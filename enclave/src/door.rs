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

/// Which door a run came through. On-chain, only the registry is let in (it has checked
/// the caller itself: the trader for `issue`, a key holder for `reveal`). Over HTTPS
/// anyone can knock, so only `reveal` and `feed` are served there, and only to a follower
/// who proves who they are and holds a key (src/auth.rs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Door {
    Registry,
    Https,
}

pub fn classify(execution_type: Option<&str>, predecessor: Option<&str>, registry: &str) -> Result<Door> {
    match execution_type {
        Some("HTTPS") => Ok(Door::Https),
        _ => check_registry_door(execution_type, predecessor, registry).map(|_| Door::Registry),
    }
}

/// Ops allowed through each door.
pub fn allowed(op: &str, door: Door) -> Result<()> {
    let ok = match door {
        Door::Registry => matches!(op, "pubkey" | "issue" | "reveal"),
        Door::Https => matches!(op, "reveal" | "feed"),
    };
    if ok {
        Ok(())
    } else {
        Err(Error::new(
            Code::BadInput,
            match door {
                Door::Https => format!("`{op}` runs only on-chain, through the registry contract"),
                Door::Registry => format!("`{op}` runs only over HTTPS, signed by the follower"),
            },
        ))
    }
}
