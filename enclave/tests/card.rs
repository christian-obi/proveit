//! T2.1, T2.3, T2.4 and the issue pipeline: canonical bytes, signatures, size.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use proveit_enclave::canonical::to_canonical;
use proveit_enclave::card::{self, Card, SignedCard};
use proveit_enclave::hl::FixtureSource;
use proveit_enclave::pipeline::{self, IssueParams};
use proveit_enclave::platform::test::TestPlatform;
use proveit_enclave::platform::Platform;
use proveit_enclave::{commit, Code};
use serde_json::{json, Value};
use std::path::PathBuf;

fn vector() -> Value {
    serde_json::from_str(include_str!("../../test-vectors/card-sig.json")).unwrap()
}

fn fixture(name: &str) -> FixtureSource {
    FixtureSource { dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name) }
}

fn issue(name: &str, platform: &TestPlatform) -> proveit_enclave::error::Result<SignedCard> {
    pipeline::issue(
        &fixture(name),
        platform,
        &IssueParams {
            address: "0xE986b8E58b5870dcA58700C23B5303F20f6823a7",
            window_days: 30,
            issuer: "trader.testnet",
            nonce: 7,
            issued_at: 1_793_980_000,
            outlayer_request_id: Some("10283".into()),
            mode: "fixture",
        },
    )
}

/// T2.1: the same card with keys in any order gives the same bytes; floats are refused.
#[test]
fn canonical_is_stable() {
    let v = vector();
    let card: Card = serde_json::from_value(v["card"].clone()).unwrap();
    assert_eq!(String::from_utf8(card::card_bytes(&card).unwrap()).unwrap(), v["canonical"].as_str().unwrap());

    let a = json!({"b": 1, "a": {"y": [3, 2], "x": null}});
    let b = json!({"a": {"x": null, "y": [3, 2]}, "b": 1});
    assert_eq!(to_canonical(&a).unwrap(), to_canonical(&b).unwrap());
    assert_eq!(to_canonical(&a).unwrap(), r#"{"a":{"x":null,"y":[3,2]},"b":1}"#);
}

#[test]
fn canonical_refuses_floats_and_non_ascii() {
    assert_eq!(to_canonical(&json!({"x": 1.5})).unwrap_err().code, Code::BadInput);
    assert_eq!(to_canonical(&json!({"x": "café"})).unwrap_err().code, Code::BadInput);
    assert_eq!(to_canonical(&json!({"é": 1})).unwrap_err().code, Code::BadInput);
}

/// T2.3: the Rust signer reproduces the TypeScript-made vector byte for byte.
#[test]
fn signature_vector() {
    let v = vector();
    let card: Card = serde_json::from_value(v["card"].clone()).unwrap();
    let p = TestPlatform::default();
    assert_eq!(hex::encode(p.card_public_key().unwrap()), v["pubkey"].as_str().unwrap());
    assert_eq!(hex::encode(card::card_hash(&card).unwrap()), v["card_hash"].as_str().unwrap());
    assert_eq!(hex::encode(card::signing_message(&card).unwrap()), v["signing_message"].as_str().unwrap());
    assert_eq!(hex::encode(card::sign(&p, &card).unwrap()), v["sig"].as_str().unwrap());
}

#[test]
fn a_changed_field_breaks_the_signature() {
    let v = vector();
    let card: Card = serde_json::from_value(v["card"].clone()).unwrap();
    let p = TestPlatform::default();
    let sig = Signature::from_bytes(&card::sign(&p, &card).unwrap());
    let key = VerifyingKey::from_bytes(&p.card_public_key().unwrap()).unwrap();
    key.verify(&card::signing_message(&card).unwrap(), &sig).unwrap();

    let mut forged = card.clone();
    forged.stats.return_bps = 3_494;
    assert!(key.verify(&card::signing_message(&forged).unwrap(), &sig).is_err());
}

#[test]
fn unknown_fields_are_refused() {
    let mut v = vector()["card"].clone();
    v["bonus_claim"] = json!("+1000%");
    assert!(serde_json::from_value::<Card>(v).is_err());
}

/// T2.4: the enclave's whole answer fits OutLayer's single-call path (< 1,024 bytes).
#[test]
fn output_size() {
    for name in ["winner", "loser"] {
        let signed = issue(name, &TestPlatform::default()).unwrap();
        let answer = json!({ "status": "ok", "card": signed.card, "sig": signed.sig }).to_string();
        assert!(answer.len() < 1_024, "{name}: {} bytes", answer.len());
    }
}

#[test]
fn issue_signs_commits_and_stores() {
    let p = TestPlatform::default();
    let signed = issue("winner", &p).unwrap();
    let card = &signed.card;

    let key = VerifyingKey::from_bytes(&p.card_public_key().unwrap()).unwrap();
    key.verify(&card::signing_message(card).unwrap(), &Signature::from_bytes(&signed.signature().unwrap())).unwrap();

    // Same account, any casing → same commitment; another account → another.
    assert_eq!(card.commitment, commit::commitment(&p, "hyperliquid", "0xe986b8e58b5870dca58700c23b5303f20f6823a7").unwrap());
    assert_ne!(card.commitment, commit::commitment(&p, "hyperliquid", "0xed01eec66dbbbd05fd43f2b340614dc7b62786ce").unwrap());
    assert_eq!(card.commitment.len(), 64);

    // The card never contains the address.
    let bytes = String::from_utf8(card::card_bytes(card).unwrap()).unwrap().to_lowercase();
    assert!(!bytes.contains("e986b8e58b5870dca58700c23b5303f20f6823a7"));

    // One storage write, keyed by the card hash, holding what a reveal needs.
    let stored = p.stored.borrow();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].0, format!("card:{}", hex::encode(card::card_hash(card).unwrap())));
    let value: Value = serde_json::from_slice(&stored[0].1).unwrap();
    assert_eq!(value["address"], "0xe986b8e58b5870dca58700c23b5303f20f6823a7");
    assert_eq!(value["orders_root"], card.orders.root);

    assert_eq!(card.nonce, 7);
    assert_eq!(card.outlayer_request_id.as_deref(), Some("10283"));
    assert!(card.orders.count >= card.stats.trades);
}

#[test]
fn refused_cards_are_not_stored_or_signed() {
    let p = TestPlatform::default();
    assert_eq!(issue("few_orders", &p).unwrap_err().code, Code::TooFewTrades);
    assert!(p.stored.borrow().is_empty());
}
