// Paying for a viewing key from another chain through NEAR Intents 1Click: the follower
// deposits (say) USDC on Base; 1Click delivers exactly the key's price in USDC on NEAR to
// the registry with ft_transfer_call and `customRecipientMsg` as the msg, which the
// registry's ft_on_transfer reads ({"card_id", "buyer"}). If anything goes wrong 1Click
// refunds the deposit to the follower's own address on the origin chain.
//
// Shared by the browser (state machine, display) and the /api/oneclick routes (the only
// place the API key is used). Nothing here reads the key.

export const ONECLICK_API = "https://1click.chaindefuser.com";
/** Circle's native USDC on NEAR, the token keys are priced in on mainnet. */
export const NEAR_USDC_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const DEADLINE_MINUTES = 30;

export type OneClickToken = { assetId: string; decimals: number; blockchain: string; symbol: string; price?: number; contractAddress?: string };

export type QuoteInput = {
  registry: string;
  cardId: number;
  buyer: string;
  /** Exact amount the registry must receive, in USDC-on-NEAR base units (the key's price). */
  price: string;
  originAsset: string;
  /** The follower's own address on the origin chain; refunds go there. */
  refundTo: string;
};

export type QuoteRequest = {
  dry: boolean;
  swapType: "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
  customRecipientMsg: string;
  appFees: { recipient: string; fee: number }[];
  referral: string;
};

/**
 * The quote request. EXACT_OUTPUT so the registry receives exactly the price (an
 * underpayment would be refunded by the registry, not by 1Click). `appFees` is empty on
 * purpose: the registry already takes its fee on-chain, and the cross-chain path must not
 * charge twice.
 */
export function quoteRequest(q: QuoteInput, now: Date, dry = false): QuoteRequest {
  if (!/^\d+$/.test(q.price) || q.price === "0") throw new Error("price must be a positive integer in base units");
  if (!Number.isInteger(q.cardId) || q.cardId < 0) throw new Error("bad card id");
  if (!q.refundTo) throw new Error("a refund address on the origin chain is required");
  return {
    dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: q.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC_ASSET,
    amount: q.price,
    refundTo: q.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: q.registry,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now.getTime() + DEADLINE_MINUTES * 60_000).toISOString(),
    customRecipientMsg: JSON.stringify({ card_id: q.cardId, buyer: q.buyer }),
    appFees: [],
    referral: "proveit",
  };
}

export type Quote = {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  amountOut: string;
  deadline?: string;
  timeEstimate?: number;
};

/** Every value of the 1Click execution status enum (GET /v0/status). */
export const STATUSES = ["PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;
export type Status = (typeof STATUSES)[number];

export type UiState = { status: Status | "UNKNOWN"; final: boolean; tone: "wait" | "ok" | "bad"; message: string };

/** What the page shows for each 1Click status. Exhaustive: a new status is a type error. */
export function uiState(status: string): UiState {
  const s = status as Status;
  switch (s) {
    case "PENDING_DEPOSIT":
      return { status: s, final: false, tone: "wait", message: "Waiting for your deposit." };
    case "INCOMPLETE_DEPOSIT":
      return { status: s, final: false, tone: "bad", message: "The deposit is below the quoted amount. Send the rest before the deadline, or it is refunded to your address." };
    case "PROCESSING":
      return { status: s, final: false, tone: "wait", message: "Deposit received. Swapping and delivering USDC to the registry…" };
    case "SUCCESS":
      return { status: s, final: true, tone: "ok", message: "Delivered. The registry is writing your key." };
    case "REFUNDED":
      return { status: s, final: true, tone: "bad", message: "Refunded to your address on the origin chain. No key was bought." };
    case "FAILED":
      return { status: s, final: true, tone: "bad", message: "The swap failed. Funds that arrived are refunded to your address." };
    default: {
      const unknown: never = s;
      return { status: "UNKNOWN", final: false, tone: "wait", message: `1Click reports "${unknown}"; still waiting.` };
    }
  }
}

/** Tokens a follower can pay with, best first: stablecoins on the cheaper chains. */
export function payableTokens(tokens: OneClickToken[]): OneClickToken[] {
  const rank = (t: OneClickToken) => (t.symbol === "USDC" ? 0 : t.symbol === "USDT" ? 1 : 2) * 10 + (["base", "arb", "sol", "eth"].indexOf(t.blockchain) + 1 || 9);
  return tokens.filter((t) => t.blockchain !== "near").sort((a, b) => rank(a) - rank(b));
}
