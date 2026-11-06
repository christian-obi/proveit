//! P0 spikes S2, S3 and S5 in one OutLayer project, so one deployment answers all three.
//!
//! stdin: {"op": "...", ...}
//!   env          which accounts and ids the platform handed this run
//!   pubkey       the `cards` ed25519 public key (S2: stable across runs and versions?)
//!   sign         {"text"}: signs "proveit-spike-v1\n" + text, never caller-chosen bytes
//!   mac          {"data"}: mac under the `commit` key (S2: stable?)
//!   secret_hash  sha256 of the PROVEIT_SECRET env var (S3: did the encrypted secret arrive?)
//!   blob         {"bytes"}: an output of about that many bytes (S5: size limits)
//!
//! Every answer carries VERSION, which the `v2` feature changes to give a second sha256.

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};

#[cfg(not(feature = "v2"))]
const VERSION: &str = "v1";
#[cfg(feature = "v2")]
const VERSION: &str = "v2";

/// The domain prefix on every signed message: the module composes what it signs.
const SIGN_PREFIX: &str = "proveit-spike-v1\n";
const MAX_BLOB_BYTES: usize = 64 * 1024;

/// The manifest lives in the `outlayer.manifest` custom section, covered by the wasm's sha256.
#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] = *include_bytes!("../manifest.json");

mod signing_keys_host {
    wit_bindgen::generate!({ world: "signing-keys-host", path: "wit/signing-keys" });
}
use signing_keys_host::outlayer::signing_keys::api as signing_keys;

mod encryption_keys_host {
    wit_bindgen::generate!({ world: "encryption-keys-host", path: "wit/encryption-keys" });
}
use encryption_keys_host::outlayer::encryption_keys::api as encryption_keys;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    Env,
    Pubkey,
    Sign { text: String },
    Mac { data: String },
    SecretHash,
    Blob { bytes: usize },
}

fn main() {
    let answer = run().unwrap_or_else(|e| json!({ "status": "err", "message": e }));
    print!("{answer}");
    let _ = io::stdout().flush();
}

fn run() -> Result<Value, String> {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).map_err(|e| e.to_string())?;
    let request: Request = serde_json::from_str(&raw).map_err(|e| format!("bad input: {e}"))?;

    let body = match request {
        Request::Env => json!({
            "sender": env("NEAR_SENDER_ID"),
            "predecessor": env("NEAR_PREDECESSOR_ID"),
            "project": env("OUTLAYER_PROJECT_ID"),
            "request_id": env("NEAR_REQUEST_ID"),
            "call_id": env("OUTLAYER_CALL_ID"),
            "execution_type": env("OUTLAYER_EXECUTION_TYPE"),
            "max_memory_mb": env("NEAR_MAX_MEMORY_MB"),
            "max_seconds": env("NEAR_MAX_EXECUTION_SECONDS"),
        }),
        Request::Pubkey => {
            let pk = signing_keys::public_key("cards", None)?;
            json!({ "pubkey_hex": hex::encode(pk) })
        }
        Request::Sign { text } => {
            let message = format!("{SIGN_PREFIX}{text}");
            let sig = signing_keys::sign("cards", None, message.as_bytes())?;
            let pk = signing_keys::public_key("cards", None)?;
            json!({ "message": message, "signature_hex": hex::encode(sig), "pubkey_hex": hex::encode(pk) })
        }
        Request::Mac { data } => {
            let mac = encryption_keys::mac("commit", None, data.as_bytes())?;
            json!({ "mac_hex": hex::encode(mac) })
        }
        Request::SecretHash => match std::env::var("PROVEIT_SECRET") {
            Ok(secret) => json!({
                "present": true,
                "len": secret.len(),
                "sha256_hex": hex::encode(Sha256::digest(secret.as_bytes())),
            }),
            Err(_) => json!({ "present": false }),
        },
        Request::Blob { bytes } => {
            if bytes > MAX_BLOB_BYTES {
                return Err(format!("bytes must be at most {MAX_BLOB_BYTES}"));
            }
            json!({ "requested_bytes": bytes, "pad": "x".repeat(bytes) })
        }
    };

    Ok(json!({ "status": "ok", "version": VERSION, "result": body }))
}

fn env(name: &str) -> Value {
    std::env::var(name).ok().filter(|v| !v.is_empty()).map(Value::String).unwrap_or(Value::Null)
}
