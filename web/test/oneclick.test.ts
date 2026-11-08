// T8.1 and T8.2: the 1Click state machine and quote request, against the recorded spec and responses.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NEAR_USDC_ASSET, payableTokens, quoteRequest, STATUSES, uiState } from "../lib/oneclick";

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "oneclick", name), "utf8"));

describe("T8.1: every status in the 1Click spec", () => {
  const spec: string[] = fx("status-enum.json").status;
  test("the UI knows exactly the spec's statuses", () => {
    expect([...STATUSES].sort()).toEqual([...spec].sort());
  });
  test.each(spec)("%s has a message and a final/waiting state", (s) => {
    const u = uiState(s);
    expect(u.status).toBe(s);
    expect(u.message.length).toBeGreaterThan(10);
  });
  test("only SUCCESS, REFUNDED and FAILED end the flow; only SUCCESS is good", () => {
    expect(spec.filter((s) => uiState(s).final).sort()).toEqual(["FAILED", "REFUNDED", "SUCCESS"]);
    expect(spec.filter((s) => uiState(s).tone === "ok")).toEqual(["SUCCESS"]);
  });
  test("an unknown future status keeps waiting instead of crashing", () => {
    expect(uiState("SOMETHING_NEW")).toMatchObject({ status: "UNKNOWN", final: false });
  });
});

describe("T8.2: the quote request", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const req = quoteRequest(
    { registry: "proveit.near", cardId: 3, buyer: "follower.near", price: "1000000", originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", refundTo: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
    now,
  );
  test("snapshot", () => {
    expect(req).toMatchInlineSnapshot(`
      {
        "amount": "1000000",
        "appFees": [],
        "customRecipientMsg": "{"card_id":3,"buyer":"follower.near"}",
        "deadline": "2026-11-13T12:30:00.000Z",
        "depositType": "ORIGIN_CHAIN",
        "destinationAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
        "dry": false,
        "originAsset": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
        "recipient": "proveit.near",
        "recipientType": "DESTINATION_CHAIN",
        "referral": "proveit",
        "refundTo": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "refundType": "ORIGIN_CHAIN",
        "slippageTolerance": 100,
        "swapType": "EXACT_OUTPUT",
      }
    `);
  });
  test("customRecipientMsg is exactly what the registry's ft_on_transfer parses", () => {
    expect(JSON.parse(req.customRecipientMsg)).toEqual({ card_id: 3, buyer: "follower.near" });
  });
  test("the registry receives exactly the price, in native USDC, and refunds go to the follower's origin address", () => {
    expect([req.swapType, req.amount, req.destinationAsset, req.refundType]).toEqual(["EXACT_OUTPUT", "1000000", NEAR_USDC_ASSET, "ORIGIN_CHAIN"]);
  });
  test("one fee only: the registry's on-chain fee, no 1Click app fee on top", () => {
    expect(req.appFees).toEqual([]);
  });
  test("the recorded dry quote accepted this request shape", () => {
    const rec = fx("quote-dry.json");
    for (const k of ["swapType", "depositType", "destinationAsset", "recipientType", "refundType", "amount", "customRecipientMsg"]) expect(Object.keys(rec.request)).toContain(k);
    expect(rec.response.quote.amountOut).toBe("1000000");
    expect(BigInt(rec.response.quote.amountIn)).toBeGreaterThan(1_000_000n);
  });
  test("bad input is refused before anything is sent", () => {
    const base = { registry: "r.near", cardId: 1, buyer: "b.near", price: "1", originAsset: "x", refundTo: "0x1" };
    expect(() => quoteRequest({ ...base, price: "0" }, now)).toThrow();
    expect(() => quoteRequest({ ...base, price: "1.5" }, now)).toThrow();
    expect(() => quoteRequest({ ...base, refundTo: "" }, now)).toThrow();
    expect(() => quoteRequest({ ...base, cardId: -1 }, now)).toThrow();
  });
});

test("payable tokens: stablecoins on cheap chains first, nothing already on NEAR", () => {
  const list = payableTokens(fx("tokens.json").tokens);
  expect(list[0]).toMatchObject({ symbol: "USDC", blockchain: "base" });
  expect(list.some((t) => t.blockchain === "near")).toBe(false);
});
