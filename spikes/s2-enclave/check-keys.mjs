// T0.3 checker. Feed it the outputs of the S2 runs (as recorded by the spike contract) and it
// checks: same public key across runs and versions, signatures verify, MAC is stable.
//
// node check-keys.mjs <runs.json>
//   runs.json: the array returned by the spike contract's get_runs view.

import crypto from "node:crypto";
import fs from "node:fs";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifyEd25519(pubHex, message, sigHex) {
  const key = crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubHex, "hex")]),
    format: "der",
    type: "spki",
  });
  return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(sigHex, "hex"));
}

const runs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const answers = runs
  .filter((r) => r.ok && r.output_head)
  .map((r) => ({ id: r.id, op: JSON.parse(r.input).op, out: JSON.parse(r.output_head) }));

const pubkeys = answers.filter((a) => a.op === "pubkey").map((a) => ({ id: a.id, version: a.out.version, key: a.out.result.pubkey_hex }));
const signs = answers.filter((a) => a.op === "sign").map((a) => ({ id: a.id, ...a.out.result }));
const macs = answers.filter((a) => a.op === "mac").map((a) => ({ id: a.id, version: a.out.version, mac: a.out.result.mac_hex }));

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? "✔" : "✘"} ${label}`);
  if (!ok) failed = true;
};

check(pubkeys.length >= 3, `at least 3 pubkey runs (found ${pubkeys.length})`);
check(new Set(pubkeys.map((p) => p.version)).size >= 2, `pubkey runs cover 2 versions (${[...new Set(pubkeys.map((p) => p.version))].join(", ")})`);
check(new Set(pubkeys.map((p) => p.key)).size === 1, `one public key across all runs and versions: ${pubkeys[0]?.key ?? "none"}`);
for (const s of signs) {
  check(verifyEd25519(s.pubkey_hex, s.message, s.signature_hex), `run ${s.id}: signature verifies`);
  check(s.pubkey_hex === pubkeys[0]?.key, `run ${s.id}: signed by the same key`);
}
check(macs.length >= 2 && new Set(macs.map((m) => m.mac)).size === 1, `mac stable across ${macs.length} runs`);

process.exitCode = failed ? 1 : 0;
