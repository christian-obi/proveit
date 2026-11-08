import Link from "next/link";
import Card from "@/components/Card";
import FakeScreenshot from "@/components/FakeScreenshot";
import VerifyPanel from "@/components/VerifyPanel";
import { cardPath, loadCard } from "@/lib/cards";
import { config } from "@/lib/config";

export const revalidate = 60;

// The card shown next to the fake: NEXT_PUBLIC_FEATURED_CARD="<registry>:<id>", default demo card #2 (it sells viewing keys).
const [featuredRegistry, featuredId] = (process.env.NEXT_PUBLIC_FEATURED_CARD ?? `${config.demoRegistry}:2`).split(":");

export default async function Home() {
  const featured = await loadCard(featuredId, featuredRegistry).catch(() => null);
  return (
    <div className="space-y-12">
      <section className="space-y-4 pt-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Screenshots can be faked. Prove-It cards can&apos;t.</h1>
        <p className="max-w-2xl text-muted">
          A trader proves their Hyperliquid performance without revealing their wallet. An Intel TDX enclave reads the account, computes the
          stats and signs a card; the card is recorded on NEAR, and anyone can check it in one click.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/create" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
            Create a card
          </Link>
          <Link href="/verify" className="rounded-md border border-line px-4 py-2 text-sm">
            Verify a card
          </Link>
        </div>
      </section>

      <section className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">A screenshot</h2>
          <FakeScreenshot />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">A Prove-It card</h2>
          {featured ? (
            <>
              <Card card={featured.card} id={featured.record.id} />
              <VerifyPanel registry={featured.registry} cardId={featured.record.id} cardJson={featured.record.card_json} />
              <Link href={cardPath(featured.record.id, featured.registry)} className="text-xs text-muted underline">
                Open this card&apos;s page
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted">The featured card couldn&apos;t be loaded from {featuredRegistry}.</p>
          )}
        </div>
      </section>

      <section className="grid gap-6 border-t border-line pt-8 text-sm sm:grid-cols-3">
        {[
          ["Private", "The wallet address never appears on the card or on-chain. Only the enclave sees it."],
          ["Unfakeable", "Edit one number and the signature, the on-chain record and the TEE attestation all fail. Try tamper mode."],
          ["Checkable by anyone", "Your browser runs the checks from public data: the NEAR registry and OutLayer's attestation API."],
        ].map(([t, d]) => (
          <div key={t}>
            <h3 className="font-medium">{t}</h3>
            <p className="mt-1 text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
