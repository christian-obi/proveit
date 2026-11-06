//! The enclave binary: one request on stdin, one JSON answer on stdout.
//!
//! stdin:  {"op": "stats", "window_days": 30}
//! env:    PROVEIT_SECRET  {"venue":"hyperliquid","proof":{...OwnershipProof}}  (an encrypted
//!                         OutLayer secret, decrypted only inside the TEE)
//!         NEAR_SENDER_ID  the NEAR account issuing the card (set by the platform)
//! stdout: {"status":"ok","card":{...}} or {"status":"err","code":"...","message":"..."}
//!
//! With `--features fixtures`, data comes from PROVEIT_FIXTURE_DIR and the ownership
//! check is skipped; such cards say "mode": "fixture" and are never accepted on-chain.

use proveit_enclave::error::{Code, Error, Result};
use proveit_enclave::pipeline;
use serde::Deserialize;
use serde_json::json;
use std::io::{self, Read, Write};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Stats { window_days: u32 },
}

fn main() {
    let answer = match run() {
        Ok(card) => json!({ "status": "ok", "card": card }),
        Err(e) => json!({ "status": "err", "code": e.code, "message": e.message }),
    };
    print!("{answer}");
    let _ = io::stdout().flush();
}

fn run() -> Result<proveit_enclave::card::Card> {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).map_err(|e| Error::new(Code::BadInput, e.to_string()))?;
    let Request::Stats { window_days } =
        serde_json::from_str(&raw).map_err(|e| Error::new(Code::BadInput, format!("bad input: {e}")))?;
    issue(window_days)
}

#[cfg(feature = "fixtures")]
fn issue(window_days: u32) -> Result<proveit_enclave::card::Card> {
    let dir = std::env::var("PROVEIT_FIXTURE_DIR")
        .map_err(|_| Error::new(Code::BadInput, "PROVEIT_FIXTURE_DIR is not set"))?;
    let source = proveit_enclave::hl::FixtureSource { dir: dir.into() };
    pipeline::build_card(&source, "fixture", window_days, "fixture", "fixture")
}

#[cfg(not(feature = "fixtures"))]
fn issue(window_days: u32) -> Result<proveit_enclave::card::Card> {
    use proveit_enclave::ownership::{self, OwnershipProof};

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Secret {
        venue: String,
        proof: OwnershipProof,
    }

    let secret: Secret = serde_json::from_str(
        &std::env::var("PROVEIT_SECRET").map_err(|_| Error::new(Code::BadInput, "PROVEIT_SECRET is not set"))?,
    )
    .map_err(|e| Error::new(Code::BadInput, format!("PROVEIT_SECRET: {e}")))?;
    if secret.venue != "hyperliquid" {
        return Err(Error::new(Code::BadInput, format!("unsupported venue '{}'", secret.venue)));
    }
    let issuer = std::env::var("NEAR_SENDER_ID")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| Error::new(Code::BadInput, "NEAR_SENDER_ID is not set"))?;

    ownership::verify(&secret.proof, &issuer, now_secs())?;
    let address = secret.proof.account.to_lowercase();
    pipeline::build_card(&live::source(), &address, window_days, &issuer, "live")
}

/// The block time when the platform gives one, else the worker's clock.
#[cfg(not(feature = "fixtures"))]
fn now_secs() -> u64 {
    std::env::var("NEAR_BLOCK_TIMESTAMP")
        .ok()
        .and_then(|ns| ns.parse::<u64>().ok())
        .map(|ns| ns / 1_000_000_000)
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        })
}

#[cfg(all(not(feature = "fixtures"), target_arch = "wasm32"))]
mod live {
    use proveit_enclave::error::{Code, Error, Result};
    use proveit_enclave::hl::{Client, Transport, INFO_URL};
    use std::time::Duration;
    use wasi_http_client::Client as Http;

    pub struct Wasi;

    impl Transport for Wasi {
        fn post(&self, body: &serde_json::Value) -> Result<Vec<u8>> {
            let payload = body.to_string();
            let response = Http::new()
                .post(INFO_URL)
                .header("Content-Type", "application/json")
                .body(payload.as_bytes())
                .connect_timeout(Duration::from_secs(10))
                .send()
                .map_err(|e| Error::new(Code::Upstream, format!("hyperliquid request failed: {e}")))?;
            let status = response.status();
            let bytes = response.body().map_err(|e| Error::new(Code::Upstream, e.to_string()))?;
            if !(200..300).contains(&status) {
                return Err(Error::new(Code::Upstream, format!("hyperliquid answered HTTP {status}")));
            }
            Ok(bytes)
        }
    }

    pub fn source() -> Client<Wasi> {
        Client { transport: Wasi }
    }
}

/// Host builds have no WASI HTTP; live mode exists only in the wasm binary.
#[cfg(all(not(feature = "fixtures"), not(target_arch = "wasm32")))]
mod live {
    use proveit_enclave::error::{Code, Error, Result};
    use proveit_enclave::hl::{Client, Transport};

    pub struct Unavailable;

    impl Transport for Unavailable {
        fn post(&self, _body: &serde_json::Value) -> Result<Vec<u8>> {
            Err(Error::new(Code::Upstream, "live mode needs the wasm32-wasip2 build"))
        }
    }

    pub fn source() -> Client<Unavailable> {
        Client { transport: Unavailable }
    }
}
