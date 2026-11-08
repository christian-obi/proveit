// A follower outside the browser, for the P8 live tests: sign the NEP-413 follower message
// with a NEAR key, call the enclave over HTTPS (directly with a payment key, or through the
// app's /api/reveal relay), decrypt the answer and check it.
//
//   node scripts/follow.ts keygen <keyfile>
//   node scripts/follow.ts <feed|reveal> --keyfile F --account A --registry R --card N
//        [--since n] [--relay https://…/api/reveal | --project owner/name]   (direct needs OUTLAYER_PAYMENT_KEY)
//
// The keyfile is a throwaway testnet key; keep it outside the repository.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { hex } from "../packages/verify/src/bytes.ts";
import { view } from "../packages/verify/src/checks.ts";
import { base58Encode, checkPage, followerMessage, newEd25519, RECIPIENT, signNep413, type FeedPage } from "../packages/verify/src/feed.ts";
import { checkReveal, followerKey, openSealed, type Revealed } from "../packages/verify/src/reveal.ts";

const RPC = ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];
const API = "https://testnet-api.outlayer.ai";
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

if (process.argv[2] === "keygen") {
  const { seed, pub } = newEd25519();
  const key = { public_key: `ed25519:${base58Encode(pub)}`, private_key: `ed25519:${base58Encode(new Uint8Array([...seed, ...pub]))}`, seed: hex(seed) };
  writeFileSync(process.argv[3], JSON.stringify(key, null, 2), { mode: 0o600 });
  console.log(key.public_key);
  process.exit(0);
}

const op = process.argv[2];
const { values: a } = parseArgs({
  args: process.argv.slice(3),
  options: { keyfile: { type: "string" }, account: { type: "string" }, registry: { type: "string" }, card: { type: "string" }, since: { type: "string" }, relay: { type: "string" }, project: { type: "string" } },
});
if (!["feed", "reveal"].includes(op) || !a.keyfile || !a.account || !a.registry || !a.card) throw new Error("usage: see the top of this file");
const key = JSON.parse(readFileSync(a.keyfile, "utf8"));
const card = await view<{ card_hash: string; card_json: string }>(RPC, a.registry, "get_card", { card_id: Number(a.card) });

const x = followerKey();
const message = followerMessage(card.card_hash, x.pub, Math.floor(Date.now() / 1000) + 3600);
const nonce = crypto.getRandomValues(new Uint8Array(32));
const signature = signNep413(Buffer.from(key.seed, "hex"), message, nonce, RECIPIENT);
const auth = { account_id: a.account, public_key: key.public_key, signature: b64(signature), message, nonce: b64(nonce), recipient: RECIPIENT };

const started = Date.now();
let output: any, attestation: string | null = null;
if (a.relay) {
  const res = await fetch(a.relay, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registry: a.registry, op, card_id: Number(a.card), since: Number(a.since ?? 0), auth }) });
  const data = await res.json();
  if (!res.ok) throw new Error(`relay: HTTP ${res.status} ${JSON.stringify(data)}`);
  ({ output, attestation } = data);
} else {
  const payment = process.env.OUTLAYER_PAYMENT_KEY;
  if (!payment || !a.project) throw new Error("direct calls need --project and OUTLAYER_PAYMENT_KEY");
  const { active_version } = await view<{ active_version: string }>(RPC, a.registry, "get_config", {});
  const input: Record<string, unknown> = { op, card_id: Number(a.card), auth };
  if (op === "feed") input.since = Number(a.since ?? 0);
  const res = await fetch(`${API}/call/${a.project}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Payment-Key": payment, "X-Compute-Limit": "100000" },
    body: JSON.stringify({ input, version_key: active_version, resource_limits: { max_instructions: 30_000_000_000, max_memory_mb: 256, max_execution_seconds: 60 } }),
  });
  const data = await res.json();
  console.log(`OutLayer: HTTP ${res.status}, status ${data.status}, cost ${data.compute_cost} µUSD, ${data.time_ms} ms`);
  if (data.status !== "completed") throw new Error(JSON.stringify(data));
  output = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
  attestation = data.attestation_url ? new URL(data.attestation_url, API).toString() : null;
}
console.log(`answered in ${Date.now() - started} ms; attestation ${attestation}`);
if (output.status !== "ok") {
  console.log("enclave refused:", output.code, output.message);
  process.exit(2);
}
if (op === "reveal") {
  const r = openSealed<Revealed>(x.secret, output.ciphertext);
  const c = checkReveal(r, JSON.parse(card.card_json), card.card_hash, a.account);
  console.log(`${c.ok ? "PASS" : "FAIL"}: ${c.shown}/${c.total} Merkle-verified over HTTPS · ${c.detail}`);
  process.exit(c.ok ? 0 : 1);
}
const p = openSealed<FeedPage>(x.secret, output.ciphertext);
const c = checkPage(p, null, card.card_hash, a.account);
console.log(`${c.ok ? "PASS" : "FAIL"}: feed from #${p.from}: ${p.entries.length} entries, ${p.held_back} held back, head ${p.head.slice(0, 12)}…, next ${p.next} · ${c.detail}`);
for (const e of p.entries.slice(0, 5)) console.log("  ", JSON.stringify(e));
process.exit(c.ok ? 0 : 1);
