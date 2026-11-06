// Independent reference implementation of the card statistics.
//
//   node scripts/reference-stats.ts enclave/fixtures/<name> [--write]
//
// Written separately from enclave/src/stats.rs from the same spec (docs/METHODOLOGY.md),
// in floating point instead of decimals. The golden files the Rust tests compare
// against come from HERE, so a bug has to be made twice, identically, to pass.
// --write saves the result as <dir>/expected_stats.json.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Fill, Series } from "./lib/hl.ts";

const MIN_CAPITAL = 100;
const MIN_TRADES = 20;
const DAY = 86_400_000;

export type Expected =
  | { status: "ok"; window: { days: number; start: number; end: number; samples: number }; stats: Record<string, unknown> }
  | { status: "err"; code: string };

const bps = (x: number) => roundHalfAway(x * 10_000);
const x100 = (x: number) => roundHalfAway(x * 100);
function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

export function linkedReturn(s: Series) {
  const av = s.accountValueHistory.map(([, v]) => Number(v));
  const pnl = s.pnlHistory.map(([, v]) => Number(v));
  const ts = s.accountValueHistory.map(([t]) => t);
  const first = av.findIndex((v) => v >= MIN_CAPITAL);
  if (first < 0) return null;
  let index = 1, peak = 1, maxDd = 0, flows = 0;
  for (let i = first + 1; i < av.length; i++) {
    const dPnl = pnl[i] - pnl[i - 1];
    const flow = av[i] - av[i - 1] - dPnl;
    flows += Math.abs(flow);
    const base = av[i - 1] + flow / 2;
    if (base < MIN_CAPITAL) continue;
    index = Math.max(0, index * (1 + dPnl / base));
    peak = Math.max(peak, index);
    maxDd = Math.max(maxDd, (peak - index) / peak);
  }
  const measured = av.slice(first);
  const avgCapital = measured.reduce((a, b) => a + b, 0) / measured.length;
  return { start: ts[first], end: ts[ts.length - 1], samples: av.length - first, twr: index - 1, maxDd, flowTurnover: avgCapital > 0 ? flows / avgCapital : 0 };
}

export function tradeStats(fills: Fill[]) {
  const nets = new Map<number, number>();
  let volume = 0;
  const days = new Set<number>();
  for (const f of fills) {
    volume += Math.abs(Number(f.px) * Number(f.sz));
    days.add(Math.floor(f.time / DAY));
    if (Number(f.closedPnl) !== 0 || f.dir.startsWith("Close")) {
      const fee = f.feeToken === "USDC" ? Number(f.fee) : 0;
      nets.set(f.oid, (nets.get(f.oid) ?? 0) + Number(f.closedPnl) - fee);
    }
  }
  const values = [...nets.values()];
  const gains = values.filter((n) => n > 0).reduce((a, b) => a + b, 0);
  const losses = values.filter((n) => n < 0).reduce((a, b) => a - b, 0);
  return {
    trades: values.length,
    wins: values.filter((n) => n > 0).length,
    profitFactor: losses === 0 ? null : gains / losses,
    volume,
    activeDays: days.size,
  };
}

export function expected(dir: string, windowDays = 30): Expected {
  const pf = new Map<string, Series>(JSON.parse(readFileSync(join(dir, "portfolio.json"), "utf8")));
  const allFills: Fill[] = JSON.parse(readFileSync(join(dir, "fills.json"), "utf8"));
  const month = pf.get("month")!;
  const allTime = pf.get("allTime")!;

  const end = month.accountValueHistory[month.accountValueHistory.length - 1][0];
  const requestedStart = end - windowDays * DAY;
  const funded = allTime.accountValueHistory.find(([, v]) => Number(v) >= MIN_CAPITAL);
  if (!funded) return { status: "err", code: "NO_DATA" };
  if (funded[0] > requestedStart) return { status: "err", code: "ACCOUNT_TOO_NEW" };

  const r = linkedReturn(month);
  if (!r) return { status: "err", code: "WINDOW_TOO_SHORT" };
  if (Math.floor((r.end - r.start) / DAY) < windowDays - 1) return { status: "err", code: "WINDOW_TOO_SHORT" };

  const fills = allFills.filter((f) => f.time >= r.start && f.time <= r.end);
  const t = tradeStats(fills);
  if (t.trades < MIN_TRADES) return { status: "err", code: "TOO_FEW_TRADES" };

  return {
    status: "ok",
    window: { days: windowDays, start: r.start, end: r.end, samples: r.samples },
    stats: {
      return_bps: bps(r.twr),
      max_dd_bps: bps(r.maxDd),
      win_rate_bps: bps(t.wins / t.trades),
      trades: t.trades,
      profit_factor_x100: t.profitFactor === null ? null : x100(t.profitFactor),
      volume_band: `1e${Math.floor(Math.log10(Math.max(t.volume, 1)))}`,
      active_days: t.activeDays,
      flow_turnover_bps: bps(r.flowTurnover),
    },
  };
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node scripts/reference-stats.ts <fixture dir> [--write]");
  const result = expected(dir);
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--write")) writeFileSync(join(dir, "expected_stats.json"), JSON.stringify(result, null, 2) + "\n");
}
