//! T3.1–T3.5: the registry's checks, driven through the real callback with mocked OutLayer
//! results. Cards are signed with the PUBLIC test key (seed sha256("proveit-test-card-key-v1")),
//! the same key the enclave's `test-keys` and test-vectors/card-sig.json use.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::get_created_receipts;
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use sha2::{Digest, Sha256};

const REGISTRY: &str = "registry.testnet";
const OWNER: &str = "owner.testnet";
const TRADER: &str = "trader.testnet";
const VERSION: &str = "8fac34b1779bf3f609daf46d5ad8989b74cb89c2de8b4982df7fba6a255e4b29";

fn vector() -> Value {
    serde_json::from_str(include_str!("../../test-vectors/card-sig.json")).unwrap()
}

fn key() -> SigningKey {
    SigningKey::from_bytes(&Sha256::digest(b"proveit-test-card-key-v1").into())
}

fn ctx(predecessor: &str, deposit: NearToken, results: Vec<PromiseResult>, now_secs: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(REGISTRY.parse().unwrap())
        .predecessor_account_id(predecessor.parse().unwrap())
        .signer_account_id(predecessor.parse().unwrap())
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(now_secs * 1_000_000_000);
    testing_env!(b.build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

/// A card in the shape the enclave produces, for `issuer`, in `mode`, with `nonce`.
fn card(issuer: &str, mode: &str, nonce: u64, window_days: u32) -> Value {
    let mut c = vector()["card"].clone();
    c["issuer"] = json!(issuer);
    c["mode"] = json!(mode);
    c["nonce"] = json!(nonce);
    c["window"]["days"] = json!(window_days);
    c
}

/// The enclave's stdout for a card, signed with `signer`.
fn output_for(card: &Value, signer: &SigningKey) -> Vec<u8> {
    let canonical = card::canonical(card).unwrap();
    let sig = signer.sign(&card::signing_message(&canonical)).to_bytes();
    json!({ "status": "ok", "card": card, "sig": hex::encode(sig) }).to_string().into_bytes()
}

fn issued_at() -> u64 {
    vector()["card"]["issued_at"].as_u64().unwrap()
}

/// A registry with an approved version and the test key bootstrapped through the callback.
fn registry(accept_fixture_cards: bool) -> Registry {
    ctx(OWNER, NearToken::from_near(0), vec![], issued_at());
    let mut r = Registry::new(OWNER.parse().unwrap(), "outlayer.testnet".parse().unwrap(), "owner.testnet/enclave".into(), accept_fixture_cards);
    r.approve_version(VERSION.into());
    ctx(OWNER, NearToken::from_millinear(50), vec![], issued_at());
    let _ = r.bootstrap_key();
    let pk = hex::encode(key().verifying_key().to_bytes());
    let out = json!({ "status": "ok", "pubkey": pk }).to_string().into_bytes();
    ctx(REGISTRY, NearToken::from_near(0), vec![PromiseResult::Successful(out)], issued_at());
    assert_eq!(r.on_result(0), RequestOutcome::KeySet { pubkey: pk });
    r
}

/// Request a card as `trader` and feed `result` back through the callback.
fn issue(r: &mut Registry, trader: &str, window_days: u32, result: PromiseResult) -> RequestOutcome {
    ctx(trader, NearToken::from_millinear(70), vec![], issued_at());
    let seq = r.get_config().requests;
    let _ = r.request_card(window_days, Some("s1".into()), None);
    ctx(REGISTRY, NearToken::from_near(0), vec![result], issued_at() + 60);
    r.on_result(seq)
}

fn ok(card: &Value) -> PromiseResult {
    PromiseResult::Successful(output_for(card, &key()))
}

fn code(o: &RequestOutcome) -> &str {
    match o {
        RequestOutcome::Refused { code, .. } => code,
        _ => "ISSUED",
    }
}

// ---- canonical bytes (pinned to the enclave and the TypeScript verifier) ---------------

#[test]
fn canonical_matches_the_enclave_and_typescript() {
    ctx(OWNER, NearToken::from_near(0), vec![], 0);
    let v = vector();
    let canonical = card::canonical(&v["card"]).unwrap();
    assert_eq!(canonical, v["canonical"].as_str().unwrap());
    assert_eq!(card::card_hash(&canonical), v["card_hash"].as_str().unwrap());
    let pk = card::parse_hex::<32>(v["pubkey"].as_str().unwrap()).unwrap();
    assert!(card::signature_ok(&canonical, v["sig"].as_str().unwrap(), &pk));
}

#[test]
fn canonical_refuses_floats() {
    assert!(card::canonical(&json!({ "x": 1.5 })).is_err());
    assert!(card::canonical(&json!({ "x": "é" })).is_err());
}

// ---- T3.1: on_card accepts only valid cards ------------------------------------------

#[test]
fn accepts_a_valid_live_card() {
    let mut r = registry(false);
    let c = card(TRADER, "live", 1, 30);
    let outcome = issue(&mut r, TRADER, 30, ok(&c));
    let RequestOutcome::Issued { card_id, card_hash } = outcome else { panic!("{outcome:?}") };
    let rec = r.get_card(card_id).unwrap();
    assert_eq!(rec.issuer.as_str(), TRADER);
    assert_eq!(rec.version, VERSION);
    assert_eq!(rec.card_hash, card_hash);
    assert_eq!(rec.card_json, card::canonical(&c).unwrap());
    assert_eq!(r.get_card_by_hash(card_hash).unwrap().id, card_id);
}

#[test]
fn refuses_a_bad_signature() {
    let mut r = registry(false);
    let other = SigningKey::from_bytes(&[7u8; 32]);
    let c = card(TRADER, "live", 1, 30);
    assert_eq!(code(&issue(&mut r, TRADER, 30, PromiseResult::Successful(output_for(&c, &other)))), "BAD_SIGNATURE");
}

#[test]
fn refuses_an_edited_card() {
    let mut r = registry(false);
    let c = card(TRADER, "live", 1, 30);
    let mut out: Value = serde_json::from_slice(&output_for(&c, &key())).unwrap();
    out["card"]["stats"]["return_bps"] = json!(9_999);
    assert_eq!(code(&issue(&mut r, TRADER, 30, PromiseResult::Successful(out.to_string().into_bytes()))), "BAD_SIGNATURE");
}

#[test]
fn refuses_a_card_for_another_issuer() {
    let mut r = registry(false);
    let c = card("someone-else.testnet", "live", 1, 30);
    assert_eq!(code(&issue(&mut r, TRADER, 30, ok(&c))), "WRONG_ISSUER");
}

#[test]
fn refuses_the_wrong_window() {
    let mut r = registry(false);
    let c = card(TRADER, "live", 1, 90);
    assert_eq!(code(&issue(&mut r, TRADER, 30, ok(&c))), "BAD_CARD");
}

#[test]
fn refuses_unknown_fields_and_malformed_output() {
    let mut r = registry(false);
    let mut c = card(TRADER, "live", 1, 30);
    c["bonus"] = json!("+1000%");
    assert_eq!(code(&issue(&mut r, TRADER, 30, ok(&c))), "BAD_CARD");
    assert_eq!(code(&issue(&mut r, TRADER, 30, PromiseResult::Successful(b"not json".to_vec()))), "BAD_OUTPUT");
    assert_eq!(code(&issue(&mut r, TRADER, 30, PromiseResult::Successful(b"null".to_vec()))), "ENCLAVE_ERROR");
}

#[test]
fn passes_the_enclave_refusal_through() {
    let mut r = registry(false);
    let out = json!({ "status": "err", "code": "TOO_FEW_TRADES", "message": "6 trades" }).to_string().into_bytes();
    let o = issue(&mut r, TRADER, 30, PromiseResult::Successful(out));
    assert_eq!(code(&o), "TOO_FEW_TRADES");
    assert_eq!(r.get_config().cards, 0);
}

#[test]
fn fixture_cards_only_on_demo_registries() {
    let mut mainnet = registry(false);
    assert_eq!(code(&issue(&mut mainnet, TRADER, 30, ok(&card(TRADER, "fixture", 0, 30)))), "FIXTURE_REFUSED");
    let mut demo = registry(true);
    assert_eq!(code(&issue(&mut demo, TRADER, 30, ok(&card(TRADER, "fixture", 0, 30)))), "ISSUED");
}

#[test]
fn a_nonce_is_used_once() {
    let mut r = registry(false);
    assert_eq!(code(&issue(&mut r, TRADER, 30, ok(&card(TRADER, "live", 5, 30)))), "ISSUED");
    let mut again = card(TRADER, "live", 5, 30);
    again["issued_at"] = json!(issued_at() + 1);
    assert_eq!(code(&issue(&mut r, TRADER, 30, ok(&again))), "NONCE_REUSED");
}

/// Transfers to `who` in the receipts the last call created.
fn refunds_to(who: &str) -> Vec<u128> {
    get_created_receipts()
        .into_iter()
        .filter(|r| r.receiver_id.as_str() == who)
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_failed_outlayer_call_refunds_everything() {
    let mut r = registry(false);
    let o = issue(&mut r, TRADER, 30, PromiseResult::Failed);
    assert_eq!(code(&o), "OUTLAYER_FAILED");
    assert_eq!(r.get_request(1), Some(o));
    assert_eq!(refunds_to(TRADER), vec![NearToken::from_millinear(70).as_yoctonear()]);
}

#[test]
fn a_refused_card_refunds_the_storage_fee() {
    let mut r = registry(false);
    let out = json!({ "status": "err", "code": "TOO_FEW_TRADES", "message": "6 trades" }).to_string().into_bytes();
    issue(&mut r, TRADER, 30, PromiseResult::Successful(out));
    assert_eq!(refunds_to(TRADER), vec![STORAGE_FEE.as_yoctonear()]);
}

#[test]
fn an_issued_card_keeps_the_storage_fee() {
    let mut r = registry(false);
    issue(&mut r, TRADER, 30, ok(&card(TRADER, "live", 1, 30)));
    assert!(refunds_to(TRADER).is_empty());
}

#[test]
fn without_a_key_nothing_is_recorded() {
    ctx(OWNER, NearToken::from_near(0), vec![], issued_at());
    let mut r = Registry::new(OWNER.parse().unwrap(), "outlayer.testnet".parse().unwrap(), "p".into(), false);
    r.approve_version(VERSION.into());
    assert_eq!(code(&issue(&mut r, TRADER, 30, ok(&card(TRADER, "live", 1, 30)))), "NO_KEY");
}

// ---- T3.3 and T3.5: permissions and money -------------------------------------------

#[test]
#[should_panic(expected = "only the owner")]
fn only_the_owner_bootstraps() {
    let mut r = registry(false);
    ctx(TRADER, NearToken::from_millinear(50), vec![], issued_at());
    let _ = r.bootstrap_key();
}

#[test]
#[should_panic(expected = "only the owner")]
fn only_the_owner_approves_versions() {
    let mut r = registry(false);
    ctx(TRADER, NearToken::from_near(0), vec![], issued_at());
    r.approve_version(VERSION.into());
}

#[test]
#[should_panic(expected = "attach at least")]
fn a_small_deposit_is_refused() {
    let mut r = registry(false);
    ctx(TRADER, NearToken::from_millinear(60), vec![], issued_at());
    let _ = r.request_card(30, None, None);
}

#[test]
#[should_panic(expected = "no active enclave version")]
fn no_cards_without_an_active_version() {
    let mut r = registry(false);
    ctx(OWNER, NearToken::from_near(0), vec![], issued_at());
    r.retire_version(VERSION.into());
    ctx(TRADER, NearToken::from_millinear(70), vec![], issued_at());
    let _ = r.request_card(30, None, None);
}

#[test]
#[should_panic(expected = "window_days must be")]
fn odd_windows_are_refused() {
    let mut r = registry(false);
    ctx(TRADER, NearToken::from_millinear(70), vec![], issued_at());
    let _ = r.request_card(45, None, None);
}

#[test]
#[should_panic(expected = "only the card's issuer can revoke it")]
fn only_the_issuer_revokes() {
    let mut r = registry(false);
    issue(&mut r, TRADER, 30, ok(&card(TRADER, "live", 1, 30)));
    ctx("mallory.testnet", NearToken::from_near(0), vec![], issued_at());
    r.revoke(0);
}

#[test]
fn seven_day_cards_are_accepted() {
    let mut r = registry(false);
    assert_eq!(code(&issue(&mut r, TRADER, 7, ok(&card(TRADER, "live", 1, 7)))), "ISSUED");
}

// ---- T3.4: verify_card ----------------------------------------------------------------

fn verified(r: &Registry, id: u64, json: Option<String>, now: u64) -> String {
    ctx("anyone.testnet", NearToken::from_near(0), vec![], now);
    r.verify_card(id, json).status
}

#[test]
fn verify_card_statuses() {
    let mut r = registry(false);
    let c = card(TRADER, "live", 1, 30);
    issue(&mut r, TRADER, 30, ok(&c));
    let canonical = card::canonical(&c).unwrap();
    let now = issued_at() + 120;

    assert_eq!(verified(&r, 0, Some(canonical.clone()), now), "VALID");
    // Same card with keys in another order: still the same canonical bytes.
    assert_eq!(verified(&r, 0, Some(c.to_string()), now), "VALID");

    let mut edited = c.clone();
    edited["stats"]["return_bps"] = json!(3_494);
    assert_eq!(verified(&r, 0, Some(edited.to_string()), now), "HASH_MISMATCH");
    assert_eq!(verified(&r, 0, Some("{nope".into()), now), "BAD_CARD");
    assert_eq!(verified(&r, 9, None, now), "NOT_FOUND");
    assert_eq!(verified(&r, 0, None, issued_at() + DEFAULT_STALE_AFTER_SECS + 1), "STALE");

    ctx(OWNER, NearToken::from_near(0), vec![], now);
    r.retire_version(VERSION.into());
    assert_eq!(verified(&r, 0, None, now), "VERSION_RETIRED");
}

#[test]
fn revoked_cards_stop_verifying() {
    let mut r = registry(false);
    issue(&mut r, TRADER, 30, ok(&card(TRADER, "live", 1, 30)));
    ctx(TRADER, NearToken::from_near(0), vec![], issued_at());
    r.revoke(0);
    assert_eq!(verified(&r, 0, None, issued_at() + 60), "REVOKED");
}

#[test]
fn refresh_supersedes_and_needs_the_same_account() {
    let mut r = registry(false);
    issue(&mut r, TRADER, 30, ok(&card(TRADER, "live", 1, 30)));

    // Same commitment: the new card supersedes the old one.
    ctx(TRADER, NearToken::from_millinear(70), vec![], issued_at());
    let _ = r.refresh(0, Some("s1".into()));
    let mut newer = card(TRADER, "live", 2, 30);
    newer["issued_at"] = json!(issued_at() + 3_600);
    ctx(REGISTRY, NearToken::from_near(0), vec![ok(&newer)], issued_at() + 3_600);
    assert_eq!(code(&r.on_result(2)), "ISSUED");
    assert_eq!(r.get_card(0).unwrap().superseded_by, Some(1));
    assert_eq!(r.get_card(1).unwrap().supersedes, Some(0));
    assert_eq!(verified(&r, 0, None, issued_at() + 3_700), "SUPERSEDED");

    // Another account's card can't refresh this one.
    ctx(TRADER, NearToken::from_millinear(70), vec![], issued_at());
    let _ = r.refresh(1, Some("s1".into()));
    let mut other = card(TRADER, "live", 3, 30);
    other["commitment"] = json!("00".repeat(32));
    ctx(REGISTRY, NearToken::from_near(0), vec![ok(&other)], issued_at() + 7_200);
    assert_eq!(code(&r.on_result(3)), "COMMITMENT_MISMATCH");
}

#[test]
fn profile_indices() {
    let mut r = registry(false);
    issue(&mut r, TRADER, 30, ok(&card(TRADER, "live", 1, 30)));
    let mut second = card(TRADER, "live", 2, 7);
    second["commitment"] = json!("ab".repeat(32));
    issue(&mut r, TRADER, 7, ok(&second));
    ctx("anyone.testnet", NearToken::from_near(0), vec![], issued_at());
    assert_eq!(r.get_cards_by_issuer(TRADER.parse().unwrap(), None, None).len(), 2);
    let first_commitment = vector()["card"]["commitment"].as_str().unwrap().to_string();
    assert_eq!(r.get_cards_by_commitment(first_commitment.clone(), None, None).len(), 1);

    // T9.2: a third card from the first account → 3 by issuer, grouped 2 + 1 by commitment.
    let mut third = card(TRADER, "live", 3, 30);
    third["issued_at"] = json!(issued_at() + 60);
    issue(&mut r, TRADER, 30, ok(&third));
    ctx("anyone.testnet", NearToken::from_near(0), vec![], issued_at());
    let all = r.get_cards_by_issuer(TRADER.parse().unwrap(), None, None);
    assert_eq!(all.iter().map(|c| c.id).collect::<Vec<_>>(), vec![0, 1, 2]);
    let first = r.get_cards_by_commitment(first_commitment, None, None);
    assert_eq!(first.iter().map(|c| c.id).collect::<Vec<_>>(), vec![0, 2]);
    assert_eq!(r.get_cards_by_commitment("ab".repeat(32), None, None).iter().map(|c| c.id).collect::<Vec<_>>(), vec![1]);
    assert!(r.get_cards_by_issuer("nobody.testnet".parse().unwrap(), None, None).is_empty());
}

#[test]
fn agent_cards() {
    let mut r = registry(false);
    // The registry asks the enclave for the kind the issuer chose…
    ctx(TRADER, NearToken::from_millinear(70), vec![], issued_at());
    let _ = r.request_card(30, Some("s1".into()), Some("agent".into()));
    let input: Value = get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .find_map(|a| match a {
            MockAction::FunctionCallWeight { method_name, args, .. } if method_name == b"request_execution" => {
                Some(serde_json::from_str(serde_json::from_slice::<Value>(&args).unwrap()["input_data"].as_str().unwrap()).unwrap())
            }
            _ => None,
        })
        .unwrap();
    assert_eq!(input, json!({ "op": "issue", "window_days": 30, "kind": "agent" }));
    // …and records the agent card the enclave signs.
    let mut c = card(TRADER, "live", 1, 30);
    c["kind"] = json!("agent");
    ctx(REGISTRY, NearToken::from_near(0), vec![ok(&c)], issued_at() + 60);
    assert_eq!(code(&r.on_result(1)), "ISSUED");
    // Anything else is refused, both asked for and signed.
    ctx(TRADER, NearToken::from_millinear(70), vec![], issued_at());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = r.request_card(30, None, Some("whale".into()));
    }))
    .is_err());
    let mut odd = card(TRADER, "live", 2, 30);
    odd["kind"] = json!("whale");
    assert_eq!(code(&issue(&mut r, TRADER, 30, ok(&odd))), "BAD_CARD");
}

#[path = "keys_tests.rs"]
mod keys_tests;

/// T10.5: callbacks are #[private]: nobody but the registry itself can feed it a result.
/// near-sdk enforces this in the generated wasm entry point (which unit tests bypass), so
/// this checks the attribute is on every callback; docs/p10-results has the live refusal.
#[test]
fn callbacks_are_private() {
    for (file, src) in [("lib.rs", include_str!("lib.rs")), ("keys.rs", include_str!("keys.rs"))] {
        for (i, line) in src.lines().enumerate() {
            if let Some(name) = line.trim().strip_prefix("pub fn on_").map(|r| r.split('(').next().unwrap()) {
                let prev: Vec<&str> = src.lines().take(i).collect();
                assert!(prev.iter().rev().take(2).any(|l| l.trim() == "#[private]"), "{file}: on_{name} must be #[private]");
            }
        }
    }
}
