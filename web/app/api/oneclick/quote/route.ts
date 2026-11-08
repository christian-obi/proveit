// POST /api/oneclick/quote {cardId, buyer, originAsset, refundTo, dry?}
// Builds the 1Click quote on the server, with the price read from the registry (never from
// the browser) and the partner API key from ONECLICK_API_KEY, which never reaches the client.

import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { ONECLICK_API, quoteRequest } from "@/lib/oneclick";
import { getOffer } from "@/lib/keys";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { cardId?: unknown; buyer?: unknown; originAsset?: unknown; refundTo?: unknown; dry?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad JSON" }, { status: 400 });
  }
  const { cardId, buyer, originAsset, refundTo } = body;
  if (typeof cardId !== "number" || typeof buyer !== "string" || typeof originAsset !== "string" || typeof refundTo !== "string") {
    return NextResponse.json({ error: "cardId, buyer, originAsset and refundTo are required" }, { status: 400 });
  }
  if (!/^[a-z0-9._-]{2,64}$/.test(buyer)) return NextResponse.json({ error: "buyer must be a NEAR account" }, { status: 400 });
  const offer = await getOffer(config.registry, cardId).catch(() => null);
  if (!offer) return NextResponse.json({ error: "this card has no viewing keys for sale" }, { status: 404 });

  const request = quoteRequest({ registry: config.registry, cardId, buyer, price: offer.offer.price, originAsset, refundTo }, new Date(), body.dry === true);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.ONECLICK_API_KEY) headers["X-API-Key"] = process.env.ONECLICK_API_KEY;
  const res = await fetch(`${ONECLICK_API}/v0/quote`, { method: "POST", headers, body: JSON.stringify(request) });
  const data = await res.json().catch(() => ({ message: `1Click answered HTTP ${res.status}` }));
  if (!res.ok) return NextResponse.json({ error: data.message ?? "1Click refused the quote", keyConfigured: !!process.env.ONECLICK_API_KEY }, { status: 502 });
  return NextResponse.json({ quote: data.quote, request });
}
