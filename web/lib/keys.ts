// Viewing keys from the browser: the registry's offer, the USDC payment, and the reveal.
// The follower's X25519 secret lives only in this page's memory; the enclave encrypts the
// trades to it, so neither this app's server nor the chain ever sees them in the clear.

import { rpc } from "@proveit/verify/checks";
import { config, MAX_GAS, networkFor } from "./config";
import { view, type RequestOutcome, type Tx } from "./near";

export type Offer = {
  price: string;
  delay_secs: number;
  duration_secs: number;
  max_seats: number;
  requires_approval: boolean;
  payout: string;
};
export type OfferView = { card_id: number; offer: Offer; seats_used: number; seats_left: number; waiting: number; token: string | null; fee_bps: number };
export type Grant = { buyer: string; paid: string; granted_at: number; expires_at: number; delay_secs: number; payout: string };
export type TokenMeta = { symbol: string; decimals: number };

/** Attached to request_reveal for the enclave run; OutLayer refunds what it doesn't use. */
export const REVEAL_DEPOSIT_YOCTO = "50000000000000000000000";

export const getOffer = (registry: string, cardId: number) => view<OfferView | null>(registry, "get_offer", { card_id: cardId });
export const getGrant = (registry: string, cardId: number, buyer: string) => view<Grant | null>(registry, "get_grant", { card_id: cardId, buyer });
export const isWaiting = async (registry: string, cardId: number, buyer: string) =>
  (await view<{ buyer: string }[]>(registry, "get_waiting", { card_id: cardId })).some((w) => w.buyer === buyer);
export const tokenMeta = (token: string) => view<TokenMeta>(token, "ft_metadata", {});
export const tokenBalance = async (token: string, account: string) => BigInt(await view<string>(token, "ft_balance_of", { account_id: account }));

export function formatAmount(raw: string | bigint, decimals: number): string {
  const v = BigInt(raw);
  const whole = v / 10n ** BigInt(decimals);
  const frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.slice(0, 2).padEnd(2, "0")}` : `${whole}`;
}

export function duration(secs: number): string {
  if (secs === 0) return "live";
  if (secs % 86_400 === 0) return `${secs / 86_400} day${secs === 86_400 ? "" : "s"}`;
  if (secs % 3_600 === 0) return `${secs / 3_600} hour${secs === 3_600 ? "" : "s"}`;
  return `${Math.round(secs / 60)} min`;
}

/** Pay for a key: USDC `ft_transfer_call` to the registry with the card id. */
export function buyTx(token: string, registry: string, cardId: number, price: string): Tx {
  return {
    receiverId: token,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "ft_transfer_call",
          args: { receiver_id: registry, amount: price, msg: JSON.stringify({ card_id: cardId }) },
          gas: "100000000000000",
          deposit: "1",
        },
      },
    ],
  };
}

export function revealTx(registry: string, cardId: number, x25519Pub: string): Tx {
  return {
    receiverId: registry,
    actions: [{ type: "FunctionCall", params: { methodName: "request_reveal", args: { card_id: cardId, x25519_pub: x25519Pub }, gas: MAX_GAS, deposit: REVEAL_DEPOSIT_YOCTO } }],
  };
}

export function txHash(outcome: unknown): string | null {
  const o = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
  return o?.transaction?.hash ?? o?.transaction_outcome?.id ?? null;
}

type TxResult = { status?: { SuccessValue?: string; Failure?: unknown }; final_execution_status?: string };

/**
 * The reveal arrives as the final return value of the follower's own transaction
 * (request_reveal → OutLayer → on_result), never in contract state. Poll until it's there.
 */
export async function waitForReveal(registry: string, hash: string, sender: string, onTick?: (s: number) => void): Promise<RequestOutcome> {
  const started = Date.now();
  const { rpc: recent, archivalRpc } = networkFor(registry);
  for (let attempt = 0; ; attempt++) {
    try {
      // Regular nodes forget transactions after a few days; every other try asks an archival one.
      const r = await rpc<TxResult>(attempt % 2 ? archivalRpc : recent, "tx", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
      if (r.status?.Failure) throw new Error(`the transaction failed: ${JSON.stringify(r.status.Failure)}`);
      if (r.status?.SuccessValue) return JSON.parse(atob(r.status.SuccessValue));
    } catch (e) {
      // Not final yet (the RPC times out while OutLayer runs), or not indexed yet.
      if (/failed:/.test((e as Error).message)) throw e;
    }
    if (Date.now() - started > 5 * 60_000) throw new Error("the enclave did not answer within 5 minutes");
    onTick?.(Math.round((Date.now() - started) / 1000));
    await new Promise((r) => setTimeout(r, 3000));
  }
}
