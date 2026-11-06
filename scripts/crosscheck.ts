// T1.9: compare our 30-day return with Hyperliquid's own leaderboard ROI.
//
//   node scripts/crosscheck.ts <address> [<address> ...]
//
// The leaderboard's ROI is not time-weighted, so the two only have to agree when the
// account had no deposits or withdrawals in the window. Accounts with flows are listed
// with their flow size, and any difference is expected (docs/METHODOLOGY.md). The
// leaderboard is also a cached snapshot, so accounts whose snapshot PnL differs from
// the live portfolio are not compared either.

import { portfolio } from "./lib/hl.ts";
import { linkedReturn } from "./reference-stats.ts";

const TOLERANCE_PP = 1;
const LOW_FLOW = 0.02; // total |flows| under 2% of average capital counts as "no flows"
const SYNC_TOLERANCE = 0.01; // leaderboard PnL within 1% of live PnL: same window

const addresses = process.argv.slice(2).map((a) => a.toLowerCase());
if (addresses.length === 0) throw new Error("usage: node scripts/crosscheck.ts <address> ...");

const [board, ...portfolios] = await Promise.all([
  fetch("https://stats-data.hyperliquid.xyz/Mainnet/leaderboard", { headers: { "User-Agent": "proveit-scripts" } }).then((r) => r.json()),
  ...addresses.map((a) => portfolio(a)),
]);
const rows = new Map<string, any>(board.leaderboardRows.map((r: any) => [r.ethAddress.toLowerCase(), r]));

let failed = false;
let compared = 0;
addresses.forEach((address, i) => {
  const month = new Map(portfolios[i]).get("month")!;
  const r = linkedReturn(month);
  const row = rows.get(address);
  if (!r || !row) {
    console.log(`${address}  skipped (${!r ? "never funded" : "not on the leaderboard"})`);
    return;
  }
  const av = month.accountValueHistory.map(([, v]) => Number(v));
  const pnl = month.pnlHistory.map(([, v]) => Number(v));
  let flows = 0;
  for (let k = 1; k < av.length; k++) flows += Math.abs(av[k] - av[k - 1] - (pnl[k] - pnl[k - 1]));
  const avgCapital = av.reduce((a, b) => a + b, 0) / av.length;
  const flowShare = avgCapital > 0 ? flows / avgCapital : Infinity;

  const lbMonth = new Map<string, any>(row.windowPerformances).get("month");
  const ours = r.twr * 100;
  const theirs = Number(lbMonth.roi) * 100;
  const diff = Math.abs(ours - theirs);
  // The leaderboard is a cached snapshot. Compare only when it describes the same
  // window as the live portfolio, i.e. its PnL matches ours.
  const ourPnl = pnl[pnl.length - 1] - pnl[0];
  const inSync = Math.abs(Number(lbMonth.pnl) - ourPnl) <= Math.max(1, Math.abs(ourPnl) * SYNC_TOLERANCE);
  const lowFlow = flowShare < LOW_FLOW;
  const comparable = inSync && lowFlow;
  const verdict = comparable
    ? diff <= TOLERANCE_PP ? "PASS" : "FAIL"
    : !inSync ? "n/a (leaderboard snapshot is for a different window)" : "n/a (flows; not comparable)";
  if (comparable && diff > TOLERANCE_PP) failed = true;
  if (comparable) compared++;
  console.log(
    `${address}  ours ${ours.toFixed(2)}%  leaderboard ${theirs.toFixed(2)}%  diff ${diff.toFixed(2)}pp  flows ${(flowShare * 100).toFixed(1)}% of capital  ${verdict}`,
  );
});
console.log(`${compared} comparable account(s)`);
if (compared === 0) console.log("nothing comparable: add accounts with no flows whose leaderboard snapshot is current");
process.exitCode = failed || compared === 0 ? 1 : 0;
