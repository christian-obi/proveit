// Anonymous card reactions. Only cards on the registries can be reacted to, and clicks are
// rate limited. Reactions never affect a card's checks or its rank.

import { NextResponse } from "next/server";
import { boardData } from "@/lib/board";
import { entryKey } from "@/lib/board-view";
import { networkFor } from "@/lib/config";
import { CARD_KEY } from "@/lib/reaction-kinds";
import { addReaction, allCounts, allowClicks, countsOf, isKind } from "@/lib/reactions";

export const dynamic = "force-dynamic";

const MAX_BATCH = 50;
const headers = { "Cache-Control": "no-store" };

export function GET(request: Request) {
  const card = new URL(request.url).searchParams.get("card");
  if (card === null) return NextResponse.json({ reactions: allCounts() }, { headers });
  if (!CARD_KEY.test(card)) return NextResponse.json({ error: "card must be <registry>:<id>" }, { status: 400, headers });
  return NextResponse.json({ counts: countsOf(card) }, { headers });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { card, kind, n } = (body ?? {}) as { card?: unknown; kind?: unknown; n?: unknown };
  if (typeof card !== "string" || !CARD_KEY.test(card) || !isKind(kind) || !Number.isInteger(n) || (n as number) < 1 || (n as number) > MAX_BATCH) {
    return NextResponse.json({ error: "send card, kind (fire, proveit or near) and n (1 to 50)" }, { status: 400, headers });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowClicks(ip, n as number)) return NextResponse.json({ error: "too many clicks", counts: countsOf(card) }, { status: 429, headers });
  const known = (await boardData(networkFor(card.split(":")[0]).network)).entries.some((e) => entryKey(e) === card);
  if (!known) return NextResponse.json({ error: "no such card" }, { status: 404, headers });
  return NextResponse.json({ counts: addReaction(card, kind, n as number) }, { headers });
}
