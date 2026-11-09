---
description: "How a follower copies a verified trader's new trades from an open browser tab."
---

# Copy from a tab

A viewing-key holder can copy a trader's new trades on Hyperliquid. Each trade is sized to the follower's own account and sent straight from the browser. Copying stops when the tab closes.

## Where orders can go

| Destination | What happens | Needs |
|---|---|---|
| Simulate | Uses real prices and a pretend balance. No order is sent | Nothing |
| Hyperliquid testnet | Real signed orders with play money | An EVM wallet |
| Real money | Real orders on Hyperliquid mainnet. Only on live cards, after an explicit confirmation | An EVM wallet funded on Hyperliquid |

## How it works

1. The follower opens the card's feed with their viewing key.
2. They set their limits and sign one approval in their EVM wallet. This creates a new trading key.
3. They press **Start auto-copy**, or press **Copy** on a single trade.
4. Each new trade is decrypted in the browser and turned into an order. The order goes directly to Hyperliquid.

Auto-copy only takes trades that arrive while it is on. Trades already in the feed are never replayed automatically.

## The trading key

- It is created in the browser and exists only in that tab's memory. Closing the tab discards it.
- It is a Hyperliquid agent wallet, which can place trades but can't withdraw funds.
- Its approval expires after 30 days. The key itself is lost as soon as the tab closes.
- A new key is created each time, because Hyperliquid warns against reusing agent addresses.

This app's server never receives the follower's address, balance or trading key.

## Sizing

The feed reports each trade as a share of the trader's account. The copy is:

`your account value × the trade's share × your Size %`

The follower's limits always win over the trader's size.

| Setting | Default | Effect |
|---|---|---|
| Size % | 100 | Scales every copy |
| Max per trade | $25 | Largest new position from one trade |
| Max slippage | 0.5% | Worst price accepted, measured from the current mid price |
| Max leverage | 3x | Total exposure allowed relative to account value |

## Rules

- Orders are immediate-or-cancel limit orders, so nothing is left resting. An order can fill only partly.
- A copy under Hyperliquid's $10 minimum is skipped, never rounded up.
- Closing orders are reduce-only and need a matching position. If a partial close would leave less than $10, the whole position is closed.
- Flips, spot trades and markets outside Hyperliquid's main perp list are skipped.
- Each trade gets a fixed client order ID and is remembered in the browser, so retries and second tabs don't double it.
- Auto-copy stops after three failures in a row. Stopping doesn't close open positions.

## Limits

- Copies always arrive after the original. Trades settle for 2 minutes, the feed is checked every 30 seconds, and the key's delay is added on top, so the price can be different.
- The feed has no prices, so a copy can't be compared with the trader's entry.
- Copying replays orders. If a trade is missed, for example when the tab was closed, the positions drift apart.
- Many followers placing the same trade soon after a trader could help someone work out which wallet is being copied.
- A verified record shows past results only. Copying can lose money.
