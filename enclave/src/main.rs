//! The enclave binary: one request on stdin, one JSON answer on stdout.
//!
//! stdin:  {"op": "pubkey"}                      → {"status":"ok","pubkey":"<hex>"}
//!         {"op": "issue", "window_days": 30}    → {"status":"ok","card":{...},"sig":"<hex>"}
//! env:    PROVEIT_SECRET   {"venue":"hyperliquid","proof":{...OwnershipProof}}: an encrypted
//!                          OutLayer secret, decrypted only inside the TEE
//!         NEAR_SENDER_ID, NEAR_BLOCK_TIMESTAMP, NEAR_REQUEST_ID   set by the platform
//! errors: {"status":"err","code":"...","message":"..."}
//!
//! Builds (see Cargo.toml):
//!   default        live: Hyperliquid over HTTPS, ownership check, the TEE's own keys
//!   fixtures       local wasmtime: data from PROVEIT_FIXTURE_DIR, the public test key
//!   demo-fixture   testnet smoke test: the `winner` fixture compiled in, the TEE's keys

use proveit_enclave::error::{Code, Error, Result};
use proveit_enclave::platform::Platform;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, Read, Write};

#[cfg(all(feature = "fixtures", feature = "demo-fixture"))]
compile_error!("choose one of `fixtures` and `demo-fixture`");

/// The manifest lives in the `outlayer.manifest` custom section, covered by the wasm's sha256.
#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] = *include_bytes!("../manifest.json");

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Pubkey,
    Issue { window_days: u32 },
}

fn main() {
    let answer = run().unwrap_or_else(|e| json!({ "status": "err", "code": e.code, "message": e.message }));
    print!("{answer}");
    let _ = io::stdout().flush();
}

fn run() -> Result<Value> {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).map_err(|e| Error::new(Code::BadInput, e.to_string()))?;
    let request: Request = serde_json::from_str(&raw).map_err(|e| Error::new(Code::BadInput, format!("bad input: {e}")))?;
    let platform = build::platform();
    match request {
        Request::Pubkey => Ok(json!({ "status": "ok", "pubkey": hex::encode(platform.card_public_key()?) })),
        Request::Issue { window_days } => {
            let signed = build::issue(&platform, window_days)?;
            Ok(json!({ "status": "ok", "card": signed.card, "sig": signed.sig }))
        }
    }
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|s| !s.is_empty())
}

/// The block time when the platform gives one, else the worker's clock.
fn now_secs() -> u64 {
    env("NEAR_BLOCK_TIMESTAMP")
        .and_then(|ns| ns.parse::<u64>().ok())
        .map(|ns| ns / 1_000_000_000)
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        })
}

#[cfg_attr(feature = "fixtures", allow(dead_code))]
fn issuer() -> Result<String> {
    env("NEAR_SENDER_ID").ok_or_else(|| Error::new(Code::BadInput, "NEAR_SENDER_ID is not set"))
}

// ---- local fixture build: public test key, data from disk ------------------------------

#[cfg(feature = "fixtures")]
mod build {
    use super::*;
    use proveit_enclave::card::SignedCard;
    use proveit_enclave::hl::FixtureSource;
    use proveit_enclave::pipeline::{self, IssueParams};
    use proveit_enclave::platform::test::TestPlatform;

    pub fn platform() -> TestPlatform {
        TestPlatform::default()
    }

    pub fn issue(platform: &TestPlatform, window_days: u32) -> Result<SignedCard> {
        let dir = env("PROVEIT_FIXTURE_DIR").ok_or_else(|| Error::new(Code::BadInput, "PROVEIT_FIXTURE_DIR is not set"))?;
        let source = FixtureSource { dir: dir.into() };
        let issuer = env("NEAR_SENDER_ID").unwrap_or_else(|| "fixture".into());
        pipeline::issue(
            &source,
            platform,
            &IssueParams {
                address: "0x0000000000000000000000000000000000000000",
                window_days,
                issuer: &issuer,
                nonce: 0,
                issued_at: env("ISSUED_AT").and_then(|s| s.parse().ok()).unwrap_or_else(now_secs),
                outlayer_request_id: None,
                mode: "fixture",
            },
        )
    }
}

// ---- builds that run inside an OutLayer worker: the TEE's own keys --------------------

#[cfg(all(not(feature = "fixtures"), target_arch = "wasm32"))]
mod host {
    use proveit_enclave::error::{Code, Error, Result};
    use proveit_enclave::platform::Platform;

    mod signing_keys_host {
        wit_bindgen::generate!({ world: "signing-keys-host", path: "wit/signing-keys" });
    }
    mod encryption_keys_host {
        wit_bindgen::generate!({ world: "encryption-keys-host", path: "wit/encryption-keys" });
    }
    mod storage_host {
        wit_bindgen::generate!({ world: "storage-host", path: "wit/storage" });
    }
    use encryption_keys_host::outlayer::encryption_keys::api as encryption_keys;
    use signing_keys_host::outlayer::signing_keys::api as signing_keys;
    use storage_host::near::storage::api as storage;

    /// Must match the paths declared in manifest.json.
    const CARD_KEY: &str = "cards";
    const COMMIT_KEY: &str = "commit";

    fn host_err(what: &str, e: String) -> Error {
        Error::new(Code::Upstream, format!("{what}: {e}"))
    }

    pub struct HostPlatform;

    impl Platform for HostPlatform {
        fn card_public_key(&self) -> Result<[u8; 32]> {
            let pk = signing_keys::public_key(CARD_KEY, None).map_err(|e| host_err("public-key", e))?;
            pk.try_into().map_err(|_| Error::new(Code::Upstream, "public key is not 32 bytes"))
        }

