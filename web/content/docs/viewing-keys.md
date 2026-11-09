---
description: "How followers buy viewing keys, reveal trades and follow the feed."
---

# Viewing keys and the live feed

A trader can sell followers access to their trades. The trader sets the price, delay (0 means live, for copy trading), duration, number of seats (1 to 1000) and whether each buyer needs approval.

- **Payment.** Followers pay in USDC on NEAR. Wrong tokens and underpayments are refunded. The default platform fee is 1%.
- **Reveals.** The enclave sends coarsened records: hour, coin, side and percentage sizes. They contain no prices, IDs, transaction hashes or exact times.
- **Completeness.** Each revealed record is proven against the card's Merkle root, so none can be edited, dropped, reordered or added.
- **Delay.** An order is shown only once its last fill is older than the delay.
- **Encryption.** Answers are encrypted to the follower inside the enclave, so the relay can't read them.
- **Live feed.** Each card has one hash chain. A follower keeps the latest head and checks that each page continues from it, which exposes dropped or rewritten trades. New orders join after a 2-minute settling period.
- **Access.** Feed requests carry a NEP-413 signature. The enclave checks the signature, the full-access key and a live grant before reading any data.
- **Copying.** A key holder can [copy new trades from a browser tab](copy-from-tab.md).
