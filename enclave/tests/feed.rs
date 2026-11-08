//! T8.7 (feed_chain) and T8.8 (feed_auth): the copy-trading feed and who may read it.

use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use proveit_enclave::card;
use proveit_enclave::ecies;
use proveit_enclave::error::Result;
use proveit_enclave::feed::{self, FeedPage};
use proveit_enclave::hl::FixtureSource;
use proveit_enclave::near::Near;
use proveit_enclave::nep413::{self, SignedMessage};
use proveit_enclave::pipeline::{self, IssueParams};
use proveit_enclave::platform::test::TestPlatform;
use proveit_enclave::platform::Platform;
use proveit_enclave::reveal::Stored;
use proveit_enclave::Code;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;

const REGISTRY: &str = "proveit-registry.testnet";
const FOLLOWER: &str = "follower.testnet";
const X_SECRET: [u8; 32] = [7u8; 32];
const CARD_ID: u64 = 4;

fn source() -> FixtureSource {
    FixtureSource { dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join("winner") }
}

/// A platform that counts reads, so a test can show a refusal came before any data.
#[derive(Default)]
struct Counting {
    inner: TestPlatform,
    reads: Cell<u32>,
}

impl Platform for Counting {
    fn card_public_key(&self) -> Result<[u8; 32]> {
        self.inner.card_public_key()
    }
    fn sign_card(&self, m: &[u8]) -> Result<[u8; 64]> {
        self.inner.sign_card(m)
    }
    fn commit_mac(&self, d: &[u8]) -> Result<Vec<u8>> {
        self.inner.commit_mac(d)
    }
    fn store(&self, k: &str, v: &[u8]) -> Result<()> {
        self.inner.store(k, v)
    }
    fn load(&self, k: &str) -> Result<Option<Vec<u8>>> {
        self.reads.set(self.reads.get() + 1);
        self.inner.load(k)
    }
    fn random_32(&self) -> Result<[u8; 32]> {
        self.inner.random_32()
    }
    fn cell_get(&self, k: &str) -> Result<Option<Vec<u8>>> {
        self.reads.set(self.reads.get() + 1);
        self.inner.cell_get(k)
    }
    fn cell_swap(&self, k: &str, e: Option<&[u8]>, n: &[u8]) -> Result<bool> {
        self.inner.cell_swap(k, e, n)
    }
}

/// The chain as the enclave would see it over RPC.
#[derive(Default)]
struct MockNear {
    /// (account, public key) → full access?
    keys: HashMap<(String, String), bool>,
    cards: HashMap<u64, String>,
    /// (card, buyer) → (expires_at, delay_secs)
    grants: HashMap<(u64, String), (u64, u64)>,
    calls: RefCell<Vec<String>>,
}

impl Near for MockNear {
    fn view(&self, _contract: &str, method: &str, args: &Value) -> Result<Value> {
        self.calls.borrow_mut().push(method.into());
        let id = args["card_id"].as_u64().unwrap();
        Ok(match method {
            "get_card" => self.cards.get(&id).map(|h| json!({ "card_hash": h })).unwrap_or(Value::Null),
            "get_grant" => self
                .grants
                .get(&(id, args["buyer"].as_str().unwrap().to_string()))
                .map(|(e, d)| json!({ "expires_at": e, "delay_secs": d }))
                .unwrap_or(Value::Null),
            _ => panic!("unexpected view {method}"),
        })
    }
    fn access_key(&self, account: &str, pk: &str) -> Result<Option<bool>> {
        self.calls.borrow_mut().push("access_key".into());
        Ok(self.keys.get(&(account.to_string(), pk.to_string())).copied())
    }
}

fn wallet_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn pk_string(k: &SigningKey) -> String {
    format!("ed25519:{}", bs58::encode(k.verifying_key().to_bytes()).into_string())
}

