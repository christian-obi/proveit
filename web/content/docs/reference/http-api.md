---
description: "The JSON endpoints for verifying cards and reading the live board."
---

# HTTP API

## `GET /api/verify`

Runs the five checks. It allows requests from any origin and may be cached for 30 seconds.

| Parameter | Required | Meaning |
|---|---|---|
| `card` | Yes | A card ID, or a card URL containing `/c/<id>` or `/demo/<id>` |
| `registry` | No | Registry account. Defaults to the live registry, or the demo registry for a `/demo/` URL |
| `guard` | No | `1` adds the agent guard's verdict |
| `min_trades` | No | Guard policy. Default 20 |
| `max_dd` | No | Largest allowed drawdown, in percent. Default 30 |
| `min_days` | No | Shortest allowed window, in days. Default 7 |
| `allow_demo` | No | `1` accepts demo cards. Refused by default |
| `allow_warnings` | No | `1` accepts warnings. Refused by default |

Response fields: `registry`, `card_id`, `ok`, `checks` (a list of `id`, `label`, `status`, `detail`), `card`, `attestation` (a URL), and with `guard=1`, `guard` (`policy`, `follow`, `reasons`).

| Status | Meaning |
|---|---|
| 200 | The card was found. Read `ok` and `checks` for the result |
| 400 | Bad `card` value or unknown registry |
| 404 | No such card on that registry |

A 200 status doesn't mean the card is valid. `ok` does.

## `GET /api/board`

The live board as JSON, the same data the Explore page polls. Open to any origin and built only from public registry data.

| Field | Meaning |
|---|---|
| `at` | Server time of this answer, in milliseconds |
| `network` | `testnet` or `mainnet` |
| `block` | Latest final NEAR block height, or `null` if the RPC didn't answer |
| `entries` | Verified cards, newest first, each with `registry`, `record`, `card`, `offer` and `stale`. Revoked, replaced and retired cards are left out |

Card lists are cached for about 20 seconds on the server.

`reactions` holds the anonymous reaction counts by `<registry>:<id>`.

## `/api/reactions`

Anonymous fire, Prove-It and NEAR reactions on a card.

- `GET /api/reactions?card=<registry>:<id>` returns `{ "counts": { "fire": 0, "proveit": 0, "near": 0 } }`.
- `POST /api/reactions` with `{ "card": "<registry>:<id>", "kind": "fire", "n": 1 }` adds up to 50 at once and returns the new counts. Clicks are rate limited per address, and addresses are not stored.

Reactions are a social signal. Anyone can click them, so they are not verified, and they never change a card's checks, its rank or the agent guard.
