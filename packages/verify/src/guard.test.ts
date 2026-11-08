// The agent guard's policy, on reports from the real check code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, DEFAULT_POLICY } from "./guard.ts";
import type { Report } from "./checks.ts";

const report = (over: Partial<Record<string, "pass" | "fail" | "warn">> = {}, card: any = {}, details: Record<string, string> = {}): Report =>
  ({
    ok: !Object.values(over).includes("fail"),
    checks: (["signature", "record", "code", "attestation", "freshness"] as const).map((id) => ({ id, label: id, status: over[id] ?? "pass", detail: details[id] ?? "fine" })),
    card: { mode: "live", window: { days: 30 }, stats: { trades: 42, max_dd_bps: 1_200 }, ...card },
    record: null,
    attestationUrl: null,
  }) as unknown as Report;

test("a green live card within policy: follow", () => {
  assert.deepEqual(judge(report()), { follow: true, reasons: [] });
});

test("any failed check refuses, with the check's reason", () => {
  const v = judge(report({ signature: "fail" }, {}, { signature: "signature mismatch" }));
  assert.equal(v.follow, false);
  assert.match(v.reasons[0], /signature mismatch/);
});

test("policy: too few trades, too deep a drawdown, too short a window", () => {
  const v = judge(report({}, { window: { days: 1 }, stats: { trades: 5, max_dd_bps: 6_283 } }));
  assert.equal(v.reasons.length, 3);
});

test("demo cards are refused unless allowed; then their demo warning is accepted, other warnings aren't", () => {
  const demo = report({ freshness: "warn" }, { mode: "fixture" }, { freshness: "issued today; a demo card from a recorded public account" });
  assert.equal(judge(demo).follow, false);
  assert.equal(judge(demo, { ...DEFAULT_POLICY, allowDemo: true }).follow, true);
  const staleDemo = report({ freshness: "warn" }, { mode: "fixture" }, { freshness: "issued 30 days ago; the trader should refresh it; a demo card" });
  assert.equal(judge(staleDemo, { ...DEFAULT_POLICY, allowDemo: true }).follow, false);
});

test("warnings refuse by default", () => {
  assert.equal(judge(report({ attestation: "warn" })).follow, false);
  assert.equal(judge(report({ attestation: "warn" }), { ...DEFAULT_POLICY, allowWarnings: true }).follow, true);
});
