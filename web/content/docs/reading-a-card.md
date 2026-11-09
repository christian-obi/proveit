---
description: "What each field and statistic on a card means."
---

# Reading a card

A card is JSON. This is the `card` object for demo card 3, shortened:

```json
{
  "v": 1,
  "kind": "trader",
  "mode": "fixture",
  "venue": "hyperliquid",
  "issuer": "proveit-realist.testnet",
  "commitment": "816454e5…",
  "window": { "days": 30, "start": 1791325080034, "end": 1793978799608, "samples": 46 },
  "orders": { "count": 91, "root": "3d82b6ae…" },
  "stats": {
    "return_bps": 1400,
    "return_precision_bps": 100,
    "k_anon": 98,
    "k_min": 25,
    "max_dd_bps": 6283,
    "win_rate_bps": 6190,
    "profit_factor_x100": 209,
    "trades": 42,
    "active_days": 16,
    "volume_band": "1e7",
    "flow_turnover_bps": 661
  }
}
```

A basis point (bps) is 0.01%.

| Field | Meaning |
|---|---|
| `kind` | `trader` or `agent`. This is the issuer's own label and is not proven |
| `mode` | `live` means the issuer's own account. `fixture` means a demo card from a recorded public account |
| `issuer` | The NEAR account that requested the card |
| `commitment` | An enclave-only MAC of the wallet. All cards from one wallet share it, without revealing the wallet |
| `orders` | Count of committed orders and their Merkle root |
| `stats.return_bps` | Lower edge of the return bucket. The example means +14% to +15% |
| `stats.return_precision_bps` | Bucket width |
| `stats.k_anon` | Number of leaderboard accounts in that bucket, shown as "1 of ≥ K" |
| `stats.k_min` | Smallest allowed `k_anon`, currently 25 |
| `stats.max_dd_bps` | Maximum drawdown |
| `stats.win_rate_bps` | Share of winning trades |
| `stats.profit_factor_x100` | Profit factor times 100, so 209 means 2.09 |
| `stats.trades` | Number of trades |
| `stats.active_days` | Distinct UTC days with at least one fill |
| `stats.volume_band` | Order of magnitude of traded volume. `1e7` means $10M to $99.9M |
| `stats.flow_turnover_bps` | Total deposits and withdrawals divided by average account value |

Return is time-weighted (linked Modified Dietz). The formulas are in `docs/METHODOLOGY.md` in the repository.
