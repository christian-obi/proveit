//! The card's data model. P2 adds the commitment, fills root, signature and
//! canonical encoding; P1 fixes the statistics part of the shape.
//!
//! Every number is an integer (basis points or ×100), so the signed bytes never
//! depend on float formatting. Unknown fields are refused when parsing, so a
//! verifier can't be handed extra claims it doesn't understand.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Card {
    pub v: u8,
    pub venue: String,
    pub kind: String,
    /// "account": statistics cover the whole Hyperliquid account (spot + perps).
    pub scope: String,
    pub issuer: String,
    pub window: CardWindow,
    pub stats: CardStats,
    /// "live" for real issuance; "fixture" for local test builds (never valid on-chain).
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
}
