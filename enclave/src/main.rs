//! The enclave binary: one request on stdin, one JSON answer on stdout.
//!
//! stdin:  {"op": "pubkey"}                      → {"status":"ok","pubkey":"<hex>"}
//!         {"op": "issue", "window_days": 30}    → {"status":"ok","card":{...},"sig":"<hex>"}
//!         (window_days: 1, 7, 30, 90 or 180)
//!         {"op": "reveal", "card_hash": "<hex>", "follower": "<account>",
//!          "follower_x25519_pub": "<hex>", "delay_secs": 0}
//!                                               → {"status":"ok","ciphertext":"<base64>","shown":k,"total":n}
//!         (the registry sends this only for a follower holding a live grant; src/reveal.rs)
//! HTTPS:  {"op": "reveal", "card_id": N, "auth": {NEP-413 signed message}}  → same as reveal
//!         {"op": "feed", "card_id": N, "since": cursor, "auth": {…}}       → {"status":"ok","ciphertext":…,"head":…,"next":n}
//!         (the follower signs `proveit-follow-v1|card_hash|x25519_pub|expires_at`; src/auth.rs)
//! door:   inside OutLayer, both ops run only on-chain and only when the caller is the
//!         registry compiled in as PROVEIT_REGISTRY (src/door.rs)
//! env:    PROVEIT_SECRET   {"venue":"hyperliquid","proof":{...OwnershipProof}}: an encrypted
//!                          OutLayer secret, decrypted only inside the TEE
//!         NEAR_SENDER_ID, NEAR_BLOCK_TIMESTAMP, NEAR_REQUEST_ID   set by the platform
//! errors: {"status":"err","code":"...","message":"..."}
//!
//! Builds (see Cargo.toml):
//!   default        live: Hyperliquid over HTTPS, ownership check, the TEE's own keys
//!   fixtures       local wasmtime: data from PROVEIT_FIXTURE_DIR, the public test key
//!   demo-fixture   testnet smoke test: the `winner` fixture compiled in, the TEE's keys

use proveit_enclave::door::{self, Door};
use proveit_enclave::error::{Code, Error, Result};
use proveit_enclave::nep413::SignedMessage;
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
    Issue {
        window_days: u32,
        #[serde(default)]
        kind: Option<String>,
    },
    /// On-chain from the registry: the first four fields. Over HTTPS: `card_id` and `auth`.
    Reveal {
        card_hash: Option<String>,
        follower: Option<String>,
        follower_x25519_pub: Option<String>,
        delay_secs: Option<u64>,
        card_id: Option<u64>,
        auth: Option<SignedMessage>,
    },
    Feed {
        card_id: u64,
        #[serde(default)]
        since: u64,
        auth: SignedMessage,
    },
}

impl Request {
    fn op(&self) -> &'static str {
        match self {
            Request::Pubkey => "pubkey",
            Request::Issue { .. } => "issue",
            Request::Reveal { .. } => "reveal",
            Request::Feed { .. } => "feed",
        }
    }
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
    let door = build::door()?;
    door::allowed(request.op(), door)?;
    match request {
        Request::Pubkey => Ok(json!({ "status": "ok", "pubkey": hex::encode(platform.card_public_key()?) })),
        Request::Issue { window_days, kind } => {
            let signed = build::issue(&platform, window_days, kind.as_deref().unwrap_or("trader"))?;
            Ok(json!({ "status": "ok", "card": signed.card, "sig": signed.sig }))
        }
        Request::Reveal { card_hash: Some(h), follower: Some(f), follower_x25519_pub: Some(k), delay_secs: Some(d), card_id: None, auth: None } if door == Door::Registry => {
            reveal(&platform, &h, &f, &k, d)
        }
        Request::Reveal { card_id: Some(id), auth: Some(a), card_hash: None, follower: None, follower_x25519_pub: None, delay_secs: None } if door == Door::Https => {
            let sealed = proveit_enclave::reveal::seal_for_follower(&platform, &build::near()?, build::REGISTRY, id, &a, now_secs())?;
            Ok(sealed_json(sealed))
        }
        Request::Reveal { .. } => Err(Error::new(Code::BadInput, "reveal takes card_hash/follower/follower_x25519_pub/delay_secs on-chain, or card_id/auth over HTTPS")),
        Request::Feed { card_id, since, auth } => {
            use base64::Engine;
            let f = proveit_enclave::feed::feed_for(&platform, &build::feed_source()?, &build::near()?, build::REGISTRY, card_id, since, &auth, now_secs())?;
            Ok(json!({
                "status": "ok",
                "ciphertext": base64::engine::general_purpose::STANDARD.encode(f.ciphertext),
                "head": f.head,
                "next": f.next,
            }))
        }
    }
}

