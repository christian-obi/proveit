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
