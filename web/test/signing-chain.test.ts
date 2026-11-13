// The wallet must be on Arbitrum (Sepolia for testnet) before it signs a trading-key approval.
// A mock wallet that behaves like MetaMask, with each way wallets report an unknown chain.

import { describe, expect, it } from "vitest";
import { ensureSigningChain } from "../lib/hyperliquid";

type Opts = {
  active?: string;
  known?: string[];
  /** How "I don't know this chain" is reported. */
  unknownAs?: "4902" | "wrapped" | "text-only";
  rejectSwitch?: boolean;
  rejectAdd?: boolean;
  /** Some wallets add the chain without switching to it. */
  addSwitches?: boolean;
  noSwitchSupport?: boolean;
};

function wallet(o: Opts = {}) {
  let active = o.active ?? "0x1";
  const known = new Set(o.known ?? ["0x1"]);
  const calls: string[] = [];
  const unknown = (id: string) => {
    const message = `Unrecognized chain ID "${id}". Try adding the chain using wallet_addEthereumChain first.`;
    if (o.unknownAs === "wrapped") return { code: -32603, message: "Internal JSON-RPC error.", data: { originalError: { code: 4902, message } } };
    if (o.unknownAs === "text-only") return { code: -32603, message };
    return { code: 4902, message };
  };
  return {
    calls,
    get active() {
      return active;
    },
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      calls.push(method);
      const id = (params?.[0] as { chainId?: string })?.chainId;
      if (method === "eth_chainId") return active;
      if (method === "wallet_switchEthereumChain") {
        if (o.noSwitchSupport) throw { code: -32601, message: "Method not supported" };
        if (!known.has(id!)) throw unknown(id!);
        if (o.rejectSwitch) throw { code: 4001, message: "User rejected the request." };
        active = id!;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        if (o.rejectAdd) throw { code: 4001, message: "User rejected the request." };
        known.add(id!);
        if (o.addSwitches !== false) active = id!;
        return null;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

describe("ensureSigningChain", () => {
  it("does nothing when the wallet is already on the chain", async () => {
    const w = wallet({ active: "0x66eee" });
    await ensureSigningChain(w, "testnet");
    expect(w.calls).toEqual(["eth_chainId"]);
  });

  it("switches to a chain the wallet knows", async () => {
    const w = wallet({ known: ["0x1", "0xa4b1"] });
    await ensureSigningChain(w, "mainnet");
    expect(w.active).toBe("0xa4b1");
    expect(w.calls).not.toContain("wallet_addEthereumChain");
  });

  for (const unknownAs of ["4902", "wrapped", "text-only"] as const) {
    it(`adds the chain when the wallet reports it unknown (${unknownAs})`, async () => {
      const w = wallet({ unknownAs });
      await ensureSigningChain(w, "testnet");
      expect(w.active).toBe("0x66eee");
      expect(w.calls).toContain("wallet_addEthereumChain");
    });
  }

  it("switches after adding when the wallet only added the chain", async () => {
    const w = wallet({ unknownAs: "wrapped", addSwitches: false });
    await ensureSigningChain(w, "testnet");
    expect(w.active).toBe("0x66eee");
    expect(w.calls.filter((c) => c === "wallet_switchEthereumChain")).toHaveLength(2);
  });

  it("explains a declined switch", async () => {
    await expect(ensureSigningChain(wallet({ known: ["0x1", "0xa4b1"], rejectSwitch: true }), "mainnet")).rejects.toThrow(/Switch your wallet to Arbitrum One/);
  });

  it("explains a declined add", async () => {
    await expect(ensureSigningChain(wallet({ rejectAdd: true }), "testnet")).rejects.toThrow(/Add Arbitrum Sepolia to your wallet/);
  });

  it("explains a wallet that can't switch at all, without [object Object]", async () => {
    const err = await ensureSigningChain(wallet({ noSwitchSupport: true }), "testnet").catch((e: Error) => e.message);
    expect(err).toMatch(/couldn't switch to Arbitrum Sepolia: Method not supported/);
    expect(err).not.toContain("[object");
  });

  it("adds mainnet with the right parameters", async () => {
    const seen: unknown[] = [];
    const w = wallet({ unknownAs: "4902" });
    const spy = { request: (a: { method: string; params?: unknown[] }) => (a.method === "wallet_addEthereumChain" && seen.push(a.params![0]), w.request(a)) };
    await ensureSigningChain(spy, "mainnet");
    expect(seen[0]).toMatchObject({ chainId: "0xa4b1", chainName: "Arbitrum One", nativeCurrency: { symbol: "ETH", decimals: 18 }, rpcUrls: ["https://arb1.arbitrum.io/rpc"] });
  });
});
