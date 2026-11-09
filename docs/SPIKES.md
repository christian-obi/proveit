# P0 spike results

What each spike proved, with the numbers, and the G0 decision. Raw logs from live runs go to `docs/p0-results/`.

| Spike | Question | Local result (4 Nov) | Live result |
|---|---|---|---|
| S1 `spikes/s1-hello-hl` | Can a WASI P2 module reach Hyperliquid? | ✔ `wasmtime -S http`: fetched 38,146 bytes of `portfolio` for the HLP vault; `perpMonth` has 51 points | ✔ 6 Nov, request 10257: code, input and output hashes match the TEE attestation (`/attestations/by-request/10257`); 989 ms, 0.0012 NEAR |
| S2 `spikes/s2-enclave` + `spikes/s2-contract` | Contract-started runs get a stable `cards` signing key and `commit` MAC key? | ✔ builds for `wasm32-wasip2`; manifest section embedded in v1 and v2; imports `outlayer:signing-keys/api@0.1.0` and `outlayer:encryption-keys/api@0.1.0`; v1 and v2 hashes differ (below); WIT copied from the worker (signing WIT identical to the probe's). Spike contract: 2/2 unit tests pass, wasm builds. Checker `check-keys.mjs` self-tested (passes good data, catches a tampered signature). The host functions exist only inside OutLayer workers, so the module cannot run locally. | ✔ 6 Nov: one `cards` key `5be7edf3…0261` across 3 pubkey runs on v1 and v2; signature verifies; `commit` MAC identical on v1 and v2; platform reports `predecessor = spike.proveit-realist.testnet`, `execution_type = NEAR`. Callback latency 11–22 blocks (≈ 12–25 s); ≈ 0.001 NEAR per run |
| S3 `spikes/s3-secrets` | Can the browser encrypt a secret only the TEE can read? | ✔ 4/4 tests: JS ECIES v1 decrypts with an independent implementation (node:crypto); blob layout correct; tampering detected; live `POST https://api.outlayer.ai/secrets/pubkey` answers with **placeholder values**, and keys differ per owner | ✔ 6 Nov: secret encrypted in JS, stored with `store_secrets` (0.005 NEAR storage), referenced via `secrets_ref` from a contract-started run; the enclave's hash matches; the plaintext appears in neither transaction (`scripts/leakcheck.py`, with a positive control) |
| S4 `spikes/s4-leaderboard` | Is the k-anonymity guard affordable in the enclave? | ✔ 40,017,997 bytes, 48,539 rows; fetch 8.2 s, parse 0.13 s, total 8.3 s. Runs under a **128 MB** wasm memory cap, fails at 96 MB. Example: 18.0–19.0% bucket → k = 101 | optional re-run on OutLayer |
| S5 (same module, `blob` op) | Output size through the callback | Source says ≥ 1 KB uses the stored two-call flow with no fixed cap | ✔ 6 Nov: 922 B, 4,073 B and 16,074 B all arrived intact through the stored two-call flow; 11 blocks each; 0.00104 NEAR each, independent of size |
| S7 (not started) | Can the enclave read a user's NEAR Intents confidential history? | 1Click spec read: `POST /v0/auth/authenticate` → tokens; `GET /v0/account/history` returns public and confidential items with USD amounts; **invite-only** | pending access (T0.9) |
| S6 `spikes/s6-chainsig-match` | Is a near.com dedicated account a Chain Signatures address? | ✔ derivation self-test on mainnet (`root.near` + `hyperliquid` → match, confirmed by `v1.signer`) | pending: needs a near.com test account (T0.8) |

**Build hashes (local, non-reproducible builds; P2 makes them reproducible):**
- `s2-enclave` v1: `f5e25c06192f22f242fa26bbd98314eb1f866fbe6f9249e89efeb2813df4ad5f`
- `s2-enclave` v2: `9b3a2bf78108579b8b4e75727485af6cde7c56c0d7e887f75a620f113b923240`

Rebuilding on another machine can change these; `scripts/p0-live.sh build` prints the current ones into `docs/p0-results/build.log`.

## Findings that change the plan
- **Attestation lookup (T0.2):** `/attestations/{id}` is keyed by OutLayer's internal task ID, not the request ID. Use `/attestations/by-request/{request_id}`; the verify page and T4.4 now do.
- **Latency (T0.3):** a contract-started run returns its callback in 11–22 blocks (≈ 12–25 s on testnet), so a card can be issued well within one minute.
- **S4:** the live k-anon guard is affordable. Download time dominates (8 s of 8.3 s), so request `max_execution_seconds ≥ 60` and `max_memory_mb = 256` for issue runs. The snapshot fallback is not needed unless OutLayer's network is much slower than a laptop's.
- **OutLayer contract:** omitting `resource_limits` turns a request into **compile-only**, so the registry must always send limits (the spike contract does).
- **Contract toolchain:** the contract pins Rust 1.86 (`rust-toolchain.toml`) and resolves dependencies with `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback` (one dependency needs 1.88 at its newest).
- **Gas:** give OutLayer a fixed floor (50 Tgas) with `GasWeight(1)`, not `prepaid − reserves`. The second pattern fails with `GasExceeded` because the call has already burned gas before the promise is created.

## Live setup (once, by hand)
These need your own accounts, so they are not automated.

1. **Testnet account** (free, from the faucet):
   ```bash
   near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config testnet create
   ```
2. **OutLayer login** (prompts for the account and its private key):
   ```bash
   near account export-account <name>.testnet using-private-key network-config testnet   # prints the key
   outlayer login testnet
   ```
3. **Live tests**, in order:
   ```bash
   export ACCOUNT=<name>.testnet
   scripts/p0-live.sh build
   scripts/p0-live.sh projects      # uploads + deploys s1-hello-hl and s2-enclave
   scripts/p0-live.sh contract      # creates spike.$ACCOUNT and deploys the spike contract
   scripts/p0-live.sh t02           # S1 on OutLayer + attestation
   scripts/p0-live.sh t03           # S2 keys (deploys v2 midway) + automatic check
   scripts/p0-live.sh t04 '{"venue":"hyperliquid","address":"0x0000000000000000000000000000000000000001"}'
   #   then run the printed store_secrets command, then:
   scripts/p0-live.sh t04-run
   scripts/p0-live.sh t05           # S5 output sizes
   ```
4. **Railway placeholder** (T0.7):
   ```bash
   railway login
   cd web && railway init --name proveit && railway up && railway domain
   curl -sI https://<generated>.up.railway.app | head -1      # expect HTTP/2 200
   ```
   Later, connect the GitHub repo in the Railway dashboard (service root directory `web/`) so every push deploys.
5. **S6** is on the post-hackathon roadmap: see `spikes/s6-chainsig-match/README.md`.

## G0 decision
Recorded after the live tests. Rules (from BUILD_PLAN §5, P0):
- S1 + S2 green → the plan stands.
- S2 red → sign with a `PROTECTED_` generated ed25519 secret and prove the key with a `pubkey` run attestation.
- S3 red → store secrets with the `outlayer secrets set` CLI for the demo and document it.
- S4 red → leaderboard snapshot hash. (Local result: green.)
- S5 red → reveal over HTTPS (`/api/reveal` on Railway).

**Decision (6 Nov):** S1 and S2 are green on OutLayer testnet, so **the plan stands**: one registry-bound `cards` signing key and `commit` MAC key that survive code upgrades. S4 is green locally. S3 is green too (6 Nov). S5 is green too: on-chain reveals up to at least 16 KB work at flat cost, so `/api/reveal` is needed only for the live feed's frequent polling.
