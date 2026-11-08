// The card: the shareable picture of a trader's verified numbers. Pure render, so the card
// page, the landing page and tamper mode all show the same thing.

import { date, pct, volume, windowLabel } from "@/lib/format";

export type CardData = {
  window: { days: number; start: number; end: number; samples: number };
  stats: {
    return_bps: number;
    max_dd_bps: number;
    win_rate_bps: number;
    trades: number;
    profit_factor_x100: number | null;
    volume_band: string;
    active_days: number;
    flow_turnover_bps: number;
  };
  issuer: string;
  issued_at: number;
  mode: string;
  venue: string;
};

export default function Card({ card, id, edited }: { card: CardData; id?: number; edited?: boolean }) {
  const s = card.stats;
  const up = s.return_bps >= 0;
  const rows: [string, string][] = [
    ["Max drawdown", pct(-s.max_dd_bps)],
    ["Win rate", pct(s.win_rate_bps)],
    ["Trades", String(s.trades)],
    ["Profit factor", s.profit_factor_x100 === null ? "no losses" : (s.profit_factor_x100 / 100).toFixed(2)],
    ["Active days", String(s.active_days)],
    ["Volume", volume(s.volume_band)],
  ];
  return (
    <article className={`overflow-hidden rounded-xl border bg-panel ${edited ? "border-bad" : "border-line"}`}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-xs text-muted">
        <span>
          Prove-It · Hyperliquid · {windowLabel(card.window.days)}
          {id !== undefined && <> · card #{id}</>}
        </span>
        <span className="flex gap-1.5">
          {card.mode !== "live" && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-warn">demo card</span>}
          {card.window.days === 1 && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-warn">1-day test</span>}
          {edited && <span className="rounded bg-bad/15 px-1.5 py-0.5 text-bad">edited</span>}
        </span>
      </div>
      <div className="px-5 py-5">
        <p className="text-xs uppercase tracking-wide text-muted">Return, time-weighted</p>
        <p className={`text-5xl font-semibold tabular-nums tracking-tight ${up ? "text-accent" : "text-bad"}`}>{pct(s.return_bps, true)}</p>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {s.flow_turnover_bps > 10_000 && (
          <p className="mt-4 text-xs text-warn">
            Deposits and withdrawals moved {pct(s.flow_turnover_bps)} of capital in this window, so dollar PnL can differ a lot from this
            return.
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-line px-5 py-3 text-xs text-muted">
        <span>
          Issued by <span className="font-mono">{card.issuer}</span>
        </span>
        <span>
          {date(card.window.start / 1000)} – {date(card.window.end / 1000)} · signed {date(card.issued_at)}
        </span>
      </div>
    </article>
  );
}
