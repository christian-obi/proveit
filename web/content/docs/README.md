---
description: "What Prove-It is and its current deployment status."
---

# Prove-It documentation

Prove-It gives a trader a verifiable record of their Hyperliquid performance without revealing their wallet. An OutLayer Intel TDX enclave computes the statistics from Hyperliquid's public API and signs a card. A NEAR contract records the card. Anyone can check it with public data only.

**Status (9 Nov 2026):** the website runs on NEAR testnet and OutLayer testnet. The registry and enclave are deployed on NEAR mainnet (`proveit.near`), and the first mainnet card is pending. Live demo cards use a recorded public Hyperliquid account and are labelled as demo cards.
