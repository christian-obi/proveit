//! Who may read a card's trades over HTTPS: a follower who signed (NEP-413) with a
//! full-access key of their NEAR account, for this card and this X25519 key, before the
//! message's expiry, and who holds a live viewing key on the registry. Every check runs
//! before any stored data is read.

use crate::error::{Code, Error, Result};
use crate::near::Near;
use crate::nep413::{self, SignedMessage};
use serde_json::json;

/// A signed message may be used for at most a day.
pub const MAX_VALIDITY_SECS: u64 = 86_400;

#[derive(Debug, Clone, PartialEq)]
pub struct Follower {
    pub account: String,
    pub card_id: u64,
    pub card_hash: String,
    pub x25519_pub: String,
    /// The delay the key was sold with (from the registry, never from the request).
    pub delay_secs: u64,
}

pub fn authorize(near: &impl Near, registry: &str, card_id: u64, auth: &SignedMessage, now_secs: u64) -> Result<Follower> {
    nep413::verify(auth)?;
    if auth.recipient != nep413::RECIPIENT {
        return Err(Error::new(Code::SigInvalid, "the signed message is for another app"));
    }
    let (card_hash, x25519_pub, expires_at) =
        nep413::parse_follower_message(&auth.message).ok_or_else(|| Error::new(Code::SigInvalid, "not a Prove-It follower message"))?;
    if expires_at <= now_secs {
        return Err(Error::new(Code::SigExpired, "the signed message has expired; sign a new one"));
    }
    if expires_at > now_secs + MAX_VALIDITY_SECS {
        return Err(Error::new(Code::SigExpired, "the signed message must expire within a day"));
    }
    if near.access_key(&auth.account_id, &auth.public_key)? != Some(true) {
        return Err(Error::new(Code::NearAccountMismatch, format!("that key is not a full-access key of {}", auth.account_id)));
    }
    let card = near.view(registry, "get_card", &json!({ "card_id": card_id }))?;
    if card["card_hash"].as_str() != Some(card_hash.as_str()) {
        return Err(Error::new(Code::BadInput, "the signed card hash is not this card"));
    }
    let grant = near.view(registry, "get_grant", &json!({ "card_id": card_id, "buyer": auth.account_id }))?;
    if grant.is_null() || grant["expires_at"].as_u64().unwrap_or(0) <= now_secs {
        return Err(Error::new(Code::NoGrant, format!("{} holds no live viewing key for card #{card_id}", auth.account_id)));
    }
    Ok(Follower {
        account: auth.account_id.clone(),
        card_id,
        card_hash,
        x25519_pub,
        delay_secs: grant["delay_secs"].as_u64().ok_or_else(|| Error::new(Code::Upstream, "grant without delay_secs"))?,
    })
}
