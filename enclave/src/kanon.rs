//! The k-anonymity guard: a card must not be traceable to its wallet through Hyperliquid's
//! public leaderboard.
//!
//! The leaderboard (~48,000 accounts) lists every account's ROI per day, week, month and
//! all time. A card's exact return could be matched against it to find the wallet. So the
//! enclave counts the accounts whose ROI for the same window falls in the card's return
//! bucket, and widens the bucket until at least K_MIN share it:
//!
//!   0.1% → 1% → 5% → 25% → 100%; none reaches K_MIN → the card is refused (PRIVACY_RISK).
//!
//! The card then publishes the bucket (`return_bps` = its lower edge,
//! `return_precision_bps` = its width) and `k_anon`, "1 of ≥ K accounts". Hyperliquid's ROI
//! and the card's time-weighted return are computed differently; what matters is what an
//! observer could match, and they would compare the published bucket with the same list.

use crate::error::{Code, Error, Result};
use serde::Deserialize;

pub const LEADERBOARD_URL: &str = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
pub const K_MIN: u32 = 25;
pub const PRECISIONS_BPS: [i64; 5] = [10, 100, 500, 2_500, 10_000];

/// ROI in bps (floor), sorted, per leaderboard window.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Board {
    pub day: Vec<i64>,
    pub week: Vec<i64>,
    pub month: Vec<i64>,
    #[serde(rename = "allTime")]
    pub all_time: Vec<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Anon {
    pub return_bps: i64,
    pub precision_bps: i64,
    pub k: u32,
}

fn to_bps(roi: &str) -> Option<i64> {
    let x: f64 = roi.parse().ok()?;
    x.is_finite().then(|| (x * 10_000.0).floor() as i64)
}

impl Board {
    /// The live leaderboard JSON (`leaderboardRows[].windowPerformances`). Only the ROI per
    /// window is kept; addresses and everything else are dropped while parsing.
    pub fn parse_live(bytes: &[u8]) -> Result<Board> {
        #[derive(Deserialize)]
        struct Perf {
            roi: String,
        }
        #[derive(Deserialize)]
        struct Row {
            #[serde(rename = "windowPerformances")]
            windows: Vec<(String, Perf)>,
        }
        #[derive(Deserialize)]
        struct Live {
            #[serde(rename = "leaderboardRows")]
            rows: Vec<Row>,
        }
        let live: Live = serde_json::from_slice(bytes).map_err(|e| Error::new(Code::Upstream, format!("leaderboard: {e}")))?;
        let mut b = Board::default();
        for row in live.rows {
            for (name, perf) in row.windows {
                let Some(v) = to_bps(&perf.roi) else { continue };
                match name.as_str() {
                    "day" => b.day.push(v),
                    "week" => b.week.push(v),
                    "month" => b.month.push(v),
                    "allTime" => b.all_time.push(v),
                    _ => {}
                }
            }
        }
        b.sort();
        if b.month.len() < 1_000 {
            return Err(Error::new(Code::Upstream, format!("the leaderboard has only {} accounts; refusing to judge privacy on it", b.month.len())));
        }
        Ok(b)
    }

    /// The recorded form in `fixtures/leaderboard.json` (already per window, sorted).
    pub fn parse_compact(bytes: &[u8]) -> Result<Board> {
        let mut b: Board = serde_json::from_slice(bytes).map_err(|e| Error::new(Code::NoData, format!("leaderboard fixture: {e}")))?;
        b.sort();
        Ok(b)
    }

    fn sort(&mut self) {
        for v in [&mut self.day, &mut self.week, &mut self.month, &mut self.all_time] {
            v.sort_unstable();
        }
    }

    /// The leaderboard window an observer would compare a card's window with.
    pub fn for_window(&self, days: u32) -> &[i64] {
        match days {
            1 => &self.day,
            7 => &self.week,
            30 => &self.month,
            _ => &self.all_time,
        }
    }
}

/// How many of `sorted` fall in [low, low + width).
pub fn count(sorted: &[i64], low: i64, width: i64) -> u32 {
    let a = sorted.partition_point(|&x| x < low);
    let b = sorted.partition_point(|&x| x < low + width);
    (b - a) as u32
}

/// The narrowest bucket around `return_bps` shared by at least `k_min` accounts.
pub fn coarsen(return_bps: i64, sorted: &[i64], k_min: u32) -> Result<Anon> {
    for p in PRECISIONS_BPS {
        let low = return_bps.div_euclid(p) * p;
        let k = count(sorted, low, p);
        if k >= k_min {
            return Ok(Anon { return_bps: low, precision_bps: p, k });
        }
    }
    Err(Error::new(
        Code::PrivacyRisk,
        format!("fewer than {k_min} leaderboard accounts have a return near this one, even rounded to 100%; a card would point at the wallet"),
    ))
}
