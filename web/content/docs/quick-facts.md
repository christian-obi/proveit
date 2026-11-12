---
description: "What Prove-It is, who it is for and how it works, in one table."
---

# Quick facts

| Question | Answer |
|---|---|
| What is it? | Signed, on-chain trading performance cards that hide the wallet behind them |
| Who is it for? | Traders proving a record, followers deciding whom to follow, AI agents and contracts that need a machine-checkable record |
| Supported venue | Hyperliquid |
| Where is the computation done? | An OutLayer Intel TDX enclave, running open-source WebAssembly with a reproducible build |
| Where are cards recorded? | A NEAR smart contract (the registry) |
| Does verifying need an account? | No. It reads public NEAR RPC and OutLayer attestation data |
| How do followers pay? | USDC on NEAR. Payment from other chains through NEAR Intents 1Click is built but not yet tested live |
| Web app | https://proveit.up.railway.app |
| Source code | https://github.com/christian-obi/proveit |
