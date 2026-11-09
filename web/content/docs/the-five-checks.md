---
description: "The five checks that decide whether a card verifies."
---

# The five checks

Every verifier (web panel, command line and API) uses the same code and runs these checks:

| `id` | Label | What it establishes |
|---|---|---|
| `signature` | Enclave signature | The numbers are what the registry-bound enclave key signed |
| `record` | On-chain record | The registry holds this exact card |
| `code` | Enclave code | The card names a build the registry approved, which anyone can rebuild |
| `attestation` | TEE attestation | Intel TDX attests this build, project, issuer and exact output |
| `freshness` | Freshness and privacy | The card's age and demo status, and that `k_anon ≥ k_min` |

Each check returns `pass`, `warn` or `fail`. A demo card always shows `warn` on `freshness`, which is expected.
