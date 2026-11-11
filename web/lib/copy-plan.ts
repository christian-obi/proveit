// Decides what one copied trade should be. Pure, so every rule is unit tested. The follower's
// limits always win over the trader's size, and when in doubt the answer is to skip.

import { roundSize, type Follower, type Market } from "./hyperliquid";

export const MIN_ORDER_USD = 10;

export type CopySettings = { multiplierPct: number; maxUsd: number; slippagePct: number; maxLeverage: number };
export const DEFAULT_SETTINGS: CopySettings = { multiplierPct: 100, maxUsd: 25, slippagePct: 0.5, maxLeverage: 3 };

export type CopyRecord = { coin: string; dir: string; size_bps: number; hour?: number };

export type Plan =
  | { kind: "skip"; reason: string }
  | { kind: "order"; side: "Buy" | "Sell"; isBuy: boolean; reduceOnly: boolean; size: number; limit: number; notional: number };

const DIRECTIONS: Record<string, { isBuy: boolean; close: boolean; holds?: 1 | -1 }> = {
  "Open Long": { isBuy: true, close: false },
  "Open Short": { isBuy: false, close: false },
  "Close Long": { isBuy: false, close: true, holds: 1 },
  "Close Short": { isBuy: true, close: true, holds: -1 },
};

const skip = (reason: string): Plan => ({ kind: "skip", reason });

export function planCopy(record: CopyRecord, follower: Follower, market: Market | null, settings: CopySettings): Plan {
  const direction = DIRECTIONS[record.dir];
  if (!direction) return skip(`${record.dir} trades aren't copied`);
  if (!market) return skip(`${record.coin} isn't available on this market`);
  const { isBuy, close, holds } = direction;
  const slip = settings.slippagePct / 100;
  const limit = market.mid * (isBuy ? 1 + slip : 1 - slip);
  const side = isBuy ? "Buy" : "Sell";
  const scaled = (follower.equity * record.size_bps * settings.multiplierPct) / 1e6;

  if (close) {
    const held = follower.positions[record.coin] ?? 0;
    if (held === 0 || Math.sign(held) !== holds) return skip(`you have no ${holds === 1 ? "long" : "short"} ${record.coin} position to close`);
    const whole = Math.abs(held);
    const wanted = roundSize(scaled / market.mid, market.szDecimals);
    // A leftover too small to sell later would be stuck, so close it all instead.
    const all = wanted >= whole || wanted * market.mid < MIN_ORDER_USD || (whole - wanted) * market.mid < MIN_ORDER_USD;
    const size = all ? whole : wanted;
    return { kind: "order", side, isBuy, reduceOnly: true, size, limit, notional: size * market.mid };
  }

  if (follower.equity <= 0) return skip("your account has no balance");
  const room = follower.equity * settings.maxLeverage - follower.exposure;
  const capped = Math.min(scaled, settings.maxUsd, room);
  const size = roundSize(capped / market.mid, market.szDecimals);
  const notional = size * market.mid;
  if (notional < MIN_ORDER_USD) {
    if (room < MIN_ORDER_USD) return skip(`your ${settings.maxLeverage}x leverage limit is used up`);
    return skip(`your copy would be $${capped.toFixed(2)}, under Hyperliquid's $${MIN_ORDER_USD} minimum`);
  }
  return { kind: "order", side, isBuy, reduceOnly: false, size, limit, notional };
}
