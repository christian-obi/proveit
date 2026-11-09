// A small Hyperliquid client that runs only in the browser. The follower's address and agent
// key go to Hyperliquid directly and never reach this app's server. Signing follows
// hyperliquid-python-sdk's signing.py; test/hyperliquid.test.ts checks it against that SDK's vectors.

import { concat, keccak256, parseSignature, toBytes, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export type HlNetwork = "mainnet" | "testnet";

const API: Record<HlNetwork, string> = { mainnet: "https://api.hyperliquid.xyz", testnet: "https://api.hyperliquid-testnet.xyz" };
const SIGNATURE_CHAIN: Record<HlNetwork, { hex: Hex; id: number }> = { mainnet: { hex: "0xa4b1", id: 42161 }, testnet: { hex: "0x66eee", id: 421614 } };
const ZERO = "0x0000000000000000000000000000000000000000";

/** The agent stops working by itself after this. Hyperliquid allows up to 180 days. */
const AGENT_LIFETIME_MS = 30 * 24 * 3_600_000;

// --- MessagePack, only what order actions use. Key order is the insertion order, as Hyperliquid hashes it.

function packInt(n: number): number[] {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`cannot encode ${n}`);
  if (n < 128) return [n];
  if (n < 256) return [0xcc, n];
  if (n < 65536) return [0xcd, n >> 8, n & 255];
  if (n < 2 ** 32) return [0xce, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const b = BigInt(n);
  return [0xcf, ...Array.from({ length: 8 }, (_, i) => Number((b >> BigInt(56 - i * 8)) & 255n))];
}

function packString(s: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(s));
  if (bytes.length < 32) return [0xa0 | bytes.length, ...bytes];
  if (bytes.length < 256) return [0xd9, bytes.length, ...bytes];
  if (bytes.length < 65536) return [0xda, bytes.length >> 8, bytes.length & 255, ...bytes];
  throw new Error("string too long");
}

export function msgpack(v: unknown): Uint8Array {
  const go = (x: unknown): number[] => {
    if (typeof x === "string") return packString(x);
    if (typeof x === "number") return packInt(x);
    if (typeof x === "boolean") return [x ? 0xc3 : 0xc2];
    if (Array.isArray(x)) {
      if (x.length > 15) throw new Error("array too long");
      return [0x90 | x.length, ...x.flatMap(go)];
    }
    if (x && typeof x === "object") {
      const entries = Object.entries(x);
      if (entries.length > 15) throw new Error("map too long");
      return [0x80 | entries.length, ...entries.flatMap(([k, val]) => [...packString(k), ...go(val)])];
    }
    throw new Error(`cannot encode ${String(x)}`);
  };
  return new Uint8Array(go(v));
}

// --- Signing

export function actionHash(action: unknown, nonce: number): Hex {
  const n = new Uint8Array(8);
  new DataView(n.buffer).setBigUint64(0, BigInt(nonce));
  return keccak256(concat([msgpack(action), n, new Uint8Array([0])]));
}

export type Signature = { r: Hex; s: Hex; v: number };

const split = (signature: Hex): Signature => {
  const p = parseSignature(signature);
  return { r: p.r, s: p.s, v: Number(p.v ?? BigInt((p.yParity ?? 0) + 27)) };
};

export async function signL1Action(agent: PrivateKeyAccount, action: unknown, nonce: number, network: HlNetwork): Promise<Signature> {
  return split(
    await agent.signTypedData({
      domain: { chainId: 1337, name: "Exchange", verifyingContract: ZERO, version: "1" },
      types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
      primaryType: "Agent",
      message: { source: network === "mainnet" ? "a" : "b", connectionId: actionHash(action, nonce) },
    }),
  );
}

// --- Numbers, as the exchange wants them

const strip = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** At most 5 significant figures and 6 − szDecimals decimals, without trailing zeros. */
export function wirePrice(px: number, szDecimals: number): string {
  return strip(Number(px.toPrecision(5)).toFixed(Math.max(0, 6 - szDecimals)));
}

/** Sizes are always rounded down, so a copy can never exceed what was planned. */
export const roundSize = (sz: number, szDecimals: number) => Math.floor(sz * 10 ** szDecimals + 1e-9) / 10 ** szDecimals;

export const wireSize = (sz: number, szDecimals: number) => strip(sz.toFixed(szDecimals));

// --- Reading

