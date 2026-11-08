//! The card, its canonical bytes, and its signature.
//!
//! Every number is an integer (basis points or ×100), so the signed bytes never depend
//! on float formatting. Unknown fields are refused when parsing, so a verifier can't be
//! handed extra claims it doesn't understand.
//!
//!   card_bytes = canonical JSON of the card (src/canonical.rs)
//!   card_hash  = sha256(card_bytes)                            what the registry stores
//!   signed     = sha256("proveit-card-v1\n" ‖ card_bytes)       32 bytes
//!   sig        = ed25519(cards key, signed)
//!
//! The code hash is not in the card: the code can't know its own hash. The registry
//! records the version it pinned, and the attestation proves which binary ran.

use crate::canonical::to_canonical;
use crate::error::{Code, Error, Result};
use crate::platform::Platform;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SIGNING_PREFIX: &[u8] = b"proveit-card-v1\n";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Card {
    pub v: u8,
    pub venue: String,
    pub kind: String,
    /// "account": statistics cover the whole Hyperliquid account (spot + perps).
    pub scope: String,
    pub issuer: String,
    /// Same for every card from one account; can't be reversed (src/commit.rs).
    pub commitment: String,
    pub window: CardWindow,
    pub stats: CardStats,
    pub orders: CardOrders,
    /// Unix seconds.
    pub issued_at: u64,
    /// From the ownership signature; the registry refuses a nonce twice.
    pub nonce: u64,
    /// The OutLayer request that produced this card, to find its attestation.
    pub outlayer_request_id: Option<String>,
    /// "live" for real issuance; "fixture" for test builds (never valid on-chain).
    pub mode: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardWindow {
    /// The requested length: 30, 90 or 180.
    pub days: u32,
    /// Unix milliseconds of the first and last samples measured.
    pub start: u64,
    pub end: u64,
    pub samples: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardStats {
    pub return_bps: i64,
    pub max_dd_bps: i64,
    pub win_rate_bps: i64,
    pub trades: u32,
    /// None when there were no losing trades.
    pub profit_factor_x100: Option<i64>,
    pub volume_band: String,
    pub active_days: u32,
    /// Deposits and withdrawals in the window as a share of average capital, in bps.
    pub flow_turnover_bps: i64,
    /// Set on issued cards by the k-anonymity guard (src/kanon.rs): `return_bps` is then the
    /// lower edge of a bucket this wide, shared by at least `k_anon` leaderboard accounts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_precision_bps: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k_anon: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k_min: Option<u32>,
}

/// The Merkle commitment to every order in the window (src/orders.rs, src/merkle.rs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardOrders {
    pub root: String,
    pub count: u32,
}

pub fn card_bytes(card: &Card) -> Result<Vec<u8>> {
    Ok(to_canonical(card)?.into_bytes())
}

pub fn card_hash(card: &Card) -> Result<[u8; 32]> {
    Ok(Sha256::digest(card_bytes(card)?).into())
}

/// The 32 bytes the enclave signs.
pub fn signing_message(card: &Card) -> Result<[u8; 32]> {
    let mut h = Sha256::new();
    h.update(SIGNING_PREFIX);
    h.update(card_bytes(card)?);
    Ok(h.finalize().into())
}

pub fn sign(platform: &impl Platform, card: &Card) -> Result<[u8; 64]> {
    platform.sign_card(&signing_message(card)?)
}

/// The enclave's answer for `issue`. Kept under 1 KB so OutLayer resolves it in one call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedCard {
    pub card: Card,
    /// 64-byte ed25519 signature, hex.
    pub sig: String,
}

impl SignedCard {
    pub fn signature(&self) -> Result<[u8; 64]> {
        let mut out = [0u8; 64];
        hex::decode_to_slice(&self.sig, &mut out).map_err(|_| Error::new(Code::BadInput, "sig is not 64 bytes of hex"))?;
        Ok(out)
    }
}
