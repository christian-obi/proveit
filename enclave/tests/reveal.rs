//! T7.1–T7.4: what a viewing key reveals, and that the follower can check it.

use proveit_enclave::card::{self, SignedCard};
use proveit_enclave::hl::FixtureSource;
use proveit_enclave::merkle;
use proveit_enclave::pipeline::{self, IssueParams};
use proveit_enclave::platform::test::TestPlatform;
use proveit_enclave::platform::Platform;
use proveit_enclave::reveal::{self, Revealed, Stored};
use proveit_enclave::{ecies, Code};
use proptest::prelude::*;
use serde_json::Value;
use std::path::PathBuf;

const ADDRESS: &str = "0xe986b8e58b5870dca58700c23b5303f20f6823a7";
const FOLLOWER: &str = "follower.testnet";
/// The follower's X25519 secret in tests and in test-vectors/ecies-follower.json. PUBLIC.
const FOLLOWER_SECRET: [u8; 32] = [7u8; 32];

fn dir(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name)
}

fn issue(name: &str, p: &TestPlatform) -> (SignedCard, String, Stored) {
    let signed = pipeline::issue(
        &FixtureSource { dir: dir(name) },
        p,
        &IssueParams {
            address: ADDRESS,
            window_days: 30,
            issuer: "trader.testnet",
            nonce: 7,
            issued_at: 1_793_980_000,
            outlayer_request_id: Some("10283".into()),
            mode: "fixture",
        },
    )
    .unwrap();
    let hash = hex::encode(card::card_hash(&signed.card).unwrap());
    let stored = serde_json::from_slice(&p.load(&format!("card:{hash}")).unwrap().unwrap()).unwrap();
    (signed, hash, stored)
}

fn open(sealed: &[u8]) -> Revealed {
    serde_json::from_slice(&ecies::open(&FOLLOWER_SECRET, sealed).unwrap()).unwrap()
}

fn follower_pub() -> String {
    hex::encode(ecies::public_key(&FOLLOWER_SECRET))
}

/// T7.1: an order whose last fill is exactly `delay` old is shown; anything newer never is,
/// and nothing after the first too-new order is shown either.
#[test]
fn delay_boundary() {
    // Last-fill times (ms), oldest order first; order 3 ended before order 2.
    let last = [1_000_000u64, 2_000_000, 3_000_000, 2_500_000, 9_000_000];
    let delay = 1_000; // seconds = 1,000,000 ms
    assert_eq!(reveal::shown(&last, delay, 4_000_000), 4, "order 2 ends exactly at now − delay: shown");
    assert_eq!(reveal::shown(&last, delay, 3_999_999), 2, "order 2 is 1 ms too new: hidden, and order 3 after it too");
    assert_eq!(reveal::shown(&last, 0, 9_000_000), 5, "delay 0 (live): everything up to now, inclusive");
    assert_eq!(reveal::shown(&last, 0, 8_999_999), 4);
    assert_eq!(reveal::shown(&last, delay, 0), 0);
    assert_eq!(reveal::shown(&last, u64::MAX, 10_000_000), 0, "a huge delay saturates instead of wrapping");

    // Through the whole reveal: never a record whose last fill is newer than now − delay.
    let p = TestPlatform::default();
    let (_, hash, stored) = issue("winner", &p);
    let n = stored.records.len();
    let mid = stored.last_fill_ms[n / 2];
    for (delay, now_ms) in [(0, mid), (3_600, mid + 3_600_000), (86_400, mid + 86_400_000 - 1)] {
        let now = now_ms / 1000;
        let sealed = reveal::seal_for(&p, &hash, FOLLOWER, &follower_pub(), delay, now).unwrap();
        let r = open(&sealed.ciphertext);
        let k = r.records.len();
        assert!(k < n, "a partial reveal");
        for t in &stored.last_fill_ms[..k] {
            assert!(t + delay * 1000 <= now * 1000);
        }
        assert!(stored.last_fill_ms[k] + delay * 1000 > now * 1000, "the first hidden order is too new");
        assert_eq!(reveal::check(&r).unwrap(), k);
    }
}

