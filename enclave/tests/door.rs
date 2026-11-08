//! T7.9 (built in P3): only the registry, on-chain, may ask for cards.

use proveit_enclave::door::check_registry_door;
use proveit_enclave::Code;

const REGISTRY: &str = "proveit-registry.testnet";

#[test]
fn the_registry_on_chain_is_allowed() {
    check_registry_door(Some("NEAR"), Some(REGISTRY), REGISTRY).unwrap();
}

#[test]
fn https_is_refused() {
    let e = check_registry_door(Some("HTTPS"), Some(REGISTRY), REGISTRY).unwrap_err();
    assert_eq!(e.code, Code::BadInput);
}

#[test]
fn another_contract_or_a_direct_call_is_refused() {
    for caller in [Some("attacker.testnet"), Some("proveit-registry.testnet.evil.testnet"), Some("trader.testnet"), None] {
        assert!(check_registry_door(Some("NEAR"), caller, REGISTRY).is_err(), "{caller:?}");
    }
}

#[test]
fn a_missing_execution_type_is_refused() {
    assert!(check_registry_door(None, Some(REGISTRY), REGISTRY).is_err());
}

// ---- P8: the HTTPS door (T7.9's HTTPS half, T8.8's first gate) --------------------------

use proveit_enclave::door::{allowed, classify, Door};

#[test]
fn https_lets_in_only_reveal_and_feed() {
    assert_eq!(classify(Some("HTTPS"), None, REGISTRY).unwrap(), Door::Https);
    for op in ["issue", "pubkey"] {
        assert!(allowed(op, Door::Https).is_err(), "{op} over HTTPS");
    }
    for op in ["reveal", "feed"] {
        allowed(op, Door::Https).unwrap();
    }
}

#[test]
fn on_chain_only_the_registry_and_never_the_feed() {
    assert_eq!(classify(Some("NEAR"), Some(REGISTRY), REGISTRY).unwrap(), Door::Registry);
    assert!(classify(Some("NEAR"), Some("attacker.testnet"), REGISTRY).is_err());
    assert!(classify(None, Some(REGISTRY), REGISTRY).is_err());
    for op in ["pubkey", "issue", "reveal"] {
        allowed(op, Door::Registry).unwrap();
    }
    assert!(allowed("feed", Door::Registry).is_err());
}
