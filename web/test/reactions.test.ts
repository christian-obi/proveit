import { describe, expect, it } from "vitest";
import { heatOf, mergeCounts, pileSize, seeded, tierOf } from "@/lib/reaction-kinds";
import { allowClicks } from "@/lib/reactions";

describe("reactions", () => {
  it("keeps the higher count of two views", () => {
    expect(mergeCounts({ fire: 3, proveit: 0, near: 9 }, { fire: 1, proveit: 2, near: 9 })).toEqual({ fire: 3, proveit: 2, near: 9 });
  });
  it("draws one icon each at first, then a bounded number", () => {
    expect(pileSize(0)).toBe(0);
    expect(pileSize(60)).toBe(60);
    expect(pileSize(61)).toBeGreaterThanOrEqual(60);
    expect(pileSize(10_000_000)).toBe(140);
  });
  it("tiers rise with total reactions", () => {
    expect([0, 1, 9, 10, 50, 250, 1000, 1e6].map(tierOf)).toEqual([0, 1, 1, 2, 3, 4, 5, 5]);
  });
  it("heat stays between 0 and 1", () => {
    expect(heatOf(0)).toBe(0);
    expect(heatOf(1e9)).toBe(1);
  });
  it("a card's random sequence is the same everywhere", () => {
    expect(seeded("a:1")()).toBe(seeded("a:1")());
    expect(seeded("a:1")()).not.toBe(seeded("a:2")());
  });
  it("limits clicks per address and refills over time", () => {
    const at = 1_000_000;
    expect(allowClicks("t", 200, at)).toBe(true);
    expect(allowClicks("t", 1, at)).toBe(false);
    expect(allowClicks("t", 25, at + 1_000)).toBe(true);
    expect(allowClicks("other", 1, at)).toBe(true);
  });
});
