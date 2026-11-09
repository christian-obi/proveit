// The live board as JSON: what the site polls, and open to agents. Public registry data only.

import { NextResponse } from "next/server";
import { boardData } from "@/lib/board";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await boardData(), { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