async function info<T>(network: HlNetwork, body: object): Promise<T> {
  const res = await fetch(`${API[network]}/info`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Hyperliquid answered HTTP ${res.status}`);
  return res.json();
}

export type Market = { asset: number; szDecimals: number; mid: number };
export type Follower = { equity: number; exposure: number; positions: Record<string, number> };

export async function loadMarket(network: HlNetwork, coin: string): Promise<Market | null> {
  const [meta, mids] = await Promise.all([info<{ universe: { name: string; szDecimals: number; isDelisted?: boolean }[] }>(network, { type: "meta" }), info<Record<string, string>>(network, { type: "allMids" })]);
  const asset = meta.universe.findIndex((u) => u.name === coin && !u.isDelisted);
  const mid = Number(mids[coin]);
  return asset < 0 || !mid ? null : { asset, szDecimals: meta.universe[asset].szDecimals, mid };
}

type Clearinghouse = { marginSummary: { accountValue: string }; assetPositions: { position: { coin: string; szi: string; positionValue: string } }[] };
type Spot = { balances: { coin: string; total: string }[] };

/** Read fresh for every copy. Unified accounts keep their USDC on the spot side, so read both. */
export async function loadFollower(network: HlNetwork, user: string): Promise<Follower> {
  const [perp, spot] = await Promise.all([info<Clearinghouse>(network, { type: "clearinghouseState", user }), info<Spot>(network, { type: "spotClearinghouseState", user })]);
  const perpValue = Number(perp.marginSummary.accountValue);
  const spotUsdc = Number(spot.balances.find((b) => b.coin === "USDC")?.total ?? 0);
  return {
    equity: Math.max(perpValue, spotUsdc),
    exposure: perp.assetPositions.reduce((sum, p) => sum + Math.abs(Number(p.position.positionValue)), 0),
    positions: Object.fromEntries(perp.assetPositions.map((p) => [p.position.coin, Number(p.position.szi)])),
  };
}

// --- Trading

async function exchange(network: HlNetwork, action: unknown, nonce: number, signature: Signature) {
  const res = await fetch(`${API[network]}/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, nonce, signature, vaultAddress: null }) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`Hyperliquid answered HTTP ${res.status}`);
  if (data.status !== "ok") throw new Error(typeof data.response === "string" ? data.response : "Hyperliquid refused the request");
  return data.response;
}

export type Agent = { account: PrivateKeyAccount; network: HlNetwork; lastNonce: number };

/**
 * A new trading-only key, approved by one wallet signature. It lives in this tab's memory and
 * is gone when the tab closes; it can't withdraw, and it expires by itself after 30 days.
 */
export async function approveNewAgent(network: HlNetwork, owner: Hex): Promise<Agent> {
  if (!window.ethereum) throw new Error("No EVM wallet found. Install Rabby or MetaMask.");
  const account = privateKeyToAccount(generatePrivateKey());
  const nonce = Date.now();
  const message = {
    hyperliquidChain: network === "mainnet" ? "Mainnet" : "Testnet",
    agentAddress: account.address.toLowerCase() as Hex,
    agentName: `proveit valid_until ${nonce + AGENT_LIFETIME_MS}`,
    nonce,
  };
  // Sent to the wallet directly: viem refuses this type name, which contains a colon.
  const typedData = {
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: SIGNATURE_CHAIN[network].id, verifyingContract: ZERO },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      "HyperliquidTransaction:ApproveAgent": [
        { name: "hyperliquidChain", type: "string" },
        { name: "agentAddress", type: "address" },
        { name: "agentName", type: "string" },
        { name: "nonce", type: "uint64" },
      ],
    },
    primaryType: "HyperliquidTransaction:ApproveAgent",
    message,
  };
  const signature = (await window.ethereum.request({ method: "eth_signTypedData_v4", params: [owner, JSON.stringify(typedData)] })) as Hex;
  const action = { type: "approveAgent", signatureChainId: SIGNATURE_CHAIN[network].hex, hyperliquidChain: message.hyperliquidChain, agentAddress: message.agentAddress, agentName: message.agentName, nonce };
  await exchange(network, action, nonce, split(signature));
  return { account, network, lastNonce: nonce };
}

export type OrderResult = { status: "filled"; size: string; price: string } | { status: "resting" } | { status: "error"; message: string };

/** Order keys must stay in this order: the hash covers the encoded bytes. */
export const orderAction = (o: { asset: number; isBuy: boolean; price: string; size: string; reduceOnly: boolean; cloid?: Hex; tif?: "Ioc" | "Gtc" }) => ({
  type: "order",
  orders: [{ a: o.asset, b: o.isBuy, p: o.price, s: o.size, r: o.reduceOnly, t: { limit: { tif: o.tif ?? "Ioc" } }, ...(o.cloid ? { c: o.cloid } : {}) }],
  grouping: "na",
});

export async function placeOrder(agent: Agent, order: Parameters<typeof orderAction>[0]): Promise<OrderResult> {
  const action = orderAction(order);
  agent.lastNonce = Math.max(Date.now(), agent.lastNonce + 1);
  const nonce = agent.lastNonce;
  const response = await exchange(agent.network, action, nonce, await signL1Action(agent.account, action, nonce, agent.network));
  const status = response?.data?.statuses?.[0];
  if (status?.filled) return { status: "filled", size: status.filled.totalSz, price: status.filled.avgPx };
  if (status?.resting) return { status: "resting" };
  return { status: "error", message: status?.error ?? "no order status returned" };
}

/** The same trade always gets the same client id, so a retry or a second tab can't double it. */
export const cloidFor = (cardHash: string, seq: number): Hex => toHex(toBytes(keccak256(toBytes(`proveit-copy-v1|${cardHash}|${seq}`))).slice(0, 16));
