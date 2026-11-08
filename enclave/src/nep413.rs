//! NEP-413 signed messages: how a follower proves, over HTTPS, which NEAR account they are.
//!
//! The wallet signs `sha256(borsh(2^31 + 413 as u32) ‖ borsh(Payload))`, with
//! `Payload { message: String, nonce: [u8; 32], recipient: String, callback_url: Option<String> }`.
//! Over HTTPS the platform's caller is the app's payment key, not the follower, so this
//! signature (checked here) plus an on-chain access-key check (src/auth.rs) is the
//! follower's identity.

use crate::error::{Code, Error, Result};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const TAG: u32 = (1 << 31) + 413;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedMessage {
    pub account_id: String,
    /// "ed25519:<base58>"
    pub public_key: String,
    /// base64 of the 64-byte signature
    pub signature: String,
    pub message: String,
    /// base64 of 32 bytes
    pub nonce: String,
    pub recipient: String,
    #[serde(default)]
    pub callback_url: Option<String>,
}

fn borsh_string(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s.as_bytes());
}

/// The 32 bytes the wallet signs.
pub fn signed_hash(message: &str, nonce: &[u8; 32], recipient: &str, callback_url: Option<&str>) -> [u8; 32] {
    let mut bytes = TAG.to_le_bytes().to_vec();
    borsh_string(&mut bytes, message);
    bytes.extend_from_slice(nonce);
    borsh_string(&mut bytes, recipient);
    match callback_url {
        None => bytes.push(0),
        Some(u) => {
            bytes.push(1);
            borsh_string(&mut bytes, u);
        }
    }
    Sha256::digest(&bytes).into()
}

pub fn parse_public_key(s: &str) -> Result<[u8; 32]> {
    let bad = || Error::new(Code::SigInvalid, "public_key must be ed25519:<base58 of 32 bytes>");
    let b58 = s.strip_prefix("ed25519:").ok_or_else(bad)?;
    bs58::decode(b58).into_vec().map_err(|_| bad())?.try_into().map_err(|_| bad())
}

/// Check the signature; returns the signing public key. Says nothing yet about whether
/// that key belongs to `account_id` (src/auth.rs asks the chain).
pub fn verify(m: &SignedMessage) -> Result<[u8; 32]> {
    let invalid = |why: &str| Error::new(Code::SigInvalid, format!("NEP-413 signature: {why}"));
    let pk = parse_public_key(&m.public_key)?;
    let b64 = base64::engine::general_purpose::STANDARD;
    let nonce: [u8; 32] = b64.decode(&m.nonce).map_err(|_| invalid("nonce is not base64"))?.try_into().map_err(|_| invalid("nonce must be 32 bytes"))?;
    let sig: [u8; 64] = b64.decode(&m.signature).map_err(|_| invalid("signature is not base64"))?.try_into().map_err(|_| invalid("signature must be 64 bytes"))?;
    let key = VerifyingKey::from_bytes(&pk).map_err(|_| invalid("bad public key"))?;
    let hash = signed_hash(&m.message, &nonce, &m.recipient, m.callback_url.as_deref());
    key.verify(&hash, &Signature::from_bytes(&sig)).map_err(|_| invalid("does not verify"))?;
    Ok(pk)
}

/// The message a follower signs for the feed or an HTTPS reveal: which card, which X25519
/// key the answer is encrypted to, and until when it may be used.
pub const RECIPIENT: &str = "proveit";

pub fn follower_message(card_hash: &str, x25519_pub: &str, expires_at: u64) -> String {
    format!("proveit-follow-v1|{card_hash}|{x25519_pub}|{expires_at}")
}

pub fn parse_follower_message(m: &str) -> Option<(String, String, u64)> {
    let mut parts = m.split('|');
    if parts.next()? != "proveit-follow-v1" {
        return None;
    }
    let card_hash = parts.next()?.to_string();
    let x25519 = parts.next()?.to_string();
    let expires_at = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some((card_hash, x25519, expires_at))
}
