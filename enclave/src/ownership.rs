//! Proof that the trader controls the Hyperliquid account: an EIP-712 signature by the
//! account's own key, bound to the NEAR account issuing the card, a nonce and an expiry.
//!
//! Typed data (what the wallet shows):
//!   domain  EIP712Domain(string name,string version) = ("Prove-It", "1")
//!   message ProveIt(string statement,address account,string nearAccount,uint64 nonce,uint64 expiry)
//!
//! The domain has no chainId on purpose: the signature is verified only here, never by
//! an EVM contract, and leaving it out means the wallet does not ask the trader to
//! switch networks. Replay is prevented by the NEAR account binding, the expiry and
//! the nonce (which the registry contract refuses to accept twice).

use crate::error::{Code, Error, Result};
use crate::hl::is_evm_address;
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use serde::Deserialize;
use sha3::{Digest, Keccak256};

pub const DOMAIN_NAME: &str = "Prove-It";
pub const DOMAIN_VERSION: &str = "1";
pub const STATEMENT: &str = "I control this Hyperliquid account and allow Prove-It to compute its trading statistics inside a TEE. This signature cannot move funds or place trades.";
/// A signature may be used for at most this long after it is made.
pub const MAX_VALIDITY_SECS: u64 = 24 * 60 * 60;

const DOMAIN_TYPE: &str = "EIP712Domain(string name,string version)";
const MESSAGE_TYPE: &str = "ProveIt(string statement,address account,string nearAccount,uint64 nonce,uint64 expiry)";

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OwnershipProof {
    /// The Hyperliquid account (an EVM address).
    pub account: String,
    #[serde(rename = "nearAccount")]
    pub near_account: String,
    pub nonce: u64,
    /// Unix seconds.
    pub expiry: u64,
    /// 65 bytes `r ‖ s ‖ v` as 0x-prefixed hex; `v` may be 0/1 or 27/28.
    pub signature: String,
}

fn keccak(data: &[u8]) -> [u8; 32] {
    Keccak256::digest(data).into()
}

fn word_u64(n: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..].copy_from_slice(&n.to_be_bytes());
    w
}

fn word_address(addr: &[u8; 20]) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(addr);
    w
}

fn parse_address(s: &str) -> Result<[u8; 20]> {
    if !is_evm_address(s) {
        return Err(Error::new(Code::BadInput, "account must be a 0x-prefixed 20-byte hex address"));
    }
    let mut out = [0u8; 20];
    hex::decode_to_slice(&s[2..], &mut out).map_err(|e| Error::new(Code::BadInput, e.to_string()))?;
    Ok(out)
}

pub fn domain_separator() -> [u8; 32] {
    let mut buf = Vec::with_capacity(96);
    buf.extend_from_slice(&keccak(DOMAIN_TYPE.as_bytes()));
    buf.extend_from_slice(&keccak(DOMAIN_NAME.as_bytes()));
    buf.extend_from_slice(&keccak(DOMAIN_VERSION.as_bytes()));
    keccak(&buf)
}

/// The EIP-712 digest the wallet signed.
pub fn digest(proof: &OwnershipProof) -> Result<[u8; 32]> {
    let account = parse_address(&proof.account)?;
    let mut buf = Vec::with_capacity(192);
    buf.extend_from_slice(&keccak(MESSAGE_TYPE.as_bytes()));
    buf.extend_from_slice(&keccak(STATEMENT.as_bytes()));
    buf.extend_from_slice(&word_address(&account));
    buf.extend_from_slice(&keccak(proof.near_account.as_bytes()));
    buf.extend_from_slice(&word_u64(proof.nonce));
    buf.extend_from_slice(&word_u64(proof.expiry));
    let struct_hash = keccak(&buf);

    let mut msg = Vec::with_capacity(66);
    msg.extend_from_slice(&[0x19, 0x01]);
    msg.extend_from_slice(&domain_separator());
    msg.extend_from_slice(&struct_hash);
    Ok(keccak(&msg))
}

/// The address that produced `signature` over `digest`.
pub fn recover(digest: &[u8; 32], signature: &str) -> Result<[u8; 20]> {
    let raw = signature.strip_prefix("0x").unwrap_or(signature);
    let bytes = hex::decode(raw).map_err(|_| Error::new(Code::SigInvalid, "signature is not hex"))?;
    if bytes.len() != 65 {
        return Err(Error::new(Code::SigInvalid, "signature must be 65 bytes"));
    }
    let sig = Signature::from_slice(&bytes[..64]).map_err(|_| Error::new(Code::SigInvalid, "malformed signature"))?;
    // A high-s signature is the mirror of a valid one; accepting both makes signatures malleable.
    if sig.normalize_s().is_some() {
        return Err(Error::new(Code::SigInvalid, "high-s signature"));
    }
    let v = bytes[64];
    let rid = RecoveryId::from_byte(if v >= 27 { v - 27 } else { v })
        .ok_or_else(|| Error::new(Code::SigInvalid, "bad recovery id"))?;
    let key = VerifyingKey::recover_from_prehash(digest, &sig, rid)
        .map_err(|_| Error::new(Code::SigInvalid, "signature does not recover to a key"))?;
    let point = key.to_encoded_point(false);
    let hash = keccak(&point.as_bytes()[1..]);
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&hash[12..]);
    Ok(addr)
}

/// Accept the proof only if it is signed by `proof.account`, names the NEAR account
/// that is issuing the card, and is inside its validity window at `now_secs`.
pub fn verify(proof: &OwnershipProof, issuer: &str, now_secs: u64) -> Result<()> {
    if proof.near_account != issuer {
        return Err(Error::new(
            Code::NearAccountMismatch,
            format!("signature is for NEAR account '{}', but '{}' is issuing the card", proof.near_account, issuer),
        ));
    }
    if proof.expiry <= now_secs {
        return Err(Error::new(Code::SigExpired, "ownership signature has expired"));
    }
    if proof.expiry > now_secs + MAX_VALIDITY_SECS {
        return Err(Error::new(Code::BadInput, "ownership signature expiry is more than 24 hours away"));
    }
    let expected = parse_address(&proof.account)?;
    let recovered = recover(&digest(proof)?, &proof.signature)?;
    if recovered != expected {
        return Err(Error::new(Code::SigInvalid, "signature was not made by this account's key"));
    }
    Ok(())
}
