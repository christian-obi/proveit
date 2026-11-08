// Record the public data behind one real card (registry record, config, versions, TEE
// attestation) so packages/verify's tests run against genuine responses, offline.
//
//   node scripts/record-verify-fixture.ts [registry] [card_id]

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { view } from "../packages/verify/src/checks.ts";

const registry = process.argv[2] ?? "proveit-demo-registry.testnet";
const cardId = Number(process.argv[3] ?? 1);
const rpc = "https://rpc.testnet.fastnear.com";
const api = "https://testnet-api.outlayer.ai";

const record = await view<any>(rpc, registry, "get_card", { card_id: cardId });
const config = await view<any>(rpc, registry, "get_config", {});
const versions = await view<any>(rpc, registry, "get_versions", {});
const attestation = await (await fetch(`${api}/attestations/by-request/${record.outlayer_request_id}`)).json();

const out = join(import.meta.dirname, "..", "packages", "verify", "test-data", `${registry}-${cardId}.json`);
writeFileSync(
  out,
  JSON.stringify({ note: "Recorded by scripts/record-verify-fixture.ts from testnet.", registry, cardId, recorded_at: new Date().toISOString(), record, config, versions, attestation }, null, 2) + "\n",
);
console.log(`wrote ${out}`);
