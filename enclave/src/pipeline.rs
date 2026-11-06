//! From account data to an (unsigned, in P1) card.

use crate::card::{Card, CardStats, CardWindow};
use crate::error::{Code, Error, Result};
use crate::hl::{Point, Series, Source};
use crate::rules;
use crate::stats::{self, MIN_CAPITAL, MS_PER_DAY};
use rust_decimal::Decimal;

pub const WINDOWS: [u32; 3] = [30, 90, 180];

/// The account-value series for a window. 30 days uses Hyperliquid's `month` window
/// (denser sampling); 90 and 180 days slice the sparser `allTime` window.
pub fn select_series(portfolio: &crate::hl::Portfolio, window_days: u32) -> Result<Series> {
    match window_days {
        30 => Ok(portfolio.window("month")?.clone()),
        90 | 180 => {
            let all = portfolio.window("allTime")?;
            let end = all.account_value.last().map(|p| p.t).unwrap_or(0);
            let start = end.saturating_sub(window_days as u64 * MS_PER_DAY);
            let keep = |pts: &[Point]| pts.iter().copied().filter(|p| p.t >= start).collect::<Vec<_>>();
            Ok(Series { account_value: keep(&all.account_value), pnl: keep(&all.pnl) })
        }
        other => Err(Error::new(Code::BadInput, format!("window_days must be 30, 90 or 180, not {other}"))),
    }
}

/// When the account first held at least MIN_CAPITAL, from the `allTime` history.
pub fn first_funded_ms(portfolio: &crate::hl::Portfolio) -> Result<u64> {
    portfolio
        .window("allTime")?
        .account_value
        .iter()
        .find(|p| p.v >= MIN_CAPITAL)
        .map(|p| p.t)
        .ok_or_else(|| Error::new(Code::NoData, "the account has never held at least $100"))
}

pub fn build_card(source: &impl Source, address: &str, window_days: u32, issuer: &str, mode: &str) -> Result<Card> {
    let portfolio = source.portfolio(address)?;
    let series = select_series(&portfolio, window_days)?;
    let requested_end = series.account_value.last().map(|p| p.t).ok_or_else(|| Error::new(Code::NoData, "empty series"))?;
    let requested_start = requested_end.saturating_sub(window_days as u64 * MS_PER_DAY);

    rules::check_account_age(first_funded_ms(&portfolio)?, requested_start)?;
    let r = stats::returns(&series)?;
    rules::check_window(&r, window_days as u64)?;

    let fills = source.fills_between(address, r.start_ms, r.end_ms)?;
    let t = stats::trades(&fills);
    rules::check_trades(&t)?;

    let win_rate = Decimal::from(t.wins) / Decimal::from(t.trades);
    Ok(Card {
        v: 1,
        venue: "hyperliquid".into(),
        kind: "trader".into(),
        scope: "account".into(),
        issuer: issuer.into(),
        window: CardWindow { days: window_days, start: r.start_ms, end: r.end_ms, samples: r.samples },
        stats: CardStats {
            return_bps: stats::to_bps(r.twr),
            max_dd_bps: stats::to_bps(r.max_drawdown),
            win_rate_bps: stats::to_bps(win_rate),
            trades: t.trades,
            profit_factor_x100: t.profit_factor.map(stats::to_x100),
            volume_band: stats::volume_band(t.volume),
            active_days: t.active_days,
            flow_turnover_bps: stats::to_bps(r.flow_turnover),
        },
        mode: mode.into(),
    })
}
