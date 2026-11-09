import { cookies } from "next/headers";
import Link from "next/link";
import Card from "@/components/Card";
import FakeScreenshot from "@/components/FakeScreenshot";
import LiveBoard from "@/components/LiveBoard";
import VerifyPanel from "@/components/VerifyPanel";
import { boardData } from "@/lib/board";
import { cardPath, loadCard } from "@/lib/cards";
import { config, NETWORK_COOKIE, parseNetwork } from "@/lib/config";

export const dynamic = "force-dynamic";

// The card shown next to the fake: NEXT_PUBLIC_FEATURED_CARD="<registry>:<id>", default demo card #3 (privacy guard + viewing keys).
const [featuredRegistry, featuredId] = (process.env.NEXT_PUBLIC_FEATURED_CARD || `${config.demoRegistry}:3`).split(":");

export default async function Home() {
  const [featured, board] = await Promise.all([loadCard(featuredId, featuredRegistry).catch(() => null), boardData(parseNetwork((await cookies()).get(NETWORK_COOKIE)?.value))]);
  return (
    <div className="wide space-y-14">
      <LiveBoard key={board.network} initial={board} limit={6}>
        <section className="space-y-5 pb-2">
          <p className="label">
            <span className="text-accent">{"//"} Verified</span> — signed in a TEE, recorded on NEAR
          </p>
          <h1 className="max-w-3xl text-4xl leading-[1.08] sm:text-6xl">Screenshots can be faked. Prove-It cards can&apos;t.</h1>
          <p className="max-w-2xl text-lg text-muted">
            A trader proves their Hyperliquid performance without revealing their wallet. An Intel TDX enclave reads the account, computes the
            stats and signs a card; the card is recorded on NEAR, and anyone can check it in one click.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/create" className="rounded-md bg-accent px-5 py-2.5 text-xs font-semibold text-accent-fg">
              Create a card
            </Link>
            <Link href="/verify" className="rounded-md border border-line px-5 py-2.5 text-xs">
              Verify a card
            </Link>
          </div>
        </section>
      </LiveBoard>

      <section className="grid gap-8 border-t border-line pt-10 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="label">A screenshot</h2>
          <FakeScreenshot />
        </div>
        <div className="space-y-3">
          <h2 className="label">A Prove-It card</h2>
          {featured ? (
            <>
              <Card card={featured.card} id={featured.record.id} seed={featured.record.card_hash} reactionKey={`${featured.registry}:${featured.record.id}`} />
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

      <section className="grid gap-2 text-sm sm:grid-cols-3">
        {[
          ["Private", "The wallet address never appears on the card or on-chain. Only the enclave sees it."],
          ["Unfakeable", "Edit one number and the signature, the on-chain record and the TEE attestation all fail. Try tamper mode."],
          ["Checkable by anyone", "Your browser runs the checks from public data: the NEAR registry and OutLayer's attestation API."],
        ].map(([t, d]) => (
          <div key={t} className="border border-line bg-panel p-4">
            <h3 className="label text-accent">{t}</h3>
            <p className="mt-2 text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
