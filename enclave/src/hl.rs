//! Hyperliquid public info API: response types, pagination, and data sources.
//!
//! Facts this module relies on (checked against the live API, 6 Nov 2026):
//! - `userFillsByTime` returns at most 2,000 fills, oldest first, and `startTime` is
//!   inclusive. Many fills can share one millisecond, so the next page starts AT the
//!   last timestamp and duplicates are dropped by `tid`. Starting at `last + 1` would
//!   silently lose fills.
//! - Only the 10,000 most recent fills are retrievable.
//! - `portfolio` returns `[window, {accountValueHistory, pnlHistory, vlm}]` pairs with
//!   identical timestamps in both histories.

use crate::error::{Code, Error, Result};
use rust_decimal::Decimal;
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::str::FromStr;

pub const INFO_URL: &str = "https://api.hyperliquid.xyz/info";
pub const PAGE_SIZE: usize = 2_000;
pub const FILL_CAP: usize = 10_000;

fn dec<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Decimal, D::Error> {
    let s = String::deserialize(d)?;
    Decimal::from_str(&s).map_err(serde::de::Error::custom)
}

/// One `[timestamp_ms, "decimal"]` sample.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub t: u64,
    pub v: Decimal,
}

impl<'de> Deserialize<'de> for Point {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let (t, s): (u64, String) = Deserialize::deserialize(d)?;
        let v = Decimal::from_str(&s).map_err(serde::de::Error::custom)?;
        Ok(Point { t, v })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Series {
    #[serde(rename = "accountValueHistory")]
    pub account_value: Vec<Point>,
    #[serde(rename = "pnlHistory")]
    pub pnl: Vec<Point>,
}

#[derive(Debug, Clone)]
pub struct Portfolio {
    pub windows: BTreeMap<String, Series>,
}

impl Portfolio {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let pairs: Vec<(String, Series)> =
            serde_json::from_slice(bytes).map_err(|e| Error::new(Code::Upstream, format!("portfolio: {e}")))?;
        Ok(Self { windows: pairs.into_iter().collect() })
    }

    pub fn window(&self, name: &str) -> Result<&Series> {
        self.windows
            .get(name)
            .ok_or_else(|| Error::new(Code::NoData, format!("portfolio has no '{name}' window")))
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Fill {
    pub coin: String,
    #[serde(deserialize_with = "dec")]
    pub px: Decimal,
    #[serde(deserialize_with = "dec")]
    pub sz: Decimal,
    pub side: String,
    pub time: u64,
    pub dir: String,
    #[serde(rename = "closedPnl", deserialize_with = "dec")]
    pub closed_pnl: Decimal,
    #[serde(deserialize_with = "dec")]
    pub fee: Decimal,
    #[serde(rename = "feeToken")]
    pub fee_token: String,
    pub oid: u64,
    pub tid: u64,
}

/// Sends one JSON body to the info endpoint and returns the raw response.
pub trait Transport {
    fn post(&self, body: &Value) -> Result<Vec<u8>>;
}

/// Where account data comes from: the live API, or recorded fixtures.
pub trait Source {
    fn portfolio(&self, address: &str) -> Result<Portfolio>;
    /// Every fill with `start_ms <= time <= end_ms`, oldest first, no duplicates.
    fn fills_between(&self, address: &str, start_ms: u64, end_ms: u64) -> Result<Vec<Fill>>;
}

pub struct Client<T: Transport> {
    pub transport: T,
}

impl<T: Transport> Source for Client<T> {
    fn portfolio(&self, address: &str) -> Result<Portfolio> {
        Portfolio::parse(&self.transport.post(&json!({ "type": "portfolio", "user": address }))?)
    }

    fn fills_between(&self, address: &str, start_ms: u64, end_ms: u64) -> Result<Vec<Fill>> {
        let mut seen = HashSet::new();
        let mut fills = Vec::new();
        let mut cursor = start_ms;
        loop {
            let body = json!({ "type": "userFillsByTime", "user": address, "startTime": cursor, "endTime": end_ms });
            let page: Vec<Fill> = serde_json::from_slice(&self.transport.post(&body)?)
                .map_err(|e| Error::new(Code::Upstream, format!("userFillsByTime: {e}")))?;
            let full = page.len() >= PAGE_SIZE;
            let last_time = page.last().map(|f| f.time);
            for f in page {
                if seen.insert(f.tid) {
                    fills.push(f);
                }
            }
            if fills.len() >= FILL_CAP {
                return Err(Error::new(
                    Code::FillCapExceeded,
                    format!("more than {FILL_CAP} fills in the window; Hyperliquid only serves the {FILL_CAP} most recent"),
                ));
            }
            match last_time {
                Some(t) if full && t > cursor => cursor = t,
                Some(_) if full => {
                    return Err(Error::new(
                        Code::Upstream,
                        format!("a full page of fills shares one millisecond ({cursor}); cannot paginate past it"),
                    ))
                }
                _ => break,
            }
        }
        fills.sort_by_key(|f| (f.time, f.tid));
        Ok(fills)
    }
}

/// Recorded data in `<dir>/portfolio.json` and `<dir>/fills.json`, written by
/// `scripts/record-fixtures.ts`. Used by the tests and by `--features fixtures` builds.
pub struct FixtureSource {
    pub dir: std::path::PathBuf,
}

impl FixtureSource {
    fn read(&self, name: &str) -> Result<Vec<u8>> {
        std::fs::read(self.dir.join(name))
            .map_err(|e| Error::new(Code::NoData, format!("fixture {}: {e}", self.dir.join(name).display())))
    }
}

impl Source for FixtureSource {
    fn portfolio(&self, _address: &str) -> Result<Portfolio> {
        Portfolio::parse(&self.read("portfolio.json")?)
    }

    fn fills_between(&self, _address: &str, start_ms: u64, end_ms: u64) -> Result<Vec<Fill>> {
        let all: Vec<Fill> = serde_json::from_slice(&self.read("fills.json")?)
            .map_err(|e| Error::new(Code::NoData, format!("fills.json: {e}")))?;
        let mut fills: Vec<Fill> = all.into_iter().filter(|f| f.time >= start_ms && f.time <= end_ms).collect();
        fills.sort_by_key(|f| (f.time, f.tid));
        Ok(fills)
    }
}

pub fn is_evm_address(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}
