# Trust model

What you have to trust to believe a Prove-It card, and what each party can and cannot do.

## What a verified card means

A card that passes the five checks (`pnpm verify <card link>`, or Verify on its page) means:

1. **Signature:** the numbers were signed by the enclave's card key. That key is derived inside the TEE by OutLayer, bound to the enclave project and to the registry contract as caller, and the registry learned its public half from the enclave itself (`bootstrap_key`). Nobody holds it.
2. **On-chain record:** the NEAR registry recorded exactly these bytes (`card_hash`), and the card isn't revoked, replaced or from a retired build.
3. **Code:** the enclave build that produced it (its wasm sha256) is one the registry approved. Anyone can rebuild it reproducibly (`enclave/build.sh`) and compare.
4. **TEE attestation:** OutLayer's Intel TDX attestation for that run names this build, this project, this issuer, and an output hash equal to `sha256` of exactly this card and signature.
5. **Freshness and privacy:** when it was issued, whether it's a demo card, and that its return is shared by at least `k_min` leaderboard accounts.

Together: **open-source code with a known hash computed these numbers inside a TEE, from Hyperliquid's public API, for an account whose key signed an ownership message bound to the issuer's NEAR account; nobody edited them since.**

## What you trust

| You trust | For | If it failed |
|---|---|---|
| **Intel TDX** (the hardware) | the enclave's memory and keys stay private and its code is what was measured | a broken TEE could sign false cards or leak an address |
| **OutLayer** (worker measurements, keystore and key derivation) | running the attested wasm, deriving keys only inside TEEs, decrypting secrets only for the right project and caller | OutLayer could run other code or hand out keys |
| **Hyperliquid's public API** | the fills and account values are the real ones | wrong source data gives wrong (but honestly computed) stats |
| **The NEAR registry's owner key** | approving only audited, reproducible builds; it can retire builds | an owner could approve a malicious build; every card names its build, so this is visible |
| **The code** (this repo) | the statistics, rules and privacy guard do what `docs/METHODOLOGY.md` says | read it, rebuild it, compare the hash |

## What you don't have to trust

| Party | Can | Cannot |
|---|---|---|
| **Prove-It's web app on Railway** | refuse service; show the wrong page | see a wallet address (it's encrypted in the browser to the TEE, `web/e2e/no-leak.spec.ts`); forge a card (no key); read viewing-key trades (encrypted to the follower inside the TEE, `web/e2e/feed.spec.ts`); swap the verify result (the CLI runs on your machine from public data) |
| **The `/api/reveal` relay** | refuse to forward; see which follower polls which card | read trades or forge pages (encrypted to the follower; each answer has a TEE attestation; the feed is a hash chain the follower checks) |
| **The trader** | choose a window and when to issue; refresh or revoke; set key terms | edit a number (signature + on-chain hash); use another person's account (EIP-712 ownership signature, checked in the TEE); reuse an ownership signature (single-use nonce); cherry-pick revealed trades (Merkle root committed at issuance) |
| **A viewing-key buyer** | see coarsened trades after the key's delay | see the address, prices, dollar sizes or exact times; read past the key's expiry; read another follower's answer |
| **Anyone on NEAR** | read every card and grant | find the address: no transaction contains it (`scripts/leakcheck.py`, run on every live flow) |

## Known gaps, stated openly

- **Other accounts.** Nothing proves the account on a card is the trader's only one. Cards from one account share a commitment and the profile lists every card an issuer made, so switching accounts is visible, but not prevented.
- **k-anonymity is relative to the leaderboard.** It removes the cheapest lookup (exact return → wallet). Someone with other side information can narrow further.
- **Demo cards** are computed inside the real TEE from a recorded public account, not the issuer's. They say `mode: "fixture"`, only the demo registry accepts them, and the verifier marks them amber.
- **Testnet today.** Everything above runs live on NEAR testnet and OutLayer testnet. The mainnet deploy is scripted (`scripts/deploy-mainnet.sh`) and listed in `docs/PHASES.md` (P4) as pending.
