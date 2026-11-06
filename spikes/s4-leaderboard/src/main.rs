//! P0 spike S4: is the k-anonymity guard affordable inside the enclave?
//!
//! Fetches the public Hyperliquid leaderboard (~40 MB), parses only the fields the
//! guard needs, and counts accounts whose 30-day ROI falls in the same bucket as a
//! card's published return.
//!
//! stdin:  {"return_bps": 1830, "precision_bps": 100}
//! stdout: rows, bytes, fetch and parse time, and k for that bucket.

use serde::Deserialize;
use serde_json::json;
use std::io::{self, Read, Write};
use std::time::{Duration, Instant};
use wasi_http_client::Client;

const LEADERBOARD: &str = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

#[derive(Deserialize)]
struct Input {
    return_bps: i64,
    precision_bps: i64,
}

#[derive(Deserialize)]
struct Leaderboard {
    #[serde(rename = "leaderboardRows")]
    rows: Vec<Row>,
}

#[derive(Deserialize)]
struct Row {
    #[serde(rename = "windowPerformances")]
    windows: Vec<(String, Perf)>,
}

#[derive(Deserialize)]
struct Perf {
    roi: String,
}

fn main() {
    if let Err(e) = run() {
        print!("{}", json!({ "spike": "s4", "error": e.to_string() }));
        let _ = io::stdout().flush();
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw)?;
    let input: Input = serde_json::from_str(&raw)?;
    if input.precision_bps <= 0 {
        return Err("precision_bps must be positive".into());
    }

    let started = Instant::now();
    let response = Client::new()
        .get(LEADERBOARD)
        .connect_timeout(Duration::from_secs(15))
        .send()?;
    let status = response.status();
    let bytes = response.body()?;
    if !(200..300).contains(&status) {
        return Err(format!("leaderboard answered HTTP {status}").into());
    }
    let fetch_ms = started.elapsed().as_millis();

    let parse_started = Instant::now();
    let board: Leaderboard = serde_json::from_slice(&bytes)?;
    let parse_ms = parse_started.elapsed().as_millis();

    // The card's bucket is [return rounded down to precision, + precision).
    let low = input.return_bps.div_euclid(input.precision_bps) * input.precision_bps;
    let high = low + input.precision_bps;
    let month_rois = board
        .rows
        .iter()
        .filter_map(|r| r.windows.iter().find(|(name, _)| name == "month"))
        .filter_map(|(_, perf)| perf.roi.parse::<f64>().ok());
    let mut with_month = 0usize;
    let mut k = 0usize;
    for roi in month_rois {
        with_month += 1;
        let bps = (roi * 10_000.0).floor() as i64;
        if bps >= low && bps < high {
            k += 1;
        }
    }

    let output = json!({
        "spike": "s4",
        "bytes": bytes.len(),
        "rows": board.rows.len(),
        "rows_with_month": with_month,
        "bucket_bps": [low, high],
        "k": k,
        "fetch_ms": fetch_ms,
        "parse_ms": parse_ms,
        "total_ms": started.elapsed().as_millis(),
    });
    print!("{output}");
    io::stdout().flush()?;
    Ok(())
}