/// T7.2: revealed records carry no hash, tid, oid, exact size or price, or exact time,
/// and the plaintext contains none of the account's identifiers.
#[test]
fn coarsening() {
    let p = TestPlatform::default();
    let (signed, hash, stored) = issue("winner", &p);
    let sealed = reveal::seal_for(&p, &hash, FOLLOWER, &follower_pub(), 0, signed.card.issued_at).unwrap();
    let plain = String::from_utf8(ecies::open(&FOLLOWER_SECRET, &sealed.ciphertext).unwrap()).unwrap();
    let v: Value = serde_json::from_str(&plain).unwrap();

    let allowed = ["coin", "dir", "fills", "hour", "pnl_bps", "size_bps"];
    for r in v["records"].as_array().unwrap() {
        let mut keys: Vec<&str> = r.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        keys.sort();
        assert_eq!(keys, allowed);
    }
    let top: Vec<&str> = v.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    for k in ["address", "last_fill_ms", "last_salt", "hash", "tid", "oid", "px", "sz", "time"] {
        assert!(!top.contains(&k), "{k}");
    }

    let fills: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(dir("winner").join("fills.json")).unwrap()).unwrap();
    let lower = plain.to_lowercase();
    assert!(!lower.contains(ADDRESS) && !lower.contains(&ADDRESS[2..]), "address");
    for f in &fills {
        assert!(!lower.contains(&f["hash"].as_str().unwrap().to_lowercase()), "tx hash");
        // Trade and order ids are 9+ digit numbers; none may appear anywhere.
        for id in ["tid", "oid"] {
            let s = f[id].to_string();
            assert!(!plain.contains(&s), "{id} {s}");
        }
        // Exact millisecond times don't appear either.
        assert!(!plain.contains(&f["time"].to_string()), "time");
    }
    assert_eq!(stored.address, ADDRESS, "the address stays in encrypted storage");
}

/// T7.3: with the whole window past the delay, every committed order is shown and the
/// shown set rebuilds the card's root; any edit, drop or reorder breaks it.
#[test]
fn proofs_match_card() {
    for name in ["winner", "loser", "late_funded", "hlp_vault"] {
        let p = TestPlatform::default();
        let signed = match pipeline::issue(
            &FixtureSource { dir: dir(name) },
            &p,
            &IssueParams { address: ADDRESS, window_days: 30, issuer: "t.testnet", nonce: 1, issued_at: 1_793_980_000, outlayer_request_id: None, mode: "fixture" },
        ) {
            Ok(s) => s,
            Err(e) => {
                // Fixtures the rules refuse have no card and nothing to reveal.
                assert_ne!(e.code, Code::Upstream, "{name}: {e}");
                continue;
            }
        };
        let hash = hex::encode(card::card_hash(&signed.card).unwrap());
        let sealed = reveal::seal_for(&p, &hash, FOLLOWER, &follower_pub(), 0, signed.card.issued_at).unwrap();
        let r = open(&sealed.ciphertext);
        assert_eq!(r.orders_root, signed.card.orders.root, "{name}");
        assert_eq!(r.total, signed.card.orders.count, "{name}");
        assert_eq!(reveal::check(&r).unwrap(), signed.card.orders.count as usize, "{name}: N/N verified");
        assert!(r.proof.is_empty(), "nothing hidden, nothing to prove");
        assert_eq!((r.card_hash.as_str(), r.follower.as_str()), (hash.as_str(), FOLLOWER));

        let mut edited = r.clone();
        edited.records[0].pnl_bps += 1;
        assert!(reveal::check(&edited).is_err(), "{name}: an edited record");
        let mut dropped = r.clone();
        dropped.records.remove(1);
        assert!(reveal::check(&dropped).is_err(), "{name}: a cherry-picked set");
        let mut swapped = r.clone();
        swapped.records.swap(0, 1);
        assert!(reveal::check(&swapped).is_err() || swapped.records[0] == swapped.records[1], "{name}: reordered");
        let mut short = r.clone();
        short.total += 1;
        assert!(reveal::check(&short).is_err(), "{name}: a count that hides an order");
    }
}

