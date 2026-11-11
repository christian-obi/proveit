// Wallet connections. NEAR goes through HOT's near-connect (HOT, Meteor, MyNearWallet, …);
// the Hyperliquid account's EVM wallet (MetaMask, Rabby, …) through the injected provider.
//
// With NEXT_PUBLIC_E2E=1 (Playwright builds only) the NEAR wallet is a fake that records
// transactions on window.__proveitSent instead of sending them.

import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { config, type Network } from "./config";
import type { Tx } from "./near";
import { typedData } from "./ownership";

/** NEP-413 signMessage result, in the shape the enclave reads (src/nep413.rs). */
export type SignedMessage = { account_id: string; public_key: string; signature: string; message: string; nonce: string; recipient: string };

export type NearSession = {
  accountId: string;
  signAndSendTransactions(txs: Tx[]): Promise<unknown[]>;
  signMessage(message: string, recipient: string): Promise<SignedMessage>;
  disconnect(): Promise<void>;
};

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
    __proveitSent?: Tx[][];
    /** Playwright only: the fake wallet's account and the tx hash it reports. */
    __proveitE2eAccount?: string;
    __proveitE2eTxHash?: string;
  }
}

// One session per network, shared by every page, and restored from the wallet's own storage
// after a reload: connecting once is enough, as on any other dapp.
const sessions = new Map<Network, NearSession>();
const CHANGED = "proveit-wallets-changed";
const announce = () => window.dispatchEvent(new Event(CHANGED));

/** Calls `onChange` whenever a NEAR or EVM wallet connects or disconnects anywhere on the page. */
export function onWalletChange(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

export const currentNear = (network: Network) => sessions.get(network) ?? null;

type Connector = import("@hot-labs/near-connect").NearConnector;
type NearWallet = Awaited<ReturnType<Connector["connect"]>>;
const connectors = new Map<Network, Promise<Connector>>();

function connector(network: Network): Promise<Connector> {
  let c = connectors.get(network);
  if (!c) {
    c = import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({ network, footerBranding: null }));
    connectors.set(network, c);
  }
  return c;
}

const e2eFlag = (network: Network) => `proveit-e2e-near-${network}`;

function fakeSession(network: Network): NearSession {
  return {
    accountId: window.__proveitE2eAccount ?? "e2e-trader.testnet",
    async signAndSendTransactions(txs) {
      (window.__proveitSent ??= []).push(txs);
      return txs.map(() => ({ receipts_outcome: [], transaction: { hash: window.__proveitE2eTxHash ?? "e2e-not-sent" } }));
    },
    async signMessage(message, recipient) {
      // A PUBLIC test key (seed 32×0x01): only for Playwright against recorded answers.
      const { ed25519 } = await import("@noble/curves/ed25519");
      const { nep413Hash, base58Encode } = await import("@proveit/verify/feed");
      const seed = new Uint8Array(32).fill(1);
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const sig = ed25519.sign(nep413Hash(message, nonce, recipient), seed);
      return {
        account_id: window.__proveitE2eAccount ?? "e2e-trader.testnet",
        public_key: `ed25519:${base58Encode(ed25519.getPublicKey(seed))}`,
        signature: toB64(sig),
        message,
        nonce: toB64(nonce),
        recipient,
      };
    },
    async disconnect() {
      try {
        localStorage.removeItem(e2eFlag(network));
      } catch {}
      sessions.delete(network);
      announce();
    },
  };
}

function sessionOf(c: Connector, wallet: NearWallet, accountId: string, network: Network): NearSession {
  return {
    accountId,
    signAndSendTransactions: (txs) => wallet.signAndSendTransactions({ network, signerId: accountId, transactions: txs } as never) as Promise<unknown[]>,
    async signMessage(message, recipient) {
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const signed = await wallet.signMessage({ message, recipient, nonce } as never);
      const s = signed as unknown as { accountId: string; publicKey: string; signature: string };
      return { account_id: s.accountId, public_key: s.publicKey, signature: s.signature, message, nonce: toB64(nonce), recipient };
    },
    async disconnect() {
      await c.disconnect(wallet).catch(() => undefined);
      sessions.delete(network);
      announce();
    },
  };
}

function remember(network: Network, s: NearSession) {
  sessions.set(network, s);
  announce();
  return s;
}

/** Asks the user to pick a wallet, unless one is already connected on this network. */
export async function connectNear(network: Network = config.network): Promise<NearSession> {
  const have = sessions.get(network);
  if (have) return have;
  if (config.e2e) {
    try {
      localStorage.setItem(e2eFlag(network), "1");
    } catch {}
    return remember(network, fakeSession(network));
  }
  const c = await connector(network);
  const wallet = await c.connect();
  const accounts = await wallet.getAccounts();
  if (!accounts.length) throw new Error("the wallet returned no account");
  return remember(network, sessionOf(c, wallet, accounts[0].accountId, network));
}

/** The wallet connected earlier on this network, without asking anything. */
export async function restoreNear(network: Network): Promise<NearSession | null> {
  const have = sessions.get(network);
  if (have) return have;
  if (config.e2e) {
    let flagged = false;
    try {
      flagged = localStorage.getItem(e2eFlag(network)) === "1";
    } catch {}
    return flagged ? remember(network, fakeSession(network)) : null;
  }
  try {
    const c = await connector(network);
    const found = await c.getConnectedWallet();
    const accountId = found?.accounts?.[0]?.accountId;
    if (!found || !accountId) return null;
    return sessions.get(network) ?? remember(network, sessionOf(c, found.wallet as NearWallet, accountId, network));
  } catch {
    return null;
  }
}

let evmAccount: `0x${string}` | null = null;
export const currentEvm = () => evmAccount;

/** The EVM account this site may already use, without a prompt. */
export async function restoreEvm(): Promise<`0x${string}` | null> {
  if (evmAccount || !window.ethereum) return evmAccount;
  try {
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as `0x${string}`[];
    if (accounts?.length) {
      evmAccount = accounts[0];
      announce();
    }
  } catch {}
  return evmAccount;
}

function toB64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export async function connectEvm(): Promise<`0x${string}`> {
  if (!window.ethereum) throw new Error("No EVM wallet found. Install MetaMask or Rabby, or open this page in your wallet's browser.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  if (!accounts?.length) throw new Error("The EVM wallet returned no account.");
  evmAccount = accounts[0];
  announce();
  return evmAccount;
}

/** Ask the Hyperliquid account's wallet to sign the ownership message. */
export async function signOwnership(account: `0x${string}`, nearAccount: string, nonce: number, expiry: number) {
  if (!window.ethereum) throw new Error("No EVM wallet found.");
  const client = createWalletClient({ account, transport: custom(window.ethereum) });
  return client.signTypedData(typedData(account, nearAccount, nonce, expiry));
}
