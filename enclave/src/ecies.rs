//! Encryption to a follower's X25519 key, so only the key holder can read a reveal.
//!
//!   0x01 ‖ ephemeral_x25519_pub (32) ‖ nonce (12) ‖ ciphertext ‖ tag (16)
//!   key = HKDF-SHA256(ikm = X25519(ephemeral, follower), salt = none, info = INFO), 32 bytes
//!   ChaCha20-Poly1305, no AAD
//!
//! The same layout as the OutLayer keystore's ECIES v1 (and web/lib/ecies.ts), with its own
//! HKDF label so a reveal can never be mistaken for a keystore secret or the reverse.

use crate::error::{Code, Error, Result};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

pub const INFO: &[u8] = b"proveit-reveal-v1";
pub const VERSION: u8 = 0x01;

fn key(shared: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(None, shared).expand(INFO, &mut out).expect("32 bytes is a valid HKDF length");
    out
}

/// Encrypt `plaintext` to `recipient`, with fresh `ephemeral` and `nonce` randomness.
pub fn seal(recipient: &[u8; 32], plaintext: &[u8], ephemeral: [u8; 32], nonce: [u8; 12]) -> Result<Vec<u8>> {
    let secret = StaticSecret::from(ephemeral);
    let shared = secret.diffie_hellman(&PublicKey::from(*recipient));
    if !shared.was_contributory() {
        return Err(Error::new(Code::BadInput, "the follower's X25519 key is a low-order point"));
    }
    let sealed = ChaCha20Poly1305::new(&key(shared.as_bytes()).into())
        .encrypt(&Nonce::from(nonce), plaintext)
        .map_err(|_| Error::new(Code::BadInput, "encryption failed"))?;
    let mut out = Vec::with_capacity(1 + 32 + 12 + sealed.len());
    out.push(VERSION);
    out.extend_from_slice(PublicKey::from(&secret).as_bytes());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// The follower's side; the enclave never calls it (tests and the vector generator do).
pub fn open(secret: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>> {
    let bad = || Error::new(Code::BadInput, "not a reveal ciphertext for this key");
    if blob.len() < 1 + 32 + 12 + 16 || blob[0] != VERSION {
        return Err(bad());
    }
    let eph: [u8; 32] = blob[1..33].try_into().map_err(|_| bad())?;
    let nonce: [u8; 12] = blob[33..45].try_into().map_err(|_| bad())?;
    let shared = StaticSecret::from(*secret).diffie_hellman(&PublicKey::from(eph));
    ChaCha20Poly1305::new(&key(shared.as_bytes()).into())
        .decrypt(&Nonce::from(nonce), &blob[45..])
        .map_err(|_| bad())
}

pub fn public_key(secret: &[u8; 32]) -> [u8; 32] {
    *PublicKey::from(&StaticSecret::from(*secret)).as_bytes()
}
