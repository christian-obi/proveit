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
