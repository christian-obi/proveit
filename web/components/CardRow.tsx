// One card in a list (/explore, profiles): the numbers, its badges, and its key offer.

import Link from "next/link";
import { cardPath } from "@/lib/cards";
import { pct, returnLabel, windowLabel } from "@/lib/format";
import type { Entry } from "@/lib/explore";
import type { Counts } from "@/lib/reaction-kinds";
import CardPicture from "@/components/CardPicture";
import Reactions from "@/components/Reactions";
import ShareButton from "@/components/ShareButton";

export default function CardRow({ e, showIssuer = true, rank, maxReturn, flash, counts }: { e: Entry; showIssuer?: boolean; rank?: number; maxReturn?: number; flash?: boolean; counts?: Counts }) {
  const s = e.card.stats;
  const up = s.return_bps >= 0;
  const badge = (text: string, tone: string) => <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{text}</span>;
  const price = e.offer ? Number(e.offer.offer.price) / 1e6 : null;
  return (
    <li className={`board-row reactive flex gap-3 p-3 pb-8 sm:gap-4 sm:p-4 sm:pb-9 ${flash ? "row-flash" : ""}`} data-card-row={`${e.registry}:${e.record.id}`} data-stale={e.stale ? "1" : "0"}>
      <Link href={cardPath(e.record.id, e.registry)} className="self-start" aria-label={`Open card ${e.record.id}`}>
        <CardPicture seed={e.record.card_hash} returnBps={s.return_bps} label={`${e.card.window.days}d`} size={76} />
      </Link>
      <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={cardPath(e.record.id, e.registry)} className="flex items-baseline gap-3 hover:text-accent">
          {rank !== undefined && <span className="label tabular-nums">{String(rank).padStart(2, "0")}</span>}
          <span className={`font-mono text-2xl font-semibold tabular-nums ${up ? "text-accent" : "text-bad"}`}>{returnLabel(s)}</span>
          <span className="font-mono text-xs text-muted">{windowLabel(e.card.window.days)} · card #{e.record.id}</span>
        </Link>
        <span className="flex flex-wrap gap-1">
          {e.card.kind === "agent" && badge("AI agent", "bg-accent/15 text-accent")}
          {e.card.mode !== "live" && badge("demo", "bg-warn/15 text-warn")}
          {e.stale && badge("stale: not refreshed", "bg-warn/15 text-warn")}
          {e.record.revoked && badge("revoked", "bg-bad/15 text-bad")}
          {e.record.superseded_by !== null && badge(`replaced by #${e.record.superseded_by}`, "bg-line text-muted")}
          {s.k_anon && badge(`1 of ≥ ${s.k_anon}`, "bg-line text-muted")}
        </span>
      </div>
      {maxReturn !== undefined && (
        <span className={`mt-2 block ${up ? "text-accent" : "text-bad"}`} aria-hidden>
          <span className="return-bar" style={{ width: `${Math.max(1, (Math.abs(s.return_bps) / maxReturn) * 100)}%` }} />
        </span>
      )}
      <p className="mt-2 font-mono text-xs tabular-nums text-muted">
        Max drawdown <span className="text-fg">{pct(-s.max_dd_bps)}</span> · {s.trades} trades · win rate {pct(s.win_rate_bps)}
        {showIssuer && (
          <>
            {" · by "}
            <Link className="underline" href={`/p/${e.record.issuer}`}>
              {e.record.issuer}
            </Link>
          </>
        )}
      </p>
      <p className="mt-1 font-mono text-xs text-muted" data-offer-summary>
        {e.offer ? (
          <Link className="underline" href={`${cardPath(e.record.id, e.registry)}/unlock`}>
            Viewing key {price} {config_registry_hint(e.registry)} · {e.offer.offer.delay_secs === 0 ? "live" : `${Math.round(e.offer.offer.delay_secs / 3600)}h delay`} · {e.offer.seats_left} of {e.offer.offer.max_seats} seats left
          </Link>
        ) : (
          "No viewing keys for sale"
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <Reactions cardKey={`${e.registry}:${e.record.id}`} counts={counts} />
        <ShareButton path={cardPath(e.record.id, e.registry)} stats={s} days={e.card.window.days} demo={e.card.mode !== "live"} />
      </div>
      </div>
    </li>
  );
}

// Test USDC on testnet, native USDC on mainnet.
function config_registry_hint(registry: string): string {
  return registry.endsWith(".near") ? "USDC" : "tUSDC";
}
