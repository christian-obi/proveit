// Record real Hyperliquid data for the enclave's golden tests.
//
//   node scripts/record-fixtures.ts
//
// Writes enclave/fixtures/<name>/{portfolio.json, fills.json, meta.json}. The accounts
// are public leaderboard accounts, chosen so each fixture tests something different.
// Re-recording changes the data, so re-run scripts/reference-stats.ts afterwards.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fillsBetween, portfolio } from "./lib/hl.ts";

const FIXTURES: { name: string; address: string; why: string }[] = [
  { name: "winner", address: "0xe986b8e58b5870dca58700c23b5303f20f6823a7", why: "passes every rule; fills span two API pages; some flows exercise Modified Dietz" },
  { name: "loser", address: "0xed01eec66dbbbd05fd43f2b340614dc7b62786ce", why: "passes every rule with a negative return: exercises rounding below zero" },
  { name: "few_orders", address: "0xee16198171b3cf5c96af82e538d489f78935fb67", why: "739 fills but only 6 orders that realized PnL: must be TOO_FEW_TRADES (trades are counted per order)" },
  { name: "late_funded", address: "0x0d807461709d1dc2005cfa7dc15716dcf30be423", why: "empty for the first half of the window: must be WINDOW_TOO_SHORT" },
  { name: "hlp_vault", address: "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303", why: "a vault with no fills of its own: must be TOO_FEW_TRADES" },
];

const root = join(import.meta.dirname, "..", "enclave", "fixtures");

for (const fx of FIXTURES) {
  const pf = await portfolio(fx.address);
  const month = new Map(pf).get("month");
  if (!month) throw new Error(`${fx.name}: no month window`);
  const start = month.accountValueHistory[0][0];
  const end = month.accountValueHistory[month.accountValueHistory.length - 1][0];
  const fills = await fillsBetween(fx.address, start, end);

  const dir = join(root, fx.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "portfolio.json"), JSON.stringify(pf));
  writeFileSync(join(dir, "fills.json"), JSON.stringify(fills));
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ address: fx.address, why: fx.why, recorded_at: new Date().toISOString(), month_start: start, month_end: end, fills: fills.length }, null, 2) + "\n",
  );
  console.log(`${fx.name.padEnd(12)} ${fx.address}  fills=${fills.length}`);
}
