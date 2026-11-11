# Phase test log

One row per exit test from BUILD_PLAN §5. A phase is complete only when every row in it is ✔. Paste the evidence (command output, tx hash, URL) in the last column or link a log in `docs/p0-results/`.

## P0 — Setup and risk spikes

| ID | Test | Status | Evidence |
|---|---|---|---|
| T0.1 | S1 under `wasmtime -S http` prints `perpMonth` with a non-empty `accountValueHistory` | ✔ | 4 Nov: 38,146 bytes fetched, `perpMonth.points = 51` (HLP vault) |
| T0.2 | S1 on OutLayer testnet; attestation `wasm_hash` = local sha256, `output_hash` = sha256(output) | ✔ | 6 Nov: request 10257; code, input and output hashes all match the attestation ([log](p0-results/t02-verify.log)) |
| T0.3 | Same ed25519 key across 2 runs + a second version; signature verifies; MAC stable | ✔ | 6 Nov: key `5be7edf3…0261` in all runs on v1 and v2; signature verifies; MAC stable; 6/6 checks ([runs](p0-results/t03-runs.json), [log](p0-results/t03.log)) |
| T0.4 | Encrypted secret reaches the enclave (hash matches); plaintext in no tx argument | ✔ | 6 Nov: enclave read the 78-char secret, sha256 `1b18c287…d08e` = expected (request 10535); `scripts/leakcheck.py` found the address in neither `store_secrets` (`2o66pg…`) nor the run (`9h5zoq…`), with a positive control ([log](p0-results/t04-leakcheck.log)) |
| T0.5 | Leaderboard fetch + parse < 60 s and within memory limit | ✔ | 4 Nov: 8.3 s total, runs under a 128 MB cap (fails at 96 MB); k = 101 for 18–19% |
| T0.6 | 0.9 KB, 4 KB and 16 KB outputs arrive intact; gas and latency recorded | ✔ | 6 Nov: 922 / 4,073 / 16,074 bytes arrived intact (requests 10543–10545); 11 blocks each; 0.00104 NEAR each, independent of size ([log](p0-results/t05.log)) |
| T0.7 | Railway URL answers `HTTP/2 200` | ✔ | 6 Nov: https://proveit-production-d47c.up.railway.app → `HTTP/2 200`, `/healthz` → `ok` (project `proveit`, environment `production`) |

**P0 status:** ✔ 7 of 7 (T0.1–T0.7). Confidential perps ownership and NEAR Intents history moved to the post-hackathon roadmap, so their tests were dropped.

## P1 — Enclave core: ownership, data, stats

Run everything with `scripts/p1-check.sh` (evidence in [p1-results/](p1-results/)). CI runs it offline on every push.

| ID | Test | Status | Evidence |
|---|---|---|---|
| T1.1 | viem-signed ownership proof is accepted; digest equals viem's | ✔ | `tests/ownership.rs`: `valid_signature`, `digest_matches_viem`, `checksummed_or_lowercase_account_both_work` |
| T1.2 | other key, tampered fields, high-s → `SIG_INVALID`; other NEAR account → `NEAR_ACCOUNT_MISMATCH`; expired → `SIG_EXPIRED`; expiry > 24 h → `BAD_INPUT` | ✔ | `tests/ownership.rs`: 7 rejection tests |
| T1.3 | 5 fixtures match the independent TypeScript reference | ✔ | `golden_winner` (+14.94%), `golden_loser` (−8.39%), `golden_few_orders`, `golden_late_funded`, `golden_hlp_vault`; goldens in sync with `reference-stats.ts` |
| T1.4 | deposits and withdrawals don't change TWR | ✔ | `twr_ignores_deposits`: 6,000+ random accounts (3 × 2,000 cases) |
| T1.5 | MDD in [0, 10,000] bps; rising equity → 0 | ✔ | `mdd_bounds` (6,000+ cases), `mdd_is_zero_for_rising_equity`, `mdd_of_a_known_path` (+100%, −50%, +25% → 50% MDD, +25% return) |
| T1.6 | trades grouped per order, net of fees | ✔ | `trade_grouping`, `profit_factor_is_none_without_losses`, `non_usdc_fees_are_not_subtracted` |
| T1.7 | 4,500 fills over pages with shared milliseconds → 4,500 unique | ✔ | `tests/pagination.rs`: also window bounds, cap, one-millisecond full page |
| T1.8 | rules refuse correctly | ✔ | `rules_too_few_trades`, `rules_account_too_new`, `rules_window_too_short`, `more_than_the_cap_is_refused`, `periods_below_min_capital_are_skipped` |
| T1.9 | within ±1pp of the leaderboard on comparable accounts | ✔ | 2 comparable accounts: 0.12pp and 0.00pp ([log](p1-results/t1.9-crosscheck.log)) |
| T1.10 | wasm binary prints a strict `Card` | ✔ | fixture build: 2 cards parse, 3 correct refusals ([log](p1-results/t1.10-wasm.log)); live build: real HTTP + ownership, refuses bad key / wrong NEAR account / no secret |

