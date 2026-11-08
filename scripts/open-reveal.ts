// The follower's side of a reveal, outside the browser: fetch the request_reveal
// transaction's final result, decrypt it with the follower's X25519 secret, and check the
// trades against the card's orders root on the registry.
//
//   node scripts/open-reveal.ts keygen                      → "<secret hex> <public hex>"
//   node scripts/open-reveal.ts --registry R --card N --tx HASH --sender ACCOUNT --secret HEX [--record out.json]
//
// --record keeps the transaction result and secret so the browser test can replay a real
// reveal (web/e2e/unlock.spec.ts). Exit 1 if the reveal doesn't check out.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { hex, unhex } from "../packages/verify/src/bytes.ts";
import { rpc, view } from "../packages/verify/src/checks.ts";
import { checkReveal, followerKey, openReveal } from "../packages/verify/src/reveal.ts";

const RPC = ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];

if (process.argv[2] === "keygen") {
  const k = followerKey();
  console.log(`${hex(k.secret)} ${k.pub}`);
  process.exit(0);
}

const { values: a } = parseArgs({
  options: { registry: { type: "string" }, card: { type: "string" }, tx: { type: "string" }, sender: { type: "string" }, secret: { type: "string" }, record: { type: "string" } },
});
if (!a.registry || !a.card || !a.tx || !a.sender || !a.secret) throw new Error("usage: see the top of this file");

type Tx = { status?: { SuccessValue?: string; Failure?: unknown } };
let value: string | undefined;
const started = Date.now();
while (!value) {
  try {
    const r = await rpc<Tx>(RPC, "tx", { tx_hash: a.tx, sender_account_id: a.sender, wait_until: "FINAL" });
    if (r.status?.Failure) throw new Error(`transaction failed: ${JSON.stringify(r.status.Failure)}`);
    value = r.status?.SuccessValue;
  } catch (e) {
    if (/transaction failed/.test((e as Error).message)) throw e;
  }
  if (!value) {
    if (Date.now() - started > 300_000) throw new Error("no final result within 5 minutes");
    await new Promise((r) => setTimeout(r, 3000));
  }
}
const outcome = JSON.parse(Buffer.from(value, "base64").toString());
if (!outcome.Revealed) {
  console.log("registry answered:", JSON.stringify(outcome));
  process.exit(1);
}
const { ciphertext, shown, total, ciphertext_sha256 } = outcome.Revealed;
console.log(`registry: Revealed ${shown}/${total}, ciphertext ${ciphertext.length} base64 chars, sha256 ${ciphertext_sha256.slice(0, 12)}…`);

const record = await view<{ card_hash: string; card_json: string }>(RPC, a.registry, "get_card", { card_id: Number(a.card) });
const card = JSON.parse(record.card_json);
const revealed = openReveal(unhex(a.secret), ciphertext);
const check = checkReveal(revealed, card, record.card_hash, a.sender);
console.log(`decrypted for ${revealed.follower}, card ${revealed.card_hash.slice(0, 12)}…, delay ${revealed.delay_secs}s, as of ${new Date(revealed.as_of * 1000).toISOString()}`);
console.log(`${check.ok ? "PASS" : "FAIL"}: ${check.shown}/${check.total} Merkle-verified · ${check.detail}`);
for (const r of revealed.records.slice(0, 5)) console.log("  ", JSON.stringify(r));
if (revealed.records.length > 5) console.log(`   … ${revealed.records.length - 5} more`);

if (a.record) {
  mkdirSync(dirname(a.record), { recursive: true });
  writeFileSync(
    a.record,
    JSON.stringify(
      {
        about: "A real testnet reveal (scripts/p7-live.sh reveal), replayed by web/e2e/unlock.spec.ts. The secret is a throwaway key for this one reveal of a recorded public account's trades.",
        registry: a.registry,
        card_id: Number(a.card),
        sender: a.sender,
        tx: a.tx,
        secret: a.secret,
        success_value: value,
        shown,
        total,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`recorded to ${a.record}`);
}
process.exit(check.ok ? 0 : 1);
