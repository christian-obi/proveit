# Claims and their evidence

Every claim in the README, with the test or live record that backs it. Test IDs and full results are in [PHASES.md](PHASES.md). "Live" means run against NEAR testnet and OutLayer testnet; mainnet runs are listed as pending where they are.

| # | Claim | Evidence | How to check it yourself |
|---|---|---|---|
| C1 | A card's numbers can't be edited without every check noticing | T6.1–T6.3; `packages/verify/src/checks.test.ts` | `pnpm demo` (prints the real card verified, then the edited copy failing signature, record and attestation) |
| C2 | Verification needs no account and no trust in our server: public data only, on your machine | `packages/verify` reads NEAR RPC and OutLayer's attestation API only | `pnpm verify https://proveit-production-d47c.up.railway.app/demo/3` |
| C3 | Cards are computed inside an Intel TDX enclave by an open-source build anyone can reproduce | T2.5/T2.6 (CI `reproducible-build`); check 4 compares the attestation's `wasm_hash` and output hash | `REGISTRY=proveit-demo-registry.testnet enclave/build.sh demo-fixture` → compare with `enclave/expected-hashes.txt` and with the card's attestation |
| C4 | Only the registry contract can get a card signed; direct calls are refused | T7.9 (`enclave/tests/door.rs`); live refusals P3, P8 (`docs/p8-results/https-refusals.log`) | `outlayer run proveit-realist.testnet/enclave-demo '{"op":"pubkey"}'` → refused |
| C5 | The trader proves they control the Hyperliquid account; no API keys | T1.1–T1.2 (`enclave/tests/ownership.rs`, vectors from viem) | `cd enclave && cargo test --test ownership` |
| C6 | The wallet address never appears on-chain or on our server | T5.3 (`web/e2e/no-leak.spec.ts`), T7.7, T8.10, `scripts/leakcheck.py` with positive controls | `pnpm --filter web e2e`; `scripts/leakcheck.py` on any card's transactions |
| C7 | A card's return can't be looked up on Hyperliquid's leaderboard: it's shared by ≥ 25 accounts | T9.1 (`enclave/tests/kanon.rs`); live in the TEE: demo card #3, "1 of ≥ 98" | `cd enclave && cargo test --test kanon`; card #3's page |
| C8 | Followers buy viewing keys in USDC on the trader's terms: price, delay (0 = live), duration, seats, approval | T7.5, T7.8 (`contract/src/keys_tests.rs`); live: underpayment refunded, payment granted (`docs/p7-results/buy.log`) | `cd contract && cargo test keys` |
| C9 | Revealed trades are exactly the card's committed orders: none edited, dropped, reordered or added | T7.3, T7.4; live: **91/91 Merkle-verified** on-chain (P7) and over HTTPS (P8) | `node --test packages/verify/src/reveal.test.ts` |
| C10 | Revealed trades are coarsened so they can't identify the wallet | T7.2 (field-absence tests, no tx hash, ID or exact time in the plaintext) | `cd enclave && cargo test --test reveal coarsening` |
| C11 | The live feed is one hash chain per card; a follower detects any dropped or rewritten trade | T8.7 (Rust + TypeScript on `test-vectors/feed.json`), `web/e2e/feed.spec.ts` | `cd enclave && cargo test --test feed` |
| C12 | Only a live key holder can read a feed or HTTPS reveal, and is refused before any data is read | T8.8; live: `NEAR_ACCOUNT_MISMATCH`, `NO_GRANT` (`docs/p8-results/`) | `cd enclave && cargo test --test feed feed_auth` |
| C13 | The relay in the middle can't read trades | answers are encrypted to the follower inside the TEE; T8.10 | `web/e2e/feed.spec.ts` |
| C14 | Followers can pay from other chains through NEAR Intents 1Click | T8.1–T8.3 (state machine, request shape, a real recorded quote). **Live payment pending:** T8.4 needs mainnet | `pnpm --filter web test oneclick` |
| C15 | AI agents can check a trader before following: `pnpm agent-guard` and `/api/verify` | T9.4 (`docs/agent-guard-demo.log`), T9.5 | `pnpm agent-guard https://proveit-production-d47c.up.railway.app/demo/3 --allow-demo --max-dd 70` → FOLLOW; add `--tamper return_bps=9000` → REFUSE |
| C16 | Other contracts can gate on a verified card on-chain | `verify_card(card_id, card_json?)` view on the registry; T3 tests | `near contract call-function as-read-only proveit-demo-registry.testnet verify_card json-args '{"card_id":3}' network-config testnet now` |
| C17 | The security checklist holds | T10.5 ([THREAT_MODEL.md](THREAT_MODEL.md)) | `pnpm test` |
| C18 | On NEAR mainnet | Registry and enclave deployed (T4.1, T4.2); card #0 issued, attested and leak-free (T4.3–T4.6) | `node packages/verify/bin/verify.ts https://proveit-production-d47c.up.railway.app/c/0` |
| C19 | Followers can copy trades from a browser tab; the app server never sees their address or trading key | TC.1–TC.5. **A live filled order is pending** (TC.6) | `pnpm --filter web test && pnpm --filter web e2e copy` |
