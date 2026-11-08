import type { Metadata } from "next";
import Link from "next/link";
import CardRow from "@/components/CardRow";
import { allCards, rank, SORTS, type Sort } from "@/lib/explore";

export const metadata: Metadata = { title: "Explore verified traders · Prove-It" };
export const revalidate = 60;

const LABEL: Record<Sort, string> = { return: "Return", drawdown: "Lowest drawdown", trades: "Most trades", newest: "Newest" };

export default async function Page({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const q = (await searchParams).sort;
  const sort: Sort = SORTS.includes(q as Sort) ? (q as Sort) : "return";
  const cards = rank(await allCards(), sort);
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Explore verified traders</h1>
        <p className="text-sm text-muted">Every card here was computed in a TEE and recorded on NEAR. Revoked and replaced cards are hidden; cards not refreshed in 14 days are marked stale.</p>
      </div>
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Sort">
        {SORTS.map((s) => (
          <Link key={s} href={`/explore?sort=${s}`} className={`rounded-md border px-3 py-1 ${s === sort ? "border-accent text-fg" : "border-line text-muted"}`} aria-current={s === sort ? "page" : undefined}>
            {LABEL[s]}
          </Link>
        ))}
      </nav>
      {cards.length === 0 ? <p className="text-sm text-muted">No cards yet.</p> : <ul className="space-y-3">{cards.map((e) => <CardRow key={`${e.registry}:${e.record.id}`} e={e} />)}</ul>}
    </section>
  );
}
