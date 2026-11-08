//! Prove-It registry.
//!
//! Traders call `request_card`; the registry asks OutLayer to run the pinned enclave
//! version with the trader's encrypted secret, and the callback records the card only if
//! the enclave's signature verifies under the key the registry learned from the enclave
//! itself (`bootstrap_key`). Anyone can then check a card with `verify_card`.
//!
//! The registry is the only account that can obtain this enclave's card key: OutLayer
//! derives it from the project and the calling contract, and the enclave refuses to issue
//! through any other door.

mod card;
mod keys;
#[cfg(test)]
mod tests;

use card::{Card, WINDOWS};
pub use keys::{Grant, Offer, OfferView, Waiting};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault, Promise,
};

const CALLBACK_GAS: Gas = Gas::from_tgas(60);
/// A floor for OutLayer; with GasWeight(1) it also receives all gas left unreserved.
const OUTLAYER_MIN_GAS: Gas = Gas::from_tgas(50);
const MAX_OUTPUT: usize = 16 * 1024;
/// A reveal carries one ~100-byte record per order, encrypted; a 10,000-fill account has
/// at most a few thousand orders.
const MAX_REVEAL_OUTPUT: usize = 1024 * 1024;
const DEFAULT_FEE_BPS: u16 = 100;
const KINDS: [&str; 2] = ["trader", "agent"];
const MAX_PAGE: u32 = 100;
const DEFAULT_STALE_AFTER_SECS: u64 = 14 * 24 * 60 * 60;
/// Kept by the registry to pay for storing the card; refunded if the card is refused.
const STORAGE_FEE: NearToken = NearToken::from_millinear(20);
/// The least that must reach OutLayer; it refunds what the run doesn't use to the payer.
const MIN_OUTLAYER_DEPOSIT: NearToken = NearToken::from_millinear(50);

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Versions,
    Cards,
    CardByHash,
    ByIssuer,
    ByCommitment,
    Nonces,
    Pending,
    Requests,
    Offers,
    Grants,
    Waiting,
    Balances,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VersionInfo {
    pub approved_at: u64,
    pub retired: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct CardRecord {
    pub id: u64,
    pub card_hash: String,
    /// The card's canonical JSON, exactly the bytes that were signed.
    pub card_json: String,
    pub sig: String,
    /// The enclave key that verified this card when it was recorded.
    pub pubkey: String,
    pub issuer: AccountId,
    pub commitment: String,
    /// The enclave version (wasm sha256) the registry pinned for this run.
    pub version: String,
    pub mode: String,
    pub window_days: u32,
    pub issued_at: u64,
    pub outlayer_request_id: Option<String>,
    pub revoked: bool,
    pub supersedes: Option<u64>,
    pub superseded_by: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub enum PendingKind {
    Pubkey,
    Card { window_days: u32, supersedes: Option<u64> },
    Reveal { card_id: u64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Pending {
    pub kind: PendingKind,
    pub signer: AccountId,
    pub version: String,
    pub outlayer_deposit: NearToken,
    pub storage_fee: NearToken,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum RequestOutcome {
    Pending,
    Issued { card_id: u64, card_hash: String },
    KeySet { pubkey: String },
    Refused { code: String, message: String },
    /// `ciphertext` (base64, for the follower's key) is only in the callback's return
    /// value, which the follower reads from the transaction; it is never kept in state.
    Revealed { card_id: u64, shown: u32, total: u32, ciphertext_sha256: String, ciphertext: Option<String> },
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VerifyResult {
    /// VALID, NOT_FOUND, BAD_CARD, HASH_MISMATCH, REVOKED, VERSION_RETIRED, SUPERSEDED or STALE.
    pub status: String,
    pub valid: bool,
    pub card_id: Option<u64>,
    pub card_hash: Option<String>,
    pub version: Option<String>,
    pub mode: Option<String>,
    pub issued_at: Option<u64>,
    pub pubkey: Option<String>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub outlayer: AccountId,
    pub project_id: String,
    pub active_version: Option<String>,
    pub card_pubkey: Option<String>,
    pub accept_fixture_cards: bool,
    pub stale_after_secs: u64,
    pub cards: u64,
    pub requests: u64,
    pub usdc: Option<AccountId>,
    pub fee_bps: u16,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner: AccountId,
    outlayer: AccountId,
    project_id: String,
    active_version: Option<String>,
    versions: IterableMap<String, VersionInfo>,
    card_pubkey: Option<[u8; 32]>,
    /// Testnet demo registries accept the demo build's "fixture" cards; mainnet never does.
    accept_fixture_cards: bool,
    stale_after_secs: u64,
    next_card_id: u64,
    next_request: u64,
    cards: LookupMap<u64, CardRecord>,
    card_by_hash: LookupMap<String, u64>,
    by_issuer: LookupMap<AccountId, Vec<u64>>,
    by_commitment: LookupMap<String, Vec<u64>>,
    used_nonces: LookupSet<String>,
    pending: LookupMap<u64, Pending>,
    requests: LookupMap<u64, RequestOutcome>,
    // ---- viewing keys (P7, src/keys.rs) ----
    /// The only token accepted for keys (USDC on NEAR); `None` until the owner sets it.
    usdc: Option<AccountId>,
    fee_bps: u16,
    offers: LookupMap<u64, Offer>,
    /// Per card. Bounded by the offer's seat cap; expired grants are pruned on each sale.
    grants: LookupMap<u64, Vec<Grant>>,
    /// Per card: payments held until the issuer approves or rejects the buyer.
    waiting: LookupMap<u64, Vec<Waiting>>,
    /// USDC owed to issuers, the fee account and refunded buyers; paid out by `withdraw`.
    balances: LookupMap<AccountId, u128>,
}

/// The P3–P6 state, for `migrate`.
#[near(serializers = [borsh])]
pub struct RegistryV1 {
    owner: AccountId,
    outlayer: AccountId,
    project_id: String,
    active_version: Option<String>,
    versions: IterableMap<String, VersionInfo>,
    card_pubkey: Option<[u8; 32]>,
    accept_fixture_cards: bool,
    stale_after_secs: u64,
    next_card_id: u64,
    next_request: u64,
    cards: LookupMap<u64, CardRecord>,
    card_by_hash: LookupMap<String, u64>,
    by_issuer: LookupMap<AccountId, Vec<u64>>,
    by_commitment: LookupMap<String, Vec<u64>>,
    used_nonces: LookupSet<String>,
    pending: LookupMap<u64, Pending>,
    requests: LookupMap<u64, RequestOutcome>,
}

fn event(name: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "proveit", "version": "1.0.0", "event": name, "data": [data] })
    ));
}

fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn refused(code: &str, message: impl Into<String>) -> RequestOutcome {
    RequestOutcome::Refused { code: code.into(), message: message.into() }
}

#[near]
impl Registry {
    #[init]
    pub fn new(owner: AccountId, outlayer: AccountId, project_id: String, accept_fixture_cards: bool) -> Self {
        Self {
            owner,
            outlayer,
            project_id,
            active_version: None,
            versions: IterableMap::new(Key::Versions),
            card_pubkey: None,
            accept_fixture_cards,
            stale_after_secs: DEFAULT_STALE_AFTER_SECS,
            next_card_id: 0,
            next_request: 0,
            cards: LookupMap::new(Key::Cards),
            card_by_hash: LookupMap::new(Key::CardByHash),
            by_issuer: LookupMap::new(Key::ByIssuer),
            by_commitment: LookupMap::new(Key::ByCommitment),
            used_nonces: LookupSet::new(Key::Nonces),
            pending: LookupMap::new(Key::Pending),
            requests: LookupMap::new(Key::Requests),
            usdc: None,
            fee_bps: DEFAULT_FEE_BPS,
            offers: LookupMap::new(Key::Offers),
            grants: LookupMap::new(Key::Grants),
            waiting: LookupMap::new(Key::Waiting),
            balances: LookupMap::new(Key::Balances),
        }
    }

    /// Upgrade a P3–P6 registry in place: cards, versions and the key are kept.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: RegistryV1 = env::state_read().unwrap_or_else(|| env::panic_str("no state to migrate"));
        Self {
            owner: old.owner,
            outlayer: old.outlayer,
            project_id: old.project_id,
            active_version: old.active_version,
            versions: old.versions,
            card_pubkey: old.card_pubkey,
            accept_fixture_cards: old.accept_fixture_cards,
            stale_after_secs: old.stale_after_secs,
            next_card_id: old.next_card_id,
            next_request: old.next_request,
            cards: old.cards,
            card_by_hash: old.card_by_hash,
            by_issuer: old.by_issuer,
            by_commitment: old.by_commitment,
            used_nonces: old.used_nonces,
            pending: old.pending,
            requests: old.requests,
            usdc: None,
            fee_bps: DEFAULT_FEE_BPS,
            offers: LookupMap::new(Key::Offers),
            grants: LookupMap::new(Key::Grants),
            waiting: LookupMap::new(Key::Waiting),
            balances: LookupMap::new(Key::Balances),
        }
    }

    // ---- versions (owner) --------------------------------------------------------------

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }

    /// Approve an audited enclave build (its wasm sha256) and make it the one new cards use.
    pub fn approve_version(&mut self, hash: String) {
        self.assert_owner();
        require!(hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()), "hash must be a sha256 in hex");
        self.versions.insert(hash.clone(), VersionInfo { approved_at: now_secs(), retired: false });
        self.active_version = Some(hash.clone());
        event("version_approved", json!({ "hash": hash }));
    }

    /// Retire a build: cards it produced stop verifying, and it can't issue new ones.
    pub fn retire_version(&mut self, hash: String) {
        self.assert_owner();
        let info = self.versions.get_mut(&hash).unwrap_or_else(|| env::panic_str("unknown version"));
        info.retired = true;
        if self.active_version.as_deref() == Some(hash.as_str()) {
            self.active_version = None;
        }
        event("version_retired", json!({ "hash": hash }));
    }

    pub fn set_stale_after_secs(&mut self, secs: u64) {
        self.assert_owner();
        self.stale_after_secs = secs;
    }

    /// Ask the enclave for its card key. The key is bound to this contract, so only the
    /// enclave, called by this registry, can produce it.
    #[payable]
    pub fn bootstrap_key(&mut self) -> Promise {
        self.assert_owner();
        self.start(PendingKind::Pubkey, json!({ "op": "pubkey" }).to_string(), None, NearToken::from_yoctonear(0))
    }

    // ---- cards (traders) -------------------------------------------------------------

    /// Issue a card from the trader's stored, encrypted OutLayer secret (`secrets_profile`).
    /// Attach at least 0.07 NEAR: 0.02 pays for storing the card (refunded if it's refused),
    /// the rest goes to OutLayer, which refunds whatever the run doesn't use.
    /// `kind`: "trader" (default) or "agent", for an account traded by an AI agent. It is the
    /// issuer's own label, signed into the card like everything else.
    #[payable]
    pub fn request_card(&mut self, window_days: u32, secrets_profile: Option<String>, kind: Option<String>) -> Promise {
        require!(WINDOWS.contains(&window_days), "window_days must be 1, 7, 30, 90 or 180");
        let kind = kind.unwrap_or_else(|| "trader".into());
        require!(KINDS.contains(&kind.as_str()), "kind must be trader or agent");
        let input = json!({ "op": "issue", "window_days": window_days, "kind": kind }).to_string();
        self.start(PendingKind::Card { window_days, supersedes: None }, input, secrets_profile, STORAGE_FEE)
    }

    /// Re-issue a card for the same account and window. The new card links back to the old one.
    #[payable]
    pub fn refresh(&mut self, card_id: u64, secrets_profile: Option<String>) -> Promise {
        let old = self.cards.get(&card_id).unwrap_or_else(|| env::panic_str("unknown card")).clone();
        require!(old.issuer == env::predecessor_account_id(), "only the card's issuer can refresh it");
        require!(old.superseded_by.is_none() && !old.revoked, "card is already superseded or revoked");
        let kind = serde_json::from_str::<Value>(&old.card_json).ok().and_then(|c| c["kind"].as_str().map(String::from)).unwrap_or_else(|| "trader".into());
        let input = json!({ "op": "issue", "window_days": old.window_days, "kind": kind }).to_string();
        self.start(PendingKind::Card { window_days: old.window_days, supersedes: Some(card_id) }, input, secrets_profile, STORAGE_FEE)
    }

    pub fn revoke(&mut self, card_id: u64) {
        let card = self.cards.get_mut(&card_id).unwrap_or_else(|| env::panic_str("unknown card"));
        require!(card.issuer == env::predecessor_account_id(), "only the card's issuer can revoke it");
        card.revoked = true;
        event("card_revoked", json!({ "card_id": card_id }));
    }

    fn start(&mut self, kind: PendingKind, input: String, secrets_profile: Option<String>, storage_fee: NearToken) -> Promise {
        let version = self.active_version.clone().unwrap_or_else(|| env::panic_str("no active enclave version"));
        let signer = env::predecessor_account_id();
        let attached = env::attached_deposit();
        let needed = storage_fee.saturating_add(MIN_OUTLAYER_DEPOSIT);
        require!(attached >= needed, format!("attach at least {} yoctoNEAR", needed.as_yoctonear()));
        let outlayer_deposit = attached.saturating_sub(storage_fee);

        let seq = self.next_request;
        self.next_request += 1;
        self.pending.insert(seq, Pending { kind: kind.clone(), signer: signer.clone(), version: version.clone(), outlayer_deposit, storage_fee });
        self.requests.insert(seq, RequestOutcome::Pending);
        event("request_started", json!({ "request": seq, "signer": signer, "version": version }));

        // resource_limits must be present: without it OutLayer treats the request as compile-only.
        let args = json!({
            "source": { "Project": { "project_id": self.project_id, "version_key": version } },
            "resource_limits": { "max_instructions": 30_000_000_000u64, "max_memory_mb": 256, "max_execution_seconds": 120 },
            "input_data": input,
            "secrets_ref": secrets_profile.map(|profile| json!({ "profile": profile, "account_id": signer })),
            "response_format": "Json",
            "payer_account_id": signer,
            "params": null
        });
        Promise::new(self.outlayer.clone())
            .function_call_weight(
                "request_execution".to_string(),
                serde_json::to_vec(&args).unwrap(),
                outlayer_deposit,
                OUTLAYER_MIN_GAS,
                GasWeight(1),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_result(seq))
    }

    #[private]
    pub fn on_result(&mut self, seq: u64) -> RequestOutcome {
        let p = self.pending.remove(&seq).unwrap_or_else(|| env::panic_str("unknown request"));
        let max = if matches!(p.kind, PendingKind::Reveal { .. }) { MAX_REVEAL_OUTPUT } else { MAX_OUTPUT };
        let outcome = match env::promise_result_checked(0, max) {
            // OutLayer refused the request outright; its deposit came back to this contract.
            Err(e) => {
                Promise::new(p.signer.clone()).transfer(p.outlayer_deposit.saturating_add(p.storage_fee)).detach();
                refused("OUTLAYER_FAILED", format!("{e:?}"))
            }
            Ok(bytes) => {
                let result = match &p.kind {
                    PendingKind::Pubkey => self.accept_pubkey(&bytes),
                    PendingKind::Card { window_days, supersedes } => self.accept_card(&p, *window_days, *supersedes, &bytes),
                    PendingKind::Reveal { card_id } => accept_reveal(*card_id, &bytes),
                };
                result.unwrap_or_else(|(code, message)| {
                    if !p.storage_fee.is_zero() {
                        Promise::new(p.signer.clone()).transfer(p.storage_fee).detach();
                    }
                    refused(&code, message)
                })
            }
        };
        // A reveal's ciphertext goes back in the return value only, never into state or logs.
        let kept = match &outcome {
            RequestOutcome::Revealed { card_id, shown, total, ciphertext_sha256, .. } => RequestOutcome::Revealed {
                card_id: *card_id,
                shown: *shown,
                total: *total,
                ciphertext_sha256: ciphertext_sha256.clone(),
                ciphertext: None,
            },
            other => other.clone(),
        };
        self.requests.insert(seq, kept.clone());
        match &kept {
            RequestOutcome::Refused { code, message } => {
                event("request_refused", json!({ "request": seq, "signer": p.signer, "code": code, "message": message }))
            }
            other => event("request_done", json!({ "request": seq, "outcome": other })),
        }
        outcome
    }

    fn accept_pubkey(&mut self, bytes: &[u8]) -> Result<RequestOutcome, (String, String)> {
        let v: Value = serde_json::from_slice(bytes).map_err(|e| ("BAD_OUTPUT".to_string(), e.to_string()))?;
        if v["status"] != "ok" {
            return Err(enclave_error(&v));
        }
        let hex_key = v["pubkey"].as_str().unwrap_or_default().to_string();
        let key = card::parse_hex::<32>(&hex_key).ok_or(("BAD_OUTPUT".to_string(), "pubkey is not 32 bytes of hex".to_string()))?;
        self.card_pubkey = Some(key);
        event("key_set", json!({ "pubkey": hex_key }));
        Ok(RequestOutcome::KeySet { pubkey: hex_key })
    }

    fn accept_card(&mut self, p: &Pending, window_days: u32, supersedes: Option<u64>, bytes: &[u8]) -> Result<RequestOutcome, (String, String)> {
        let fail = |code: &str, msg: &str| Err((code.to_string(), msg.to_string()));
        let v: Value = serde_json::from_slice(bytes).map_err(|e| ("BAD_OUTPUT".to_string(), e.to_string()))?;
        if v["status"] != "ok" {
            return Err(enclave_error(&v));
        }
        let card_value = v["card"].clone();
        let sig = v["sig"].as_str().unwrap_or_default().to_string();
        let parsed: Card = serde_json::from_value(card_value.clone()).map_err(|e| ("BAD_CARD".to_string(), e.to_string()))?;
        let canonical = card::canonical(&card_value).map_err(|e| ("BAD_CARD".to_string(), e))?;

        let pubkey = match self.card_pubkey {
            Some(k) => k,
            None => return fail("NO_KEY", "the registry has no enclave key yet; the owner must run bootstrap_key"),
        };
        if !card::signature_ok(&canonical, &sig, &pubkey) {
            return fail("BAD_SIGNATURE", "the card's signature does not verify under the enclave key");
        }
        if parsed.v != 1 || parsed.venue != "hyperliquid" || !KINDS.contains(&parsed.kind.as_str()) || parsed.scope != "account" {
            return fail("BAD_CARD", "unsupported card version, venue, kind or scope");
        }
        if parsed.window.days != window_days {
            return fail("BAD_CARD", "the card's window is not the one requested");
        }
        if parsed.issuer != p.signer.as_str() {
            return fail("WRONG_ISSUER", "the card names a different issuer than the account that requested it");
        }
        match parsed.mode.as_str() {
            "live" => {
                let nonce_key = format!("{}:{}", p.signer, parsed.nonce);
                if !self.used_nonces.insert(nonce_key) {
                    return fail("NONCE_REUSED", "this ownership signature was already used for a card");
                }
            }
            "fixture" if self.accept_fixture_cards => {}
            _ => return fail("FIXTURE_REFUSED", "this registry only accepts live cards"),
        }

        let hash = card::card_hash(&canonical);
        if self.card_by_hash.contains_key(&hash) {
            return fail("DUPLICATE", "this exact card is already recorded");
        }
        if let Some(old_id) = supersedes {
            let old = self.cards.get(&old_id).ok_or(("BAD_CARD".to_string(), "superseded card is gone".to_string()))?;
            if old.commitment != parsed.commitment {
                return fail("COMMITMENT_MISMATCH", "a refresh must come from the same account as the original card");
            }
        }

        let id = self.next_card_id;
        self.next_card_id += 1;
        let record = CardRecord {
            id,
            card_hash: hash.clone(),
            card_json: canonical,
            sig,
            pubkey: hex::encode(pubkey),
            issuer: p.signer.clone(),
            commitment: parsed.commitment.clone(),
            version: p.version.clone(),
            mode: parsed.mode.clone(),
            window_days,
            issued_at: parsed.issued_at,
            outlayer_request_id: parsed.outlayer_request_id.clone(),
            revoked: false,
            supersedes,
            superseded_by: None,
        };
        if let Some(old_id) = supersedes {
            if let Some(old) = self.cards.get_mut(&old_id) {
                old.superseded_by = Some(id);
            }
        }
        self.cards.insert(id, record);
        self.card_by_hash.insert(hash.clone(), id);
        self.by_issuer.entry(p.signer.clone()).or_default().push(id);
        self.by_commitment.entry(parsed.commitment.clone()).or_default().push(id);
        event(
            "card_issued",
            json!({ "card_id": id, "card_hash": hash, "issuer": p.signer, "commitment": parsed.commitment, "version": p.version, "mode": parsed.mode }),
        );
        Ok(RequestOutcome::Issued { card_id: id, card_hash: hash })
    }

    // ---- views ---------------------------------------------------------------------

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            outlayer: self.outlayer.clone(),
            project_id: self.project_id.clone(),
            active_version: self.active_version.clone(),
            card_pubkey: self.card_pubkey.map(hex::encode),
            accept_fixture_cards: self.accept_fixture_cards,
            stale_after_secs: self.stale_after_secs,
            cards: self.next_card_id,
            requests: self.next_request,
            usdc: self.usdc.clone(),
            fee_bps: self.fee_bps,
        }
    }

    pub fn get_versions(&self) -> Vec<(String, VersionInfo)> {
        self.versions.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_card(&self, card_id: u64) -> Option<CardRecord> {
        self.cards.get(&card_id).cloned()
    }

    pub fn get_card_by_hash(&self, card_hash: String) -> Option<CardRecord> {
        self.card_by_hash.get(&card_hash).and_then(|id| self.cards.get(id)).cloned()
    }

    pub fn get_request(&self, request: u64) -> Option<RequestOutcome> {
        self.requests.get(&request).cloned()
    }

    pub fn get_cards_by_issuer(&self, issuer: AccountId, from: Option<u32>, limit: Option<u32>) -> Vec<CardRecord> {
        self.page(self.by_issuer.get(&issuer), from, limit)
    }

    pub fn get_cards_by_commitment(&self, commitment: String, from: Option<u32>, limit: Option<u32>) -> Vec<CardRecord> {
        self.page(self.by_commitment.get(&commitment), from, limit)
    }

    fn page(&self, ids: Option<&Vec<u64>>, from: Option<u32>, limit: Option<u32>) -> Vec<CardRecord> {
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        ids.map(|ids| {
            ids.iter().skip(from.unwrap_or(0) as usize).take(limit).filter_map(|id| self.cards.get(id).cloned()).collect()
        })
        .unwrap_or_default()
    }

    /// Check a card. With `card_json`, also checks those exact bytes are the recorded card
    /// (any edit gives HASH_MISMATCH). Contracts can call this to gate on verified traders.
    pub fn verify_card(&self, card_id: u64, card_json: Option<String>) -> VerifyResult {
        let mut r = VerifyResult {
            status: "NOT_FOUND".into(),
            valid: false,
            card_id: Some(card_id),
            card_hash: None,
            version: None,
            mode: None,
            issued_at: None,
            pubkey: None,
        };
        let Some(c) = self.cards.get(&card_id) else { return r };
        r.card_hash = Some(c.card_hash.clone());
        r.version = Some(c.version.clone());
        r.mode = Some(c.mode.clone());
        r.issued_at = Some(c.issued_at);
        r.pubkey = Some(c.pubkey.clone());

        if let Some(json) = card_json {
            let canonical = serde_json::from_str::<Value>(&json).map_err(|e| e.to_string()).and_then(|v| card::canonical(&v));
            match canonical {
                Err(_) => {
                    r.status = "BAD_CARD".into();
                    return r;
                }
                Ok(bytes) if card::card_hash(&bytes) != c.card_hash => {
                    r.status = "HASH_MISMATCH".into();
                    return r;
                }
                Ok(_) => {}
            }
        }
        let retired = self.versions.get(&c.version).map(|v| v.retired).unwrap_or(true);
        r.status = if c.revoked {
            "REVOKED"
        } else if retired {
            "VERSION_RETIRED"
        } else if c.superseded_by.is_some() {
            "SUPERSEDED"
        } else if now_secs().saturating_sub(c.issued_at) > self.stale_after_secs {
            "STALE"
        } else {
            "VALID"
        }
        .into();
        r.valid = r.status == "VALID";
        r
    }
}

