// Sign an ownership proof with Anvil's PUBLIC test key, for testing the live path
// end to end. The test key's Hyperliquid account has funds but no trades, so the
// enclave must accept the signature and then refuse the card with TOO_FEW_TRADES.
//
//   node scripts/sign-test-ownership.ts <near account> [nonce]
//
// Prints the PROVEIT_SECRET JSON. Never use these keys for anything real.

import { privateKeyToAccount } from "viem/accounts";

const STATEMENT =
  "I control this Hyperliquid account and allow Prove-It to compute its trading statistics inside a TEE. This signature cannot move funds or place trades.";

const nearAccount = process.argv[2];
if (!nearAccount) throw new Error("usage: node scripts/sign-test-ownership.ts <near account> [nonce]");
const nonce = BigInt(process.argv[3] ?? Date.now());
const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);

const signer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const signature = await signer.signTypedData({
  domain: { name: "Prove-It", version: "1" },
  types: {
    ProveIt: [
      { name: "statement", type: "string" },
      { name: "account", type: "address" },
      { name: "nearAccount", type: "string" },
      { name: "nonce", type: "uint64" },
      { name: "expiry", type: "uint64" },
    ],
  },
  primaryType: "ProveIt",
  message: { statement: STATEMENT, account: signer.address, nearAccount, nonce, expiry },
});

console.log(
  JSON.stringify({
    venue: "hyperliquid",
    proof: { account: signer.address, nearAccount, nonce: Number(nonce), expiry: Number(expiry), signature },
  }),
);
