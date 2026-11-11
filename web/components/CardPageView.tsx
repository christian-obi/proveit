// The card page and its share image, for either registry (/c/<id> live, /demo/<id> demo).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Card from "@/components/Card";
import VerifyPanel from "@/components/VerifyPanel";
import FeedFlow from "@/components/FeedFlow";
import UnlockFlow from "@/components/UnlockFlow";
import { cardPath, loadCard } from "@/lib/cards";
import { getOffer, tokenMeta } from "@/lib/keys";
import { pct, returnLabel, windowLabel } from "@/lib/format";

export async function cardMetadata(id: string, registry: string): Promise<Metadata> {
  const loaded = await loadCard(id, registry);
  if (!loaded) return { title: "Card not found · Prove-It" };
  const s = loaded.card.stats;
  const demo = loaded.card.mode !== "live" ? " (demo)" : "";
  const title = `${returnLabel(s)} in ${windowLabel(loaded.card.window.days)}${demo} · Prove-It`;
  const description = `Max drawdown ${pct(s.max_dd_bps)}, ${s.trades} trades, verified by a TEE and recorded on NEAR. The wallet stays private.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

async function UnlockLink({ id, registry }: { id: number; registry: string }) {
  const offer = await getOffer(registry, id).catch(() => null);
  const token = offer?.token ? await tokenMeta(offer.token).catch(() => null) : null;
  const href = `${cardPath(id, registry)}/unlock`;
  return (
    <div className="space-y-2">
    <Link href={href} className="flex items-center justify-between rounded-lg border border-line bg-panel p-4 text-sm hover:border-accent" data-unlock-link>
      <span>
        <span className="font-medium">Follow this trader</span>
        <span className="text-muted">
          {offer
            ? ` · viewing keys from ${Number(offer.offer.price) / 10 ** (token?.decimals ?? 6)} ${token?.symbol ?? "USDC"}, ${offer.seats_left} seat${offer.seats_left === 1 ? "" : "s"} left`
            : " · the trader can sell viewing keys to this card's trades"}
        </span>
      </span>
      <span aria-hidden>→</span>
    </Link>
    <SellLink id={id} registry={registry} selling={!!offer} />
    </div>
  );
}

/** The trader's own way in: pricing and seats live on the unlock page, behind their wallet. */
function SellLink({ id, registry, selling }: { id: number; registry: string; selling: boolean }) {
  return (
    <Link href={`${cardPath(id, registry)}/unlock#sell`} className="flex items-center justify-between rounded-lg border border-dashed border-line p-4 text-sm hover:border-accent" data-sell-link>
      <span>
        <span className="font-medium">Is this your card?</span>
        <span className="text-muted">
          {selling ? " · change your price, seats or delay" : " · sell viewing keys: set a price, how many followers can copy you, and a delay"}
        </span>
      </span>
      <span aria-hidden>→</span>
    </Link>
  );
}

export async function CardPageView({ id, registry, autoRun }: { id: string; registry: string; autoRun: boolean }) {
  const loaded = await loadCard(id, registry);
  if (!loaded) notFound();
  const { record, card } = loaded;
  return (
    <section className="space-y-6">
      <Card card={card} id={record.id} seed={record.card_hash} reactionKey={`${registry}:${record.id}`} />
      <VerifyPanel registry={registry} cardId={record.id} cardJson={record.card_json} autoRun={autoRun} />
      <UnlockLink id={record.id} registry={registry} />
      <p className="text-xs text-muted">
        Issued by{" "}
        <Link className="font-mono underline" href={`/p/${record.issuer}`}>
          {record.issuer}
        </Link>{" "}
        · registry <span className="font-mono">{registry}</span> · enclave build <span className="font-mono">{record.version.slice(0, 12)}…</span>
        {record.revoked && <span className="text-bad"> · revoked by the issuer</span>}
        {record.superseded_by !== null && (
          <>
            {" · "}
            <Link className="underline" href={cardPath(record.superseded_by, registry)}>
              replaced by card #{record.superseded_by}
            </Link>
          </>
        )}
      </p>
    </section>
  );
}

/** /c/<id>/unlock and /demo/<id>/unlock: buy a viewing key, see the trades. */
export async function UnlockPageView({ id, registry }: { id: string; registry: string }) {
  const loaded = await loadCard(id, registry);
  if (!loaded) notFound();
  const { record, card } = loaded;
  const offer = await getOffer(registry, record.id).catch(() => null);
  const token = offer?.token ? await tokenMeta(offer.token).catch(() => null) : null;
  return (
    <section className="space-y-6">
      <Card card={card} id={record.id} seed={record.card_hash} reactionKey={`${registry}:${record.id}`} />
      <div>
        <h1 className="text-lg font-semibold">Viewing key</h1>
        <p className="text-sm text-muted">
          Follow this trader: see the trades behind the card, delayed as the trader chose, each one proven to be in the card the enclave signed. The wallet stays private.
        </p>
      </div>
      <UnlockFlow
        registry={registry}
        cardId={record.id}
        cardHash={record.card_hash}
        issuer={record.issuer}
        orders={card.orders}
        initialOffer={offer}
        token={token}
      />
      <Link className="text-sm underline" href={cardPath(record.id, registry)}>
        Back to the card
      </Link>
    </section>
  );
}

/** /c/<id>/feed and /demo/<id>/feed: a key holder's live feed of new trades. */
export async function FeedPageView({ id, registry }: { id: string; registry: string }) {
  const loaded = await loadCard(id, registry);
  if (!loaded) notFound();
  const { record, card } = loaded;
  return (
    <section className="space-y-6">
      <Card card={card} id={record.id} seed={record.card_hash} reactionKey={`${registry}:${record.id}`} />
      <div>
        <h1 className="text-lg font-semibold">Live feed</h1>
        <p className="text-sm text-muted">
          The trader&apos;s orders after this card, one hash chain for every follower, encrypted to this browser by the enclave. Coarsened like the card: hour, side, size and
          PnL as a share of the account.
        </p>
      </div>
      <FeedFlow registry={registry} cardId={record.id} cardHash={record.card_hash} isLive={card.mode === "live"} />
      <Link className="text-sm underline" href={`${cardPath(record.id, registry)}/unlock`}>
        Your viewing key
      </Link>
    </section>
  );
}

export const ogSize = { width: 1200, height: 630 };

export { cardImage } from "@/components/ShareCard";