/// The enclave's reveal answer: `{"status":"ok","ciphertext":"<base64>","shown":k,"total":n}`.
fn accept_reveal(card_id: u64, bytes: &[u8]) -> Result<RequestOutcome, (String, String)> {
    let v: Value = serde_json::from_slice(bytes).map_err(|e| ("BAD_OUTPUT".to_string(), e.to_string()))?;
    if v["status"] != "ok" {
        return Err(enclave_error(&v));
    }
    let ciphertext = v["ciphertext"].as_str().ok_or(("BAD_OUTPUT".to_string(), "no ciphertext".to_string()))?.to_string();
    let count = |k: &str| v[k].as_u64().and_then(|n| u32::try_from(n).ok()).ok_or(("BAD_OUTPUT".to_string(), format!("no {k}")));
    Ok(RequestOutcome::Revealed {
        card_id,
        shown: count("shown")?,
        total: count("total")?,
        ciphertext_sha256: hex::encode(env::sha256(ciphertext.as_bytes())),
        ciphertext: Some(ciphertext),
    })
}

fn enclave_error(v: &Value) -> (String, String) {
    (
        v["code"].as_str().unwrap_or("ENCLAVE_ERROR").to_string(),
        v["message"].as_str().unwrap_or("the enclave refused").to_string(),
    )
}