/// What a wallet returns from signMessage for the follower message.
fn signed(k: &SigningKey, account: &str, card_hash: &str, expires_at: u64) -> SignedMessage {
    let message = nep413::follower_message(card_hash, &hex::encode(ecies::public_key(&X_SECRET)), expires_at);
    let nonce = [9u8; 32];
    let sig = k.sign(&nep413::signed_hash(&message, &nonce, nep413::RECIPIENT, None));
    let b64 = base64::engine::general_purpose::STANDARD;
    SignedMessage {
        account_id: account.into(),
        public_key: pk_string(k),
        signature: b64.encode(sig.to_bytes()),
        message,
        nonce: b64.encode(nonce),
        recipient: nep413::RECIPIENT.into(),
        callback_url: None,
    }
}

struct World {
    p: Counting,
    near: MockNear,
    card_hash: String,
    /// When the card's window "ended": the fixture's fills after it play new trades.
    cut_ms: u64,
    last_ms: u64,
}

fn world(delay: u64) -> World {
    let p = Counting::default();
    let signed_card = pipeline::issue(
        &source(),
        &p.inner,
        &IssueParams { address: "0xe986b8e58b5870dca58700c23b5303f20f6823a7", window_days: 30, issuer: "t.testnet", nonce: 1, issued_at: 1_793_980_000, outlayer_request_id: None, mode: "fixture" },
    )
    .unwrap();
    let card_hash = hex::encode(card::card_hash(&signed_card.card).unwrap());
    let key = format!("card:{card_hash}");
    let mut stored: Stored = serde_json::from_slice(&p.inner.load(&key).unwrap().unwrap()).unwrap();
    let n = stored.last_fill_ms.len();
    let cut_ms = stored.last_fill_ms[n / 2];
    let last_ms = *stored.last_fill_ms.last().unwrap();
    stored.window.end = cut_ms;
    p.inner.store(&key, &serde_json::to_vec(&stored).unwrap()).unwrap();

    let mut near = MockNear::default();
    near.keys.insert((FOLLOWER.into(), pk_string(&wallet_key(1))), true);
    near.keys.insert((FOLLOWER.into(), pk_string(&wallet_key(2))), false); // a function-call key
    near.cards.insert(CARD_ID, card_hash.clone());
    near.grants.insert((CARD_ID, FOLLOWER.into()), (u64::MAX / 2, delay));
    World { p, near, card_hash, cut_ms, last_ms }
}

fn poll(w: &World, since: u64, now_ms: u64) -> Result<FeedPage> {
    let now = now_ms / 1000;
    let auth = signed(&wallet_key(1), FOLLOWER, &w.card_hash, now + 3_600);
    let sealed = feed::feed_for(&w.p, &source(), &w.near, REGISTRY, CARD_ID, since, &auth, now)?;
    Ok(serde_json::from_slice(&ecies::open(&X_SECRET, &sealed.ciphertext).unwrap()).unwrap())
}

/// T8.7: three polls extend one chain; each page continues from the head the follower kept.
#[test]
fn feed_chain() {
    let w = world(0);
    let span = w.last_ms - w.cut_ms;
    let times = [w.cut_ms + span / 3 + feed::SETTLE_MS, w.cut_ms + 2 * span / 3 + feed::SETTLE_MS, w.last_ms + feed::SETTLE_MS];
    let (mut cursor, mut head, mut total) = (0, None::<String>, 0);
    let mut pages = vec![];
    for t in times {
        let p = poll(&w, cursor, t).unwrap();
        feed::check(&p, head.as_deref()).unwrap();
        assert!(!p.entries.is_empty(), "every poll brings new trades");
        // Nothing newer than the settle time, nothing from before the card's window.
        assert_eq!(p.held_back, 0);
        total += p.entries.len();
        cursor = p.next;
        head = Some(p.head.clone());
        pages.push(p);
    }
    // Everything after the cut, once, in order: the same records the card would commit to.
    let all: Vec<_> = pages.iter().flat_map(|p| p.entries.iter().map(|e| e.record.clone())).collect();
    assert_eq!(all.len(), total);
    let state: feed::FeedState = serde_json::from_slice(&w.p.cell_get(&format!("feed:{}", w.card_hash)).unwrap().unwrap()).unwrap();
    assert_eq!(state.entries.iter().map(|e| e.record.clone()).collect::<Vec<_>>(), all);
    assert_eq!(hex::encode(feed::heads(&w.card_hash, &state.entries).unwrap().last().unwrap()), head.clone().unwrap());

    // A second follower from cursor 0 gets the same chain and ends at the same head.
    let again = poll(&w, 0, w.last_ms + feed::SETTLE_MS).unwrap();
    feed::check(&again, None).unwrap();
    assert_eq!(again.head, head.unwrap());

    // Dropped, reordered or edited entries, or a rewritten start, all break the check.
    let p = &pages[1];
    assert!(p.entries.len() >= 2);
    let mut dropped = p.clone();
    dropped.entries.remove(0);
    assert!(feed::check(&dropped, Some(&pages[0].head)).is_err());
    let mut swapped = p.clone();
    swapped.entries.swap(0, 1);
    assert!(feed::check(&swapped, Some(&pages[0].head)).is_err());
    let mut edited = p.clone();
    edited.entries[0].record.size_bps += 1;
    assert!(feed::check(&edited, Some(&pages[0].head)).is_err());
    assert!(feed::check(p, Some(&"00".repeat(32))).is_err(), "doesn't continue from what the follower saw");
}