        fn sign_card(&self, message: &[u8]) -> Result<[u8; 64]> {
            let sig = signing_keys::sign(CARD_KEY, None, message).map_err(|e| host_err("sign", e))?;
            sig.try_into().map_err(|_| Error::new(Code::Upstream, "signature is not 64 bytes"))
        }

        fn commit_mac(&self, data: &[u8]) -> Result<Vec<u8>> {
            encryption_keys::mac(COMMIT_KEY, None, data).map_err(|e| host_err("mac", e))
        }

        fn store(&self, key: &str, value: &[u8]) -> Result<()> {
            let error = storage::set_worker(key, value, Some(true));
            if error.is_empty() {
                Ok(())
            } else {
                Err(host_err("storage", error))
            }
        }
    }
}

#[cfg(all(feature = "demo-fixture", target_arch = "wasm32"))]
mod build {
    use super::*;
    use proveit_enclave::card::SignedCard;
    use proveit_enclave::hl::{Fill, Portfolio, Source};
    use proveit_enclave::pipeline::{self, IssueParams};

    pub use super::host::HostPlatform as Platform;

    pub fn platform() -> Platform {
        super::host::HostPlatform
    }

    struct Embedded;

    impl Source for Embedded {
        fn portfolio(&self, _: &str) -> Result<Portfolio> {
            Portfolio::parse(include_bytes!("../fixtures/winner/portfolio.json"))
        }
        fn fills_between(&self, _: &str, start: u64, end: u64) -> Result<Vec<Fill>> {
            let all: Vec<Fill> = serde_json::from_slice(include_bytes!("../fixtures/winner/fills.json"))
                .map_err(|e| Error::new(Code::NoData, e.to_string()))?;
            Ok(all.into_iter().filter(|f| f.time >= start && f.time <= end).collect())
        }
    }

    pub fn issue(platform: &Platform, window_days: u32) -> Result<SignedCard> {
        let issuer = issuer()?;
        pipeline::issue(
            &Embedded,
            platform,
            &IssueParams {
                address: "0xe986b8e58b5870dca58700c23b5303f20f6823a7",
                window_days,
                issuer: &issuer,
                nonce: 0,
                issued_at: now_secs(),
                outlayer_request_id: env("NEAR_REQUEST_ID"),
                mode: "fixture",
            },
        )
    }
}

#[cfg(all(not(feature = "fixtures"), not(feature = "demo-fixture"), target_arch = "wasm32"))]
mod build {
    use super::*;
    use proveit_enclave::card::SignedCard;
    use proveit_enclave::hl::{Client, Transport, INFO_URL};
    use proveit_enclave::ownership::{self, OwnershipProof};
    use proveit_enclave::pipeline::{self, IssueParams};
    use std::time::Duration;
    use wasi_http_client::Client as Http;

    pub use super::host::HostPlatform as Platform;

    pub fn platform() -> Platform {
        super::host::HostPlatform
    }

    struct Wasi;

    impl Transport for Wasi {
        fn post(&self, body: &Value) -> Result<Vec<u8>> {
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

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Secret {
        venue: String,
        proof: OwnershipProof,
    }

    pub fn issue(platform: &Platform, window_days: u32) -> Result<SignedCard> {
        let raw = env("PROVEIT_SECRET").ok_or_else(|| Error::new(Code::BadInput, "PROVEIT_SECRET is not set"))?;
        let secret: Secret = serde_json::from_str(&raw).map_err(|e| Error::new(Code::BadInput, format!("PROVEIT_SECRET: {e}")))?;
        if secret.venue != pipeline::VENUE {
            return Err(Error::new(Code::BadInput, format!("unsupported venue '{}'", secret.venue)));
        }
        let issuer = issuer()?;
        let now = now_secs();
        ownership::verify(&secret.proof, &issuer, now)?;
        let address = secret.proof.account.to_lowercase();
        pipeline::issue(
            &Client { transport: Wasi },
            platform,
            &IssueParams {
                address: &address,
                window_days,
                issuer: &issuer,
                nonce: secret.proof.nonce,
                issued_at: now,
                outlayer_request_id: env("NEAR_REQUEST_ID"),
                mode: "live",
            },
        )
    }
}

/// Host builds without `fixtures` exist only so `cargo build` and `cargo test` compile the
/// binary; the enclave itself is the wasm32-wasip2 build.
#[cfg(all(not(feature = "fixtures"), not(target_arch = "wasm32")))]
mod build {
    use super::*;
    use proveit_enclave::card::SignedCard;

    pub struct Unavailable;

    impl Platform for Unavailable {
        fn card_public_key(&self) -> Result<[u8; 32]> {
            Err(unavailable())
        }
        fn sign_card(&self, _: &[u8]) -> Result<[u8; 64]> {
            Err(unavailable())
        }
        fn commit_mac(&self, _: &[u8]) -> Result<Vec<u8>> {
            Err(unavailable())
        }
        fn store(&self, _: &str, _: &[u8]) -> Result<()> {
            Err(unavailable())
        }
    }

    fn unavailable() -> Error {
        Error::new(Code::Upstream, "the enclave keys exist only in the wasm32-wasip2 build inside OutLayer")
    }

    pub fn platform() -> Unavailable {
        Unavailable
    }

    pub fn issue(_: &Unavailable, _: u32) -> Result<SignedCard> {
        let _ = (issuer, now_secs);
        Err(unavailable())
    }
}
