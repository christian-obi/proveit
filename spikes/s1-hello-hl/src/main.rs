//! P0 spike S1: can a WASI P2 module reach Hyperliquid's public info API?
//!
//! stdin:  {"user": "0x…"}
//! stdout: a short summary of the `portfolio` windows (kept under 1 KB so it
//!         takes OutLayer's single-call resolve path).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::time::Duration;
use wasi_http_client::Client;

const HL_INFO: &str = "https://api.hyperliquid.xyz/info";

#[derive(Deserialize)]
struct Input {
    user: String,
}

#[derive(Deserialize)]
struct Window {
    #[serde(rename = "accountValueHistory")]
    account_value_history: Vec<(u64, String)>,
}

#[derive(Serialize)]
struct WindowSummary {
    points: usize,
    first_ts: Option<u64>,
    last_ts: Option<u64>,
    last_account_value: Option<String>,
}

#[derive(Serialize)]
struct Output {
    spike: &'static str,
    bytes_fetched: usize,
    windows: BTreeMap<String, WindowSummary>,
}

fn main() {
    if let Err(e) = run() {
        print!("{}", serde_json::json!({ "spike": "s1", "error": e.to_string() }));
        let _ = io::stdout().flush();
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw)?;
    let input: Input = serde_json::from_str(&raw)?;
    if !is_evm_address(&input.user) {
        return Err("user must be a 0x-prefixed 20-byte hex address".into());
    }

    let body = serde_json::json!({ "type": "portfolio", "user": input.user }).to_string();
    let response = Client::new()
        .post(HL_INFO)
        .header("Content-Type", "application/json")
        .body(body.as_bytes())
        .connect_timeout(Duration::from_secs(10))
        .send()?;

    let status = response.status();
    let bytes = response.body()?;
    if !(200..300).contains(&status) {
        return Err(format!("hyperliquid answered HTTP {status}: {}", String::from_utf8_lossy(&bytes)).into());
    }

    let portfolio: Vec<(String, Window)> = serde_json::from_slice(&bytes)?;
    let windows = portfolio
        .into_iter()
        .map(|(name, w)| {
            let h = &w.account_value_history;
            let summary = WindowSummary {
                points: h.len(),
                first_ts: h.first().map(|p| p.0),
                last_ts: h.last().map(|p| p.0),
                last_account_value: h.last().map(|p| p.1.clone()),
            };
            (name, summary)
        })
        .collect();

    let output = Output { spike: "s1", bytes_fetched: bytes.len(), windows };
    print!("{}", serde_json::to_string(&output)?);
    io::stdout().flush()?;
    Ok(())
}

fn is_evm_address(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}
