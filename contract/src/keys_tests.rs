//! T7.5 and T7.8: viewing-key payments and offer terms, through the real entry points.
//! The token contract is simulated: `ft_on_transfer` is called as it, and payouts are
//! checked as the `ft_transfer` receipts the registry creates.

use super::*;
use crate::keys::Grant;
use near_sdk::json_types::U128;
use near_sdk::PromiseOrValue;

const USDC: &str = "usdc.testnet";
const BUYER: &str = "buyer.testnet";
const BUYER2: &str = "buyer2.testnet";
const BUYER3: &str = "buyer3.testnet";
const PRICE: u128 = 1_000_000; // $1
const DAY: u64 = 86_400;
const PUB: &str = "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a";

/// A registry with card #0 (live, by TRADER) and USDC payments at a 1% fee.
fn market() -> Registry {
    let mut r = registry(false);
    assert_eq!(code(&issue(&mut r, TRADER, 30, ok(&card(TRADER, "live", 1, 30)))), "ISSUED");
    ctx(OWNER, NearToken::from_near(0), vec![], now());
    r.set_payments(USDC.parse().unwrap(), 100);
    r
}

fn now() -> u64 {
    issued_at() + 3_600
}

fn offer(r: &mut Registry, delay: u64, seats: u32, approval: bool) {
    ctx(TRADER, NearToken::from_near(0), vec![], now());
    r.set_offer(0, U128(PRICE), delay, 30 * DAY, seats, approval, None);
}

/// `ft_transfer_call` from `buyer`: returns what the token contract would refund.
fn pay(r: &mut Registry, buyer: &str, amount: u128, msg: &str, at: u64) -> u128 {
    ctx(USDC, NearToken::from_near(0), vec![], at);
    match r.ft_on_transfer(buyer.parse().unwrap(), U128(amount), msg.into()) {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("expected a value"),
    }
}

fn buy(r: &mut Registry, buyer: &str, at: u64) -> u128 {
    pay(r, buyer, PRICE, r#"{"card_id":0}"#, at)
}

fn balance(r: &Registry, who: &str) -> u128 {
    r.get_balance(who.parse().unwrap()).0
}

/// `ft_transfer`s the registry sent: (receiver_id, amount).
fn token_transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .into_iter()
        .filter(|r| r.receiver_id.as_str() == USDC)
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } if method_name == b"ft_transfer" => {
                assert_eq!(attached_deposit, NearToken::from_yoctonear(1), "ft_transfer needs exactly 1 yocto");
                let v: Value = serde_json::from_slice(&args).unwrap();
                Some((v["receiver_id"].as_str().unwrap().to_string(), v["amount"].as_str().unwrap().parse().unwrap()))
            }
            _ => None,
        })
        .collect()
}

fn grant(r: &Registry, who: &str) -> Option<Grant> {
    r.get_grant(0, who.parse().unwrap())
}

// ---- T7.5: payments -------------------------------------------------------------------

