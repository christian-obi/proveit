---
description: "Exactly what a card proves, and what it does not."
---

# What is proven and what isn't

| Claim | Proven by |
|---|---|
| Open-source code with a known hash computed these numbers | The registry's approved version, the attestation's `wasm_hash` and a reproducible build |
| The issuer controls the Hyperliquid account | An EIP-712 signature verified in the enclave |
| The data came from Hyperliquid's public API | The code, the attestation and the manifest's host allowlist |
| The card wasn't edited | The enclave signature, on-chain hash and attestation output hash |
| The return can't single out the wallet on the leaderboard | `k_anon ≥ k_min`, checked by the verifier |
| Revealed trades are the full committed set | The Merkle root in the signed card and the committed count |

**Not proven:**

- That the trader has no other accounts. A trader can choose which account to show. Cards from one account are linked, so switching is visible but not prevented.
- That a past record predicts future results.
- That `kind: "agent"` is really an AI agent. It is the issuer's label.

**You must trust:** Intel TDX, OutLayer's worker measurements and key derivation, and Hyperliquid's API.

Reaction counts and card pictures prove nothing. Reactions are anonymous clicks stored by the web app, and a picture is drawn from the card's public hash. Neither is part of the five checks.
