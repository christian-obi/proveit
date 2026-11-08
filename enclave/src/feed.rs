//! The live feed (copy trading): the trader's orders after the card's window, each linked
//! into one hash chain per card, encrypted to each follower.
//!
//!   head_0 = sha256("proveit-feed-v1" ‖ card_hash)
//!   head_n = sha256(head_{n-1} ‖ sha256(canonical({"seq": n-1, "record": record})))
//!
//! The chain lives in the run's storage cell, extended with compare-and-swap, so every
//! follower is served the same chain: a follower who keeps the head they saw last can
//! tell if anything was later dropped, reordered or rewritten, and two followers can
//! compare heads. Orders join the chain once their last fill is SETTLE_MS old (so a
//! partly filled order isn't split), and are shown to a follower once the key's delay
//! has passed (0 = live). Records are coarsened exactly like a card's (src/orders.rs).

use crate::auth::{self, Follower};
use crate::canonical::to_canonical;
use crate::ecies;
use crate::error::{Code, Error, Result};
use crate::hl::Source;
use crate::merkle::Hash;
use crate::near::Near;
use crate::nep413::SignedMessage;
use crate::orders::{self, OrderRecord};
use crate::platform::Platform;
use crate::reveal::Stored;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SETTLE_MS: u64 = 120_000;
pub const PAGE_LIMIT: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredEntry {
    pub record: OrderRecord,
    pub last_fill_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeedState {
    pub v: u32,
    /// Every fill up to here has been looked at.
    pub scanned_until_ms: u64,
    pub entries: Vec<StoredEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub seq: u64,
    pub record: OrderRecord,
}

/// What a follower decrypts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeedPage {
    pub v: u32,
    pub card_hash: String,
    pub follower: String,
    /// The first entry's sequence number (the follower's cursor).
    pub from: u64,
    /// The chain head before `entries[0]`.
    pub prev_head: String,
    pub entries: Vec<Entry>,
    /// The head after the last entry: the follower keeps it and sends `next` next time.
    pub head: String,
    pub next: u64,
    /// Orders already in the chain but newer than the key's delay.
    pub held_back: u64,
    pub delay_secs: u64,
    pub as_of: u64,
}

pub fn genesis(card_hash: &str) -> Hash {
    let mut h = Sha256::new();
    h.update(b"proveit-feed-v1");
    h.update(card_hash.as_bytes());
    h.finalize().into()
}

pub fn link(prev: &Hash, entry: &Entry) -> Result<Hash> {
    let leaf: Hash = Sha256::digest(to_canonical(entry)?.as_bytes()).into();
    let mut h = Sha256::new();
    h.update(prev);
    h.update(leaf);
    Ok(h.finalize().into())
}

/// heads[i] = the head after the first i entries.
pub fn heads(card_hash: &str, entries: &[StoredEntry]) -> Result<Vec<Hash>> {
    let mut out = vec![genesis(card_hash)];
    for (i, e) in entries.iter().enumerate() {
        let next = link(out.last().unwrap(), &Entry { seq: i as u64, record: e.record.clone() })?;
        out.push(next);
    }
    Ok(out)
}

/// Settled orders since the last scan, coarsened against the account value at the time.
pub fn scan(source: &impl Source, address: &str, scanned_until_ms: u64, now_ms: u64) -> Result<(Vec<StoredEntry>, u64)> {
    let end = now_ms.saturating_sub(SETTLE_MS);
    if end <= scanned_until_ms {
        return Ok((vec![], scanned_until_ms));
    }
    let fills = source.fills_between(address, scanned_until_ms + 1, end)?;
    if fills.is_empty() {
        return Ok((vec![], end));
    }
    let portfolio = source.portfolio(address)?;
    let av = &portfolio.window("month")?.account_value;
    let entries = orders::timed_records(&fills, av).into_iter().map(|(record, last_fill_ms)| StoredEntry { record, last_fill_ms }).collect();
    Ok((entries, end))
}

/// Extend the card's chain with anything new and return it. Retries if another run
/// extended it at the same time.
pub fn update(platform: &impl Platform, source: &impl Source, card_hash: &str, card: &Stored, now_ms: u64) -> Result<FeedState> {
    let key = format!("feed:{card_hash}");
    for _ in 0..3 {
        let current = platform.cell_get(&key)?;
        let state = match &current {
            Some(b) => serde_json::from_slice(b).map_err(|e| Error::new(Code::Upstream, format!("stored feed: {e}")))?,
            None => FeedState { v: 1, scanned_until_ms: card.window.end, entries: vec![] },
        };
        let (new, scanned) = scan(source, &card.address, state.scanned_until_ms, now_ms)?;
        if new.is_empty() {
            // Nothing to add: don't write (the next poll scans the same range again).
            return Ok(state);
        }
        let mut next = state;
        next.entries.extend(new);
        next.scanned_until_ms = scanned;
        let bytes = serde_json::to_vec(&next).map_err(|e| Error::new(Code::Upstream, e.to_string()))?;
        if platform.cell_swap(&key, current.as_deref(), &bytes)? {
            return Ok(next);
        }
    }
    Err(Error::new(Code::Upstream, "the feed is busy; try again"))
}

