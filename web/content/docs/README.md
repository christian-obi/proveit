---
description: "What Prove-It is and its current deployment status."
---

# Prove-It documentation

Prove-It gives a trader a verifiable record of their Hyperliquid performance without revealing their wallet. An OutLayer Intel TDX enclave computes the statistics from Hyperliquid's public API and signs a card. A NEAR contract records the card. Anyone can check it with public data only.

**Status (11 Nov 2026):** the registry and enclave run on NEAR mainnet (`proveit.near`), where card #0 is issued and verified. Testnet and the demo cards are still available through the switch in the site header. Live demo cards use a recorded public Hyperliquid account and are labelled as demo cards.
