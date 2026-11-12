// `pnpm demo`: the 60-second check, no wallet and no account needed.
//
// 1. Verify a real card with the five checks, from public data only (NEAR RPC + OutLayer's
//    attestation API), on this machine.
// 2. Verify a copy of it with one number edited, the way a faked screenshot would be: the
//    signature, the on-chain record and the TEE attestation must all fail.
//
// Exit 0 when the real card verifies and the edited copy is caught; 1 otherwise.
// PROVEIT_DEMO_CARD=<card url> picks another card (the default is the featured testnet card;
// the mainnet card replaces it once issued).

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CARD = process.env.PROVEIT_DEMO_CARD ?? "https://proveit.up.railway.app/demo/3";
const cli = join(import.meta.dirname, "..", "packages", "verify", "bin", "verify.ts");
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, CARD, ...args], { stdio: "inherit" });
  return r.status;
};

console.log(`== 1. The real card: ${CARD}\n`);
const real = run();
console.log(`\n== 2. The same card with its return edited to +90%, as a faked screenshot would be\n`);
const fake = run("--tamper", "return_bps=9000");

const ok = real === 0 && fake === 1;
console.log(
  `\n== ${ok ? "PASS" : "FAIL"}: the real card ${real === 0 ? "verified" : "did NOT verify"}; the edited copy was ${fake === 1 ? "caught" : "NOT caught"}.`,
);
if (ok && /\/demo\//.test(CARD)) console.log("   (A demo card from a recorded public account: check 5 is amber for that reason only.)");
process.exit(ok ? 0 : 1);
