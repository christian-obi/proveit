import { describe, expect, it } from "vitest";
import { returnLabel, volume } from "@/lib/format";

describe("card numbers read naturally", () => {
  it("positive ranges use a dash", () => {
    expect(returnLabel({ return_bps: 1400, return_precision_bps: 100 })).toBe("+14–15%");
  });
  it("negative ranges never show a double minus", () => {
    expect(returnLabel({ return_bps: -190, return_precision_bps: 10 })).toBe("-1.9% to -1.8%");
    expect(returnLabel({ return_bps: -50, return_precision_bps: 100 })).toBe("-1% to +1%");
  });
  it("exact returns keep their sign", () => {
    expect(returnLabel({ return_bps: -183 })).toBe("-1.83%");
  });
  it("small volume is labelled, not blank", () => {
    expect(volume("1e2")).toBe("under $1K");
    expect(volume("1e7")).toBe("$10M+");
  });
});