fn sealed_json(sealed: proveit_enclave::reveal::Sealed) -> Value {
    use base64::Engine;
    json!({
        "status": "ok",
        "ciphertext": base64::engine::general_purpose::STANDARD.encode(sealed.ciphertext),
        "shown": sealed.shown,
        "total": sealed.total,
    })
}

/// Show the follower the card's orders older than the delay, encrypted to their key.
fn reveal(platform: &impl Platform, card_hash: &str, follower: &str, follower_pub: &str, delay_secs: u64) -> Result<Value> {
    Ok(sealed_json(proveit_enclave::reveal::seal_for(platform, card_hash, follower, follower_pub, delay_secs, now_secs())?))
}

/// Builds with no network (local fixtures, host test builds): the feed and HTTPS reveals
/// need NEAR RPC and are refused.
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
struct Offline;

impl proveit_enclave::near::Near for Offline {
    fn view(&self, _: &str, _: &str, _: &Value) -> Result<Value> {
        Err(Error::new(Code::Upstream, "this build has no network; HTTPS reveals and the feed run inside OutLayer"))
    }
    fn access_key(&self, _: &str, _: &str) -> Result<Option<bool>> {
        Err(Error::new(Code::Upstream, "this build has no network"))
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

    /// Local runs have no registry; nothing here is accepted on-chain.
    pub const REGISTRY: &str = "fixture-registry.testnet";

    pub fn door() -> Result<Door> {
        Ok(match env("OUTLAYER_EXECUTION_TYPE").as_deref() {
            Some("HTTPS") => Door::Https,
            _ => Door::Registry,
        })
    }

    pub fn near() -> Result<Offline> {
        Ok(Offline)
    }

    pub fn feed_source() -> Result<FixtureSource> {
        let dir = env("PROVEIT_FIXTURE_DIR").ok_or_else(|| Error::new(Code::BadInput, "PROVEIT_FIXTURE_DIR is not set"))?;
        Ok(FixtureSource { dir: dir.into() })
    }

    pub fn issue(platform: &TestPlatform, window_days: u32, kind: &str) -> Result<SignedCard> {
        let dir = env("PROVEIT_FIXTURE_DIR").ok_or_else(|| Error::new(Code::BadInput, "PROVEIT_FIXTURE_DIR is not set"))?;
        let source = FixtureSource { dir: dir.into() };
        let issuer = env("NEAR_SENDER_ID").unwrap_or_else(|| "fixture".into());
        pipeline::issue_as(
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
            kind,
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

    /// The registry contract allowed to issue cards (src/door.rs). Set by enclave/build.sh.
    pub const REGISTRY: &str = env!("PROVEIT_REGISTRY");

    pub fn door() -> Result<proveit_enclave::door::Door> {
        proveit_enclave::door::classify(
            super::env("OUTLAYER_EXECUTION_TYPE").as_deref(),
            super::env("NEAR_PREDECESSOR_ID").as_deref(),
            REGISTRY,
        )
    }

    /// HTTPS POST over WASI, for NEAR RPC (and Hyperliquid in the live build).
    pub struct WasiHttp;

    impl proveit_enclave::near::Http for WasiHttp {
        fn post(&self, url: &str, body: &serde_json::Value) -> Result<Vec<u8>> {
            let payload = body.to_string();
            let response = wasi_http_client::Client::new()
                .post(url)
                .header("Content-Type", "application/json")
                .body(payload.as_bytes())
                .connect_timeout(std::time::Duration::from_secs(10))
                .send()
                .map_err(|e| Error::new(Code::Upstream, format!("{url}: {e}")))?;
            let status = response.status();
            let bytes = response.body().map_err(|e| Error::new(Code::Upstream, e.to_string()))?;
            if !(200..300).contains(&status) {
                return Err(Error::new(Code::Upstream, format!("{url} answered HTTP {status}")));
            }
            Ok(bytes)
        }
    }

    /// A plain HTTPS GET (the public leaderboard, ~40 MB).
    pub fn get(url: &str) -> Result<Vec<u8>> {
        let response = wasi_http_client::Client::new()
            .get(url)
            .connect_timeout(std::time::Duration::from_secs(15))
            .send()
            .map_err(|e| Error::new(Code::Upstream, format!("{url}: {e}")))?;
        let status = response.status();
        let bytes = response.body().map_err(|e| Error::new(Code::Upstream, e.to_string()))?;
        if !(200..300).contains(&status) {
            return Err(Error::new(Code::Upstream, format!("{url} answered HTTP {status}")));
        }
        Ok(bytes)
    }

    pub fn near() -> Result<proveit_enclave::near::Rpc<WasiHttp>> {
        Ok(proveit_enclave::near::Rpc { url: proveit_enclave::near::rpc_url(REGISTRY).to_string(), http: WasiHttp })
    }

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

        fn load(&self, key: &str) -> Result<Option<Vec<u8>>> {
            let (value, error) = storage::get_worker(key, None);
            if !error.is_empty() {
                return Err(host_err("storage", error));
            }
            Ok(if value.is_empty() { None } else { Some(value) })
        }

        fn cell_get(&self, key: &str) -> Result<Option<Vec<u8>>> {
            let (value, error) = storage::get(key);
            if !error.is_empty() {
                return Err(host_err("storage", error));
            }
            Ok(if value.is_empty() { None } else { Some(value) })
        }

        fn cell_swap(&self, key: &str, expected: Option<&[u8]>, new: &[u8]) -> Result<bool> {
            let (done, error) = match expected {
                None => storage::set_if_absent(key, new),
                Some(old) => {
                    let (done, _current, error) = storage::set_if_equals(key, old, new);
                    (done, error)
                }
            };
            if !error.is_empty() {
                return Err(host_err("storage", error));
            }
            Ok(done)
        }

        fn random_32(&self) -> Result<[u8; 32]> {
            let bytes = wasi::random::random::get_random_bytes(32);
            bytes.try_into().map_err(|_| Error::new(Code::Upstream, "random source gave the wrong length"))
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
    pub use super::host::{door, near, REGISTRY};

    /// The recorded account never trades again, so its feed stays empty: honest for a demo.
    pub fn feed_source() -> Result<Embedded> {
        Ok(Embedded)
    }

    pub fn platform() -> Platform {
        super::host::HostPlatform
    }

    pub struct Embedded;

    impl Source for Embedded {
        fn portfolio(&self, _: &str) -> Result<Portfolio> {
            Portfolio::parse(include_bytes!("../fixtures/winner/portfolio.json"))
        }
        fn fills_between(&self, _: &str, start: u64, end: u64) -> Result<Vec<Fill>> {
            let all: Vec<Fill> = serde_json::from_slice(include_bytes!("../fixtures/winner/fills.json"))
                .map_err(|e| Error::new(Code::NoData, e.to_string()))?;
            Ok(all.into_iter().filter(|f| f.time >= start && f.time <= end).collect())
        }
        /// The recorded account's data is old, but the privacy guard checks the card against
        /// today's leaderboard, the one an observer would use.
        fn leaderboard(&self) -> Result<proveit_enclave::kanon::Board> {
            proveit_enclave::kanon::Board::parse_live(&super::host::get(proveit_enclave::kanon::LEADERBOARD_URL)?)
        }
    }

    pub fn issue(platform: &Platform, window_days: u32, kind: &str) -> Result<SignedCard> {
        let issuer = issuer()?;
        pipeline::issue_as(
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
            kind,
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
    pub use super::host::{door, near, REGISTRY};

    pub fn feed_source() -> Result<Client<Wasi>> {
        Ok(Client { transport: Wasi })
    }

    pub fn platform() -> Platform {
        super::host::HostPlatform
    }

    pub struct Wasi;

    impl Transport for Wasi {
        fn get(&self, url: &str) -> Result<Vec<u8>> {
            super::host::get(url)
        }

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

    pub fn issue(platform: &Platform, window_days: u32, kind: &str) -> Result<SignedCard> {
        let raw = env("PROVEIT_SECRET").ok_or_else(|| Error::new(Code::BadInput, "PROVEIT_SECRET is not set"))?;
        let secret: Secret = serde_json::from_str(&raw).map_err(|e| Error::new(Code::BadInput, format!("PROVEIT_SECRET: {e}")))?;
        if secret.venue != pipeline::VENUE {
            return Err(Error::new(Code::BadInput, format!("unsupported venue '{}'", secret.venue)));
        }
        let issuer = issuer()?;
        let now = now_secs();
        ownership::verify(&secret.proof, &issuer, now)?;
        let address = secret.proof.account.to_lowercase();
        pipeline::issue_as(
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
            kind,
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
        fn load(&self, _: &str) -> Result<Option<Vec<u8>>> {
            Err(unavailable())
        }
        fn random_32(&self) -> Result<[u8; 32]> {
            Err(unavailable())
        }
        fn cell_get(&self, _: &str) -> Result<Option<Vec<u8>>> {
            Err(unavailable())
        }
        fn cell_swap(&self, _: &str, _: Option<&[u8]>, _: &[u8]) -> Result<bool> {
            Err(unavailable())
        }
    }

    fn unavailable() -> Error {
        Error::new(Code::Upstream, "the enclave keys exist only in the wasm32-wasip2 build inside OutLayer")
    }

    pub fn platform() -> Unavailable {
        Unavailable
    }

    pub const REGISTRY: &str = "";

    pub fn door() -> Result<Door> {
        Err(unavailable())
    }

    pub fn near() -> Result<Offline> {
        Ok(Offline)
    }

    pub fn feed_source() -> Result<proveit_enclave::hl::FixtureSource> {
        Err(unavailable())
    }

    pub fn issue(_: &Unavailable, _: u32, _: &str) -> Result<SignedCard> {
        let _ = (issuer, now_secs);
        Err(unavailable())
    }
}
