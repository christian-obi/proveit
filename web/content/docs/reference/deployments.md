---
description: "Contract accounts, enclave projects and networks in use."
---

# Deployments

| Item | Testnet | Mainnet |
|---|---|---|
| Live registry | `proveit-registry.testnet` | `proveit.near` (card #0 issued) |
| Demo registry | `proveit-demo-registry.testnet` | None |
| OutLayer projects | `proveit-realist.testnet/enclave`, `proveit-realist.testnet/enclave-demo` | `realist1036.near/enclave` |

Enclave build hashes, which anyone can reproduce with `enclave/build.sh`:

| Build | Registry | sha256 |
|---|---|---|
| Live | `proveit-registry.testnet` | `3de3334ab0465bd5ea5b84656c554c827648761142bc0c3bfc0c6d2a118a7320` |
| Demo fixture | `proveit-demo-registry.testnet` | `c818c20a9240ba4e4b8aa2f448a2dbe3819ef1e8c88cd3570944338dc56ae251` |
| Live (mainnet) | `proveit.near` | `fc6ccb06aff25125395881885201051cc9cb8ca3f86a99147539744b7223995d` |

## Card addresses

| Address | Registry |
|---|---|
| `/c/<id>` | `proveit.near` (mainnet) |
| `/t/<id>` | `proveit-registry.testnet` |
| `/demo/<id>` | `proveit-demo-registry.testnet` |

The switch in the site header picks which network the board lists and where new cards are created. It never changes what a card address points to. On mainnet, the board lists mainnet cards only. Add `?network=mainnet` or `?network=testnet` to `/api/board` to choose one.
