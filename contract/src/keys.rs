//! Viewing keys: a follower pays the trader in USDC for a time-limited key to the card's
//! trades, on the trader's terms.
//!
//! The trader's offer sets the price, the delay (0 = live, for copy trading), how long a
//! key lasts, how many keys may be live at once, and whether each buyer needs approval.
//! Payment is `ft_transfer_call` on the USDC contract with `msg = {"card_id": N}` (or
//! `{"card_id": N, "buyer": "<account>"}` to buy for someone else). Anything that can't
//! be honoured is refused by returning the amount, which the token contract sends back.
//!
//! Money owed (issuer earnings net of the fee, the fee, refunds that could not be sent)
//! is kept in `balances` and paid by `withdraw`. A key holder calls `request_reveal` to
//! get the trades: the registry asks the enclave, which encrypts them to the holder's
//! X25519 key, and the ciphertext comes back only in that call's return value.

// `set_offer` takes its terms as flat JSON arguments, which is the API wallets show.
#![allow(clippy::too_many_arguments)]

use crate::{event, now_secs, PendingKind, Registry, RegistryExt};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseOrValue};

const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
const PAYOUT_CALLBACK_GAS: Gas = Gas::from_tgas(10);
pub const MAX_SEATS: u32 = 1_000;
pub const MIN_DURATION_SECS: u64 = 60;
pub const MAX_FEE_BPS: u16 = 1_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Offer {
    /// In the token's smallest unit (USDC: 6 decimals, so 1_000_000 = $1).
    pub price: U128,
    /// Trades are shown once they are this old; 0 = live.
    pub delay_secs: u64,
    /// How long a key lasts from purchase (buying again extends it).
    pub duration_secs: u64,
    /// Keys live at once, counting buyers waiting for approval.
    pub max_seats: u32,
    pub requires_approval: bool,
    /// Who earns the sales (the issuer, or another account of theirs).
    pub payout: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Grant {
    pub buyer: AccountId,
    /// Total paid for this key, for pro-rata refunds.
    pub paid: U128,
    pub granted_at: u64,
    pub expires_at: u64,
    /// The offer's delay when the key was bought; later offer changes don't affect it.
    pub delay_secs: u64,
    pub payout: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Waiting {
    pub buyer: AccountId,
    pub paid: U128,
    pub asked_at: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct OfferView {
    pub card_id: u64,
    pub offer: Offer,
    pub seats_used: u32,
    pub seats_left: u32,
    pub waiting: u32,
    pub token: Option<AccountId>,
    pub fee_bps: u16,
}

#[near(serializers = [json])]
struct BuyMsg {
    card_id: u64,
    buyer: Option<AccountId>,
    /// From the issuer: this transfer funds the refund for revoking `buyer`'s key early.
    revoke: Option<bool>,
}

impl Registry {
    fn assert_issuer(&self, card_id: u64) {
        let card = self.cards.get(&card_id).unwrap_or_else(|| env::panic_str("unknown card"));
        require!(card.issuer == env::predecessor_account_id(), "only the card's issuer");
    }

    /// Keys currently live, plus buyers waiting for approval.
    fn seats_used(&self, card_id: u64, now: u64) -> u32 {
        let live = self.grants.get(&card_id).map(|g| g.iter().filter(|g| g.expires_at > now).count()).unwrap_or(0);
        let waiting = self.waiting.get(&card_id).map(|w| w.len()).unwrap_or(0);
        (live + waiting) as u32
    }

    fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount > 0 {
            *self.balances.entry(account.clone()).or_insert(0) += amount;
        }
    }

    fn debit(&mut self, account: &AccountId, amount: u128) {
        let balance = self.balances.get(account).copied().unwrap_or(0);
        require!(balance >= amount, format!("{account} has {balance} left, {amount} is needed for the refund"));
        if balance == amount {
            self.balances.remove(account);
        } else {
            self.balances.insert(account.clone(), balance - amount);
        }
    }

    fn fee_of(&self, amount: u128) -> u128 {
        amount * self.fee_bps as u128 / 10_000
    }

    /// Split a sale: the payout account is paid at once, the fee stays with the owner. If the
    /// transfer fails (say, the payout account isn't registered with USDC), on_payout owes it.
    fn pay_issuer(&mut self, payout: &AccountId, amount: u128) {
        let fee = self.fee_of(amount);
        let owner = self.owner.clone();
        self.credit(&owner, fee);
        self.pay_out(payout, amount - fee);
    }

    /// Write or extend `buyer`'s key. Expired grants are dropped here.
    fn grant(&mut self, card_id: u64, offer: &Offer, buyer: &AccountId, paid: u128, now: u64) -> Grant {
        let mut grants: Vec<Grant> = self.grants.get(&card_id).cloned().unwrap_or_default();
        grants.retain(|g| g.expires_at > now);
        let g = match grants.iter_mut().find(|g| &g.buyer == buyer) {
            Some(g) => {
                g.expires_at = g.expires_at.max(now) + offer.duration_secs;
                g.paid = U128(g.paid.0 + paid);
                g.clone()
            }
            None => {
                let g = Grant {
                    buyer: buyer.clone(),
                    paid: U128(paid),
                    granted_at: now,
                    expires_at: now + offer.duration_secs,
                    delay_secs: offer.delay_secs,
                    payout: offer.payout.clone(),
                };
                grants.push(g.clone());
                g
            }
        };
        self.grants.insert(card_id, grants);
        event(
            "viewing_key_granted",
            json!({ "card_id": card_id, "buyer": buyer, "expires_at": g.expires_at, "delay_secs": g.delay_secs, "paid": U128(paid) }),
        );
        g
    }

    /// Send `amount` of the token to `account`; if the transfer fails, it is owed instead.
    fn pay_out(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let token = self.usdc.clone().unwrap_or_else(|| env::panic_str("no payment token is set"));
        Promise::new(token)
            .function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&json!({ "receiver_id": account, "amount": U128(amount), "memo": "Prove-It" })).unwrap(),
                NearToken::from_yoctonear(1),
                FT_TRANSFER_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(PAYOUT_CALLBACK_GAS).on_payout(account.clone(), U128(amount)))
            .detach();
    }

    /// The issuer pays for an early revoke. A shortfall panics, and the token then returns the
    /// whole transfer; anything above the refund stays in the payout account's balance.
    fn fund_revoke(&mut self, sender: &AccountId, amount: U128, card_id: u64, buyer: &AccountId) -> PromiseOrValue<U128> {
        let Some(card) = self.cards.get(&card_id) else {
            return self.refuse_payment(sender, amount, "UNKNOWN_CARD", "no such card");
        };
        if &card.issuer != sender {
            return self.refuse_payment(sender, amount, "NOT_ISSUER", "only the card's issuer can revoke its keys");
        }
        let now = now_secs();
        let Some(g) = self.grants.get(&card_id).and_then(|v| v.iter().find(|g| &g.buyer == buyer && g.expires_at > now).cloned()) else {
            return self.refuse_payment(sender, amount, "NO_KEY", "no live key for this buyer");
        };
        self.credit(&g.payout, amount.0);
        self.revoke_inner(card_id, buyer);
        PromiseOrValue::Value(U128(0))
    }

    fn refuse_payment(&self, sender: &AccountId, amount: U128, code: &str, message: &str) -> PromiseOrValue<U128> {
        event("payment_refused", json!({ "sender": sender, "amount": amount, "code": code, "message": message }));
        PromiseOrValue::Value(amount)
    }
}

