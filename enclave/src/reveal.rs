//! What a viewing key shows: the card's committed order records that are older than the
//! key's delay, with what the follower needs to check them against the card's root.
//!
//! Everything comes from what `issue` stored, so a reveal never calls Hyperliquid and
//! always matches the card: Hyperliquid's account-value windows roll forward, so
//! recomputing the records later would give different sizes and a different root.
//!
//! **Delay rule:** order i is shown iff `last_fill_ms[i] + delay_secs × 1000 ≤ now_ms`
//! (an order whose last fill is exactly `delay` old is shown), and only as part of the
//! oldest-first prefix: the first order that is too new hides itself and everything after
//! it. So a reveal is always the first k leaves, which `merkle::prefix_proof` proves with
//! at most ⌈log2 n⌉ hashes, and nothing newer than the delay ever leaves the enclave.

use crate::canonical::to_canonical;
use crate::ecies;
use crate::error::{Code, Error, Result};
use crate::merkle;
use crate::orders::{self, OrderRecord};
use crate::platform::Platform;
use serde::{Deserialize, Serialize};

pub const STORE_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredWindow {
    pub start: u64,
    pub end: u64,
}

/// Kept in encrypted worker storage under `card:<card_hash>`. Only this project's code can
/// read it; it holds the address (for the live feed, P8) and must never be output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stored {
    pub v: u32,
    pub venue: String,
    pub address: String,
    pub window: StoredWindow,
    pub orders_root: String,
    /// Hex of the newest order's salt; every other salt derives from it.
    pub last_salt: String,
    pub records: Vec<OrderRecord>,
    /// Each order's last fill (ms), for the delay rule. Never revealed.
    pub last_fill_ms: Vec<u64>,
}

/// What the follower decrypts. Bound to the card and the follower.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Revealed {
    pub v: u32,
    pub card_hash: String,
    pub follower: String,
    pub orders_root: String,
    pub total: u32,
    pub delay_secs: u64,
    /// The enclave's clock (unix seconds) when it chose what to show.
    pub as_of: u64,
    /// The first `records.len()` committed orders, oldest first.
    pub records: Vec<OrderRecord>,
    /// Salt of the last shown record (hex); `None` when nothing is shown yet.
    pub salt: Option<String>,
    /// `merkle::prefix_proof` for the hidden rest (hex).
    pub proof: Vec<String>,
}

fn parse_hash(s: &str) -> Result<merkle::Hash> {
    let mut out = [0u8; 32];
    hex::decode_to_slice(s, &mut out).map_err(|_| Error::new(Code::BadInput, "stored hash is not 32 bytes of hex"))?;
    Ok(out)
}

/// How many orders, oldest first, the delay allows at `now_ms`.
pub fn shown(last_fill_ms: &[u64], delay_secs: u64, now_ms: u64) -> usize {
    let delay_ms = delay_secs.saturating_mul(1000);
    last_fill_ms.iter().take_while(|&&t| t.saturating_add(delay_ms) <= now_ms).count()
}

pub fn reveal(stored: &Stored, card_hash: &str, follower: &str, delay_secs: u64, now_secs: u64) -> Result<Revealed> {
    if stored.v != STORE_VERSION || stored.records.len() != stored.last_fill_ms.len() {
        return Err(Error::new(Code::CardNotFound, "this card has no reveal data (issued by an older enclave build)"));
    }
    let n = stored.records.len();
    let salts = orders::salts(parse_hash(&stored.last_salt)?, n);
    let leaves = orders::leaves(&stored.records, &salts)?;
    // The stored data must be exactly what the card committed to.
    if hex::encode(merkle::root(&leaves)) != stored.orders_root {
        return Err(Error::new(Code::Upstream, "stored orders don't match the card's root"));
    }
    let k = shown(&stored.last_fill_ms, delay_secs, now_secs.saturating_mul(1000));
    Ok(Revealed {
        v: 1,
        card_hash: card_hash.to_string(),
        follower: follower.to_string(),
        orders_root: stored.orders_root.clone(),
        total: n as u32,
        delay_secs,
        as_of: now_secs,
        records: stored.records[..k].to_vec(),
        salt: k.checked_sub(1).map(|i| hex::encode(salts[i])),
        proof: merkle::prefix_proof(&leaves, k).iter().map(hex::encode).collect(),
    })
}

pub struct Sealed {
    pub ciphertext: Vec<u8>,
    pub shown: usize,
    pub total: u32,
}

/// The `reveal` op: load what issuance stored, pick what the delay allows, encrypt it to
/// the follower. The registry sends this only for a follower holding a live grant.
pub fn seal_for(platform: &impl Platform, card_hash: &str, follower: &str, follower_pub_hex: &str, delay_secs: u64, now_secs: u64) -> Result<Sealed> {
    let bad = |m: &str| Error::new(Code::BadInput, m.to_string());
    let card_hash = card_hash.to_lowercase();
    if card_hash.len() != 64 || !card_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(bad("card_hash must be a sha256 in hex"));
    }
    let mut recipient = [0u8; 32];
    hex::decode_to_slice(follower_pub_hex, &mut recipient).map_err(|_| bad("follower_x25519_pub must be 32 bytes of hex"))?;
    let raw = platform
        .load(&format!("card:{card_hash}"))?
        .ok_or_else(|| Error::new(Code::CardNotFound, "no reveal data for this card"))?;
    let stored: Stored =
        serde_json::from_slice(&raw).map_err(|_| Error::new(Code::CardNotFound, "this card has no reveal data (issued by an older enclave build)"))?;
    let shown = reveal(&stored, &card_hash, follower, delay_secs, now_secs)?;
    let plaintext = to_canonical(&shown)?;
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&platform.random_32()?[..12]);
    let ciphertext = ecies::seal(&recipient, plaintext.as_bytes(), platform.random_32()?, nonce)?;
    Ok(Sealed { ciphertext, shown: shown.records.len(), total: shown.total })
}

/// The follower's check: rebuild the root from what was shown. `Ok(k)` = k of `total`
/// records proven to be the card's first k committed orders.
pub fn check(r: &Revealed) -> Result<usize> {
    let bad = |m: &str| Error::new(Code::BadInput, m.to_string());
    let k = r.records.len();
    if k == 0 {
        return if r.proof.is_empty() { Ok(0) } else { Err(bad("proof without records")) };
    }
    let salts = orders::salts(parse_hash(r.salt.as_deref().ok_or_else(|| bad("missing salt"))?)?, k);
    let leaves = orders::leaves(&r.records, &salts)?;
    let proof = r.proof.iter().map(|h| parse_hash(h)).collect::<Result<Vec<_>>>()?;
    let root = merkle::prefix_root(&leaves, r.total as usize, &proof).ok_or_else(|| bad("proof doesn't fit the tree"))?;
    if hex::encode(root) != r.orders_root {
        return Err(bad("records don't match the card's orders root"));
    }
    Ok(k)
}
