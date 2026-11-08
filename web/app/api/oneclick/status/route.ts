// GET /api/oneclick/status?depositAddress=… : 1Click's execution status, with the API key added server-side.

import { NextResponse } from "next/server";
import { ONECLICK_API } from "@/lib/oneclick";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("depositAddress") ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(address)) return NextResponse.json({ error: "bad deposit address" }, { status: 400 });
  const headers: Record<string, string> = {};
  if (process.env.ONECLICK_API_KEY) headers["X-API-Key"] = process.env.ONECLICK_API_KEY;
  const res = await fetch(`${ONECLICK_API}/v0/status?depositAddress=${encodeURIComponent(address)}`, { headers, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: data.message ?? `1Click answered HTTP ${res.status}` }, { status: 502 });
  return NextResponse.json({ status: data.status, swapDetails: data.swapDetails ?? null });
}
