//! Order records: what a viewing key reveals, and what a card's Merkle root commits to.
//!
//! One record per order (`oid`), coarsened so it helps a follower copy the strategy
//! without identifying the wallet: the hour instead of the millisecond, size and PnL
//! as a share of account value instead of dollars, and no hashes, order or trade IDs.
//!
//! Leaves are salted: a record has little entropy (an hour, a coin, a side, two numbers),
//! so an unsalted leaf hash of a still-hidden order, seen as a sibling in a proof, could be
//! found by trying every plausible record. Salts form a hash chain backwards in time,
//! `salt[i] = sha256("proveit-salt-v1" ‖ salt[i+1])`, with the last one derived from the
//! enclave's MAC key. Revealing the first k orders hands over `salt[k-1]` only: the
//! follower can derive every earlier salt and none of the later ones.

use crate::canonical::to_canonical;
use crate::error::Result;
use crate::hl::{Fill, Point};
use crate::merkle;
use crate::stats::to_bps;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const MS_PER_HOUR: u64 = 3_600_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderRecord {
    /// Unix hour (ms / 3,600,000) of the order's first fill.
    pub hour: u64,
    pub coin: String,
    /// Hyperliquid's direction of the first fill: "Open Long", "Close Short", …
    pub dir: String,
    /// Σ |px × sz| of the order's fills ÷ account value, in bps.
    pub size_bps: i64,
    /// Σ realized PnL − Σ USDC fees ÷ account value, in bps (0 for opening orders).
    pub pnl_bps: i64,
    pub fills: u32,
}

/// Account value at `t`: the latest sample at or before it, or the first sample.
fn account_value_at(av: &[Point], t: u64) -> Decimal {
    let i = av.partition_point(|p| p.t <= t);
    if i == 0 {
        av.first().map(|p| p.v).unwrap_or(Decimal::ZERO)
    } else {
        av[i - 1].v
    }
}

/// Records for every order in `fills` (oldest first), measured against `account_value`.
pub fn records(fills: &[Fill], account_value: &[Point]) -> Vec<OrderRecord> {
    timed_records(fills, account_value).into_iter().map(|(r, _)| r).collect()
}

/// Records with the time (ms) of each order's LAST fill, which a delayed reveal compares
/// against: an order is shown only once all of it is older than the delay.
pub fn timed_records(fills: &[Fill], account_value: &[Point]) -> Vec<(OrderRecord, u64)> {
    struct Acc {
        first_time: u64,
        last_time: u64,
        coin: String,
        dir: String,
        notional: Decimal,
        net: Decimal,
        fills: u32,
    }
    let mut by_oid: BTreeMap<u64, Acc> = BTreeMap::new();
    for f in fills {
        let fee = if f.fee_token == "USDC" { f.fee } else { Decimal::ZERO };
        let a = by_oid.entry(f.oid).or_insert_with(|| Acc {
            first_time: f.time,
            last_time: f.time,
            coin: f.coin.clone(),
            dir: f.dir.clone(),
            notional: Decimal::ZERO,
            net: Decimal::ZERO,
            fills: 0,
        });
        a.first_time = a.first_time.min(f.time);
        a.last_time = a.last_time.max(f.time);
        a.notional += (f.px * f.sz).abs();
        if !f.closed_pnl.is_zero() || f.dir.starts_with("Close") {
            a.net += f.closed_pnl - fee;
        }
        a.fills += 1;
    }
    let mut out: Vec<(u64, u64, OrderRecord, u64)> = by_oid
        .into_iter()
        .map(|(oid, a)| {
            let equity = account_value_at(account_value, a.first_time);
            let share = |x: Decimal| if equity > Decimal::ZERO { to_bps(x / equity) } else { 0 };
            let record = OrderRecord {
                hour: a.first_time / MS_PER_HOUR,
                coin: a.coin,
                dir: a.dir,
                size_bps: share(a.notional),
                pnl_bps: share(a.net),
                fills: a.fills,
            };
            (a.first_time, oid, record, a.last_time)
        })
        .collect();
    out.sort_by_key(|(t, oid, _, _)| (*t, *oid));
    out.into_iter().map(|(_, _, r, last)| (r, last)).collect()
}

fn previous_salt(salt: &merkle::Hash) -> merkle::Hash {
    let mut h = Sha256::new();
    h.update(b"proveit-salt-v1");
    h.update(salt);
    h.finalize().into()
}

/// All `n` salts, oldest first, from the newest one (`last`).
pub fn salts(last: merkle::Hash, n: usize) -> Vec<merkle::Hash> {
    let mut out = vec![[0u8; 32]; n];
    if n == 0 {
        return out;
    }
    out[n - 1] = last;
    for i in (0..n - 1).rev() {
        out[i] = previous_salt(&out[i + 1]);
    }
    out
}

/// The leaf of one record: `sha256(0x00 ‖ salt ‖ canonical(record))`.
pub fn leaf(record: &OrderRecord, salt: &merkle::Hash) -> Result<merkle::Hash> {
    let mut bytes = salt.to_vec();
    bytes.extend_from_slice(to_canonical(record)?.as_bytes());
    Ok(merkle::leaf_hash(&bytes))
}

/// Merkle leaves for the records, in order.
pub fn leaves(records: &[OrderRecord], salts: &[merkle::Hash]) -> Result<Vec<merkle::Hash>> {
    assert_eq!(records.len(), salts.len(), "one salt per record");
    records.iter().zip(salts).map(|(r, s)| leaf(r, s)).collect()
}
