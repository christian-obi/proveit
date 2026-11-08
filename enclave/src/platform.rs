//! What the enclave needs from the platform: its signing key, its MAC key and storage.
//!
//! Inside an OutLayer worker these are host functions (see `src/main.rs`): the keys are
//! derived in the TEE, bound to this project and to the calling contract, and the module
//! never holds them. Tests and local runs use [`TestPlatform`] instead.

use crate::error::Result;

pub trait Platform {
    /// The 32-byte ed25519 public key that signs cards.
    fn card_public_key(&self) -> Result<[u8; 32]>;
    /// An ed25519 signature over `message`, which this module composed itself.
    fn sign_card(&self, message: &[u8]) -> Result<[u8; 64]>;
    /// A keyed MAC under the enclave-only `commit` key.
    fn commit_mac(&self, data: &[u8]) -> Result<Vec<u8>>;
    /// Keep `value` in encrypted worker storage under `key` (no secret may appear in `key`).
    fn store(&self, key: &str, value: &[u8]) -> Result<()>;
    /// Read what [`Platform::store`] kept, if anything.
    fn load(&self, key: &str) -> Result<Option<Vec<u8>>>;
    /// 32 fresh random bytes (encryption only; nothing signed depends on them).
    fn random_32(&self) -> Result<[u8; 32]>;
}

/// A deterministic, PUBLIC key pair and MAC key. Anyone can sign as it, so nothing
/// signed by it means anything outside a test.
#[cfg(feature = "test-keys")]
pub mod test {
    use super::Platform;
    use crate::error::{Code, Error, Result};
    use ed25519_dalek::{Signer, SigningKey};
    use hmac::{Hmac, Mac};
    use sha2::{Digest, Sha256};
    use std::cell::RefCell;

    /// The test signing key is the ed25519 key whose 32-byte seed is sha256 of this.
    pub const TEST_SEED_LABEL: &str = "proveit-test-card-key-v1";
    /// The test MAC key is sha256 of this.
    pub const TEST_MAC_LABEL: &str = "proveit-test-commit-key-v1";

    #[derive(Default)]
    pub struct TestPlatform {
        pub stored: RefCell<Vec<(String, Vec<u8>)>>,
        /// Deterministic "randomness": sha256 of a counter.
        pub draws: RefCell<u64>,
    }

    impl TestPlatform {
        fn key() -> SigningKey {
            SigningKey::from_bytes(&Sha256::digest(TEST_SEED_LABEL.as_bytes()).into())
        }
    }

    impl Platform for TestPlatform {
        fn card_public_key(&self) -> Result<[u8; 32]> {
            Ok(Self::key().verifying_key().to_bytes())
        }

        fn sign_card(&self, message: &[u8]) -> Result<[u8; 64]> {
            Ok(Self::key().sign(message).to_bytes())
        }

        fn commit_mac(&self, data: &[u8]) -> Result<Vec<u8>> {
            let key: [u8; 32] = Sha256::digest(TEST_MAC_LABEL.as_bytes()).into();
            let mut mac = Hmac::<Sha256>::new_from_slice(&key).map_err(|e| Error::new(Code::BadInput, e.to_string()))?;
            mac.update(data);
            Ok(mac.finalize().into_bytes().to_vec())
        }

        fn store(&self, key: &str, value: &[u8]) -> Result<()> {
            self.stored.borrow_mut().push((key.to_string(), value.to_vec()));
            Ok(())
        }

        fn load(&self, key: &str) -> Result<Option<Vec<u8>>> {
            Ok(self.stored.borrow().iter().rev().find(|(k, _)| k == key).map(|(_, v)| v.clone()))
        }

        fn random_32(&self) -> Result<[u8; 32]> {
            let mut n = self.draws.borrow_mut();
            *n += 1;
            let mut h = Sha256::new();
            h.update(b"proveit-test-random");
            h.update(n.to_le_bytes());
            Ok(h.finalize().into())
        }
    }
}
