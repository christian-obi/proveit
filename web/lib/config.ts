// Network configuration. Defaults are the testnet deployment from P3, so the app runs with
// no environment variables at all; production on mainnet sets the NEXT_PUBLIC_* values.

export type Network = "mainnet" | "testnet";

// Each value must be read as a literal process.env.NEXT_PUBLIC_X: Next.js doesn't inline
// dynamic lookups into the browser bundle, which would silently leave wallets on the defaults.
export const config = {
  network: (process.env.NEXT_PUBLIC_NETWORK || "testnet") as Network,
  registry: process.env.NEXT_PUBLIC_REGISTRY || "proveit-registry.testnet",
  demoRegistry: process.env.NEXT_PUBLIC_DEMO_REGISTRY || "proveit-demo-registry.testnet",
  enclaveProject: process.env.NEXT_PUBLIC_ENCLAVE_PROJECT || "proveit-realist.testnet/enclave",
  demoEnclaveProject: process.env.NEXT_PUBLIC_DEMO_ENCLAVE_PROJECT || "proveit-realist.testnet/enclave-demo",
  outlayerApi: process.env.NEXT_PUBLIC_OUTLAYER_API || "https://testnet-api.outlayer.ai",
  outlayerContract: process.env.NEXT_PUBLIC_OUTLAYER_CONTRACT || "outlayer.testnet",
  /** Comma-separated; on a rate limit the next endpoint is tried. */
  nearRpc: (process.env.NEXT_PUBLIC_NEAR_RPC || "https://rpc.testnet.fastnear.com,https://rpc.testnet.near.org,https://test.rpc.fastnear.com").split(","),
  explorer: process.env.NEXT_PUBLIC_EXPLORER || "https://testnet.nearblocks.io",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://proveit-production-d47c.up.railway.app",
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

const TESTNET = {
  network: "testnet" as Network,
  rpc: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"],
  outlayerApi: "https://testnet-api.outlayer.ai",
};

/**
 * Where an account lives. The demo registry stays on testnet after the site moves to mainnet,
 * so everything that touches a registry or token asks here instead of using config directly.
 */
export function networkFor(account: string) {
  if (config.network === "mainnet" && account.endsWith(".testnet")) return TESTNET;
  return { network: config.network, rpc: config.nearRpc, outlayerApi: config.outlayerApi };
}

export const endpointsFor = (registry: string) => {
  const { rpc, outlayerApi } = networkFor(registry);
  return { rpc, outlayerApi };
};

export const endpoints = endpointsFor(config.registry);
