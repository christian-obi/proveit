// Verify a Prove-It card from the command line, using only public data.
//
//   node packages/verify/bin/verify.ts <card url>      (…/c/<id> live, …/demo/<id> demo)
//   node packages/verify/bin/verify.ts --registry proveit-demo-registry.testnet --card 1
//   node packages/verify/bin/verify.ts <card url> --tamper return_bps=3830
//
// Testnet URLs map to the testnet registries; pass --registry for mainnet. Exit code 0 when no check
// fails (warnings allowed), 1 when one does, 2 on bad usage.

import { tamper, verifyCard, type Check } from "../src/checks.ts";

const OFFICIAL = ["proveit.near", "proveit-registry.testnet", "proveit-demo-registry.testnet"];

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error("usage: verify <card url> | --registry <account> --card <id>   [--tamper field=value]");
  process.exit(2);
}

const args = process.argv.slice(2);
let registry: string | undefined;
let cardId: number | undefined;
const edits: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--registry") registry = args[++i];
  else if (a === "--card") cardId = Number(args[++i]);
  else if (a === "--tamper") edits.push(args[++i] ?? usage("--tamper needs field=value"));
  else if (/^https?:\/\//.test(a)) {
    const u = new URL(a);
    const m = u.pathname.match(/\/(c|demo)\/(\d+)/);
    if (!m) usage(`not a card URL: ${a}`);
    cardId = Number(m[2]);
    registry ??= m[1] === "demo" ? "proveit-demo-registry.testnet" : "proveit-registry.testnet";
  } else usage(`unexpected argument ${a}`);
}
if (!registry || cardId === undefined || Number.isNaN(cardId)) usage();

const mainnet = registry.endsWith(".near");
const ep = mainnet
  ? { rpc: "https://rpc.mainnet.fastnear.com", outlayerApi: "https://api.outlayer.ai" }
  : { rpc: "https://rpc.testnet.fastnear.com", outlayerApi: "https://testnet-api.outlayer.ai" };

if (!OFFICIAL.includes(registry)) {
  console.log(`! ${registry} is not an official Prove-It registry: a pass here only means it's consistent with itself`);
}

let cardJson: string | undefined;
if (edits.length) {
  const base = await verifyCard({ registry, cardId }, ep);
  if (!base.record) usage(`card #${cardId} isn't in ${registry}`);
  cardJson = edits.reduce((json, e) => tamper(json, e), base.record.card_json);
  console.log(`tampered: ${edits.join(", ")}`);
}

const report = await verifyCard({ registry, cardId, cardJson }, ep);
const icon: Record<Check["status"], string> = { pass: "✔", fail: "✘", warn: "!" };
const c = report.card;
if (c) {
  const pct = (bps: number) => `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;
  console.log(`card #${cardId} on ${registry}: ${c.window.days}-day return ${pct(c.stats.return_bps)}, max drawdown ${(c.stats.max_dd_bps / 100).toFixed(2)}%, ${c.stats.trades} trades`);
}
for (const check of report.checks) console.log(`${icon[check.status]} ${check.label.padEnd(18)} ${check.detail}`);
if (report.attestationUrl) console.log(`  attestation: ${report.attestationUrl}`);
const fails = report.checks.filter((x) => x.status === "fail").length;
console.log(fails ? `✘ ${fails} check(s) failed` : `✔ ${report.checks.filter((x) => x.status === "pass").length}/5 checks passed`);
process.exit(fails ? 1 : 0);
