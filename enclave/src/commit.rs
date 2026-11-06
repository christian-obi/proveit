//! The account commitment: the same value on every card from one Hyperliquid account, so
//! a profile can show all of them, but impossible to reverse into the address.
//!
//! A plain hash would not do: Hyperliquid addresses are public (the leaderboard lists
//! about 48,000), so anyone could hash them all and match. The MAC key is derived inside
//! the TEE, bound to this project and to the registry contract, and nobody holds it.

use crate::error::Result;
use crate::platform::Platform;

pub fn commitment(platform: &impl Platform, venue: &str, address: &str) -> Result<String> {
    let input = format!("{venue}:{}", address.to_lowercase());
    Ok(hex::encode(platform.commit_mac(input.as_bytes())?))
}
