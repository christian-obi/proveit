import { describe, expect, it } from "vitest";
import { errorText } from "../lib/errors";

describe("errorText", () => {
  it("reads Errors and strings", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("plain")).toBe("plain");
  });

  it("reads wallet error objects instead of [object Object]", () => {
    expect(errorText({ code: -32602, message: "Provided chainId \"42161\" must match the active chainId \"1\"" })).toContain("must match the active chainId");
    expect(errorText({ code: -32603, data: { message: "inner reason" } })).toBe("inner reason");
  });

  it("says plainly when the person declined", () => {
    expect(errorText({ code: 4001, message: "User rejected the request." })).toBe("You declined the request in your wallet.");
  });

  it("never prints [object Object]", () => {
    expect(errorText({})).toBe("Something went wrong.");
    expect(errorText(null)).toBe("Something went wrong.");
    expect(errorText({ weird: 1 })).toBe('{"weird":1}');
  });
});
