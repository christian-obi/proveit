//! T10.5: the enclave's half of the security checklist, as tests.

use std::fs;
use std::path::PathBuf;

fn src(name: &str) -> String {
    fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join(name)).unwrap()
}

/// The enclave signs only messages it composes: the card key is reached through
/// `Platform::sign_card`, and the only caller is `card::sign`, which signs
/// `signing_message(card)` (a fixed prefix + the card's canonical bytes). No op takes bytes
/// to sign; feed pages and reveals are attested per run, never signed.
#[test]
fn only_the_card_code_signs() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    for entry in fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let text = fs::read_to_string(&path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let calls = text.matches(".sign_card(").count();
        match name.as_str() {
            "card.rs" => assert_eq!(calls, 1, "card::sign is the one caller"),
            _ => assert_eq!(calls, 0, "{name} must not call sign_card"),
        }
    }
    assert!(src("card.rs").contains("platform.sign_card(&signing_message(card)?)"));
    // The host binding passes its argument straight to the signing-keys host call: the
    // only way in is the Platform trait above.
    assert_eq!(src("main.rs").matches("signing_keys::sign(").count(), 1);
}

/// EIP-712: the domain names the app and a version, and the signed message binds the NEAR
/// account, a nonce and an expiry (tests/ownership.rs checks each is enforced).
#[test]
fn eip712_domain_and_bindings() {
    let o = src("ownership.rs");
    assert!(o.contains(r#"const DOMAIN_TYPE: &str = "EIP712Domain(string name,string version)";"#));
    assert!(o.contains(r#"pub const DOMAIN_NAME: &str = "Prove-It";"#));
    assert!(o.contains("ProveIt(string statement,address account,string nearAccount,uint64 nonce,uint64 expiry)"));
}
