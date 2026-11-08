// GET /api/oneclick/tokens : the tokens 1Click accepts, cached for an hour.

import { NextResponse } from "next/server";
import { ONECLICK_API, payableTokens, type OneClickToken } from "@/lib/oneclick";

export const revalidate = 3600;

export async function GET() {
  const res = await fetch(`${ONECLICK_API}/v0/tokens`, { next: { revalidate: 3600 } });
  if (!res.ok) return NextResponse.json({ error: `1Click answered HTTP ${res.status}` }, { status: 502 });
  const tokens = payableTokens((await res.json()) as OneClickToken[]).map(({ assetId, decimals, blockchain, symbol, price }) => ({ assetId, decimals, blockchain, symbol, price }));
  return NextResponse.json({ tokens });
}