#[near]
impl Registry {
    // ---- owner ------------------------------------------------------------------------

    /// The token keys are paid in (USDC on NEAR) and the fee in bps (at most 10%).
    /// Register the registry with the token (`storage_deposit`) before selling keys.
    pub fn set_payments(&mut self, token: AccountId, fee_bps: u16) {
        self.assert_owner();
        require!(fee_bps <= MAX_FEE_BPS, "fee_bps is at most 1000 (10%)");
        self.usdc = Some(token);
        self.fee_bps = fee_bps;
    }

    // ---- issuer -----------------------------------------------------------------------

    /// Offer viewing keys for a card. Changing an offer never changes keys already sold.
    pub fn set_offer(
        &mut self,
        card_id: u64,
        price: U128,
        delay_secs: u64,
        duration_secs: u64,
        max_seats: u32,
        requires_approval: bool,
        payout: Option<AccountId>,
    ) -> OfferView {
        self.assert_issuer(card_id);
        let card = self.cards.get(&card_id).unwrap();
        require!(!card.revoked && card.superseded_by.is_none(), "the card is revoked or superseded");
        require!(price.0 > 0, "price must be above 0");
        require!(duration_secs >= MIN_DURATION_SECS, "duration_secs must be at least 60");
        require!((1..=MAX_SEATS).contains(&max_seats), "max_seats must be 1 to 1000");
        let offer = Offer { price, delay_secs, duration_secs, max_seats, requires_approval, payout: payout.unwrap_or_else(env::predecessor_account_id) };
        self.offers.insert(card_id, offer.clone());
        event("offer_set", json!({ "card_id": card_id, "offer": offer }));
        self.get_offer(card_id).unwrap()
    }

    /// Stop selling keys for a card. Keys already sold keep working until they expire.
    pub fn remove_offer(&mut self, card_id: u64) {
        self.assert_issuer(card_id);
        self.offers.remove(&card_id);
        event("offer_removed", json!({ "card_id": card_id }));
    }

