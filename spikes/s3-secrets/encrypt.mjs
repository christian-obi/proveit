// T0.4 live half: encrypt a secret for the S2 spike project and print the store_secrets call.
//
// node encrypt.mjs --network testnet --project <owner>/<name> --owner <your account> \
//                  --profile s3 --secret '{"venue":"hyperliquid","address":"0x…"}'

import crypto from "node:crypto";
import { encryptForKeystore, fetchKeystorePubkey } from "./ecies.mjs";

const API = { testnet: "https://testnet-api.outlayer.ai", mainnet: "https://api.outlayer.ai" };
const CONTRACT = { testnet: "outlayer.testnet", mainnet: "outlayer.near" };

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  for (const k of ["network", "project", "owner", "profile", "secret"]) {
    if (!out[k]) throw new Error(`missing --${k}`);
  }
  if (!API[out.network]) throw new Error("--network must be testnet or mainnet");
  return out;
}

const a = args();
const pubkey = await fetchKeystorePubkey({
  api: API[a.network],
  projectId: a.project,
  owner: a.owner,
  profile: a.profile,
  secretNames: ["PROVEIT_SECRET"],
});
const plaintext = JSON.stringify({ PROVEIT_SECRET: a.secret });
const encrypted = encryptForKeystore(pubkey, plaintext);
const storeArgs = {
  accessor: { Project: { project_id: a.project } },
  profile: a.profile,
  encrypted_secrets_base64: encrypted,
  // Judged against the transaction signer, so only the owner's own runs can decrypt it.
  access: { Whitelist: { accounts: [a.owner] } },
  vault_id: null,
};

console.log(`keystore pubkey: ${pubkey}`);
console.log(`expected secret_hash in the enclave: ${crypto.createHash("sha256").update(a.secret).digest("hex")}`);
console.log("\nStore it (deposit covers storage; check with estimate_storage_cost if it fails):\n");
console.log(
  `near contract call-function as-transaction ${CONTRACT[a.network]} store_secrets ` +
    `json-args '${JSON.stringify(storeArgs)}' prepaid-gas '100.0 Tgas' attached-deposit '0.01 NEAR' ` +
    `sign-as ${a.owner} network-config ${a.network} sign-with-keychain send`,
);
