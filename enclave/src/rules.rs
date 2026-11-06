//! Anti-gaming rules. A card is refused, not issued with a warning, when any fails.

use crate::error::{Code, Error, Result};
use crate::stats::{ReturnStats, TradeStats, MS_PER_DAY};

pub const MIN_TRADES: u32 = 20;
/// The measured window (from the first funded sample) must cover at least this many
/// days of the requested window. A 30-day card measures at least 29 days.
pub const WINDOW_SLACK_DAYS: u64 = 1;

/// The account must have been funded before the requested window began; otherwise a
/// fresh account could claim a 30-day record it does not have.
pub fn check_account_age(first_funded_ms: u64, requested_start_ms: u64) -> Result<()> {
    if first_funded_ms > requested_start_ms {
        return Err(Error::new(
            Code::AccountTooNew,
            "the account was first funded after the start of the requested window",
        ));
    }
    Ok(())
}

/// The account must have held capital for (almost) the whole window, so a trader
/// can't empty an account, wait, and publish only the good stretch.
pub fn check_window(r: &ReturnStats, window_days: u64) -> Result<()> {
    let measured_days = (r.end_ms - r.start_ms) / MS_PER_DAY;
    let required = window_days.saturating_sub(WINDOW_SLACK_DAYS);
    if measured_days < required {
        return Err(Error::new(
            Code::WindowTooShort,
            format!("the account held capital for {measured_days} days of the {window_days}-day window; at least {required} are required"),
        ));
    }
    Ok(())
}

pub fn check_trades(t: &TradeStats) -> Result<()> {
    if t.trades < MIN_TRADES {
        return Err(Error::new(
            Code::TooFewTrades,
            format!("{} trades in the window; at least {MIN_TRADES} are required", t.trades),
        ));
    }
    Ok(())
}