#[test]
fn unknown_or_old_cards_are_refused() {
    let p = TestPlatform::default();
    let e = reveal::seal_for(&p, &"ab".repeat(32), FOLLOWER, &follower_pub(), 0, 0).err().unwrap();
    assert_eq!(e.code, Code::CardNotFound);
    // A card stored by the P2–P6 enclave (store v1) has no records to reveal.
    p.store(&format!("card:{}", "cd".repeat(32)), br#"{"v":1,"venue":"hyperliquid","address":"0x0","window":{"start":0,"end":1},"orders_root":"00"}"#).unwrap();
    assert_eq!(reveal::seal_for(&p, &"cd".repeat(32), FOLLOWER, &follower_pub(), 0, 0).err().unwrap().code, Code::CardNotFound);
    assert_eq!(reveal::seal_for(&p, "nothex", FOLLOWER, &follower_pub(), 0, 0).err().unwrap().code, Code::BadInput);
}

#[test]
fn stored_data_that_doesnt_match_the_root_is_refused() {
    let p = TestPlatform::default();
    let (_, hash, mut stored) = issue("winner", &p);
    stored.records[3].size_bps += 1;
    p.store(&format!("card:{hash}"), &serde_json::to_vec(&stored).unwrap()).unwrap();
    assert_eq!(reveal::seal_for(&p, &hash, FOLLOWER, &follower_pub(), 0, u64::MAX / 2000).err().unwrap().code, Code::Upstream);
}

#[test]
fn only_the_follower_can_read_it() {
    let p = TestPlatform::default();
    let (signed, hash, _) = issue("winner", &p);
    let sealed = reveal::seal_for(&p, &hash, FOLLOWER, &follower_pub(), 0, signed.card.issued_at).unwrap();
    assert!(ecies::open(&[8u8; 32], &sealed.ciphertext).is_err());
    let mut flipped = sealed.ciphertext.clone();
    *flipped.last_mut().unwrap() ^= 1;
    assert!(ecies::open(&FOLLOWER_SECRET, &flipped).is_err());
    // Two reveals of the same data never share an ephemeral key or nonce.
    let again = reveal::seal_for(&p, &hash, FOLLOWER, &follower_pub(), 0, signed.card.issued_at).unwrap();
    assert_ne!(sealed.ciphertext[1..45], again.ciphertext[1..45]);
}

proptest! {
    /// The prefix proof rebuilds the root for every tree size and every prefix, and has at
    /// most ⌈log2 n⌉ hashes.
    #[test]
    fn prefix_proofs(n in 1usize..300, k_frac in 0.0f64..1.0) {
        let k = 1 + ((n - 1) as f64 * k_frac) as usize;
        let leaves: Vec<merkle::Hash> = (0..n).map(|i| merkle::leaf_hash(&(i as u64).to_le_bytes())).collect();
        let proof = merkle::prefix_proof(&leaves, k);
        prop_assert!(proof.len() <= (usize::BITS - (n - 1).leading_zeros()) as usize);
        prop_assert_eq!(merkle::prefix_root(&leaves[..k], n, &proof), Some(merkle::root(&leaves)));
        if k < n {
            prop_assert_ne!(merkle::prefix_root(&leaves[..k - 1].iter().chain(&leaves[k..k + 1]).copied().collect::<Vec<_>>(), n, &proof), Some(merkle::root(&leaves)));
        }
    }
}

/// T7.4: test-vectors/ecies-follower.json, a Rust-sealed reveal the TypeScript client must
/// open and check. `REGEN_VECTORS=1 cargo test --test reveal` rewrites it.
#[test]
fn follower_vector() {
    let p = TestPlatform::default();
    let (signed, hash, stored) = issue("winner", &p);
    let now = stored.last_fill_ms[stored.records.len() - 10] / 1000 + 3_600;
    let sealed = reveal::seal_for(&p, &hash, FOLLOWER, &follower_pub(), 3_600, now).unwrap();
    let r = open(&sealed.ciphertext);
    use base64::Engine;
    let vector = serde_json::json!({
        "about": "A reveal sealed by the enclave (src/reveal.rs, src/ecies.rs) with the PUBLIC test platform. The TypeScript client must open it with follower_secret and rebuild orders_root from it.",
        "follower_secret": hex::encode(FOLLOWER_SECRET),
        "follower_pub": follower_pub(),
        "card_hash": hash,
        "orders_root": signed.card.orders.root,
        "orders_count": signed.card.orders.count,
        "ciphertext": base64::engine::general_purpose::STANDARD.encode(&sealed.ciphertext),
        "shown": r.records.len(),
        "plaintext": proveit_enclave::canonical::to_canonical(&r).unwrap(),
    });
    assert!(r.records.len() < signed.card.orders.count as usize && !r.proof.is_empty(), "the vector covers a partial reveal");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-vectors/ecies-follower.json");
    let text = serde_json::to_string_pretty(&vector).unwrap() + "\n";
    if std::env::var("REGEN_VECTORS").is_ok() {
        std::fs::write(&path, &text).unwrap();
    }
    assert_eq!(std::fs::read_to_string(&path).unwrap(), text, "run with REGEN_VECTORS=1 to rewrite");
}
