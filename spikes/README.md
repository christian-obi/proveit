# P0 spikes

Throwaway experiments that test the platform assumptions before real code depends on them. Results: [docs/SPIKES.md](../docs/SPIKES.md). Nothing here ships; P1 onward rebuilds the useful parts properly in `enclave/` and `contract/`.

| Folder | Spike | Exit test |
|---|---|---|
| `s1-hello-hl/` | WASI P2 module fetches a Hyperliquid portfolio | T0.1, T0.2 |
| `s2-enclave/` | Signing key, MAC key, secret hash and output-size ops in one OutLayer project | T0.3, T0.4, T0.6 |
| `s2-contract/` | Contract that starts OutLayer runs (so keys bind to it as predecessor) and records the callbacks | T0.3, T0.4, T0.6 |
| `s3-secrets/` | Browser-safe ECIES v1 encryption to the OutLayer keystore | T0.4 |
| `s4-leaderboard/` | Leaderboard fetch + parse cost for the k-anonymity guard | T0.5 |
| `s6-chainsig-match/` | Is a near.com dedicated Hyperliquid account a Chain Signatures address? | T0.8 |

Build everything: `ACCOUNT=<you>.testnet ../scripts/p0-live.sh build`. Live tests: see "Live setup" in docs/SPIKES.md.
