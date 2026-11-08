// Which card a link or flags point at, and the public endpoints for its network.

export const OFFICIAL = ["proveit.near", "proveit-registry.testnet", "proveit-demo-registry.testnet"];

export type Target = { registry: string; cardId: number };

/** "https://…/c/12" → live registry, "…/demo/2" → demo registry (testnet unless `mainnet`). */
export function parseCardUrl(url: string, mainnet = false): Target | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = u.pathname.match(/\/(c|demo|p\/[^/]+\/c)\/(\d+)/);
  if (!m) return null;
  const live = mainnet ? "proveit.near" : "proveit-registry.testnet";
  return { registry: m[1] === "demo" ? "proveit-demo-registry.testnet" : live, cardId: Number(m[2]) };
}

export function endpointsFor(registry: string) {
  return registry.endsWith(".near")
    ? { rpc: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"], outlayerApi: "https://api.outlayer.ai" }
    : { rpc: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"], outlayerApi: "https://testnet-api.outlayer.ai" };
}
