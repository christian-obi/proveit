//! Who may ask this enclave to issue a card.
//!
//! Only the registry contract, on-chain. The facts come from environment variables the
//! OutLayer worker sets from the job itself, which neither the caller nor the input can
//! change. The registry's account is compiled into the binary (`PROVEIT_REGISTRY`), so a
//! build for the testnet registry and one for mainnet are different, reproducible builds.
//!
//! The manifest can't express this: a `callers` block can't allow one contract and also
//! HTTPS, which the live feed (P8) needs. And because the card key is bound to the caller,
//! a run through any other door would get a different key anyway; this check makes the
//! refusal explicit instead of producing a card nobody can verify.

use crate::error::{Code, Error, Result};

pub fn check_registry_door(execution_type: Option<&str>, predecessor: Option<&str>, registry: &str) -> Result<()> {
    if execution_type != Some("NEAR") {
        return Err(Error::new(Code::BadInput, "cards are issued only on-chain, through the registry contract"));
    }
    if predecessor != Some(registry) {
        return Err(Error::new(
            Code::BadInput,
            format!("only the registry ({registry}) may ask for cards, not {}", predecessor.unwrap_or("an unknown caller")),
        ));
    }
    Ok(())
}
