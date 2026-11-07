//! Anti-gaming rules. A card is refused, not issued with a warning, when any fails.

use crate::error::{Code, Error, Result};
use crate::stats::{ReturnStats, TradeStats, MS_PER_DAY};

pub const MIN_TRADES: u32 = 20;
/// The measured window (from the first funded sample) must cover at least this many
/// days of the requested window. A 30-day card measures at least 29 days.
pub const WINDOW_SLACK_DAYS: u64 = 1;

/// Capital must be held for the window minus a slack of one day or a fifth of the window,
/// whichever is smaller: 29 of 30 days, 6 of 7, and about 19 hours of a 1-day card.
pub fn required_ms(window_days: u64) -> u64 {
    let window = window_days * MS_PER_DAY;
    window - (WINDOW_SLACK_DAYS * MS_PER_DAY).min(window / 5)
}

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
    let measured = r.end_ms - r.start_ms;
    let required = required_ms(window_days);
    if measured < required {
        let hours = |ms: u64| ms / 3_600_000;
        return Err(Error::new(
            Code::WindowTooShort,
            format!("the account held capital for {}h of the {window_days}-day window; at least {}h are required", hours(measured), hours(required)),
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
