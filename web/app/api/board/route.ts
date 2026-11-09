// The live board as JSON: what the site polls, and open to agents. Public registry data only.

import { NextResponse } from "next/server";
import { boardData } from "@/lib/board";
import { parseNetwork } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const network = parseNetwork(new URL(request.url).searchParams.get("network"));
  return NextResponse.json(await boardData(network), { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
