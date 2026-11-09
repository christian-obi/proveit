---
description: "The steps from a trader's signature to a signed card on NEAR."
---

# How a card is made

1. **The trader proves ownership.** They sign an EIP-712 message from the Hyperliquid account's key. It is bound to their NEAR account, a single-use nonce and an expiry. No API key is involved.
2. **The browser encrypts the proof.** The proof is encrypted to the OutLayer keystore, so only the enclave can read the address.
3. **The registry requests the card.** `request_card` on the NEAR contract triggers the enclave. Only the registry compiled into the build can do this.
4. **The enclave computes.** It verifies the signature, reads Hyperliquid's public API, computes the statistics and applies the rules. The account needs at least 20 trades in the window.
5. **The privacy guard runs.** The published return is rounded until at least 25 accounts on Hyperliquid's public leaderboard share it. If that can't be reached, no card is issued.
6. **The enclave commits and signs.** It builds a Merkle root over every order and signs the card with a key bound to this enclave and registry.
7. **The registry records it.** The contract checks the signature and stores the card.
