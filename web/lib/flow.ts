// The create flow's pure steps, kept free of React and wallets so tests can run them.

import { config } from "./config";
import { encryptForKeystore } from "./ecies";
import { requestCardTx, storeSecretsTx, type Tx } from "./near";
import { secretJson, type OwnershipProof } from "./ownership";

export function profileFor(nonce: number): string {
  return `card-${nonce}`;
}

/**
 * The two transactions for a live card: store the encrypted secret on OutLayer, then ask
 * the registry for the card. The proof is encrypted here, in the browser; only ciphertext
 * goes into the transactions.
 */
export function liveCardTransactions(opts: {
  proof: OwnershipProof;
  keystorePubkey: string;
  storageDeposit: string;
  windowDays: number;
  encrypted?: string;
  kind?: "trader" | "agent";
}): { txs: Tx[]; encrypted: string; profile: string } {
  const profile = profileFor(opts.proof.nonce);
  // The secret value is the JSON the enclave parses; the stored blob is {"PROVEIT_SECRET": value}.
  const encrypted = opts.encrypted ?? encryptForKeystore(opts.keystorePubkey, JSON.stringify({ PROVEIT_SECRET: secretJson(opts.proof) }));
  return {
    profile,
    encrypted,
    txs: [
      storeSecretsTx(config.enclaveProject, opts.proof.nearAccount, profile, encrypted, opts.storageDeposit),
      requestCardTx(config.registry, opts.windowDays, profile, opts.kind),
    ],
  };
}

/** A demo card: the demo registry's enclave uses a recorded public account; no secret, no EVM wallet. */
export function demoCardTransactions(windowDays: number, kind: "trader" | "agent" = "trader"): Tx[] {
  return [requestCardTx(config.demoRegistry, windowDays, null, kind)];
}
