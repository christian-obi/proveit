// Wallet connections. NEAR goes through HOT's near-connect (HOT, Meteor, MyNearWallet, …);
// the Hyperliquid account's EVM wallet (MetaMask, Rabby, …) through the injected provider.
//
// With NEXT_PUBLIC_E2E=1 (Playwright builds only) the NEAR wallet is a fake that records
// transactions on window.__proveitSent instead of sending them.

import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { config } from "./config";
import type { Tx } from "./near";
import { typedData } from "./ownership";

export type NearSession = {
  accountId: string;
  signAndSendTransactions(txs: Tx[]): Promise<unknown[]>;
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

export async function connectNear(): Promise<NearSession> {
  if (config.e2e) {
    return {
      accountId: window.__proveitE2eAccount ?? "e2e-trader.testnet",
      async signAndSendTransactions(txs) {
        (window.__proveitSent ??= []).push(txs);
        return txs.map(() => ({ receipts_outcome: [], transaction: { hash: window.__proveitE2eTxHash ?? "e2e-not-sent" } }));
      },
      async disconnect() {},
    };
  }
  const { NearConnector } = await import("@hot-labs/near-connect");
  const connector = new NearConnector({ network: config.network, footerBranding: null });
  const wallet = await connector.connect();
  const accounts = await wallet.getAccounts();
  if (!accounts.length) throw new Error("the wallet returned no account");
  return {
    accountId: accounts[0].accountId,
    signAndSendTransactions: (txs) =>
      wallet.signAndSendTransactions({ network: config.network, signerId: accounts[0].accountId, transactions: txs }),
    disconnect: () => connector.disconnect(wallet),
  };
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
