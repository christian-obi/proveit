# Prove-It

**Verifiable private trading track records on NEAR.** A trader proves their Hyperliquid performance without revealing their wallet: an [OutLayer](https://app.outlayer.ai) Intel TDX enclave computes the stats from Hyperliquid's public API and signs a card, and a NEAR contract records it. Anyone can verify the card in one click, and followers can buy viewing keys to the trader's (coarsened, delayed or live) trades.

Screenshots of PnL can be faked. Prove-It cards can't, and they don't give away the wallet.

> Built at NEAR HACKATHON (Nov 2026). The website opens on **NEAR testnet** by default. The registry and enclave run on **NEAR mainnet**, where the first real card, [#0](https://proveit-production-d47c.up.railway.app/c/0), is issued and verified (see [Status](#status)). A switch in the site header shows either network.

## Try it in 60 seconds, no wallet

Needs Node 22+ and pnpm.

```bash
git clone https://github.com/christian-obi/proveit && cd proveit
pnpm i
pnpm demo
```

`pnpm demo` verifies a real card on your machine from public data only (NEAR RPC and OutLayer's attestation API), then verifies a copy with its return edited to +90%. Expected:

```
✔ Enclave signature  signed by the enclave key b514754596df…, which the registry learned from the enclave itself
✔ On-chain record    card #3 is recorded on proveit-demo-registry.testnet …
✔ Enclave code       enclave build 653e74f1177e…: open source, rebuild it with enclave/build.sh and compare
✔ TEE attestation    Intel TDX attestation for OutLayer request 13345: this build, this project, this issuer, this exact output
! Freshness and privacy issued today; a demo card from a recorded public account …; 1 of ≥ 98
…
✘ Enclave signature  signature mismatch: these numbers are not what the enclave signed
✘ On-chain record    the registry holds a different card under #3: this one was edited
✘ TEE attestation    the TEE run produced different output than this card
== PASS: the real card verified; the edited copy was caught.
```

The amber check 5 is expected: the demo card is computed in the real TEE but from a recorded public account, not the issuer's own, and says so. Check any card with `pnpm verify <card link>`.

## Try it live

- **A card:** https://proveit-production-d47c.up.railway.app/demo/3: press **Verify**, then **Tamper mode** and change a number: three checks go red.
- **Explore** verified traders: https://proveit-production-d47c.up.railway.app/explore
- **Viewing key:** https://proveit-production-d47c.up.railway.app/demo/3/unlock (testnet, paid in test USDC)
- **For agents:** `https://proveit-production-d47c.up.railway.app/api/verify?card=3&registry=proveit-demo-registry.testnet&guard=1`

## How it works

```
 trader's browser                OutLayer TEE (Intel TDX)                 NEAR
 ───────────────                 ────────────────────────                 ────
 sign EIP-712 ownership ──┐
 encrypt it to the TEE ───┼──► registry.request_card ──► enclave `issue`:
 (address never leaves    │                              · verify ownership signature
  the browser in clear)   │                              · read Hyperliquid's public API
                          │                              · stats + rules (≥ 20 trades, window)
                          │                              · k-anonymity vs. the leaderboard
                          │                              · Merkle root over every order
                          │                              · sign with the registry-bound key ──► card recorded
 anyone ──── pnpm verify / Verify button: signature, record, code, attestation, freshness+privacy
 follower ── USDC (or any chain via 1Click) ──► grant ──► reveal / live feed, encrypted to the follower
```

1. **Ownership, not API keys.** Hyperliquid data is public by address. The trader proves control of the address with an EIP-712 signature from its key, bound to their NEAR account, a nonce and an expiry. The enclave verifies it.
2. **The address stays secret.** The browser encrypts the signed proof to the OutLayer keystore; only the enclave can decrypt it. The card holds a commitment (a MAC under an enclave-only key), so all cards from one account can be linked without revealing it.
3. **Stats in the TEE.** Time-weighted return (linked Modified Dietz), max drawdown, win rate, trades per order, profit factor: [docs/METHODOLOGY.md](docs/METHODOLOGY.md).
4. **Privacy guard.** The published return is rounded until at least 25 accounts on Hyperliquid's public leaderboard share it ("1 of ≥ K"), or the card is refused.
5. **Signed and recorded.** The card is signed by an ed25519 key OutLayer derives inside the TEE, bound to this enclave and to the registry contract; the registry checks the signature and records the card.
6. **Viewing keys.** The trader sets price, delay (0 = live, for copy trading), duration, seats and approval. Followers pay in USDC on NEAR (or from another chain through NEAR Intents 1Click). The enclave reveals coarsened records, Merkle-proven against the card, encrypted to the follower; the live feed is one hash chain per card.

### Where each part runs

| Part | Runs on | Sees the wallet address? |
|---|---|---|
| Enclave (`enclave/`, Rust → wasm32-wasip2) | OutLayer Intel TDX workers | yes, only inside the TEE |
| Registry contract (`contract/`, Rust, near-sdk) | NEAR | no |
| Web app and API routes (`web/`, Next.js) | Railway | no: tested in `web/e2e/no-leak.spec.ts` and `feed.spec.ts` |
| Verifier + CLI (`packages/verify/`, TypeScript) | your machine or browser | no |

## What is proven, and what is not

| Claim | Proven by |
|---|---|
| These stats were computed by open-source code with hash H | the registry's approved version + the attestation's `wasm_hash` + a reproducible build |
| …on a Hyperliquid account the issuer controls | EIP-712 ownership signature verified in the TEE, bound to the NEAR signer and a single-use nonce |
| …from Hyperliquid's own public API | the code + attestation (hosts are allowlisted in the manifest) |
| The card was not edited after issuance | enclave signature + on-chain `card_hash` + attestation output hash |
| The card can't be traced to the wallet through the leaderboard | k-anonymity guard: `k_anon ≥ k_min` on the card, checked by the verifier |
| Revealed trades are the full committed set | Merkle root in the signed card; revealed count = committed count |
| A key holder's live feed is complete and the same for everyone | per-card hash chain; every page continues from the head the follower kept; each answer has a TEE attestation |
| **Not proven:** the trader has no other accounts | cards from one account share a commitment and the profile lists them all; switching is visible, not prevented |
| **Trust assumptions** | Intel TDX, OutLayer's worker measurements and key derivation, Hyperliquid's API |

Details: [docs/TRUST_MODEL.md](docs/TRUST_MODEL.md) · [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) (with the security checklist) · every README claim mapped to its test: [docs/CLAIMS.md](docs/CLAIMS.md).

## Reproduce the enclave build

```bash
REGISTRY=proveit-demo-registry.testnet enclave/build.sh demo-fixture   # needs Docker
REGISTRY=proveit-registry.testnet      enclave/build.sh                 # the live build
```

Each prints a sha256; compare it with [enclave/expected-hashes.txt](enclave/expected-hashes.txt), with the registry's `get_versions`, and with the `wasm_hash` in any card's attestation. The registry's account is compiled in (only it may ask for cards), so each registry has its own hash. CI rebuilds every line on each push.

| Build | Registry | sha256 |
|---|---|---|
| live | `proveit-registry.testnet` | `8db6b1722e86c92a970720830f336b5150005ac8d9708498e7477684c0e0c375` |
| demo-fixture | `proveit-demo-registry.testnet` | `d0e03b6e0b5cbcc0297d46c64ebafab94dfbbf34befba7c2dc50c0215e71beef` |
| live (mainnet) | `proveit.near` | `7a2710dbcbf4219d3c94d4af89dbefaf0f9157e69718047bc274a8153f237b7b` |

## Deployments

| | Testnet (live now) | Mainnet |
|---|---|---|
| Registry | `proveit-registry.testnet` (live cards), `proveit-demo-registry.testnet` (demo cards) | `proveit.near` (card [#0](https://proveit-production-d47c.up.railway.app/c/0)) |
| OutLayer projects | `proveit-realist.testnet/enclave`, `proveit-realist.testnet/enclave-demo` | `realist1036.near/enclave` |
| Demo cards | [#3](https://proveit-production-d47c.up.railway.app/demo/3) (trader), [#4](https://proveit-production-d47c.up.railway.app/demo/4) (AI agent) | pending |
| Attestation (card #3) | https://testnet-api.outlayer.ai/attestations/by-request/13345 | |
| Web app | https://proveit-production-d47c.up.railway.app | |

## Issue your own card

Open https://proveit-production-d47c.up.railway.app/create with a NEAR testnet wallet (e.g. Meteor) and an EVM wallet holding the Hyperliquid account (MetaMask, Rabby). The account needs 20+ trades in the window and must have held capital for (almost) all of it. "Demo data" mode issues a card from a recorded public account without an EVM wallet.

## Tests

```bash
pnpm test                    # enclave + contract (Rust), verifier + web (TypeScript); needs Rust with wasm32-wasip2
pnpm --filter web e2e        # browser tests against testnet (Playwright)
scripts/p2-check.sh          # reproducible builds vs. expected-hashes.txt (Docker)
```

Per-phase exit tests and live evidence: [docs/PHASES.md](docs/PHASES.md). The plan: [BUILD_PLAN.md](BUILD_PLAN.md).

## NEAR protocols used

- **OutLayer** (NEAR's verifiable off-chain compute): Intel TDX execution with attestations, `signing-keys` (the card key), `encryption-keys` (the commitment MAC), encrypted secrets (the ownership proof), worker storage, on-chain `request_execution` with yield/resume, and the HTTPS API with payment keys (the feed).
- **A NEAR smart contract** (the registry): cards, versions, viewing-key offers, grants, payments, `verify_card` for other contracts.
- **NEP-141** USDC payments (`ft_transfer_call`), **NEP-413** signed messages (feed access), **NEAR Intents 1Click** (pay from other chains), **HOT near-connect** (wallets).

## Status

| Done (testnet, live) | Pending |
|---|---|
| issuance in the TEE, registry, verification + tamper mode, privacy guard, viewing keys with USDC, reveals, live feed over HTTPS, explore, profiles, agent guard, `/api/verify`, copy from a tab (simulated and signature-tested; no live order yet)  | a live 1Click payment from another chain (needs mainnet); a card from the team's own Hyperliquid account; the NEAR Intents venue (needs 1Click history access) |

## Roadmap

Confidential perps support is planned for after the hackathon. It isn't built. See [the roadmap](web/content/docs/roadmap.md).

## Repository

| Path | What |
|---|---|
| `enclave/` | the TEE module: ownership, Hyperliquid data, stats, rules, k-anonymity, Merkle, reveal, feed |
| `contract/` | the NEAR registry contract (and `mock-usdc/`, a testnet token) |
| `packages/verify/` | the verifier: five checks, reveal and feed checks, agent guard, CLIs |
| `web/` | the Next.js app on Railway |
| `scripts/` | deploy, live tests, leak check, demo |
| `test-vectors/` | shared vectors checked by both the Rust and the TypeScript code |
| `docs/` | phase results, methodology, trust and threat models, claims |
| `spikes/` | the P0 experiments that de-risked OutLayer and Hyperliquid |

## Disclosures

- No code was written before the hackathon started (1 Nov 2026).
- The code was written with AI assistance (Claude Code).
- Main libraries: near-sdk, serde, k256, ed25519-dalek, x25519-dalek, chacha20poly1305, rust_decimal (Rust); Next.js, React, viem, @noble/* crypto, @hot-labs/near-connect (TypeScript).
- Demo cards use a recorded public Hyperliquid account (`enclave/fixtures/winner`), computed in the real TEE and labelled as demo cards everywhere.

## License

MIT, see [LICENSE](LICENSE).
