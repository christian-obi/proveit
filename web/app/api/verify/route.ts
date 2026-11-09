// GET /api/verify?card=<id | card url>[&registry=…][&guard=1&min_trades=…&max_dd=…&min_days=…&allow_demo=1]
//
// The five checks as JSON, from public data only (the same code as `pnpm verify` and the
// verify panel), for agents and apps. With guard=1 the agent guard's verdict is added.

import { NextResponse } from "next/server";
import { verifyCard } from "@proveit/verify/checks";
import { DEFAULT_POLICY, judge } from "@proveit/verify/guard";
import { config, endpointsFor, isKnownRegistry } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const card = q.get("card") ?? "";
  let registry = q.get("registry") ?? config.registry;
  let id: number;
  const m = card.match(/\/(c|demo)\/(\d+)/);
  if (m) {
    id = Number(m[2]);
    if (!q.get("registry")) registry = m[1] === "demo" ? config.demoRegistry : config.registry;
  } else if (/^\d+$/.test(card)) id = Number(card);
  else return NextResponse.json({ error: "card must be a card id or a card URL" }, { status: 400 });
  if (!isKnownRegistry(registry)) return NextResponse.json({ error: `unknown registry ${registry}` }, { status: 400 });

  const report = await verifyCard({ registry, cardId: id }, endpointsFor(registry));
  const body: Record<string, unknown> = {
    registry,
    card_id: id,
    ok: report.ok,
    checks: report.checks,
    card: report.card,
    attestation: report.attestationUrl,
  };
  if (q.get("guard") === "1") {
    const n = (k: string, d: number) => (q.get(k) !== null && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : d);
    const policy = {
      minTrades: n("min_trades", DEFAULT_POLICY.minTrades),
      maxDrawdownBps: Math.round(n("max_dd", DEFAULT_POLICY.maxDrawdownBps / 100) * 100),
      minWindowDays: n("min_days", DEFAULT_POLICY.minWindowDays),
      allowDemo: q.get("allow_demo") === "1",
      allowWarnings: q.get("allow_warnings") === "1",
    };
    body.guard = { policy, ...judge(report, policy) };
  }
  return NextResponse.json(body, { status: report.record ? 200 : 404, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" } });
}
