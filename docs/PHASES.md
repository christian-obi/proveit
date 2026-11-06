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
