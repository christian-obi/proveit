//! Deterministic trading statistics. Methodology: docs/METHODOLOGY.md.
//!
//! Returns use the account's TOTAL value series (spot + perps). Perp-only value is
//! unusable for accounts that keep collateral in spot: it jumps on internal
//! spot↔perp transfers and can sit at zero while the account trades.
//!
//! Each sampling period's return is Modified Dietz:
//!   flow_i = (AV_i − AV_{i−1}) − (PnL_i − PnL_{i−1})     money in or out, not earned
//!   base_i = AV_{i−1} + flow_i / 2                       capital assumed mid-period
//!   r_i    = (PnL_i − PnL_{i−1}) / base_i
//! and periods are linked: TWR = Π(1 + r_i) − 1. A period whose base is below
//! MIN_CAPITAL is skipped, because a return on dust is meaningless.

use crate::error::{Code, Error, Result};
use crate::hl::{Fill, Series};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};
use std::collections::{BTreeMap, BTreeSet};

/// Below this many dollars of capital a period's return is not computed.
pub const MIN_CAPITAL: Decimal = Decimal::from_parts(10, 0, 0, false, 0);
pub const MS_PER_DAY: u64 = 86_400_000;

#[derive(Debug, Clone, PartialEq)]
pub struct ReturnStats {
    /// First sample with at least MIN_CAPITAL: where measurement really starts.
    pub start_ms: u64,
    pub end_ms: u64,
    /// Samples from `start_ms` to `end_ms`, inclusive.
    pub samples: u32,
    pub twr: Decimal,
    /// Largest peak-to-trough fall of the linked index, as a fraction (0 to 1).
    pub max_drawdown: Decimal,
    pub skipped_periods: u32,
    /// Σ |flow| over the measured window ÷ average account value. High turnover means
    /// dollar PnL and time-weighted return can disagree (even in sign), so cards show it.
    pub flow_turnover: Decimal,
}

/// Linked Modified Dietz return and drawdown over the whole series.
pub fn returns(series: &Series) -> Result<ReturnStats> {
    let av = &series.account_value;
    let pnl = &series.pnl;
    if av.len() != pnl.len() || av.iter().zip(pnl).any(|(a, p)| a.t != p.t) {
        return Err(Error::new(Code::Upstream, "account value and pnl histories are not aligned"));
    }
    let first = av
        .iter()
        .position(|p| p.v >= MIN_CAPITAL)
        .ok_or_else(|| Error::new(Code::WindowTooShort, "the account never held at least $10 in this window"))?;

    let one = Decimal::ONE;
    let mut index = one;
    let mut peak = one;
    let mut max_dd = Decimal::ZERO;
    let mut skipped = 0u32;
    let mut flows = Decimal::ZERO;
    for i in (first + 1)..av.len() {
        let d_pnl = pnl[i].v - pnl[i - 1].v;
        let flow = (av[i].v - av[i - 1].v) - d_pnl;
        flows += flow.abs();
        let base = av[i - 1].v + flow / Decimal::TWO;
        if base < MIN_CAPITAL {
            skipped += 1;
            continue;
        }
        index *= one + d_pnl / base;
        if index < Decimal::ZERO {
            index = Decimal::ZERO;
        }
        if index > peak {
            peak = index;
        }
        let dd = (peak - index) / peak;
        if dd > max_dd {
            max_dd = dd;
        }
    }
    let measured = &av[first..];
    let avg_capital = measured.iter().map(|p| p.v).sum::<Decimal>() / Decimal::from(measured.len());
    Ok(ReturnStats {
        flow_turnover: if avg_capital > Decimal::ZERO { flows / avg_capital } else { Decimal::ZERO },
        start_ms: av[first].t,
        end_ms: av[av.len() - 1].t,
        samples: (av.len() - first) as u32,
        twr: index - one,
        max_drawdown: max_dd,
        skipped_periods: skipped,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct TradeStats {
    /// Orders that realized PnL (closed or reduced a position).
    pub trades: u32,
    pub wins: u32,
    /// Σ winning nets / |Σ losing nets|; None when there were no losing trades.
    pub profit_factor: Option<Decimal>,
    /// Σ |px × sz| over every fill.
    pub volume: Decimal,
    /// Distinct UTC days with at least one fill.
    pub active_days: u32,
}

/// A trade is one order (`oid`) that realized PnL. Its net is the realized PnL of its
/// fills minus their USDC fees; fees in other tokens are left out rather than guessed.
pub fn trades(fills: &[Fill]) -> TradeStats {
    let mut nets: BTreeMap<u64, Decimal> = BTreeMap::new();
    let mut volume = Decimal::ZERO;
    let mut days = BTreeSet::new();
    for f in fills {
        volume += (f.px * f.sz).abs();
        days.insert(f.time / MS_PER_DAY);
        if !f.closed_pnl.is_zero() || f.dir.starts_with("Close") {
            let fee = if f.fee_token == "USDC" { f.fee } else { Decimal::ZERO };
            *nets.entry(f.oid).or_insert(Decimal::ZERO) += f.closed_pnl - fee;
        }
    }
    let wins = nets.values().filter(|n| **n > Decimal::ZERO).count() as u32;
    let gains: Decimal = nets.values().filter(|n| **n > Decimal::ZERO).sum();
    let losses: Decimal = nets.values().filter(|n| **n < Decimal::ZERO).map(|n| -*n).sum();
    TradeStats {
        trades: nets.len() as u32,
        wins,
        profit_factor: if losses.is_zero() { None } else { Some(gains / losses) },
        volume,
        active_days: days.len() as u32,
    }
}

/// `x` in basis points, rounded half away from zero.
pub fn to_bps(x: Decimal) -> i64 {
    (x * Decimal::from(10_000))
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
        .to_i64()
        .unwrap_or(i64::MAX)
}

/// `x × 100`, rounded half away from zero (profit factor 1.71 → 171).
pub fn to_x100(x: Decimal) -> i64 {
    (x * Decimal::from(100))
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
        .to_i64()
        .unwrap_or(i64::MAX)
}

/// Order of magnitude of a dollar amount, as "1e5" for $100,000–$999,999. Never exact.
pub fn volume_band(volume: Decimal) -> String {
    let mut band = 0u32;
    let mut v = volume.trunc();
    let ten = Decimal::from(10);
    while v >= ten {
        v /= ten;
        v = v.trunc();
        band += 1;
    }
    format!("1e{band}")
}