#[test]
fn the_delay_holds_back_recent_trades() {
    let w = world(86_400);
    let now = w.last_ms + feed::SETTLE_MS;
    let p = poll(&w, 0, now).unwrap();
    feed::check(&p, None).unwrap();
    assert!(p.held_back > 0, "trades less than a day old are in the chain but not shown");
    let state: feed::FeedState = serde_json::from_slice(&w.p.cell_get(&format!("feed:{}", w.card_hash)).unwrap().unwrap()).unwrap();
    for e in &p.entries {
        let stored = state.entries.iter().find(|s| s.record == e.record).unwrap();
        assert!(stored.last_fill_ms + 86_400_000 <= now);
    }
}

#[test]
fn a_concurrent_extension_is_not_lost() {
    let w = world(0);
    let now = w.last_ms + feed::SETTLE_MS;
    // Another run extended the chain between our read and our write.
    let first = poll(&w, 0, w.cut_ms + (w.last_ms - w.cut_ms) / 2 + feed::SETTLE_MS).unwrap();
    let later = poll(&w, first.next, now).unwrap();
    feed::check(&later, Some(&first.head)).unwrap();
}

/// T8.8: every bad request is refused before any stored data is read.
#[test]
fn feed_auth() {
    let now_ms = 1_794_200_000_000u64;
    let now = now_ms / 1000;
    type Case<'a> = (&'static str, Box<dyn Fn(&World) -> SignedMessage + 'a>, Code);
    let cases: Vec<Case<'_>> = vec![
        ("bad signature", Box::new(|w| {
            let mut m = signed(&wallet_key(1), FOLLOWER, &w.card_hash, now + 60);
            m.message.push('x');
            m
        }), Code::SigInvalid),
        ("expired message", Box::new(|w| signed(&wallet_key(1), FOLLOWER, &w.card_hash, now - 1)), Code::SigExpired),
        ("valid for more than a day", Box::new(|w| signed(&wallet_key(1), FOLLOWER, &w.card_hash, now + 2 * 86_400)), Code::SigExpired),
        ("another app's message", Box::new(|w| {
            let mut m = signed(&wallet_key(1), FOLLOWER, &w.card_hash, now + 60);
            m.recipient = "evil".into();
            m
        }), Code::SigInvalid),
        ("a key that isn't the account's", Box::new(|w| signed(&wallet_key(3), FOLLOWER, &w.card_hash, now + 60)), Code::NearAccountMismatch),
        ("a function-call key", Box::new(|w| signed(&wallet_key(2), FOLLOWER, &w.card_hash, now + 60)), Code::NearAccountMismatch),
        ("signed for another card", Box::new(|_| signed(&wallet_key(1), FOLLOWER, &"ab".repeat(32), now + 60)), Code::BadInput),
        ("another account, which holds no key", Box::new(|w| signed(&wallet_key(4), "other.testnet", &w.card_hash, now + 60)), Code::NoGrant),
    ];
    for (name, make, code) in cases {
        let mut w = world(0);
        w.near.keys.insert(("other.testnet".into(), pk_string(&wallet_key(4))), true);
        let auth = make(&w);
        let reads_before = w.p.reads.get();
        let e = feed::feed_for(&w.p, &source(), &w.near, REGISTRY, CARD_ID, 0, &auth, now).err().unwrap_or_else(|| panic!("{name}: accepted"));
        assert_eq!(e.code, code, "{name}: {e}");
        assert_eq!(w.p.reads.get(), reads_before, "{name}: read data before refusing");
    }

    // An expired grant.
    let mut w = world(0);
    w.near.grants.insert((CARD_ID, FOLLOWER.into()), (now, 0));
    let e = feed::feed_for(&w.p, &source(), &w.near, REGISTRY, CARD_ID, 0, &signed(&wallet_key(1), FOLLOWER, &w.card_hash, now + 60), now).err().unwrap();
    assert_eq!(e.code, Code::NoGrant);

    // And the HTTPS reveal goes through the same gate.
    let w = world(0);
    let e = proveit_enclave::reveal::seal_for_follower(&w.p, &w.near, REGISTRY, CARD_ID, &signed(&wallet_key(3), FOLLOWER, &w.card_hash, now + 60), now).err().unwrap();
    assert_eq!(e.code, Code::NearAccountMismatch);
    let ok = proveit_enclave::reveal::seal_for_follower(&w.p, &w.near, REGISTRY, CARD_ID, &signed(&wallet_key(1), FOLLOWER, &w.card_hash, now + 60), now).unwrap();
    assert!(ok.shown > 0);
}

