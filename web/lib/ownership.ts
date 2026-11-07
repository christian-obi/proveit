// The EIP-712 ownership message. Must match enclave/src/ownership.rs exactly; the unit test
// pins it to test-vectors/eip712.json.

export const STATEMENT =
  "I control this Hyperliquid account and allow Prove-It to compute its trading statistics inside a TEE. This signature cannot move funds or place trades.";

export const domain = { name: "Prove-It", version: "1" } as const;

export const types = {
  ProveIt: [
    { name: "statement", type: "string" },
    { name: "account", type: "address" },
    { name: "nearAccount", type: "string" },
    { name: "nonce", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

/** The enclave refuses expiries more than 24 h ahead; one hour is plenty for one card. */
export const VALIDITY_SECS = 3600;

export type OwnershipProof = {
  account: `0x${string}`;
  nearAccount: string;
  nonce: number;
  expiry: number;
  signature: `0x${string}`;
};

/** A 48-bit random nonce: unique per card, and a safe JavaScript integer. */
export function randomNonce(): number {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return b.reduce((n, byte) => n * 256 + byte, 0);
}

export function typedData(account: `0x${string}`, nearAccount: string, nonce: number, expiry: number) {
  return {
    domain,
    types,
    primaryType: "ProveIt" as const,
    message: { statement: STATEMENT, account, nearAccount, nonce: BigInt(nonce), expiry: BigInt(expiry) },
  };
}

/** The PROVEIT_SECRET the enclave reads: never sent anywhere unencrypted. */
export function secretJson(proof: OwnershipProof): string {
  return JSON.stringify({ venue: "hyperliquid", proof });
}
