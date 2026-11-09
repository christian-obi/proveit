---
description: "Planned work after the hackathon, including NEAR confidential perps."
---

# Roadmap

None of this is built. It is planned for after the hackathon.

## Confidential perps

NEAR's confidential perps give each user a dedicated Hyperliquid account, so their deposits and identity stay private. Those traders are the ones who most need a way to prove a record without exposing themselves.

Reading their performance needs no new data source, because the dedicated account is a Hyperliquid account. What's missing is proof that it belongs to the trader. There are two candidate routes:

| Route | How it would work | Open question |
|---|---|---|
| Chain Signatures | If the dedicated address is derived from the user's NEAR account, the enclave can check that derivation | Whether near.com derives addresses this way. `spikes/s6-chainsig-match` tests it |
| Order challenge | The enclave picks an exact order size, the trader places it, and the enclave finds it in the account's fills | How much it costs the trader, and how to keep the challenge private |

Either route changes the enclave, so it would ship as a new build that the registry approves.

## Other planned work

- **Copying without an open tab**, which needs a safe way to run agent keys unattended.
- **NEAR Intents as a venue**, which needs access to 1Click account history.
- **Automatic reconciliation** of a follower's positions after a missed trade.
