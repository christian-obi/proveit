//! Order records: what a viewing key reveals, and what a card's Merkle root commits to.
//!
//! One record per order (`oid`), coarsened so it helps a follower copy the strategy
//! without identifying the wallet: the hour instead of the millisecond, size and PnL
//! as a share of account value instead of dollars, and no hashes, order or trade IDs.

use crate::canonical::to_canonical;
use crate::error::Result;
use crate::hl::{Fill, Point};
use crate::merkle;
use crate::stats::to_bps;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
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
    struct Acc {
        first_time: u64,
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
            coin: f.coin.clone(),
            dir: f.dir.clone(),
            notional: Decimal::ZERO,
            net: Decimal::ZERO,
            fills: 0,
        });
        a.notional += (f.px * f.sz).abs();
        if !f.closed_pnl.is_zero() || f.dir.starts_with("Close") {
            a.net += f.closed_pnl - fee;
        }
        a.fills += 1;
    }
    let mut out: Vec<(u64, u64, OrderRecord)> = by_oid
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
            (a.first_time, oid, record)
        })
        .collect();
    out.sort_by_key(|(t, oid, _)| (*t, *oid));
    out.into_iter().map(|(_, _, r)| r).collect()
}

/// Merkle leaves for the records, in order.
pub fn leaves(records: &[OrderRecord]) -> Result<Vec<merkle::Hash>> {
    records.iter().map(|r| Ok(merkle::leaf_hash(to_canonical(r)?.as_bytes()))).collect()
}
