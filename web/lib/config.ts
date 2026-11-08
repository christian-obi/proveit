// Network configuration. Defaults are the testnet deployment from P3, so the app runs with
// no environment variables at all; production on mainnet sets the NEXT_PUBLIC_* values.

export type Network = "mainnet" | "testnet";

const env = (name: string, fallback: string) => process.env[name] || fallback;

export const config = {
  network: env("NEXT_PUBLIC_NETWORK", "testnet") as Network,
  registry: env("NEXT_PUBLIC_REGISTRY", "proveit-registry.testnet"),
  demoRegistry: env("NEXT_PUBLIC_DEMO_REGISTRY", "proveit-demo-registry.testnet"),
  enclaveProject: env("NEXT_PUBLIC_ENCLAVE_PROJECT", "proveit-realist.testnet/enclave"),
  outlayerApi: env("NEXT_PUBLIC_OUTLAYER_API", "https://testnet-api.outlayer.ai"),
  outlayerContract: env("NEXT_PUBLIC_OUTLAYER_CONTRACT", "outlayer.testnet"),
  /** Comma-separated; on a rate limit the next endpoint is tried. */
  nearRpc: env("NEXT_PUBLIC_NEAR_RPC", "https://rpc.testnet.fastnear.com,https://rpc.testnet.near.org,https://test.rpc.fastnear.com").split(","),
  explorer: env("NEXT_PUBLIC_EXPLORER", "https://testnet.nearblocks.io"),
  siteUrl: env("NEXT_PUBLIC_SITE_URL", "https://proveit-production-d47c.up.railway.app"),
  /** Build-time switch for the Playwright tests' fake wallets. Never set in a deployed build. */
  e2e: process.env.NEXT_PUBLIC_E2E === "1",
};

export const WINDOWS = [
  { days: 1, label: "1 day", note: "for live testing" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
] as const;

/** Attached to request_card: 0.02 NEAR storage (refunded if refused) + 0.05 NEAR for OutLayer. */
export const REQUEST_DEPOSIT_YOCTO = "70000000000000000000000";
export const MAX_GAS = "300000000000000";

/** Cards are shown only from these registries: a card is only as good as the registry vouching for it. */
export function isKnownRegistry(r: string): boolean {
  return r === config.registry || r === config.demoRegistry;
}

export const endpoints = { rpc: config.nearRpc, outlayerApi: config.outlayerApi };