    pub fn approve_buyer(&mut self, card_id: u64, buyer: AccountId) -> Grant {
        self.assert_issuer(card_id);
        let w = self.take_waiting(card_id, &buyer);
        let offer = self.offers.get(&card_id).cloned().unwrap_or_else(|| env::panic_str("the offer was removed; reject the buyer to refund them"));
        let g = self.grant(card_id, &offer, &buyer, w.paid.0, now_secs());
        self.pay_issuer(&offer.payout, w.paid.0);
        g
    }

    /// Turn a waiting buyer down; they get back everything they paid.
    pub fn reject_buyer(&mut self, card_id: u64, buyer: AccountId) {
        self.assert_issuer(card_id);
        let w = self.take_waiting(card_id, &buyer);
        event("buyer_rejected", json!({ "card_id": card_id, "buyer": buyer, "refund": w.paid }));
        self.pay_out(&buyer, w.paid.0);
    }

    /// End a key early. The buyer gets back the unused share of what they paid, taken from
    /// the payout account's balance and the fee in the same proportion.
    /// Sales are paid out at once, so the payout account's share of the refund must be in its
    /// Prove-It balance; otherwise send it with `ft_transfer_call` and `{"card_id","buyer","revoke":true}`.
    pub fn revoke_grant(&mut self, card_id: u64, buyer: AccountId) -> U128 {
        self.assert_issuer(card_id);
        U128(self.revoke_inner(card_id, &buyer))
    }

    /// What revoking `buyer` now would refund, and the part the payout account has to fund.
    pub fn get_revoke_cost(&self, card_id: u64, buyer: AccountId) -> Option<(U128, U128)> {
        let now = now_secs();
        let g = self.grants.get(&card_id)?.iter().find(|g| g.buyer == buyer && g.expires_at > now)?.clone();
        let refund = Self::unused_share(&g, now);
        Some((U128(refund), U128(refund - self.fee_of(refund))))
    }

    fn unused_share(g: &Grant, now: u64) -> u128 {
        let span = (g.expires_at - g.granted_at).max(1) as u128;
        let unused = (g.expires_at - now.max(g.granted_at)) as u128;
        g.paid.0 * unused / span
    }

    fn revoke_inner(&mut self, card_id: u64, buyer: &AccountId) -> u128 {
        let now = now_secs();
        let mut grants: Vec<Grant> = self.grants.get(&card_id).cloned().unwrap_or_default();
        let i = grants.iter().position(|g| &g.buyer == buyer && g.expires_at > now).unwrap_or_else(|| env::panic_str("no live key for this buyer"));
        let g = grants.remove(i);
        self.grants.insert(card_id, grants);
        let refund = Self::unused_share(&g, now);
        let fee = self.fee_of(refund);
        let owner = self.owner.clone();
        self.debit(&g.payout, refund - fee);
        self.debit(&owner, fee);
        event("viewing_key_revoked", json!({ "card_id": card_id, "buyer": buyer, "refund": U128(refund) }));
        self.pay_out(buyer, refund);
        refund
    }

    fn take_waiting(&mut self, card_id: u64, buyer: &AccountId) -> Waiting {
        let mut list: Vec<Waiting> = self.waiting.get(&card_id).cloned().unwrap_or_default();
        let i = list.iter().position(|w| &w.buyer == buyer).unwrap_or_else(|| env::panic_str("this buyer is not waiting for approval"));
        let w = list.remove(i);
        self.waiting.insert(card_id, list);
        w
    }

    // ---- anyone with a balance --------------------------------------------------------

    /// Pay out everything the caller is owed.
    pub fn withdraw(&mut self) -> U128 {
        let me = env::predecessor_account_id();
        let amount = self.balances.remove(&me).unwrap_or(0);
        require!(amount > 0, "nothing to withdraw");
        event("withdrawal", json!({ "account": me, "amount": U128(amount) }));
        self.pay_out(&me, amount);
        U128(amount)
    }

    #[private]
    pub fn on_payout(&mut self, account: AccountId, amount: U128) {
        if env::promise_result_checked(0, 1024).is_err() {
            // Not registered with the token, or the token refused: owe it instead.
            self.credit(&account, amount.0);
            event("payout_failed", json!({ "account": account, "amount": amount }));
        }
    }

    // ---- the token contract -----------------------------------------------------------

