# Threat model and security checklist

Each threat, what stops it, and the test that shows it. Test IDs are in `docs/PHASES.md`.

## Threats

| # | Threat | Stopped by | Test |
|---|---|---|---|
| 1 | A trader edits a number on their card (a faked screenshot) | ed25519 signature by the registry-bound enclave key; `card_hash` on-chain; the attestation's output hash | T6.1–T6.3, `pnpm demo`, tamper mode in the browser |
| 2 | A trader claims someone else's (better) account | EIP-712 ownership signature from the account's own key, bound to the issuer's NEAR account, verified inside the TEE | T1.1–T1.2 (`enclave/tests/ownership.rs`) |
| 3 | An ownership signature is replayed | single-use nonce (registry), 24-hour expiry, NEAR-account binding | `a_nonce_is_used_once`, `rejects_expired_signature`, `rejects_another_near_account` |
| 4 | Someone calls the enclave directly to get a signed card | the door check: `issue`/`pubkey` run only on-chain from the compiled-in registry; the card key is bound to that caller anyway | T7.9 (`enclave/tests/door.rs`), refused live in P3 and P8 |
| 5 | A malicious or modified build issues cards | the registry pins approved builds; every card names its build; reproducible builds | T2.5/T2.6 (CI `reproducible-build`), check 3 |
| 6 | The card points at the wallet via the public leaderboard | the k-anonymity guard: published return shared by ≥ 25 accounts or no card | T9.1 (`enclave/tests/kanon.rs`), live: 1 of ≥ 98 |
| 7 | A wallet address leaks on-chain or to the web server | encrypted in the browser to the TEE keystore (ECIES); placeholders to the relay; never in a transaction | T5.1, T5.3, T7.7, `scripts/leakcheck.py` with positive controls |
| 8 | A trader cherry-picks the trades a viewing key reveals | Merkle root over every order, committed in the signed card; prefix proof; count checked | T7.3, T7.4 |
| 9 | Revealed trades identify the wallet to the buyer | coarsened records (hour, coin, side, % sizes; no prices, IDs or hashes); salted leaves so proofs hide newer orders | T7.2, `enclave/tests/reveal.rs` |
| 10 | Someone reads a feed or reveal without a key, or as someone else | NEP-413 signature, on-chain full-access-key check and grant check inside the enclave, before any data is read | T8.8 (`enclave/tests/feed.rs`), live refusals in `docs/p8-results/` |
| 11 | The relay or the enclave drops or rewrites feed trades for one follower | one hash chain per card in compare-and-swap storage; the follower checks every page continues from the head they kept | T8.7, `web/e2e/feed.spec.ts` (forged page shown as broken) |
| 12 | Payment tricks: wrong token, underpaying, overselling seats, refund abuse | `ft_on_transfer` accepts only the configured token, refunds by return value, counts seats, escrows approvals, pro-rata refunds | T7.5, T7.8 (`contract/src/keys_tests.rs`), live underpayment refund |
| 13 | A forged OutLayer callback | callbacks are `#[private]` | `callbacks_are_private`, live refusal (`docs/p10-results/private-callback.log`) |
| 14 | API keys leak to the browser | 1Click and OutLayer keys only in server routes | T8.3 (`grep` of the client bundle) |
| 15 | A stale RPC answer shows a tampered card as verified | only the latest check may update the panel | `web/e2e/verify.spec.ts` (staged race) |

## T10.5 checklist

| Item | Status | Test |
|---|---|---|
| The enclave signs only messages it composes | ✔ | `enclave/tests/security.rs::only_the_card_code_signs`: `sign_card` has one caller, which signs `signing_message(card)`; no op takes bytes to sign |
| EIP-712 domain has the app name and version | ✔ | `security.rs::eip712_domain_and_bindings`; `ownership.rs::digest_matches_viem` |
| …and the message binds the NEAR account, nonce and expiry | ✔ | `rejects_another_near_account`, `rejects_expired_signature`, `rejects_expiry_too_far_ahead`, `rejects_tampered_fields` |
| Nonces are single-use | ✔ | `contract/src/tests.rs::a_nonce_is_used_once` |
| Callbacks are `#[private]` | ✔ | `callbacks_are_private` + live refusal |
| Failed runs refund | ✔ | `a_failed_outlayer_call_refunds_everything`, `a_refused_card_refunds_the_storage_fee`; a failed payout is owed again (`t7_5_withdraw_pays_out_and_a_failed_payout_is_owed_again`) |
| `ft_on_transfer` checks the sender is the USDC contract | ✔ | `t7_5_wrong_token_is_refused` |
| The relayer key is function-call only | n/a | fallback B (a relayer) isn't used; 1Click delivers to the registry directly |

## Copy from a tab

| Threat | Mitigation | Test |
|---|---|---|
| The trading key is stolen | It's created per session, kept only in tab memory, expires after 30 days and can't withdraw. It can still place bad trades until then | TC.3 |
| The app's server learns who is copying | The browser talks to Hyperliquid directly | TC.4 |
| A trade is copied twice | A fixed client order ID per trade, plus a record in the browser | TC.2, TC.3 |
| A huge trade drains a small follower | The follower's per-trade, leverage and slippage limits always apply | TC.2 |
| A demo card triggers real orders | Real-money copying is disabled on demo cards | TC.3 |
| Followers' timing reveals the trader's wallet | Not solved. Documented as a limit | — |
