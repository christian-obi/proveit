# How Prove-It computes a card

Every number on a card comes from Hyperliquid's public info API, computed by the open-source code in `enclave/src/` inside an Intel TDX enclave. This page is the specification. Two independent implementations follow it: the enclave (Rust, exact decimals) and `scripts/reference-stats.ts` (TypeScript, floating point). The enclave's golden tests require both to produce the same integers.

## Data
| Input | Endpoint | Used for |
|---|---|---|
| Account value and cumulative PnL histories | `portfolio`, windows `month` (30 days) and `allTime` (90/180 days, account age) | return, drawdown, measured window, flow turnover |
| Fills | `userFillsByTime`, paginated | trades, win rate, profit factor, volume, active days |

**Whole account, not perps only.** Returns use the total account series (spot + perps). Perp-only value is unusable for accounts that keep collateral in spot: it moves on internal spot↔perp transfers and can sit at zero while the account trades. In testing, perp-only series gave returns of −82% and +4,748% for accounts whose real return was in single digits.

**Pagination.** Fills come oldest first, at most 2,000 per request, and `startTime` is inclusive. Many fills can share one millisecond, so each page starts at the previous page's last timestamp and duplicates are removed by trade ID (`tid`). Starting one millisecond later would silently drop fills. Hyperliquid serves only the 10,000 most recent fills, so a window with more is refused (`FILL_CAP_EXCEEDED`) rather than counted partially.

## Return: time-weighted, linked Modified Dietz
For each pair of consecutive samples:

```
flow_i = (AV_i − AV_{i−1}) − (PnL_i − PnL_{i−1})    money in or out, not earned
base_i = AV_{i−1} + flow_i / 2                       capital, assuming the flow landed mid-period
r_i    = (PnL_i − PnL_{i−1}) / base_i
TWR    = Π (1 + r_i) − 1
```

- Measurement starts at the first sample with at least **$10** of account value.
- A period whose base is under $10 is skipped: a return on dust is meaningless and easy to game.
- Deposits and withdrawals do not count as return. A property test checks this on thousands of random accounts.

**Why not Hyperliquid's leaderboard ROI?** The leaderboard reports `PnL ÷ starting account value`, a dollar-weighted number. It can be inflated by depositing heavily before a lucky trade, and it changes when money moves in or out. Time-weighted return measures the trader's decisions independent of when capital arrived, which is the standard for comparing managers. The two agree when an account has no flows: on accounts with no deposits or withdrawals and a current leaderboard snapshot, they matched within 0.12 and 0.00 percentage points (`scripts/crosscheck.ts`, 6 Nov 2026).

They can disagree a lot, even in sign, when flows are large. One test account lost 8.4% time-weighted while gaining $1,323, because it lost percentage on a small balance and made dollars on a much larger one. So every card also shows **flow turnover**.

## Other statistics
| Field | Definition |
|---|---|
| `max_dd_bps` | Largest peak-to-trough fall of the linked index `Π(1 + r_i)`, from 0 to 10,000 bps |
| `flow_turnover_bps` | Σ \|flow_i\| ÷ average account value over the measured window |
| `trades` | Orders (`oid`) with at least one fill that realized PnL (or is a `Close …` fill). A large order filled in 100 pieces is **one** trade, so a trader can't inflate the count by splitting orders. |
| `win_rate_bps` | Share of trades whose net is above zero. Net = Σ realized PnL − Σ USDC fees of the trade's fills; a break-even close that paid fees is a loss. Fees in other tokens are left out rather than converted with a guessed price. |
| `profit_factor_x100` | Σ winning nets ÷ \|Σ losing nets\| × 100; `null` when there were no losing trades |
| `volume_band` | Order of magnitude of Σ \|price × size\| over all fills, as `1e6` for $1M–$9.99M. Never exact, to protect privacy. |
| `active_days` | Distinct UTC days with at least one fill |

All numbers are integers: basis points (1 bp = 0.01%) or ×100, rounded half away from zero. The signed card never depends on float formatting.

