// The agent guard from the command line: exit 0 = follow, 1 = refuse (with reasons), 2 = bad usage.
//
//   node packages/verify/bin/agent-guard.ts <card url> [--registry R --card N]
//        [--min-trades 20] [--max-dd 30] [--min-days 7] [--allow-demo] [--allow-warnings]
//        [--tamper field=value]   (check a card someone handed you with edited numbers)
//        [--json]                 (machine-readable verdict)

import { tamper, verifyCard } from "../src/checks.ts";
import { DEFAULT_POLICY, judge, type Policy } from "../src/guard.ts";
import { endpointsFor, OFFICIAL, parseCardUrl } from "../src/target.ts";

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error("usage: agent-guard <card url> [--min-trades N] [--max-dd PCT] [--min-days N] [--allow-demo] [--allow-warnings] [--tamper f=v] [--json]");
  process.exit(2);
}

const args = process.argv.slice(2);
const policy: Policy = { ...DEFAULT_POLICY };
let registry: string | undefined, cardId: number | undefined, json = false;
const edits: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const num = () => Number(args[++i] ?? usage(`${a} needs a value`));
  if (a === "--registry") registry = args[++i];
  else if (a === "--card") cardId = num();
  else if (a === "--min-trades") policy.minTrades = num();
  else if (a === "--max-dd") policy.maxDrawdownBps = Math.round(num() * 100);
  else if (a === "--min-days") policy.minWindowDays = num();
  else if (a === "--allow-demo") policy.allowDemo = true;
  else if (a === "--allow-warnings") policy.allowWarnings = true;
  else if (a === "--tamper") edits.push(args[++i] ?? usage("--tamper needs field=value"));
  else if (a === "--json") json = true;
  else if (/^https?:\/\//.test(a)) {
    const t = parseCardUrl(a, registry?.endsWith(".near")) ?? usage(`not a card URL: ${a}`);
    registry ??= t.registry;
    cardId = t.cardId;
  } else usage(`unexpected argument ${a}`);
}
if (!registry || cardId === undefined || Number.isNaN(cardId)) usage();
const ep = endpointsFor(registry);

let cardJson: string | undefined;
if (edits.length) {
  const base = await verifyCard({ registry, cardId }, ep);
  if (!base.record) usage(`card #${cardId} isn't in ${registry}`);
  cardJson = edits.reduce((j, e) => tamper(j, e), base.record.card_json);
}
const report = await verifyCard({ registry, cardId, cardJson }, ep);
const verdict = judge(report, policy);
if (!OFFICIAL.includes(registry)) verdict.reasons.unshift(`${registry} is not an official Prove-It registry`), (verdict.follow = false);

if (json) {
  console.log(JSON.stringify({ registry, card_id: cardId, tampered: edits, policy, ...verdict, checks: report.checks }, null, 2));
} else {
  console.log(`agent-guard: card #${cardId} on ${registry}${edits.length ? ` (handed over with edits: ${edits.join(", ")})` : ""}`);
  console.log(`policy: ≥ ${policy.minTrades} trades, max drawdown ≤ ${policy.maxDrawdownBps / 100}%, window ≥ ${policy.minWindowDays} days${policy.allowDemo ? ", demo cards allowed" : ""}${policy.allowWarnings ? ", warnings allowed" : ""}`);
  for (const c of report.checks) console.log(`  ${{ pass: "✔", fail: "✘", warn: "!" }[c.status]} ${c.label}`);
  console.log(verdict.follow ? "FOLLOW: every check passed and the card meets the policy" : `REFUSE:\n${verdict.reasons.map((r) => `  - ${r}`).join("\n")}`);
}
process.exit(verdict.follow ? 0 : 1);
