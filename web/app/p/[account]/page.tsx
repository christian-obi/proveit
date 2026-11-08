import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CardRow from "@/components/CardRow";
import { cardsOf } from "@/lib/explore";

type Props = { params: Promise<{ account: string }> };
export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${(await params).account} · Prove-It` };
}

export default async function Page({ params }: Props) {
  const account = decodeURIComponent((await params).account);
  if (!/^[a-z0-9._-]{2,64}$/.test(account)) notFound();
  const cards = await cardsOf(account);
  // Cards from the same trading account share a commitment (a MAC of the address that
  // nobody can reverse): the profile shows how many accounts stand behind the cards.
  const accounts = new Set(cards.map((e) => e.record.commitment)).size;
  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-mono text-2xl font-semibold">{account}</h1>
        <p className="text-sm text-muted">
          {cards.length} card{cards.length === 1 ? "" : "s"} from {accounts} trading account{accounts === 1 ? "" : "s"}, newest first. Cards from the same account share a commitment that can&apos;t be reversed into the address, so
          a trader can&apos;t show only their good account without it being visible here.
        </p>
      </div>
      {cards.length === 0 ? (
        <p className="text-sm text-muted">No cards from this account.</p>
      ) : (
        <ul className="space-y-3">
          {cards.map((e) => (
            <CardRow key={`${e.registry}:${e.record.id}`} e={e} showIssuer={false} />
          ))}
        </ul>
      )}
    </section>
  );
}
