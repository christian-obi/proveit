//! From account data to a signed card.

use crate::card::{self, Card, CardOrders, CardStats, CardWindow, SignedCard};
use crate::commit;
use crate::error::{Code, Error, Result};
use crate::hl::{Fill, Point, Portfolio, Series, Source};
use crate::merkle;
use crate::orders;
use crate::platform::Platform;
use crate::rules;
use crate::stats::{self, MIN_CAPITAL, MS_PER_DAY};
use rust_decimal::Decimal;
use serde_json::json;

pub const WINDOWS: [u32; 5] = [1, 7, 30, 90, 180];
pub const VENUE: &str = "hyperliquid";

/// The account-value series for a window. 1, 7 and 30 days use Hyperliquid's `day`, `week`
/// and `month` windows (dense sampling); 90 and 180 days slice the sparser `allTime` window.
/// 1-day cards exist for live testing with a new account; the UI labels them as such.
pub fn select_series(portfolio: &Portfolio, window_days: u32) -> Result<Series> {
    match window_days {
        1 => Ok(portfolio.window("day")?.clone()),
        7 => Ok(portfolio.window("week")?.clone()),
        30 => Ok(portfolio.window("month")?.clone()),
        90 | 180 => {
            let all = portfolio.window("allTime")?;
            let end = all.account_value.last().map(|p| p.t).unwrap_or(0);
            let start = end.saturating_sub(window_days as u64 * MS_PER_DAY);
            let keep = |pts: &[Point]| pts.iter().copied().filter(|p| p.t >= start).collect::<Vec<_>>();
            Ok(Series { account_value: keep(&all.account_value), pnl: keep(&all.pnl) })
        }
        other => Err(Error::new(Code::BadInput, format!("window_days must be 1, 7, 30, 90 or 180, not {other}"))),
    }
}

/// When the account first held at least MIN_CAPITAL, from the `allTime` history.
pub fn first_funded_ms(portfolio: &Portfolio) -> Result<u64> {
    portfolio
        .window("allTime")?
        .account_value
        .iter()
        .find(|p| p.v >= MIN_CAPITAL)
        .map(|p| p.t)
        .ok_or_else(|| Error::new(Code::NoData, "the account has never held at least $100"))
}

/// Statistics for one account and window, with everything a card is built from.
pub struct Measured {
    pub window: CardWindow,
    pub stats: CardStats,
    pub series: Series,
    pub fills: Vec<Fill>,
}

pub fn measure(source: &impl Source, address: &str, window_days: u32) -> Result<Measured> {
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
    Ok(Measured {
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
        series,
        fills,
    })
}

pub struct IssueParams<'a> {
    pub address: &'a str,
    pub window_days: u32,
    pub issuer: &'a str,
    pub nonce: u64,
    pub issued_at: u64,
    pub outlayer_request_id: Option<String>,
    pub mode: &'a str,
}

/// Measure, commit to every order, store what a later reveal needs, and sign.
pub fn issue(source: &impl Source, platform: &impl Platform, p: &IssueParams) -> Result<SignedCard> {
    let m = measure(source, p.address, p.window_days)?;
    let records = orders::records(&m.fills, &m.series.account_value);
    let root = merkle::root(&orders::leaves(&records)?);

    let card = Card {
        v: 1,
        venue: VENUE.into(),
        kind: "trader".into(),
        scope: "account".into(),
        issuer: p.issuer.into(),
        commitment: commit::commitment(platform, VENUE, p.address)?,
        window: m.window,
        stats: m.stats,
        orders: CardOrders { root: hex::encode(root), count: records.len() as u32 },
        issued_at: p.issued_at,
        nonce: p.nonce,
        outlayer_request_id: p.outlayer_request_id.clone(),
        mode: p.mode.into(),
    };

    // A reveal (P7) re-reads the account's orders and checks them against this root.
    // The key is the card hash, never anything secret; the value is encrypted storage.
    let hash = hex::encode(card::card_hash(&card)?);
    let stored = json!({
        "v": 1,
        "venue": VENUE,
        "address": p.address.to_lowercase(),
        "window": { "start": card.window.start, "end": card.window.end },
        "orders_root": card.orders.root,
    });
    platform.store(&format!("card:{hash}"), stored.to_string().as_bytes())?;

    let sig = card::sign(platform, &card)?;
    Ok(SignedCard { card, sig: hex::encode(sig) })
}