#[test]
#[should_panic(expected = "only the payment token")]
fn t7_5_wrong_token_is_refused() {
    // Panicking here makes the token's ft_resolve_transfer return the whole amount.
    let mut r = market();
    offer(&mut r, 0, 10, false);
    ctx("fake-usdc.testnet", NearToken::from_near(0), vec![], now());
    let _ = r.ft_on_transfer(BUYER.parse().unwrap(), U128(PRICE), r#"{"card_id":0}"#.into());
}

#[test]
fn t7_5_underpayment_and_bad_messages_are_refunded_in_full() {
    let mut r = market();
    offer(&mut r, 0, 10, false);
    assert_eq!(pay(&mut r, BUYER, PRICE - 1, r#"{"card_id":0}"#, now()), PRICE - 1);
    assert_eq!(pay(&mut r, BUYER, PRICE, "not json", now()), PRICE);
    assert_eq!(pay(&mut r, BUYER, PRICE, r#"{"card_id":9}"#, now()), PRICE, "no such offer");
    assert!(grant(&r, BUYER).is_none());
    assert_eq!(balance(&r, TRADER), 0);
}

#[test]
fn t7_5_exact_payment_grants_and_pays_the_issuer_net_of_the_fee() {
    let mut r = market();
    offer(&mut r, 3_600, 10, false);
    assert_eq!(buy(&mut r, BUYER, now()), 0);
    let g = grant(&r, BUYER).unwrap();
    assert_eq!((g.expires_at, g.delay_secs, g.paid.0), (now() + 30 * DAY, 3_600, PRICE));
    assert_eq!(balance(&r, TRADER), PRICE - PRICE / 100);
    assert_eq!(balance(&r, OWNER), PRICE / 100);
    // Overpaying keeps only the price.
    assert_eq!(pay(&mut r, BUYER2, PRICE + 500, r#"{"card_id":0}"#, now()), 500);
    // Buying for someone else.
    assert_eq!(pay(&mut r, BUYER, PRICE, &format!(r#"{{"card_id":0,"buyer":"{BUYER3}"}}"#), now()), 0);
    assert!(grant(&r, BUYER3).is_some());
}

#[test]
#[should_panic(expected = "no live viewing key")]
fn t7_5_reveal_without_a_grant_panics() {
    let mut r = market();
    offer(&mut r, 0, 10, false);
    ctx(BUYER, NearToken::from_millinear(50), vec![], now());
    let _ = r.request_reveal(0, PUB.into());
}

#[test]
fn t7_5_withdraw_pays_out_and_a_failed_payout_is_owed_again() {
    let mut r = market();
    offer(&mut r, 0, 10, false);
    buy(&mut r, BUYER, now());
    ctx(TRADER, NearToken::from_near(0), vec![], now());
    assert_eq!(r.withdraw().0, PRICE - PRICE / 100);
    assert_eq!(token_transfers(), vec![(TRADER.to_string(), PRICE - PRICE / 100)]);
    assert_eq!(balance(&r, TRADER), 0);

    // The transfer failed (say, TRADER isn't registered with USDC): the money is owed again.
    ctx(REGISTRY, NearToken::from_near(0), vec![PromiseResult::Failed], now());
    r.on_payout(TRADER.parse().unwrap(), U128(PRICE - PRICE / 100));
    assert_eq!(balance(&r, TRADER), PRICE - PRICE / 100);
}

#[test]
#[should_panic(expected = "nothing to withdraw")]
fn t7_5_withdrawing_nothing_panics() {
    let mut r = market();
    ctx(BUYER, NearToken::from_near(0), vec![], now());
    r.withdraw();
}

#[test]
fn a_key_holder_reveals_and_the_ciphertext_is_returned_not_stored() {
    let mut r = market();
    offer(&mut r, 3_600, 10, false);
    buy(&mut r, BUYER, now());
    ctx(BUYER, NearToken::from_millinear(50), vec![], now());
    let seq = r.get_config().requests;
    let _ = r.request_reveal(0, PUB.to_uppercase());
    // The enclave is asked for this card, this follower, and the delay the key was sold with.
    let input: Value = get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .find_map(|a| match a {
            MockAction::FunctionCallWeight { method_name, args, .. } if method_name == b"request_execution" => {
                let v: Value = serde_json::from_slice(&args).unwrap();
                Some(serde_json::from_str(v["input_data"].as_str().unwrap()).unwrap())
            }
            _ => None,
        })
        .unwrap();
    let card_hash = r.get_card(0).unwrap().card_hash;
    assert_eq!(
        input,
        json!({ "op": "reveal", "card_hash": card_hash, "follower": BUYER, "follower_x25519_pub": PUB, "delay_secs": 3_600 })
    );

    let out = json!({ "status": "ok", "ciphertext": "AQID", "shown": 40, "total": 42 }).to_string().into_bytes();
    ctx(REGISTRY, NearToken::from_near(0), vec![PromiseResult::Successful(out)], now() + 30);
    let returned = r.on_result(seq);
    let RequestOutcome::Revealed { shown, total, ciphertext, ciphertext_sha256, .. } = returned else { panic!("{returned:?}") };
    assert_eq!((shown, total, ciphertext.as_deref()), (40, 42, Some("AQID")));
    assert_eq!(ciphertext_sha256, hex::encode(Sha256::digest(b"AQID")));
    let RequestOutcome::Revealed { ciphertext: kept, .. } = r.get_request(seq).unwrap() else { panic!() };
    assert_eq!(kept, None, "never kept in state");
}

#[test]
fn an_enclave_refusal_of_a_reveal_is_recorded() {
    let mut r = market();
    offer(&mut r, 0, 10, false);
    buy(&mut r, BUYER, now());
    ctx(BUYER, NearToken::from_millinear(50), vec![], now());
    let seq = r.get_config().requests;
    let _ = r.request_reveal(0, PUB.into());
    let out = json!({ "status": "err", "code": "CARD_NOT_FOUND", "message": "no reveal data" }).to_string().into_bytes();
    ctx(REGISTRY, NearToken::from_near(0), vec![PromiseResult::Successful(out)], now());
    assert_eq!(code(&r.on_result(seq)), "CARD_NOT_FOUND");
}

// ---- T7.8: offer terms ----------------------------------------------------------------

#[test]
fn t7_8_the_seat_after_max_seats_is_refunded_until_one_frees_up() {
    let mut r = market();
    offer(&mut r, 0, 2, false);
    assert_eq!(buy(&mut r, BUYER, now()), 0);
    assert_eq!(buy(&mut r, BUYER2, now()), 0);
    assert_eq!(r.get_offer(0).unwrap().seats_left, 0);
    assert_eq!(buy(&mut r, BUYER3, now()), PRICE, "sold out");
    assert!(grant(&r, BUYER3).is_none());
    // A holder renewing doesn't need a free seat.
    assert_eq!(buy(&mut r, BUYER, now() + DAY), 0);
    assert_eq!(grant(&r, BUYER).unwrap().expires_at, now() + 60 * DAY);
    // BUYER2's key expires: the seat is free again.
    let later = now() + 30 * DAY;
    assert_eq!(buy(&mut r, BUYER3, later), 0);
}

#[test]
fn t7_8_an_expired_key_stops_working() {
    let mut r = market();
    offer(&mut r, 0, 10, false);
    buy(&mut r, BUYER, now());
    let expiry = grant(&r, BUYER).unwrap().expires_at;
    ctx(BUYER, NearToken::from_near(0), vec![], expiry - 1);
    assert!(r.has_grant(0, BUYER.parse().unwrap()));
    ctx(BUYER, NearToken::from_near(0), vec![], expiry);
    assert!(r.get_grant(0, BUYER.parse().unwrap()).is_none(), "expires at expires_at exactly");
    assert!(r.get_grants(0).is_empty());
    ctx(BUYER, NearToken::from_millinear(50), vec![], expiry);
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = r.request_reveal(0, PUB.into());
    }));
    assert!(refused.is_err(), "no reveal on an expired key");
}

#[test]
fn t7_8_approval_escrows_then_approve_grants_and_pays() {
    let mut r = market();
    offer(&mut r, 0, 10, true);
    assert_eq!(buy(&mut r, BUYER, now()), 0);
    assert!(grant(&r, BUYER).is_none(), "held, not granted");
    assert_eq!(balance(&r, TRADER), 0, "the issuer isn't paid yet");
    assert_eq!(r.get_waiting(0).len(), 1);
    assert_eq!(r.get_offer(0).unwrap().seats_used, 1, "a waiting buyer holds a seat");
    assert_eq!(buy(&mut r, BUYER, now()), PRICE, "can't pay twice while waiting");

    ctx(TRADER, NearToken::from_near(0), vec![], now() + 60);
    let g = r.approve_buyer(0, BUYER.parse().unwrap());
    assert_eq!(g.expires_at, now() + 60 + 30 * DAY, "the key runs from approval");
    assert_eq!(balance(&r, TRADER), PRICE - PRICE / 100);
    assert!(r.get_waiting(0).is_empty());
}

#[test]
fn t7_8_reject_refunds_in_full() {
    let mut r = market();
    offer(&mut r, 0, 10, true);
    buy(&mut r, BUYER, now());
    ctx(TRADER, NearToken::from_near(0), vec![], now());
    r.reject_buyer(0, BUYER.parse().unwrap());
    assert_eq!(token_transfers(), vec![(BUYER.to_string(), PRICE)]);
    assert!(grant(&r, BUYER).is_none() && r.get_waiting(0).is_empty());
    assert_eq!((balance(&r, TRADER), balance(&r, OWNER)), (0, 0));
}

#[test]
fn t7_8_revoke_refunds_the_unused_share() {
    let mut r = market();
    offer(&mut r, 0, 10, false);
    buy(&mut r, BUYER, now());
    // A quarter of the way through: three quarters back.
    ctx(TRADER, NearToken::from_near(0), vec![], now() + 30 * DAY / 4);
    let refund = r.revoke_grant(0, BUYER.parse().unwrap()).0;
    assert_eq!(refund, PRICE * 3 / 4);
    assert_eq!(token_transfers(), vec![(BUYER.to_string(), refund)]);
    assert!(grant(&r, BUYER).is_none());
    // Taken from the issuer and the fee in the same split as the sale.
    assert_eq!(balance(&r, TRADER), (PRICE - PRICE / 100) - (refund - refund / 100));
    assert_eq!(balance(&r, OWNER), PRICE / 100 - refund / 100);
}

#[test]
fn offer_terms_are_the_issuers_and_keys_keep_their_terms() {
    let mut r = market();
    ctx(BUYER, NearToken::from_near(0), vec![], now());
    let not_issuer = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        r.set_offer(0, U128(PRICE), 0, DAY, 1, false, None);
    }));
    assert!(not_issuer.is_err());
    offer(&mut r, 7 * DAY, 10, false);
    buy(&mut r, BUYER, now());
    offer(&mut r, 0, 10, false);
    assert_eq!(grant(&r, BUYER).unwrap().delay_secs, 7 * DAY, "a later offer change doesn't change a sold key");
    assert_eq!(r.get_offer(0).unwrap().offer.delay_secs, 0);

    ctx(TRADER, NearToken::from_near(0), vec![], now());
    r.remove_offer(0);
    assert_eq!(buy(&mut r, BUYER2, now()), PRICE, "no offer, no sale");
    assert!(grant(&r, BUYER).is_some(), "sold keys outlive the offer");
}

#[test]
fn revoked_cards_stop_selling() {
    let mut r = market();
    offer(&mut r, 0, 10, false);
    ctx(TRADER, NearToken::from_near(0), vec![], now());
    r.revoke(0);
    assert_eq!(buy(&mut r, BUYER, now()), PRICE);
}

#[test]
fn migrate_keeps_cards_versions_and_the_key() {
    let r = market();
    let card = r.get_card(0).unwrap();
    // Write the P3–P6 layout, then upgrade it.
    let old = RegistryV1 {
        owner: r.owner.clone(),
        outlayer: r.outlayer.clone(),
        project_id: r.project_id.clone(),
        active_version: r.active_version.clone(),
        versions: r.versions,
        card_pubkey: r.card_pubkey,
        accept_fixture_cards: r.accept_fixture_cards,
        stale_after_secs: r.stale_after_secs,
        next_card_id: r.next_card_id,
        next_request: r.next_request,
        cards: r.cards,
        card_by_hash: r.card_by_hash,
        by_issuer: r.by_issuer,
        by_commitment: r.by_commitment,
        used_nonces: r.used_nonces,
        pending: r.pending,
        requests: r.requests,
    };
    env::state_write(&old);
    drop(old); // the collections write their cached entries to storage when dropped
    ctx(REGISTRY, NearToken::from_near(0), vec![], now());
    let m = Registry::migrate();
    assert_eq!(m.get_card(0).unwrap().card_hash, card.card_hash);
    assert_eq!(m.verify_card(0, Some(card.card_json)).status, "VALID");
    assert_eq!(m.get_config().card_pubkey, Some(hex::encode(key().verifying_key().to_bytes())));
    assert_eq!((m.get_config().usdc, m.get_config().fee_bps), (None, 100));
}
