import { config } from "@/lib/config";
import { markdownResponse } from "@/lib/docs";

export const dynamic = "force-static";

const site = config.siteUrl;

export const GET = () =>
  markdownResponse(
    `# Prove-It

> Verifiable private trading track records on NEAR. An OutLayer Intel TDX enclave computes a trader's Hyperliquid statistics and signs a card, a NEAR contract records it, and anyone can verify it from public data without learning the wallet. Currently on NEAR testnet; mainnet is pending.

## Docs

- [Full documentation](${site}/docs.md): how cards are made, card fields, the five checks, API, CLI, viewing keys, limits and deployments

## API

- [Verify a card](${site}/api/verify?card=3&registry=proveit-demo-registry.testnet&guard=1): JSON result of the five checks with an agent-guard verdict. Read guard.follow, and treat false as a refusal

## Optional

- [Explore cards](${site}/explore): verified traders
- [Source code](https://github.com/christian-obi/proveit): enclave, contract, verifier and web app
`,
    "text/plain",
  );