**Mutation check:** three deliberate bugs (Dietz with full flow, pagination at `last + 1`, trades per fill) each made tests fail; sources restored byte for byte.

**P1 status:** ✔ complete (10 of 10), 6 Nov 2026. Live wasm sha256 `4e09cc1e…0d05` (non-reproducible build; P2 makes it reproducible).

## P2 — Enclave card: commit, Merkle, signing, OutLayer testnet

Offline: `scripts/p1-check.sh` (cargo tests) and `scripts/p2-check.sh`. Live: `scripts/p2-live.sh` (evidence in [p2-results/](p2-results/)).

| ID | Test | Status | Evidence |
|---|---|---|---|
| T2.1 | shuffled keys → identical bytes; floats and non-ASCII refused | ✔ | `tests/card.rs`: `canonical_is_stable`, `canonical_refuses_floats_and_non_ascii`; Rust bytes equal the TypeScript vector |
| T2.2 | Merkle roots and proofs equal the TypeScript vector; edits fail | ✔ | `tests/merkle.rs`: 0/1/2/5-leaf trees, every proof; forged leaf and moved proof fail; all 91 real orders of `winner` prove |
| T2.3 | Rust signer reproduces the TypeScript signature | ✔ | `signature_vector`: pubkey, card hash, signing message and signature byte for byte |
| T2.4 | answer < 1,024 bytes | ✔ | `output_size`; inside the TEE: 754 bytes |
| T2.5 | two clean reproducible builds, same sha256 | ✔ | `8fac34b1779bf3f609daf46d5ad8989b74cb89c2de8b4982df7fba6a255e4b29` three times on linux/amd64 (arm64 differs, so builds are pinned to amd64); CI job `reproducible-build` |
| T2.6 | manifest section embedded | ✔ | 1 `outlayer.manifest` section; imports signing keys, encryption keys, storage, HTTP |
| T2.7 | live build's `pubkey` through a contract, stable | ✔ | `3360d719…6cd4` twice via `p2.proveit-realist.testnet` ([log](p2-results/t27.log)) |
| T2.8 | signed card from the TEE; attestation hashes match | ✔ (deviation) | demo build, request 10776: signature verifies (Rust and TypeScript), `output_hash` and `wasm_hash` match the local reproducible build ([attestation](p2-results/t28-attestation.json)). The real-wallet signature moves to T3.6. |

**Also verified:** the TEE computed exactly the golden stats (+14.94%, 6,283 bps drawdown, 42 trades), so macOS, Linux CI and Intel TDX agree; editing the TEE-signed card's return makes the TypeScript check fail.

**Testnet deployment:** `proveit-realist.testnet/enclave` live `8fac34b1…4b29`; `proveit-realist.testnet/enclave-demo` `3b2ab5f6…1ef7`.

**P2 status:** ✔ complete (8 of 8, T2.8 with the deviation noted), 6 Nov 2026.

## P3 — Registry contract on testnet

Offline: `cd contract && cargo test` (26 tests, in CI). Live: `scripts/e2e-testnet.sh` (evidence in [p3-results/](p3-results/)).

