---
description: "How a follower copies a verified trader's new trades from an open browser tab."
---

# Copy from a tab

A viewing-key holder can copy a trader's new trades on Hyperliquid. Each trade is sized to the follower's own account and sent straight from the browser. Copying runs while the page is open, and carries on after a reload.

## Where orders can go

| Destination | What happens | Needs |
|---|---|---|
| Simulate | Uses real prices and a pretend balance. No order is sent | Nothing |
| Hyperliquid testnet | Real signed orders with play money | An EVM wallet |
| Real money | Real orders on Hyperliquid mainnet. Only on live cards, after an explicit confirmation | An EVM wallet funded on Hyperliquid |

## How it works

1. On a card page, the follower presses **Copy this trader** and buys a viewing key.
2. On the live feed page, they connect and follow. One signed message lasts 12 hours.
3. In the **Copy this trader** panel, they pick where to copy, set their limits, and sign one approval in their EVM wallet. This creates a trading key.
4. They press **Start auto-copy**, or press **Copy** on a single trade.
5. Each new trade is decrypted in the browser and turned into an order. The order goes directly to Hyperliquid.

Auto-copy takes every trade that arrives after it is switched on, once, as long as the trade is under an hour old. Trades already in the feed when it was switched on are never copied automatically.

## Staying connected

Connect a NEAR wallet once, in the header. Every page uses that connection, and it comes back after a reload. The feed's signed message, the copy settings and auto-copy are kept in the browser too, so a reload carries on where it was.

## Your P&L

The panel shows the follower's own P&L from copying: closed P&L and fees of the orders it placed, plus open P&L on those coins. It reads these from Hyperliquid in the browser. In simulation it keeps a pretend book at real prices.

## The trading key

- It is created in the browser. By default it is kept in that browser's storage so copying survives a reload; untick **Keep the trading key in this browser** on a shared computer.
- It is a Hyperliquid agent wallet, which can place trades but can't withdraw funds.
- Its approval expires after 30 days.
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

- Copies always arrive after the original. Trades settle for 30 seconds, the feed is checked every 10 seconds while auto-copy is on (30 seconds otherwise), and the key's delay is added on top, so the price can be different. Each check is a small paid OutLayer run on the site's key.
- The feed has no prices, so a copy can't be compared with the trader's entry.
- Copying replays orders. A trade older than an hour when the page reopens is skipped, so the positions can drift apart.
- Browsers slow down timers in background tabs, so keep the page open in a visible tab for the fastest copies.
- Many followers placing the same trade soon after a trader could help someone work out which wallet is being copied.
- A verified record shows past results only. Copying can lose money.
