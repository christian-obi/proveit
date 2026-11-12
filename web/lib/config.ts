// Network configuration. Defaults are the testnet deployment from P3, so the app runs with
// no environment variables at all; the header switch picks a network per visitor.

export type Network = "mainnet" | "testnet";

export const NETWORKS = {
  testnet: {
    network: "testnet" as Network,
    registry: "proveit-registry.testnet",
    enclaveProject: "proveit-realist.testnet/enclave",
    outlayerApi: "https://testnet-api.outlayer.ai",
    outlayerContract: "outlayer.testnet",
    nearRpc: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"],
    explorer: "https://testnet.nearblocks.io",
    archivalRpc: ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"],
  },
  mainnet: {
    network: "mainnet" as Network,
    registry: "proveit.near",
    enclaveProject: "realist1036.near/enclave",
    outlayerApi: "https://api.outlayer.ai",
    outlayerContract: "outlayer.near",
    nearRpc: ["https://rpc.mainnet.fastnear.com"],
    explorer: "https://nearblocks.io",
    archivalRpc: ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"],
  },
};

const DEMO_REGISTRY = "proveit-demo-registry.testnet";

/** The network used until a visitor picks one with the header switch. */
const defaultNetwork: Network = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const config = {
  ...NETWORKS[defaultNetwork],
  demoRegistry: DEMO_REGISTRY,
  demoEnclaveProject: "proveit-realist.testnet/enclave-demo",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://proveit.up.railway.app",
  /** Build-time switch for the Playwright tests' fake wallets. Never set in a deployed build. */
  e2e: process.env.NEXT_PUBLIC_E2E === "1",
};

export const NETWORK_COOKIE = "proveit-network";
export const parseNetwork = (value: string | null | undefined): Network => (value === "mainnet" || value === "testnet" ? value : config.network);

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

/** Which registries a network's board lists. Demo cards are testnet cards. */
export const registriesOf = (network: Network) => (network === "testnet" ? [NETWORKS.testnet.registry, DEMO_REGISTRY] : [NETWORKS.mainnet.registry]);

/** Cards are shown only from these registries: a card is only as good as the registry vouching for it. */
export const isKnownRegistry = (r: string) => [...registriesOf("testnet"), ...registriesOf("mainnet")].includes(r);

/** Where an account lives, from its name, so reads and writes never depend on the switch. */
export function networkFor(account: string) {
  const n = account.endsWith(".testnet") ? NETWORKS.testnet : NETWORKS.mainnet;
  return { ...n, rpc: n.nearRpc };
}

export const endpointsFor = (registry: string) => {
  const { rpc, outlayerApi } = networkFor(registry);
  return { rpc, outlayerApi };
};

/** The registry behind a card address: /c/<id>, /t/<id> or /demo/<id>. */
export const registryForPath = (segment: string) => (segment === "demo" ? DEMO_REGISTRY : segment === "t" ? NETWORKS.testnet.registry : NETWORKS.mainnet.registry);
