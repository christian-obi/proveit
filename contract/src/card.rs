//! The card as the registry sees it: strict parsing, canonical bytes, signature check.
//!
//! The signed bytes are recomputed here from the JSON the enclave returned. Keys are
//! sorted explicitly rather than trusting serde_json's map type, because a dependency
//! turning on serde_json's `preserve_order` feature would otherwise change the bytes.
//! `test-vectors/card-sig.json` pins this to the enclave and the TypeScript verifier.

use near_sdk::env;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, Value};

pub const SIGNING_PREFIX: &[u8] = b"proveit-card-v1\n";
pub const WINDOWS: [u32; 5] = [1, 7, 30, 90, 180];

/// The fields the registry checks. Parsing is strict (unknown fields are refused), so the
/// registry never records a claim it doesn't understand; some fields are parsed only for that.
#[allow(dead_code)]
#[derive(Deserialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct Card {
    pub v: u8,
    pub venue: String,
    pub kind: String,
    pub scope: String,
    pub issuer: String,
    pub commitment: String,
    pub window: Window,
    pub stats: Value,
    pub orders: Orders,
    pub issued_at: u64,
    pub nonce: u64,
    pub outlayer_request_id: Option<String>,
    pub mode: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct Window {
    pub days: u32,
    pub start: u64,
    pub end: u64,
    pub samples: u32,
}

#[allow(dead_code)]
#[derive(Deserialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct Orders {
    pub root: String,
    pub count: u32,
}

/// Canonical JSON: sorted keys, no whitespace, integers only, ASCII only.
pub fn canonical(v: &Value) -> Result<String, String> {
    let mut out = String::new();
    write(v, &mut out)?;
    Ok(out)
}

fn write(v: &Value, out: &mut String) -> Result<(), String> {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if !(n.is_i64() || n.is_u64()) {
                return Err(format!("canonical JSON allows integers only, got {n}"));
            }
            out.push_str(&n.to_string());
        }
        Value::String(s) => {
            if !s.is_ascii() {
                return Err("canonical JSON allows ASCII strings only".into());
            }
            out.push_str(&serde_json::to_string(s).map_err(|e| e.to_string())?);
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(&Value::String(k.clone()), out)?;
                out.push(':');
                write(&map[k], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

pub fn card_hash(canonical: &str) -> String {
    hex::encode(env::sha256(canonical.as_bytes()))
}

pub fn signing_message(canonical: &str) -> Vec<u8> {
    let mut msg = SIGNING_PREFIX.to_vec();
    msg.extend_from_slice(canonical.as_bytes());
    env::sha256(&msg)
}

pub fn parse_hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    let bytes = hex::decode(s).ok()?;
    bytes.try_into().ok()
}

pub fn signature_ok(canonical: &str, sig_hex: &str, pubkey: &[u8; 32]) -> bool {
    match parse_hex::<64>(sig_hex) {
        Some(sig) => env::ed25519_verify(&sig, signing_message(canonical), pubkey),
        None => false,
    }
}
