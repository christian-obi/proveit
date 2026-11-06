# Prove-It

Verifiable private track records: an OutLayer TEE proves a trader's Hyperliquid performance without revealing their wallet, and records a signed card on NEAR.

**Status:** in development for NEAR HACKATHON (Nov 2026). Phase P0 (setup and risk spikes) is in progress; nothing below `spikes/` is a working product yet. See [BUILD_PLAN.md](BUILD_PLAN.md) for the plan and [docs/PHASES.md](docs/PHASES.md) for test results per phase.

## Layout

| Path | What |
|---|---|
| `enclave/` | Rust WASI P2 module that runs in OutLayer's Intel TDX enclave (from P1) |
| `contract/` | NEAR registry contract (from P3) |
| `packages/verify/` | TypeScript verification library and CLI (from P6) |
| `web/` | Next.js web app, deployed on Railway (from P5) |
| `spikes/` | P0 throwaway experiments that de-risk the platform assumptions |
| `test-vectors/` | Shared vectors used by both Rust and TypeScript tests |
| `docs/` | Phase test log, spike results, methodology |

## Disclosures
- No code was written before the hackathon started (1 Nov 2026).
- Code is written with AI assistance (Claude Code).

## License
MIT, see [LICENSE](LICENSE).