## Windows
| Card | Series | Notes |
|---|---|---|
| 30 days | `month` | about 45–50 samples |
| 90 / 180 days | `allTime`, last N days | sparser sampling; the card shows the sample count |

## Rules: a card is refused, not issued with a warning
| Code | Rule |
|---|---|
| `ACCOUNT_TOO_NEW` | The account first held $10 after the start of the requested window (from the `allTime` history). |
| `WINDOW_TOO_SHORT` | The account held capital for fewer than N − 1 days of an N-day window, for example after being emptied and refilled. |
| `TOO_FEW_TRADES` | Fewer than 20 trades in the measured window. |
| `FILL_CAP_EXCEEDED` | More than 10,000 fills in the window. |

Return, maximum drawdown and trade count are always published together, so a trader can't show a return and hide the drawdown.

## Ownership
The trader signs an EIP-712 message with the Hyperliquid account's key. Domain `{name: "Prove-It", version: "1"}`; message `ProveIt(string statement, address account, string nearAccount, uint64 nonce, uint64 expiry)`, where the statement says the signature cannot move funds or place trades. The enclave checks that it recovers to the account, that `nearAccount` is the NEAR account issuing the card, that it hasn't expired, and that it expires within 24 hours. High-s signatures are rejected so a signature can't be mutated into a second valid one. The domain has no chain ID because the signature is only ever checked by the enclave, never by an EVM contract, and that saves the trader a network switch in their wallet.

## Publishing: the privacy guard (k-anonymity)
Hyperliquid publishes a leaderboard of about 48,000 accounts with each one's ROI for the day, week, month and all time. An exact return on a card could be looked up there to find the wallet. So before signing, the enclave fetches that leaderboard and counts the accounts whose ROI for the matching window (1 day → day, 7 → week, 30 → month, longer → all time) falls in the card's return bucket. It widens the bucket, 0.1% → 1% → 5% → 25% → 100%, until at least `k_min` = 25 accounts share it, and refuses the card (`PRIVACY_RISK`) if even 100% isn't enough. The card then carries `return_bps` (the bucket's lower edge), `return_precision_bps` (its width) and `k_anon` (how many accounts share it): "1 of ≥ K accounts". Hyperliquid's ROI and this time-weighted return are computed differently; the bucket is what an observer could match, so it is what's tested. Drawdown, win rate and trade count aren't on the leaderboard and stay exact.

## Order records: what viewing keys reveal
Every order in the window becomes one record: the hour of its first fill, the coin, the direction ("Open Long", "Close Short", …), its size as a share of account value at the time, its realized PnL net of fees as a share of account value, and its number of fills. No prices, dollar sizes, millisecond times, hashes, order or trade IDs: an exact record could be matched to Hyperliquid's public fills and reveal the wallet to the buyer. The card commits to all records with a Merkle root over **salted** leaves (`sha256(0x00 ‖ salt_i ‖ record)`, salts a backward hash chain from an enclave secret), so a reveal of the oldest k orders can be checked against the card without exposing anything about the hidden ones. A viewing key shows the records whose last fill is at least the key's delay old (delay 0 = live); the feed adds the orders after the card's window as they settle, in one hash chain per card that every follower sees.

## Known limits
- Hyperliquid samples account value every 2–26 hours, so drawdowns between samples are not seen. The true drawdown can only be larger than the reported one.
- Modified Dietz assumes each flow lands mid-period. With large flows and sparse samples it is an approximation; flow turnover tells the reader when that matters.
- Unrealized PnL on open positions is included in account value (and so in return), as Hyperliquid marks it.
- A trader with several accounts can issue cards from the best one only. Each account's cards share a commitment, and the profile page lists every card an issuer made, but nothing proves an account is a person's only one.
- k-anonymity is measured against the leaderboard at issuance. An observer with other side information (when you deposited, the coins you trade) can narrow the set further; the guard removes the cheapest lookup, not every one.
