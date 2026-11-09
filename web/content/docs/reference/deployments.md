---
description: "Contract accounts, enclave projects and networks in use."
---

# Deployments

| Item | Testnet | Mainnet |
|---|---|---|
| Live registry | `proveit-registry.testnet` | `proveit.near` (deployed; no cards yet) |
| Demo registry | `proveit-demo-registry.testnet` | None |
| OutLayer projects | `proveit-realist.testnet/enclave`, `proveit-realist.testnet/enclave-demo` | `realist1036.near/enclave` |

Enclave build hashes, which anyone can reproduce with `enclave/build.sh`:

| Build | Registry | sha256 |
|---|---|---|
| Live | `proveit-registry.testnet` | `8db6b1722e86c92a970720830f336b5150005ac8d9708498e7477684c0e0c375` |
| Demo fixture | `proveit-demo-registry.testnet` | `d0e03b6e0b5cbcc0297d46c64ebafab94dfbbf34befba7c2dc50c0215e71beef` |
| Live (mainnet) | `proveit.near` | `7a2710dbcbf4219d3c94d4af89dbefaf0f9157e69718047bc274a8153f237b7b` |

## Card addresses

| Address | Registry |
|---|---|
| `/c/<id>` | `proveit.near` (mainnet) |
| `/t/<id>` | `proveit-registry.testnet` |
| `/demo/<id>` | `proveit-demo-registry.testnet` |

The switch in the site header picks which network the board lists and where new cards are created. It never changes what a card address points to. On mainnet, the board lists mainnet cards only. Add `?network=mainnet` or `?network=testnet` to `/api/board` to choose one.
