// One card in a list (/explore, profiles): the numbers, its badges, and its key offer.

import Link from "next/link";
import { cardPath } from "@/lib/cards";
import { pct, returnLabel, windowLabel } from "@/lib/format";
import type { Entry } from "@/lib/explore";

export default function CardRow({ e, showIssuer = true }: { e: Entry; showIssuer?: boolean }) {
  const s = e.card.stats;
  const up = s.return_bps >= 0;
  const badge = (text: string, tone: string) => <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{text}</span>;
  const price = e.offer ? Number(e.offer.offer.price) / 1e6 : null;
  return (
    <li className="rounded-lg border border-line bg-panel p-4" data-card-row={`${e.registry}:${e.record.id}`} data-stale={e.stale ? "1" : "0"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={cardPath(e.record.id, e.registry)} className="flex items-baseline gap-3 hover:underline">
          <span className={`text-2xl font-semibold tabular-nums ${up ? "text-accent" : "text-bad"}`}>{returnLabel(s)}</span>
          <span className="text-sm text-muted">{windowLabel(e.card.window.days)} · card #{e.record.id}</span>
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
      <p className="mt-2 text-sm tabular-nums text-muted">
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
      <p className="mt-1 text-xs text-muted" data-offer-summary>
        {e.offer ? (
          <Link className="underline" href={`${cardPath(e.record.id, e.registry)}/unlock`}>
            Viewing key {price} {config_registry_hint(e.registry)} · {e.offer.offer.delay_secs === 0 ? "live" : `${Math.round(e.offer.offer.delay_secs / 3600)}h delay`} · {e.offer.seats_left} of {e.offer.offer.max_seats} seats left
          </Link>
        ) : (
          "No viewing keys for sale"
        )}
      </p>
    </li>
  );
}

// Test USDC on testnet, native USDC on mainnet.
function config_registry_hint(registry: string): string {
  return registry.endsWith(".near") ? "USDC" : "tUSDC";
}