/// The NEP-413 bytes match NEAR's own spec example layout: tag, then borsh fields.
#[test]
fn nep413_layout() {
    assert_eq!(nep413::TAG, 2_147_484_061);
    let h1 = nep413::signed_hash("hi", &[0u8; 32], "proveit", None);
    let h2 = nep413::signed_hash("hi", &[0u8; 32], "proveit", Some("https://x"));
    assert_ne!(h1, h2);
    let mut manual = 2_147_484_061u32.to_le_bytes().to_vec();
    manual.extend_from_slice(&2u32.to_le_bytes());
    manual.extend_from_slice(b"hi");
    manual.extend_from_slice(&[0u8; 32]);
    manual.extend_from_slice(&7u32.to_le_bytes());
    manual.extend_from_slice(b"proveit");
    manual.push(0);
    use sha2::Digest;
    assert_eq!(h1.to_vec(), sha2::Sha256::digest(&manual).to_vec());
}

/// test-vectors/feed.json: two consecutive feed pages and a NEP-413 signed message, for the
/// TypeScript client's checks. `REGEN_VECTORS=1 cargo test --test feed` rewrites it.
#[test]
fn feed_vector() {
    let w = world(0);
    let mid = w.cut_ms + (w.last_ms - w.cut_ms) / 2 + feed::SETTLE_MS;
    let a = poll(&w, 0, mid).unwrap();
    let b = poll(&w, a.next, w.last_ms + feed::SETTLE_MS).unwrap();
    let auth = signed(&wallet_key(1), FOLLOWER, &w.card_hash, 1_794_200_000);
    let vector = json!({
        "about": "Feed pages from enclave/src/feed.rs (test platform, winner fixture) and a NEP-413 message signed with a PUBLIC test key (seed 32×0x01).",
        "card_hash": w.card_hash,
        "pages": [a, b],
        "auth": auth,
        "auth_hash": hex::encode(nep413::signed_hash(&auth.message, &[9u8; 32], nep413::RECIPIENT, None)),
    });
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-vectors/feed.json");
    let text = serde_json::to_string_pretty(&vector).unwrap() + "\n";
    if std::env::var("REGEN_VECTORS").is_ok() {
        std::fs::write(&path, &text).unwrap();
    }
    assert_eq!(std::fs::read_to_string(&path).unwrap(), text, "run with REGEN_VECTORS=1 to rewrite");
}
