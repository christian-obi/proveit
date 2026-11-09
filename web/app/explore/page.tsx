import type { Metadata } from "next";
import { cookies } from "next/headers";
import LiveBoard from "@/components/LiveBoard";
import { boardData } from "@/lib/board";
import { NETWORK_COOKIE, parseNetwork } from "@/lib/config";
import { SORTS, type Sort } from "@/lib/explore";

export const metadata: Metadata = { title: "Explore verified traders · Prove-It" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const q = (await searchParams).sort;
  const sort: Sort = SORTS.includes(q as Sort) ? (q as Sort) : "return";
  const board = await boardData(parseNetwork((await cookies()).get(NETWORK_COOKIE)?.value));
  return (
    <LiveBoard key={board.network} initial={board} initialSort={sort} sortable>
      <div className="space-y-2">
        <h1 className="text-4xl">Explore verified traders</h1>
        <p className="max-w-2xl text-sm text-muted">Every card here was computed in a TEE and recorded on NEAR. Revoked and replaced cards are hidden; cards not refreshed in 14 days are marked stale.</p>
      </div>
    </LiveBoard>
  );
}
