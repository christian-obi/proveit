// The card page and its share image, for either registry (/c/<id> live, /demo/<id> demo).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import Card from "@/components/Card";
import VerifyPanel from "@/components/VerifyPanel";
import UnlockFlow from "@/components/UnlockFlow";
import { cardPath, loadCard } from "@/lib/cards";
import { getOffer, tokenMeta } from "@/lib/keys";
import { pct, windowLabel } from "@/lib/format";

export async function cardMetadata(id: string, registry: string): Promise<Metadata> {
  const loaded = await loadCard(id, registry);
  if (!loaded) return { title: "Card not found · Prove-It" };
  const s = loaded.card.stats;
  const demo = loaded.card.mode !== "live" ? " (demo)" : "";
  const title = `${pct(s.return_bps, true)} in ${windowLabel(loaded.card.window.days)}${demo} · Prove-It`;
  const description = `Max drawdown ${pct(s.max_dd_bps)}, ${s.trades} trades, verified by a TEE and recorded on NEAR. The wallet stays private.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

async function UnlockLink({ id, registry }: { id: number; registry: string }) {
  const offer = await getOffer(registry, id).catch(() => null);
  const token = offer?.token ? await tokenMeta(offer.token).catch(() => null) : null;
  const href = `${cardPath(id, registry)}/unlock`;
  return (
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
  );
}

export async function CardPageView({ id, registry, autoRun }: { id: string; registry: string; autoRun: boolean }) {
  const loaded = await loadCard(id, registry);
  if (!loaded) notFound();
  const { record, card } = loaded;
  return (
    <section className="space-y-6">
      <Card card={card} id={record.id} />
      <VerifyPanel registry={registry} cardId={record.id} cardJson={record.card_json} autoRun={autoRun} />
      <UnlockLink id={record.id} registry={registry} />
      <p className="text-xs text-muted">
        Registry <span className="font-mono">{registry}</span> · enclave build <span className="font-mono">{record.version.slice(0, 12)}…</span>
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
      <Card card={card} id={record.id} />
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

export const ogSize = { width: 1200, height: 630 };

export async function cardImage(id: string, registry: string) {
  const loaded = await loadCard(id, registry);
  const s = loaded?.card.stats;
  const up = (s?.return_bps ?? 0) >= 0;
  const demo = loaded && loaded.card.mode !== "live";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0b0d11", color: "#e8ebef", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "#8d96a3" }}>
          <span>
            Prove-It · Hyperliquid{loaded ? ` · ${windowLabel(loaded.card.window.days)}` : ""}
            {demo ? " · demo card" : ""}
          </span>
          <span style={{ color: "#2fbf8f" }}>Verified by a TEE · recorded on NEAR</span>
        </div>
        {s ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 30, color: "#8d96a3" }}>Return, time-weighted</span>
            <span style={{ fontSize: 160, fontWeight: 700, color: up ? "#2fbf8f" : "#f97066", lineHeight: 1 }}>{pct(s.return_bps, true)}</span>
            <div style={{ display: "flex", gap: 56, marginTop: 32, fontSize: 34 }}>
              <span>Max drawdown {pct(-s.max_dd_bps)}</span>
              <span>Win rate {pct(s.win_rate_bps)}</span>
              <span>{s.trades} trades</span>
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 64 }}>Card not found</span>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#8d96a3" }}>
          <span>Screenshots can be faked. This card can&apos;t.</span>
          <span>The wallet stays private.</span>
        </div>
      </div>
    ),
    ogSize,
  );
}
