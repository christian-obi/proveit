import { describe, expect, it } from "vitest";
import { shareTargets, shareText } from "../lib/share";

describe("share", () => {
  const stats = { return_bps: 1234, max_dd_bps: 500, trades: 42 };

  it("states the return, window and how to verify", () => {
    const t = shareText(stats, 30, false);
    expect(t).toMatch(/^\+12\.34% on Hyperliquid in 30 days, signed in a TEE/);
    expect(t).not.toContain("demo");
    expect(t).toMatch(/Verify it yourself:$/);
  });

  it("labels demo cards", () => {
    expect(shareText(stats, 30, true)).toContain("(demo card)");
  });

  it("builds encoded share links and the image URL", () => {
    const s = shareTargets("a & b", "https://x.test/c/3");
    expect(s.x).toBe("https://x.com/intent/post?text=a%20%26%20b&url=https%3A%2F%2Fx.test%2Fc%2F3");
    expect(s.telegram).toBe("https://t.me/share/url?url=https%3A%2F%2Fx.test%2Fc%2F3&text=a%20%26%20b");
    expect(s.image).toBe("https://x.test/c/3/opengraph-image");
  });
});
