//! T1.1 and T1.2: the ownership check against signatures made by viem.

use proveit_enclave::ownership::{self, OwnershipProof};
use proveit_enclave::Code;
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!("../../test-vectors/eip712.json")).unwrap()
}

fn proof(v: &Value, key: &str) -> OwnershipProof {
    serde_json::from_value(v[key].clone()).unwrap()
}

fn now(v: &Value) -> u64 {
    v["now"].as_u64().unwrap()
}

#[test]
fn digest_matches_viem() {
    let v = vectors();
    let d = ownership::digest(&proof(&v, "valid")).unwrap();
    assert_eq!(format!("0x{}", hex::encode(d)), v["digest"].as_str().unwrap());
}

#[test]
fn statement_matches_the_web_app() {
    assert_eq!(vectors()["statement"].as_str().unwrap(), ownership::STATEMENT);
}

#[test]
fn valid_signature() {
    let v = vectors();
    ownership::verify(&proof(&v, "valid"), "trader.testnet", now(&v)).unwrap();
}

#[test]
fn checksummed_or_lowercase_account_both_work() {
    let v = vectors();
    let mut p = proof(&v, "valid");
    p.account = p.account.to_lowercase();
    ownership::verify(&p, "trader.testnet", now(&v)).unwrap();
}

#[test]
fn rejects_signature_from_another_key() {
    let v = vectors();
    let e = ownership::verify(&proof(&v, "signed_by_other_key"), "trader.testnet", now(&v)).unwrap_err();
    assert_eq!(e.code, Code::SigInvalid);
}

#[test]
fn rejects_another_near_account() {
    let v = vectors();
    let e = ownership::verify(&proof(&v, "valid"), "someone-else.testnet", now(&v)).unwrap_err();
    assert_eq!(e.code, Code::NearAccountMismatch);
}

#[test]
fn rejects_expired_signature() {
    let v = vectors();
    let p = proof(&v, "valid");
    let e = ownership::verify(&p, "trader.testnet", p.expiry).unwrap_err();
    assert_eq!(e.code, Code::SigExpired);
}

#[test]
fn rejects_expiry_too_far_ahead() {
    let v = vectors();
    let p = proof(&v, "valid");
    let e = ownership::verify(&p, "trader.testnet", p.expiry - ownership::MAX_VALIDITY_SECS - 1).unwrap_err();
    assert_eq!(e.code, Code::BadInput);
}

#[test]
fn rejects_high_s_twin() {
    let v = vectors();
    let e = ownership::verify(&proof(&v, "high_s"), "trader.testnet", now(&v)).unwrap_err();
    assert_eq!(e.code, Code::SigInvalid);
}

#[test]
fn rejects_tampered_fields() {
    let v = vectors();
    for tamper in [
        |p: &mut OwnershipProof| p.nonce += 1,
        |p: &mut OwnershipProof| p.expiry -= 1,
        |p: &mut OwnershipProof| p.account = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8".into(),
    ] {
        let mut p = proof(&v, "valid");
        tamper(&mut p);
        let e = ownership::verify(&p, "trader.testnet", now(&v)).unwrap_err();
        assert_eq!(e.code, Code::SigInvalid, "tampered proof must not verify: {p:?}");
    }
}

#[test]
fn rejects_malformed_input() {
    let v = vectors();
    let mut p = proof(&v, "valid");
    p.signature = "0x1234".into();
    assert_eq!(ownership::verify(&p, "trader.testnet", now(&v)).unwrap_err().code, Code::SigInvalid);
    let mut p = proof(&v, "valid");
    p.account = "not-an-address".into();
    assert_eq!(ownership::verify(&p, "trader.testnet", now(&v)).unwrap_err().code, Code::BadInput);
}
