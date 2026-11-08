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
| T0.8 | S6 result recorded | ☐ | needs a near.com test account; script self-tested on mainnet |
| T0.9 | S7: confidential history item saved as a fixture, session-token scope recorded (or "no access by 8 Nov") | ☐ | needs invite access from the NEAR Intents team (message in BUILD_PLAN §7) |

**P0 status:** 7 of 9 passed (T0.1–T0.7). All platform risk is retired and P1 can start. Waiting on outside access: T0.8 (near.com test account), T0.9 (1Click history access; passes as "no access" after 8 Nov). Neither blocks P1–P8.

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
| T4.1 | `deploy-mainnet.sh` twice; second run changes nothing | ☐ | needs a funded mainnet owner account and `outlayer login mainnet` |
| T4.2 | `get_config`: active version = reproducible hash, key set, fixtures refused | ☐ | `deploy-mainnet.sh status` |
| T4.3 | first card on mainnet, `verify_card` VALID | ☐ | needs the Hyperliquid account (1-day card: funded 24 h earlier, 20+ trades) |
| T4.4 | attestation: `wasm_hash`, `output_hash`, project match | ☐ | `issue-demo-card.sh check` |
| T4.5 | leak check: address in no transaction | ☐ | `issue-demo-card.sh check` |
| T4.6 | card has no address, tx hash, order IDs or exact amounts | ☐ | `issue-demo-card.sh check` |

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
| T5.6 | live mode with an account under 20 trades → `TOO_FEW_TRADES` message, deposit refunded | ☐ | needs your browser wallets: Meteor (testnet) + MetaMask/Rabby with any address |

**Design note:** OutLayer's keystore allows browser calls only from listed origins (its dashboard and `localhost:3000`). The app calls it directly when allowed and otherwise uses a relay (`/api/keystore-pubkey`) that rebuilds the request with placeholder values, so it can't forward a secret; the UI tells the trader when the relay was used, because a dishonest relay could swap the key. Asking OutLayer to allowlist the domain removes the relay.

**P5 status:** 4 of 6; T5.5 and T5.6 wait for you to run the flow with your wallets.

## P6 — M2: card page, verify, tamper mode

Live at https://proveit-production-d47c.up.railway.app (testnet): `/`, `/verify`, `/c/<id>`, `/demo/<id>`. Tests: `node --test packages/verify/src/*.test.ts`, `pnpm --filter web test`, `pnpm --filter web e2e`, all in CI.

| ID | Test | Status | Evidence |
|---|---|---|---|
| T6.1 | verifier unit tests | ✔ | 16 pass: synthetic live card (signed with the public test key) → 5 green; edited stat → signature, record, attestation red; unknown id → all red; unapproved/retired build → code red; attestation output/build/project/caller mismatch → red; revoked/superseded → record red; stale → amber; missing attestation → amber; real recorded testnet card #1; rate-limited RPC falls through; cached re-check asks only `verify_card` |
| T6.2 | `pnpm verify <railway>/demo/1` | ✔ | 7 Nov, exit 0: signature, record, code, attestation ✔; freshness amber because it is a demo card from a recorded public account (a live card shows 5/5, as in T6.1). A `/c/<id>` live card waits for the Hyperliquid account. |
| T6.3 | `pnpm verify <railway>/demo/1 --tamper return_bps=3830` | ✔ | exit 1, "signature mismatch"; record and attestation also red |
| T6.4 | og:image is a 1200×630 PNG | ✔ | `web/e2e/verify.spec.ts` plus `curl` on Railway: 200, `image/png`, 1200×630, `twitter:card` = `summary_large_image` |
| T6.5 | X and Telegram previews show the card | ☐ | yours: paste https://proveit-production-d47c.up.railway.app/demo/1 into X and Telegram |
| T6.6 | hallway test, 3 people, green then red in < 10 s | ☐ | yours: log the three times here |

Also in the browser suite: tamper mode goes red then green when the number is put back; the landing page's fake screenshot can't be verified while the real card can; a pasted link on `/verify` opens with checks running; unknown cards 404; a staged race (the unedited check held 4 s) can't overwrite the red result.

**P6 status:** 4 of 6; T6.5 and T6.6 need people and social apps.
