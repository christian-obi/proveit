---
description: "Why a card request can be refused, and what each code means."
---

# Errors

| Code | Meaning |
|---|---|
| `TOO_FEW_TRADES` | The account has fewer than 20 trades in the window. No card is issued and the storage fee is refunded |
| `PRIVACY_RISK` | The return can't be rounded into a group of at least 25 accounts |
| `CARD_NOT_FOUND` | The enclave has no stored data for this card |
| `BAD_INPUT` | The request is malformed |
| `SIG_INVALID` | The ownership signature doesn't verify |
| `SIG_EXPIRED` | The ownership signature has expired |
| `WINDOW_TOO_SHORT` | The account didn't hold capital for almost all of the window |
| `ACCOUNT_TOO_NEW` | The account was first funded after the window began |
| `FILL_CAP_EXCEEDED` | The account has more fills than the enclave can process |
| `NO_DATA` | Hyperliquid has no data for the account |
| `UPSTREAM` | A call to an outside service failed. Try again |
| `NO_GRANT` | The follower has no live viewing key |
| `NEAR_ACCOUNT_MISMATCH` | The request's signature doesn't match the claimed NEAR account |