    /// NEP-141 receiver: a buyer paying for a key. Returns the amount to refund.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(self.usdc.as_ref() == Some(&env::predecessor_account_id()), "only the payment token");
        let now = now_secs();
        let Ok(m) = serde_json::from_str::<BuyMsg>(&msg) else {
            return self.refuse_payment(&sender_id, amount, "BAD_MSG", "msg must be {\"card_id\": N}");
        };
        let buyer = m.buyer.unwrap_or_else(|| sender_id.clone());
        if m.revoke == Some(true) {
            return self.fund_revoke(&sender_id, amount, m.card_id, &buyer);
        }
        let Some(offer) = self.offers.get(&m.card_id).cloned() else {
            return self.refuse_payment(&sender_id, amount, "NO_OFFER", "this card has no viewing keys for sale");
        };
        let card = self.cards.get(&m.card_id).unwrap();
        if card.revoked || card.superseded_by.is_some() {
            return self.refuse_payment(&sender_id, amount, "CARD_INACTIVE", "the card is revoked or superseded");
        }
        if amount.0 < offer.price.0 {
            return self.refuse_payment(&sender_id, amount, "UNDERPAID", "the payment is below the price");
        }
        if self.waiting.get(&m.card_id).is_some_and(|w| w.iter().any(|w| w.buyer == buyer)) {
            return self.refuse_payment(&sender_id, amount, "ALREADY_WAITING", "this buyer is already waiting for approval");
        }
        let renewing = self.grants.get(&m.card_id).is_some_and(|g| g.iter().any(|g| g.buyer == buyer && g.expires_at > now));
        if !renewing && self.seats_used(m.card_id, now) >= offer.max_seats {
            return self.refuse_payment(&sender_id, amount, "SOLD_OUT", "every seat is taken");
        }

        let price = offer.price.0;
        if offer.requires_approval && !renewing {
            self.waiting.entry(m.card_id).or_default().push(Waiting { buyer: buyer.clone(), paid: offer.price, asked_at: now });
            event("approval_requested", json!({ "card_id": m.card_id, "buyer": buyer, "paid": offer.price }));
        } else {
            self.grant(m.card_id, &offer, &buyer, price, now);
            self.pay_issuer(&offer.payout, price);
        }
        // Anything above the price goes back.
        PromiseOrValue::Value(U128(amount.0 - price))
    }

    // ---- key holders ------------------------------------------------------------------

    /// Get the card's trades older than your key's delay, encrypted to `x25519_pub` (hex).
    /// Attach at least 0.05 NEAR for the enclave run; OutLayer refunds what it doesn't use.
    /// The ciphertext is in this call's final return value (`RequestOutcome::Revealed`).
    #[payable]
    pub fn request_reveal(&mut self, card_id: u64, x25519_pub: String) -> Promise {
        let me = env::predecessor_account_id();
        let g = self.get_grant(card_id, me.clone()).unwrap_or_else(|| env::panic_str("no live viewing key for this card"));
        require!(x25519_pub.len() == 64 && x25519_pub.bytes().all(|b| b.is_ascii_hexdigit()), "x25519_pub must be 32 bytes of hex");
        let card = self.cards.get(&card_id).unwrap();
        let input = json!({
            "op": "reveal",
            "card_hash": card.card_hash,
            "follower": me,
            "follower_x25519_pub": x25519_pub.to_lowercase(),
            "delay_secs": g.delay_secs,
        })
        .to_string();
        self.start(PendingKind::Reveal { card_id }, input, None, NearToken::from_yoctonear(0))
    }

    // ---- views ------------------------------------------------------------------------

    pub fn get_offer(&self, card_id: u64) -> Option<OfferView> {
        let offer = self.offers.get(&card_id)?.clone();
        let now = now_secs();
        let used = self.seats_used(card_id, now);
        Some(OfferView {
            card_id,
            seats_used: used,
            seats_left: offer.max_seats.saturating_sub(used),
            waiting: self.waiting.get(&card_id).map(|w| w.len() as u32).unwrap_or(0),
            offer,
            token: self.usdc.clone(),
            fee_bps: self.fee_bps,
        })
    }

    /// `buyer`'s key for the card, if it is live (not expired, not revoked).
    pub fn get_grant(&self, card_id: u64, buyer: AccountId) -> Option<Grant> {
        let now = now_secs();
        self.grants.get(&card_id)?.iter().find(|g| g.buyer == buyer && g.expires_at > now).cloned()
    }

    pub fn has_grant(&self, card_id: u64, buyer: AccountId) -> bool {
        self.get_grant(card_id, buyer).is_some()
    }

    /// Live keys for a card (the issuer's dashboard).
    pub fn get_grants(&self, card_id: u64) -> Vec<Grant> {
        let now = now_secs();
        self.grants.get(&card_id).map(|g| g.iter().filter(|g| g.expires_at > now).cloned().collect()).unwrap_or_default()
    }

    pub fn get_waiting(&self, card_id: u64) -> Vec<Waiting> {
        self.waiting.get(&card_id).cloned().unwrap_or_default()
    }

    pub fn get_balance(&self, account: AccountId) -> U128 {
        U128(self.balances.get(&account).copied().unwrap_or(0))
    }
}
