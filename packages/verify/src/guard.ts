// The agent guard: what an AI trading agent (or a copy-trading contract's keeper) runs
// before following or allocating to a trader. It verifies the card with the five checks
// and then applies the agent's own policy. Anything unproven is a refusal.

import type { Report } from "./checks.ts";

export type Policy = {
  minTrades: number;
  /** Largest acceptable max drawdown, in bps. */
  maxDrawdownBps: number;
  /** Shortest acceptable window, in days. */
  minWindowDays: number;
  /** Demo ("fixture") cards are refused unless this is set. */
  allowDemo: boolean;
  /** Warnings (stale, missing attestation, pre-privacy-guard) are refused unless set. */
  allowWarnings: boolean;
};

export const DEFAULT_POLICY: Policy = { minTrades: 20, maxDrawdownBps: 3_000, minWindowDays: 7, allowDemo: false, allowWarnings: false };

export type Verdict = { follow: boolean; reasons: string[] };

export function judge(report: Report, policy: Policy = DEFAULT_POLICY): Verdict {
  const reasons: string[] = [];
  for (const c of report.checks) {
    if (c.status === "fail") reasons.push(`${c.label} failed: ${c.detail}`);
  }
  const card = report.card as any;
  if (!card) return { follow: false, reasons: reasons.length ? reasons : ["no card to judge"] };
  const demo = card.mode !== "live";
  if (demo && !policy.allowDemo) reasons.push("a demo card, not the trader's own account");
  for (const c of report.checks) {
    if (c.status !== "warn") continue;
    // A demo card's only warning is being a demo; with allowDemo that's accepted.
    const onlyDemo = demo && policy.allowDemo && c.id === "freshness" && /demo card/.test(c.detail) && !/refresh|before the privacy guard|1-day/.test(c.detail);
    if (!policy.allowWarnings && !onlyDemo) reasons.push(`${c.label}: ${c.detail}`);
  }
  const s = card.stats ?? {};
  if (s.trades < policy.minTrades) reasons.push(`${s.trades} trades, policy needs ≥ ${policy.minTrades}`);
  if (s.max_dd_bps > policy.maxDrawdownBps) reasons.push(`max drawdown ${(s.max_dd_bps / 100).toFixed(2)}%, policy allows ≤ ${(policy.maxDrawdownBps / 100).toFixed(2)}%`);
  if ((card.window?.days ?? 0) < policy.minWindowDays) reasons.push(`a ${card.window?.days}-day card, policy needs ≥ ${policy.minWindowDays} days`);
  return { follow: reasons.length === 0, reasons };
}