| ID | Test | Status | Evidence |
|---|---|---|---|
| T3.1 | the callback accepts only valid cards | ✔ | 12 accept/refuse tests through the real `on_result` callback with mocked OutLayer results; mutation check: removing the signature, issuer or tamper check each fails tests |
| T3.2 | issuance end to end | ✔ | unit + **live**: card #0 on `proveit-demo-registry.testnet` through the real OutLayer TEE (tx `Cfavm4Xp…`, [log](p3-results/demo.log)) |
| T3.3 | `bootstrap_key` from the enclave's own output | ✔ | live: demo registry `b5147545…200d`, live registry `641f094f…0cb0` (different keys: they're bound to the calling registry); non-owner panics |
| T3.4 | `verify_card` statuses | ✔ | unit: all 9 statuses; live: VALID by id and by exact JSON, HASH_MISMATCH after +20pp on the return |
| T3.5 | permissions and money | ✔ | unit (refund receipts asserted); live: refused card refunded exactly 0.02 NEAR ([log](p3-results/live-leakcheck.log)) |
| T3.6 | real Hyperliquid account, real wallet signature, VALID card | ☐ | **waiting for a Hyperliquid account**: funded at least 24 hours earlier, with 20+ trades in the last day (a 1-day card). Everything up to it is proven live: an encrypted secret with an ownership proof (public test key) went through the live registry, the enclave verified the signature, fetched real Hyperliquid data and refused with `TOO_FEW_TRADES`; the address appears in neither transaction ([log](p3-results/live.log)) |
| T3.7 | gas under 300 Tgas with ≥ 20% margin | ✔ | 15.74 Tgas total, 95% margin; callback 3.94 of 60 Tgas ([log](p3-results/t3.7-gas.log)) |

