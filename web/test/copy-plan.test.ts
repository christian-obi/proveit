import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, planCopy } from "@/lib/copy-plan";
import type { Follower, Market } from "@/lib/hyperliquid";

const btc: Market = { asset: 0, szDecimals: 5, mid: 100_000 };
const flat: Follower = { equity: 100, exposure: 0, positions: {} };
const settings = { ...DEFAULT_SETTINGS, maxUsd: 1_000 };
const open = (size_bps: number) => ({ coin: "BTC", dir: "Open Long", size_bps });

describe("planCopy", () => {
  it("scales by the follower's equity", () => {
    const p = planCopy(open(2_500), flat, btc, settings);
    expect(p).toMatchObject({ kind: "order", isBuy: true, reduceOnly: false, size: 0.00025 });
  });
  it("applies the multiplier", () => {
    expect(planCopy(open(2_500), flat, btc, { ...settings, multiplierPct: 50 })).toMatchObject({ size: 0.00012 });
    expect(planCopy(open(1_500), flat, btc, { ...settings, multiplierPct: 50 })).toMatchObject({ kind: "skip" });
    expect(planCopy(open(5_000), flat, btc, { ...settings, multiplierPct: 50 })).toMatchObject({ size: 0.00025 });
  });
  it("sets the limit from the slippage bound, in the right direction", () => {
    const limit = (p: ReturnType<typeof planCopy>) => (p.kind === "order" ? p.limit : NaN);
    expect(limit(planCopy(open(2_500), flat, btc, settings))).toBeCloseTo(100_500, 6);
    expect(limit(planCopy({ coin: "BTC", dir: "Open Short", size_bps: 2_500 }, flat, btc, settings))).toBeCloseTo(99_500, 6);
  });
  it("never exceeds the per-trade cap", () => {
    expect(planCopy(open(9_000), { ...flat, equity: 1_000 }, btc, { ...settings, maxUsd: 25 })).toMatchObject({ size: 0.00025 });
  });
  it("never exceeds the leverage limit", () => {
    const p = planCopy(open(50_000), { equity: 100, exposure: 280, positions: {} }, btc, { ...settings, maxLeverage: 3 });
    expect(p).toMatchObject({ kind: "order", size: 0.0002 });
    expect(planCopy(open(50_000), { equity: 100, exposure: 295, positions: {} }, btc, settings)).toMatchObject({ kind: "skip", reason: expect.stringContaining("leverage") });
  });
  it("skips instead of rounding up to the minimum", () => {
    expect(planCopy(open(500), flat, btc, settings)).toMatchObject({ kind: "skip", reason: expect.stringContaining("minimum") });
  });
  it("skips what it can't copy", () => {
    expect(planCopy({ coin: "BTC", dir: "Long > Short", size_bps: 5_000 }, flat, btc, settings).kind).toBe("skip");
    expect(planCopy({ coin: "@107", dir: "Buy", size_bps: 5_000 }, flat, null, settings).kind).toBe("skip");
    expect(planCopy(open(5_000), flat, null, settings).kind).toBe("skip");
    expect(planCopy(open(5_000), { ...flat, equity: 0 }, btc, settings).kind).toBe("skip");
  });
  describe("closing", () => {
    const close = (size_bps: number) => ({ coin: "BTC", dir: "Close Long", size_bps });
    const long = (szi: number): Follower => ({ equity: 100, exposure: szi * 100_000, positions: { BTC: szi } });
    it("is always reduce-only", () => {
      expect(planCopy(close(1_500), long(0.0005), btc, settings)).toMatchObject({ kind: "order", isBuy: false, reduceOnly: true });
    });
    it("needs a matching position", () => {
      expect(planCopy(close(1_500), flat, btc, settings).kind).toBe("skip");
      expect(planCopy(close(1_500), long(-0.0005), btc, settings).kind).toBe("skip");
    });
    it("closes part when the rest stays tradable", () => {
      expect(planCopy(close(1_500), long(0.0005), btc, settings)).toMatchObject({ size: 0.00015 });
    });
    it("never closes more than is held", () => {
      expect(planCopy(close(9_000), long(0.0002), btc, settings)).toMatchObject({ size: 0.0002 });
    });
    it("closes everything when the leftover would be stuck", () => {
      expect(planCopy(close(1_500), long(0.00017), btc, settings)).toMatchObject({ size: 0.00017 });
      expect(planCopy(close(500), long(0.0005), btc, settings)).toMatchObject({ size: 0.0005 });
    });
  });
});