/// The follower's page: entries from `from`, as far as the delay allows.
pub fn page(state: &FeedState, card_hash: &str, follower: &str, from: u64, delay_secs: u64, now_ms: u64) -> Result<FeedPage> {
    let hs = heads(card_hash, &state.entries)?;
    let n = state.entries.len();
    let from = (from as usize).min(n);
    let delay_ms = delay_secs.saturating_mul(1000);
    let shown = state.entries[from..].iter().take(PAGE_LIMIT).take_while(|e| e.last_fill_ms.saturating_add(delay_ms) <= now_ms).count();
    let to = from + shown;
    Ok(FeedPage {
        v: 1,
        card_hash: card_hash.to_string(),
        follower: follower.to_string(),
        from: from as u64,
        prev_head: hex::encode(hs[from]),
        entries: state.entries[from..to].iter().enumerate().map(|(i, e)| Entry { seq: (from + i) as u64, record: e.record.clone() }).collect(),
        head: hex::encode(hs[to]),
        next: to as u64,
        held_back: state.entries[to..].iter().filter(|e| e.last_fill_ms.saturating_add(delay_ms) > now_ms).count() as u64,
        delay_secs,
        as_of: now_ms / 1000,
    })
}

/// The follower's check. `last_head` is the head they kept from their previous page.
pub fn check(p: &FeedPage, last_head: Option<&str>) -> Result<()> {
    let bad = |m: &str| Error::new(Code::BadInput, m.to_string());
    let expected_prev = match last_head {
        Some(h) => h.to_string(),
        None if p.from == 0 => hex::encode(genesis(&p.card_hash)),
        None => return Ok(()), // nothing to compare the start against yet
    };
    if p.prev_head != expected_prev {
        return Err(bad("the feed doesn't continue from the head you saw last: something was rewritten"));
    }
    let mut head: Hash = hex::decode(&p.prev_head).ok().and_then(|b| b.try_into().ok()).ok_or_else(|| bad("bad head"))?;
    for (i, e) in p.entries.iter().enumerate() {
        if e.seq != p.from + i as u64 {
            return Err(bad("entries are out of sequence"));
        }
        head = link(&head, e)?;
    }
    if hex::encode(head) != p.head || p.next != p.from + p.entries.len() as u64 {
        return Err(bad("the entries don't lead to the stated head: one was dropped, edited or reordered"));
    }
    Ok(())
}

pub struct Sealed {
    pub ciphertext: Vec<u8>,
    pub head: String,
    pub next: u64,
}

/// The `feed` op (HTTPS): authorize, then extend and serve the chain, encrypted.
#[allow(clippy::too_many_arguments)]
pub fn feed_for(
    platform: &impl Platform,
    source: &impl Source,
    near: &impl Near,
    registry: &str,
    card_id: u64,
    since: u64,
    auth_msg: &SignedMessage,
    now_secs: u64,
) -> Result<Sealed> {
    let f: Follower = auth::authorize(near, registry, card_id, auth_msg, now_secs)?;
    let raw = platform.load(&format!("card:{}", f.card_hash))?.ok_or_else(|| Error::new(Code::CardNotFound, "no data for this card"))?;
    let card: Stored = serde_json::from_slice(&raw).map_err(|_| Error::new(Code::CardNotFound, "this card was issued by an older enclave build"))?;
    let now_ms = now_secs.saturating_mul(1000);
    let state = update(platform, source, &f.card_hash, &card, now_ms)?;
    let p = page(&state, &f.card_hash, &f.account, since, f.delay_secs, now_ms)?;
    let mut recipient = [0u8; 32];
    hex::decode_to_slice(&f.x25519_pub, &mut recipient).map_err(|_| Error::new(Code::BadInput, "the signed X25519 key is not 32 bytes of hex"))?;
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&platform.random_32()?[..12]);
    let ciphertext = ecies::seal(&recipient, to_canonical(&p)?.as_bytes(), platform.random_32()?, nonce)?;
    Ok(Sealed { ciphertext, head: p.head, next: p.next })
}