**Also done in P3:** the door check (T7.9's issue/pubkey part): a direct call to the live enclave is refused ([log](p3-results/door.log)); 7-day and **1-day** windows, with goldens (a 1-day card needs capital held for ~19 of the 24 hours, the account funded before the window, and 20 trades). After the 1-day change: enclave builds redeployed, both registries upgraded in place, card #1 issued and VALID, old card #0 still VALID.

**Testnet:** registries `proveit-demo-registry.testnet` and `proveit-registry.testnet` (owner `proveit-realist.testnet`); current enclave builds `cbac5209…` (demo) and `2fc1b727…` (live), in `enclave/expected-hashes.txt` (earlier `84dfc867…`/`3cb8dd63…` stay approved).

**P3 status:** 6 of 7. T3.6 waits for a Hyperliquid account; nothing else in P3 is open.

## P4 — M1: first real card on mainnet

Scripts: `scripts/deploy-mainnet.sh` (preflight, build, enclave, registry, status) and `scripts/issue-demo-card.sh` (store, request, check). Both were rehearsed on testnet ([rehearsal](p4-results/rehearsal-testnet/)): store + 1-day request reached the enclave (refused `TOO_FEW_TRADES`, as the test account never traded), and `check` passed every T4.3–T4.6 check on demo card #1.

Mainnet build (reproducible, registry `proveit.near`): `16f515c2a8abf41de9ed66537e748ea18f37550c96eb221b62bca5cc31aa03aa`, in `enclave/expected-hashes.txt`.

| ID | Test | Status | Evidence |
|---|---|---|---|
| T4.1 | `deploy-mainnet.sh` twice; second run changes nothing | ✔ | 9 Nov, owner `realist1036.near`: every step on the second run reported "already", no balance spent ([log](p4-results/all.log)) |
| T4.2 | `get_config`: active version = reproducible hash, key set, fixtures refused | ✔ | `deploy-mainnet.sh status`: version `7a2710db…7b7b` (upgraded 9 Nov for the $10 minimum; first deployed as `27e7f6c4…8d6a`), enclave key set, fixtures refused, native USDC at 1% ([log](p4-results/status.log)) |
| T4.3 | first card on mainnet, `verify_card` VALID | ✔ | 10 Nov: card #0 on `proveit.near` by `realist1036.near`, 1-day window, 26 trades, `verify_card` VALID, browser checks 4 ✔ + freshness warn (1-day test card). `request_card` tx `5Jmicu53JrEvwhSvPSDstdtEiFVjBdA9rADafbKvALpn` |
| T4.4 | attestation: `wasm_hash`, `output_hash`, project match | ✔ | `issue-demo-card.sh check 0`: output hash, build `7a2710db…` and project `realist1036.near/enclave` all match ([log](p4-results/check-0.log)) |
| T4.5 | leak check: address in no transaction | ✔ | 11 Nov, run by the trader on their machine: 0 hits for the address (both forms) in the `store_secrets` and `request_card` transactions; the control (card hash) found 4 times ([log](p4-results/check-0.log), address redacted) |
| T4.6 | card has no address, tx hash, order IDs or exact amounts | ✔ | same run: no address, no transaction hash, no order or trade IDs, volume as a band, no account value |

**P4 status:** scripts built and rehearsed; 0 of 6 until mainnet access (owner account + ~5 NEAR) and the Hyperliquid account exist.

## P5 — Web app: trader create flow (Railway)

Live at https://proveit-production-d47c.up.railway.app/create (testnet). Tests: `pnpm --filter web test` (vitest) and `pnpm --filter web e2e` (Playwright), both in CI.

| ID | Test | Status | Evidence |
|---|---|---|---|
| T5.1 | browser ECIES decrypts with an independent implementation | ✔ | `web/test/ecies.test.ts`: node:crypto decrypts, v1 layout, fresh per call, no address in the blob, tampering fails. The same encryption was accepted by the real OutLayer keystore (T0.4, P3). Deviation: cross-checked against node:crypto (the keystore's algorithm) instead of a Rust decrypt. |
| T5.2 | EIP-712 hash equals the test vector | ✔ | `web/test/eip712.test.ts`: digest equals the vector; viem's signature reproduces the vector signature byte for byte |
| T5.3 | no request to the app's server contains the address | ✔ | `web/e2e/no-leak.spec.ts` in Chromium: full live flow, transactions carry only ciphertext, keystore reached directly with a placeholder; forced relay path sees no secret. A planted leak made both tests fail. |
| T5.4 | Railway build + `/create` 200 | ✔ | 7 Nov: `/`, `/create`, `/healthz` 200; relay refuses unknown projects and returns the real keystore key |
| T5.5 | a fresh NEAR account creates a card in < 2 min in the browser | ☐ | needs your browser wallets: Meteor (testnet) for NEAR. The **demo data** mode works without a Hyperliquid account; a live card needs the Hyperliquid account |

**Design note:** OutLayer's keystore allows browser calls only from listed origins (its dashboard and `localhost:3000`). The app calls it directly when allowed and otherwise uses a relay (`/api/keystore-pubkey`) that rebuilds the request with placeholder values, so it can't forward a secret; the UI tells the trader when the relay was used, because a dishonest relay could swap the key. Asking OutLayer to allowlist the domain removes the relay.

**P5 status:** 4 of 5; T5.5 waits for you to run the flow with your wallet.

## P6 — M2: card page, verify, tamper mode

Live at https://proveit-production-d47c.up.railway.app (testnet): `/`, `/verify`, `/c/<id>`, `/demo/<id>`. Tests: `node --test packages/verify/src/*.test.ts`, `pnpm --filter web test`, `pnpm --filter web e2e`, all in CI.

| ID | Test | Status | Evidence |
|---|---|---|---|
| T6.1 | verifier unit tests | ✔ | 16 pass: synthetic live card (signed with the public test key) → 5 green; edited stat → signature, record, attestation red; unknown id → all red; unapproved/retired build → code red; attestation output/build/project/caller mismatch → red; revoked/superseded → record red; stale → amber; missing attestation → amber; real recorded testnet card #1; rate-limited RPC falls through; cached re-check asks only `verify_card` |
| T6.2 | `pnpm verify <railway>/demo/1` | ✔ | 7 Nov, exit 0: signature, record, code, attestation ✔; freshness amber because it is a demo card from a recorded public account (a live card shows 5/5, as in T6.1). A `/c/<id>` live card waits for the Hyperliquid account. |
| T6.3 | `pnpm verify <railway>/demo/1 --tamper return_bps=3830` | ✔ | exit 1, "signature mismatch"; record and attestation also red |
| T6.4 | og:image is a 1200×630 PNG | ✔ | `web/e2e/verify.spec.ts` plus `curl` on Railway: 200, `image/png`, 1200×630, `twitter:card` = `summary_large_image` |
| T6.5 | X and Telegram previews show the card | ☐ | yours: paste https://proveit-production-d47c.up.railway.app/demo/1 into X and Telegram |

Also in the browser suite: tamper mode goes red then green when the number is put back; the landing page's fake screenshot can't be verified while the real card can; a pasted link on `/verify` opens with checks running; unknown cards 404; a staged race (the unedited check held 4 s) can't overwrite the red result.

**P6 status:** 4 of 5; T6.5 needs the social apps.

## P7 — Viewing keys with direct USDC

Testnet, 8 Nov: both registries upgraded in place (`migrate`; old cards still `VALID`), enclave builds `b77de55e…` (live) and `9688f1bd…` (demo) approved, tUSDC on `proveit-usdc.testnet`. Demo card #2 sells keys: 1 tUSDC, 1-hour delay, 30 days, 5 seats. Mainnet build `ada3c504…` in `enclave/expected-hashes.txt`. Logs: `docs/p7-results/`.

| ID | Test | Status | Evidence |
|---|---|---|---|
| T7.1 | `reveal::delay_boundary` | ✔ | an order whose last fill is exactly `now − delay` is shown; 1 ms newer is hidden, with everything after it (oldest-first prefix); delay 0 shows all up to now; a huge delay saturates; through `seal_for` no shown order is newer than `now − delay` |
| T7.2 | `reveal::coarsening` | ✔ | records have exactly `coin, dir, fills, hour, pnl_bps, size_bps`; no address, salt seed, last-fill times, tx hash, `tid`, `oid` or millisecond time from the fixture appears anywhere in the plaintext |
| T7.3 | `reveal::proofs_match_card` | ✔ | for every issuable fixture, delay 0 → `N/N` rebuilds `orders.root` and `count`; an edited, dropped, reordered record or a bigger count fails; prefix proofs proptested for n ≤ 300 (≤ ⌈log2 n⌉ hashes) |
| T7.4 | `test-vectors/ecies-follower.json` | ✔ | Rust-sealed partial reveal (with a proof) opens in `packages/verify/src/reveal.test.ts`, plaintext byte-identical, root rebuilt; another key fails |
| T7.5 | payments | ✔ | `contract/src/keys_tests.rs` (unit tests through the real entry points, token simulated): wrong token panics (the token's `ft_resolve_transfer` refunds), underpayment and bad `msg` refunded in full, exact payment → grant and issuer balance = price − 1%, overpayment refunds the excess, reveal without a grant panics, `withdraw` sends `ft_transfer`, a failed payout is owed again. **Live:** 0.5 tUSDC underpayment refunded (`Aii4VvZw…`), 1 tUSDC payment granted the key (`AfwVPUqd…`). Deviation: unit tests plus a live testnet run instead of a `near-workspaces` sandbox. |
| T7.6 | live $1 USDC → "N/N Merkle-verified" | ◐ | **Testnet done:** `request_reveal` `Dc6MLncG…` from `proveit-follower.testnet`, OutLayer TEE answered, **91/91 Merkle-verified** (`scripts/open-reveal.ts`), and the same transaction replayed in the browser (`web/e2e/unlock.spec.ts`). **Mainnet:** waits for the mainnet deploy (P4) |
| T7.7 | `leakcheck.py` on payment and reveal | ✔ | fixture address: 0 matches in both; `Open Long`, `Close Long`, `size_bps`: 0 matches in the reveal tx; controls found |
| T7.8 | offer terms | ✔ | unit tests: seat after `max_seats` refunded (renewals don't need a seat), seat frees on expiry; expired key fails `get_grant` and `request_reveal`; approval escrows (seat held, issuer unpaid), approve grants from approval time and pays, reject refunds in full; `revoke_grant` at ¼ refunds ¾, split between issuer and fee; offer changes don't change sold keys; revoked cards stop selling |
| T7.9 | door checks | ✔ (on-chain) | `reveal` goes through the same registry-only door as `issue` (`enclave/tests/door.rs`, refused live in P3). **HTTPS reveal moves to P8** with the feed (NEP-413 follower signature + RPC grant check) |

Totals: enclave `cargo test` all pass (8 new reveal tests), contract 42 (16 new), `packages/verify` 20 (4 new), web e2e 13 (4 new: unlock link, terms + buy transaction, real reveal 91/91, wrong key refused).

**Design notes:**
- **Salted leaves.** An order record has little entropy, so an unsalted leaf hash of a still-hidden order, seen as a proof sibling, could be brute-forced. Salts form a backward hash chain from an enclave-MAC'd seed; a reveal of the first k orders hands over `salt[k-1]` only. This changes the leaf format from P2 (cards issued before P7 can't be revealed; they answer `CARD_NOT_FOUND`).
- **Stored, not recomputed.** Hyperliquid's account-value windows roll forward, so recomputing records later would change sizes and the root. `issue` stores the coarsened records in encrypted worker storage; reveals never call Hyperliquid.
- **The ciphertext is a return value.** `on_result` returns it to the follower's transaction and keeps only its sha256 in state; nothing readable is logged.

**P7 status:** 8 of 9; T7.6 on mainnet with real USDC after the mainnet deploy.

## P8 — M3: 1Click cross-chain unlock and the live feed

Testnet, 8 Nov: enclave builds `23b7d873…` (live) and `0ad3295a…` (demo) approved on both registries; mainnet build `e5618816…`. The enclave now has an HTTPS door for `reveal` and `feed`, guarded by a NEP-413 follower signature, an on-chain full-access-key check and an on-chain grant check, all made by the enclave itself. Logs: `docs/p8-results/`.

| ID | Test | Status | Evidence |
|---|---|---|---|
| T8.1 | 1Click status state machine | ✔ | `web/test/oneclick.test.ts`: the UI's statuses equal the spec's enum (`PENDING_DEPOSIT`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`, `FAILED`, extracted from the live OpenAPI spec); only SUCCESS/REFUNDED/FAILED are final; an unknown status keeps waiting |
| T8.2 | quote request snapshot | ✔ | `EXACT_OUTPUT` of the key's price in native USDC to the registry, `customRecipientMsg` = `{"card_id","buyer"}` (what `ft_on_transfer` parses), `refundTo` the follower's origin address, deadline +30 min; a real dry quote accepted this shape ($1.00 out for $1.01–1.02 in from Base). **Deviation:** `appFees` is empty, because the registry already takes its 1% fee on-chain and the cross-chain path must not charge twice |
| T8.3 | no 1Click or OutLayer key in the client bundle | ✔ | `grep -rE "ONECLICK\|OUTLAYER_PAYMENT_KEY\|X-Payment-Key" web/.next/static` → 0 files |
| T8.4 | live $1 USDC from Base | ☐ | needs mainnet (`proveit.near`: 1Click refuses recipients that don't exist yet) and a 1Click partner API key (`ONECLICK_API_KEY` on Railway): non-dry quotes fail without one |
| T8.7 | `enclave::feed_chain` | ✔ | `enclave/tests/feed.rs`: three polls extend one chain, each page continues from the kept head, a second follower ends at the same head; drop, reorder, edit or a rewritten start fail. Same checks in TypeScript against `test-vectors/feed.json` (`packages/verify/src/feed.test.ts`). Also: the delay holds back recent orders; a concurrent extension isn't lost (compare-and-swap) |
| T8.8 | `enclave::feed_auth` | ✔ | bad or expired signature, a message valid for more than a day, another app's message, a key that isn't the account's, a function-call key, another card, no grant, an expired grant → each refused **before any stored data is read** (counted). **Live over HTTPS:** wrong account → `NEAR_ACCOUNT_MISMATCH`, no key for card #1 → `NO_GRANT`, `issue` over HTTPS → refused |
| T8.9 | live feed shows a new trade (delay 0) | ☐ | needs the Hyperliquid account trading after its card. The path is live: `feed` over HTTPS for demo card #2 answered (0 entries: the recorded account never trades again), chain intact |
| T8.10 | no-leak for the feed | ✔ | `web/e2e/feed.spec.ts`: the page decrypts and chain-checks the feed; every request to the app's server carries only the card, a cursor and the signed message, with no address, trade, record field or secret. A forged page (a trade dropped) shows as broken, not as trades |

**Live over HTTPS (testnet):** `follower.proveit-realist.testnet` (its own key, NEP-413-signed by `scripts/follow.ts`) bought a key on demo card #2 (`HHdfMj2M…`); `reveal` over HTTPS → **91/91 Merkle-verified**, `feed` → chain intact; about $0.001 per call, 2.5–3 s in the TEE.

**Not done in P8:**
- The **Copy** button for NEAR Intents swaps waits for the Intents venue (P9). Perps trades show as signals with a link to trade the coin on Hyperliquid, sized as the same share of the follower's equity.
- The deposit address isn't shown as a QR code; it has a copy button.
- **Railway needs `OUTLAYER_PAYMENT_KEY`** (an OutLayer payment key limited to this owner's projects) before the deployed relay can serve the feed, and `ONECLICK_API_KEY` for cross-chain quotes.

**P8 status:** 6 of 8: T8.1–T8.3, T8.7, T8.8, T8.10 done; T8.4 and T8.9 need the mainnet card, a 1Click key and the Hyperliquid account.

## P9 — Explore, privacy depth, profile, agent guard

Testnet, 8 Nov: enclave builds `c4162179…` (live) and `653e74f1…` (demo) approved; mainnet build `27e7f6c4…`; registry code redeployed to both testnet registries (no state change; old cards still `VALID`). Live: https://proveit-production-d47c.up.railway.app/explore. Logs: `docs/p9-results/`, `docs/agent-guard-demo.log`.

| ID | Test | Status | Evidence |
|---|---|---|---|
| T9.1 | `kanon::coarsens_until_k` | ✔ | `enclave/tests/kanon.rs`: an outlier's bucket widens 0.1% → 1% → 5% → 25% until ≥ 25 share it; an unhideable return is refused (`PRIVACY_RISK`); proptest over the recorded leaderboard: the bucket always contains the return and holds ≥ `k_min`; the live format parses and keeps ROI only; issued cards carry `return_precision_bps`, `k_anon`, `k_min`. **Live in the TEE:** demo cards #3 and #4 fetched today's leaderboard and publish +14–15%, **1 of ≥ 98** |
| T9.2 | profile indices | ✔ | `contract/src/tests.rs::profile_indices`: 3 cards from 2 commitments → `get_cards_by_issuer` = [0, 1, 2], by commitment [0, 2] and [1]. Unit test, not sandbox |
| T9.3 | refresh | ✔ | `refresh_supersedes_and_needs_the_same_account` (P3): `supersedes` linked, old card `SUPERSEDED`, another account's card can't refresh it |
| T9.4 | `pnpm agent-guard` green / tampered | ✔ | `docs/agent-guard-demo.log` on demo card #3: verified card within policy → FOLLOW, exit 0; same card with the return edited to +90% → REFUSE (signature, record, attestation), exit 1; default policy → REFUSE (demo card, drawdown 62.83% > 30%), exit 1. Policy unit tests in `packages/verify/src/guard.test.ts` |
| T9.5 | `/api/verify?card=…` | ✔ | `web/e2e/p9.spec.ts` and live on Railway: the five checks as JSON, the same statuses as the CLI; `guard=1` adds the verdict; CORS open; unknown card 404, unknown registry 400 |
| T9.6 | `/explore` | ✔ | `web/test/explore.test.ts`: revoked, replaced and retired-build cards hidden, stale ones kept and badged, each sort order, seats left from `get_offer`; `e2e/p9.spec.ts` against testnet |

**Also:** `kind: "agent"` cards (the issuer's label, signed in; `request_card(…, kind)`, create-flow checkbox, "AI agent" badge; demo card #4 is one); profile pages `/p/<account>` group cards by commitment so a hidden extra account shows; check 5 is now "Freshness and privacy" and fails a card with `k_anon < k_min`; the landing page features card #3.

**Not built:** the NEAR Intents venue and an inception-to-date window (see the roadmap in `web/content/docs/roadmap.md`).

**P9 status:** ✔ T9.1–T9.6 done.

## P10 — Hardening for the AI screeners

| ID | Test | Status | Evidence |
|---|---|---|---|
| T10.1 | clean machine: `pnpm i && pnpm demo` | ✔ | `docs/p10-results/clean-machine.log`: a `node:22` container with only the repository's files; the real card verifies (4 ✔, check 5 amber because it's a demo card), the edited copy fails signature, record and attestation, exit 0. On mainnet the live card will show 5/5 |
| T10.2 | simulated screener (a fresh Claude Code session follows the README) | ☐ | needs the repo public (or a fresh session given local access); yours to start |
| T10.3 | CI green on `main` incl. the reproducible-hash job | ✔ | run 42474099723 on `7038145`: enclave, contract, typescript, web and reproducible-build all green (the three enclave builds match `expected-hashes.txt`). It had failed since P6 because the reproducible-build job never installed the workspace packages; fixed in `.github/workflows/ci.yml` |
| T10.4 | `docs/CLAIMS.md` | ✔ | 18 claims, each mapped to a test ID or live record and a command to check it; the commands were run |
| T10.5 | security checklist | ✔ | `docs/THREAT_MODEL.md`: every item with its test. New: `enclave/tests/security.rs` (only the card code signs; EIP-712 domain and bindings), `contract::callbacks_are_private` plus a live refusal (`docs/p10-results/private-callback.log`). The relayer item is n/a (fallback B isn't used) |
| T10.6 | Railway production | ◐ | `docs/p10-results/routes.log`: `/`, `/create`, `/verify`, `/explore`, card, unlock, feed, `/api/verify`, OG image, `/healthz` all 200 (`/c/0` is 404 because the live registry has no card until the Hyperliquid account's). The mainnet env vars wait for the mainnet deploy; the relay and 1Click keys are yours to set |

Also: README rewritten for the screeners (60-second demo, live links, where each part runs, proven / not proven, reproducible hashes, deployments, NEAR protocols, status, disclosures); `docs/TRUST_MODEL.md`, `docs/THREAT_MODEL.md`, `docs/CLAIMS.md`; `docs/METHODOLOGY.md` gains the privacy guard and order records; `pnpm demo` (`scripts/demo.ts`) and `pnpm test` (`scripts/test-all.sh`); the verify CLI prints the return bucket.

**P10 status:** T10.1, T10.3, T10.4, T10.5 done; T10.2 and T10.6 need you (repo public, keys, mainnet).

## PC — Copy from a tab

| ID | Test | Status | Evidence |
|---|---|---|---|
| TC.1 | signatures match Hyperliquid's official SDK | ✔ | `web/test/hyperliquid.test.ts`: the phantom-agent hash and the mainnet and testnet vectors from `hyperliquid-python-sdk/tests/signing_test.py` |
| TC.2 | sizing, limits, minimums, closes and skips | ✔ | `web/test/copy-plan.test.ts` |
| TC.3 | browser flow against a simulated Hyperliquid: simulate needs no wallet, demo cards can't use real money, one approval, correct order, only new trades auto-copied | ✔ | `web/e2e/copy.spec.ts` |
| TC.4 | the follower's address and agent key never reach this app's server | ✔ | `web/e2e/copy.spec.ts` |
| TC.5 | the real exchange accepts the signing format | ✔ | Hyperliquid testnet, 9 Nov: an order signed by a throwaway key was answered with that exact key's address and "does not exist", so the action hash and signature were read correctly. No order was placed |
| TC.6 | live: approve a key and fill a sample order on Hyperliquid testnet | ☐ | yours: needs your wallet and testnet funds |

**PC status:** 5 of 6; TC.6 needs your wallet. The roadmap has the rest of copying.

## 11 Nov: feedback from live testing

| Change | Where | Tested by |
|---|---|---|
| Sales pay the trader in the same transaction; revoking an already-paid key is funded by the trader | contract (all three registries redeployed 11 Nov) | `contract/src/keys_tests.rs` (47 tests) |
| Withdrawing and selling register the trader with USDC first, if needed | `web/components/UnlockFlow.tsx` | live: the first withdrawal failed because `realist1036.near` wasn't registered |
| Feed orders settle after 30 s instead of 2 min | enclave builds `3de3334a…`, `c818c20a…`, `fc6ccb06…` | enclave tests, regenerated `test-vectors/feed.json` |
| Feed checks every 10 s while auto-copy is on | `web/components/FeedFlow.tsx` | `web/e2e/copy.spec.ts` |
| One wallet connection for every page, restored after a reload | `web/lib/wallets.ts`, header button | `web/e2e/copy.spec.ts` (reload test) |
| Feed session, copy settings, trading key and auto-copy survive a reload | `FeedFlow`, `CopyPanel` | `web/e2e/copy.spec.ts` |
| Auto-copy takes every trade after it is switched on, once, if under an hour old | `CopyPanel` | `web/e2e/copy.spec.ts` |
| The follower's copy P&L (closed, open, fees); a simulated book in simulation | `CopyPanel`, `lib/hyperliquid.ts` | `web/e2e/copy.spec.ts` |
| "Copy this trader" on every card, the unlock page and the feed page | card, unlock and feed pages | manual |
