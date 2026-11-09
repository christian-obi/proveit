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

export async function connectNear(network: Network = config.network): Promise<NearSession> {
  if (config.e2e) {
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
      async disconnect() {},
    };
  }
  const { NearConnector } = await import("@hot-labs/near-connect");
  const connector = new NearConnector({ network, footerBranding: null });
  const wallet = await connector.connect();
  const accounts = await wallet.getAccounts();
  if (!accounts.length) throw new Error("the wallet returned no account");
  return {
    accountId: accounts[0].accountId,
    signAndSendTransactions: (txs) =>
      wallet.signAndSendTransactions({ network, signerId: accounts[0].accountId, transactions: txs }),
    async signMessage(message, recipient) {
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const signed = await wallet.signMessage({ message, recipient, nonce } as never);
      const s = signed as unknown as { accountId: string; publicKey: string; signature: string };
      return { account_id: s.accountId, public_key: s.publicKey, signature: s.signature, message, nonce: toB64(nonce), recipient };
    },
    disconnect: () => connector.disconnect(wallet),
  };
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
  return accounts[0];
}

/** Ask the Hyperliquid account's wallet to sign the ownership message. */
export async function signOwnership(account: `0x${string}`, nearAccount: string, nonce: number, expiry: number) {
  if (!window.ethereum) throw new Error("No EVM wallet found.");
  const client = createWalletClient({ account, transport: custom(window.ethereum) });
  return client.signTypedData(typedData(account, nearAccount, nonce, expiry));
}
