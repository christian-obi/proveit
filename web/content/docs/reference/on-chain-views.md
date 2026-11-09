---
description: "Reading cards directly from the NEAR registry contract."
---

# On-chain views

Other contracts and clients can read the registry directly. The main view methods are:

| Method | Returns |
|---|---|
| `verify_card(card_id, card_json?)` | Verification result, for gating another contract on a card |
| `get_card(card_id)` | A card record |
| `get_card_by_hash(card_hash)` | A card record |
| `get_cards_by_issuer(issuer, from?, limit?)` | An issuer's cards |
| `get_cards_by_commitment(commitment, from?, limit?)` | All cards from one wallet |
| `get_versions()` | Approved enclave builds |
| `get_offer(card_id)` | The card's viewing-key offer |
| `get_grant(card_id, buyer)` | A buyer's viewing key |

```bash
near contract call-function as-read-only proveit-demo-registry.testnet verify_card json-args '{"card_id":3}' network-config testnet now
```
