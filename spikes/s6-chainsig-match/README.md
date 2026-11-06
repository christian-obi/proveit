# Spike S6: is the near.com dedicated Hyperliquid account a Chain Signatures address?

If yes, the enclave can prove a confidential-perps trader controls their Hyperliquid account by recomputing the address from their NEAR account, with no key needed.

## What you need
1. A near.com account with confidential perps enabled (a tiny deposit is enough).
2. Its **NEAR account ID** (passkey accounts may be a 64-char hex implicit account; check the wallet or the deposit tx on nearblocks).
3. Its **dedicated Hyperliquid address** (check the near.com UI, or find the deposit landing on Hyperliquid in the explorer).
4. Optional but important: the **near.com contract** that handled the deposit (look at the receiver of your deposit tx on nearblocks). If that contract calls `v1.signer`, it is the predecessor that addresses are derived from.

## Run
```bash
cd spikes/s6-chainsig-match
npm install
node match.mjs --hl 0xYOUR_DEDICATED_ADDR --user your-account.near --predecessor <near.com contract>
```
Add more `--predecessor` and `--path` flags for any other names you spot in the transactions.

## Reading the result
- `✔ MATCH … ✔ confirmed`: it is a Chain Signatures address. Record the predecessor and path in `docs/SPIKES.md`; confidential perps becomes a P1 ownership mode.
- `✘ no match`: either the path is something we did not guess, or near.com holds the key. Keep the exact-size order challenge as the fallback, and ask near.com which it is.
- Exit code 2 with "local derivation does not match": the MPC derivation formula changed; the script refuses to guess.

The script only reads public data (two view calls on `v1.signer`) and never needs a key.
