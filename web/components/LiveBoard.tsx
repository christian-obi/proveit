"use client";

// The live board: chain status, counters, ranked cards and the issuance tape, polled from
// /api/board. Rows that really changed flash; nothing moves without a change on-chain.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import CardRow from "@/components/CardRow";
import { boardStats, changedKeys, entryKey, fingerprint, tape, utcStamp, type BoardData } from "@/lib/board-view";
import { cardPath } from "@/lib/cards";
import { rank, SORTS, type Sort } from "@/lib/explore";
import { returnLabel, windowLabel } from "@/lib/format";
import { NO_COUNTS } from "@/lib/reaction-kinds";

const POLL_MS = 5_000;
const REACTIONS_POLL_MS = 1_500;
const STALE_AFTER_S = 30;
const LABEL: Record<Sort, string> = { return: "Return", drawdown: "Lowest drawdown", trades: "Most trades", newest: "Newest" };

function Counter({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="border border-line bg-panel px-3 py-3">
      <p key={value} className={`value-tick font-mono text-2xl tabular-nums ${accent ? "text-accent" : ""}`}>
        {value.toLocaleString("en-US")}
      </p>
      <p className="label mt-1">{label}</p>
    </div>
  );
}

export default function LiveBoard({ initial, initialSort = "return", limit, sortable = false, children }: { initial: BoardData; initialSort?: Sort; limit?: number; sortable?: boolean; children?: ReactNode }) {
  const [data, setData] = useState(initial);
  const [sort, setSort] = useState<Sort>(initialSort);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [ago, setAgo] = useState(0);
  const lastOk = useRef(0);
  const seen = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    lastOk.current = Date.now();
    let controller: AbortController | null = null;
    const poll = async () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch("/api/board", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as BoardData;
        lastOk.current = Date.now();
        setFresh(changedKeys(seen.current, next.entries));
        seen.current = new Map(next.entries.map((e) => [entryKey(e), fingerprint(e)]));
        setData(next);
      } catch {
        // Keep the last good board; the status bar turns STALE on its own.
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    // Reactions are tiny, so they refresh much faster than the rest of the board.
    const pollReactions = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/reactions", { cache: "no-store" });
        if (res.ok) {
          const { reactions } = await res.json();
          setData((d) => ({ ...d, reactions }));
        }
      } catch {
        // The next tick tries again.
      }
    };
    const reactionTimer = setInterval(pollReactions, REACTIONS_POLL_MS);
    const clock = setInterval(() => setAgo(Math.floor((Date.now() - lastOk.current) / 1000)), 1_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      clearInterval(reactionTimer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", poll);
      controller?.abort();
    };
  }, []);

  const rows = useMemo(() => rank(data.entries, sort), [data.entries, sort]);
  const shown = limit ? rows.slice(0, limit) : rows;
  const stats = useMemo(() => boardStats(data.entries), [data.entries]);
  const events = useMemo(() => tape(data.entries), [data.entries]);
  const maxReturn = Math.max(1, ...rows.map((e) => Math.abs(e.card.stats.return_bps)));
  const stale = ago >= STALE_AFTER_S;

  const pick = (s: Sort) => (event: React.MouseEvent) => {
    event.preventDefault();
    setSort(s);
    window.history.replaceState(null, "", `/explore?sort=${s}`);
  };

  return (
    <div className="wide grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        {children}

        <p className="label flex flex-wrap items-center gap-x-3 gap-y-1" data-board-status={stale ? "stale" : "live"}>
          <span className={`live-dot ${stale ? "is-stale" : ""}`} aria-hidden />
          <span className={stale ? "text-warn" : "text-accent"}>{stale ? "Stale" : "Live"}</span>
          <span>NEAR {data.network}</span>
          {data.block !== null && (
            <span key={data.block} className="value-tick tabular-nums">
              Block {data.block.toLocaleString("en-US")}
            </span>
          )}
          <span className="tabular-nums">Updated {ago}s ago</span>
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Counter label="Verified cards" value={stats.cards} accent />
          <Counter label="Live cards" value={stats.live} />
          <Counter label="Traders" value={stats.traders} />
          <Counter label="Trades proven" value={stats.trades} />
          <Counter label="Keys for sale" value={stats.keys} />
        </div>

        {sortable && (
          <nav className="flex flex-wrap gap-2" aria-label="Sort">
            {SORTS.map((s) => (
              <Link key={s} href={`/explore?sort=${s}`} onClick={pick(s)} aria-current={s === sort ? "page" : undefined} className={`chip ${s === sort ? "is-on" : ""}`}>
                {LABEL[s]}
              </Link>
            ))}
          </nav>
        )}

        {shown.length === 0 ? (
          <p className="border border-line bg-panel p-4 text-sm text-muted">No cards yet.</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((e, i) => (
              <CardRow key={entryKey(e)} e={e} rank={i + 1} maxReturn={maxReturn} flash={fresh.has(entryKey(e))} counts={data.reactions[entryKey(e)] ?? NO_COUNTS} />
            ))}
          </ul>
        )}
        {limit && rows.length > limit && (
          <Link href="/explore" className="label inline-block hover:text-accent">
            All {rows.length} cards →
          </Link>
        )}
      </div>

      <aside className="min-w-0 border border-line bg-tape lg:sticky lg:top-4" aria-label="Latest cards">
        <p className="label border-b border-line px-4 py-3">
          Tape <span className="normal-case tracking-normal">latest cards signed by the enclave</span>
        </p>
        <ol className="max-h-[32rem] overflow-y-auto px-4 py-2 lg:max-h-[calc(100vh-8rem)]">
          {events.length === 0 && <li className="py-2 font-mono text-xs text-muted">Waiting for the first card…</li>}
          {events.map((e) => {
            const up = e.card.stats.return_bps >= 0;
            return (
              <li key={entryKey(e)} className={`tape-row ${fresh.has(entryKey(e)) ? "row-flash" : ""}`}>
                <span className="text-muted tabular-nums">{utcStamp(e.record.issued_at)}</span>
                <Link href={cardPath(e.record.id, e.registry)} className="truncate hover:text-accent">
                  #{e.record.id} {e.record.issuer}
                </Link>
                <span className={e.card.mode === "live" ? "text-accent" : "text-warn"}>{e.card.mode === "live" ? "LIVE" : "DEMO"}</span>
                <span className="text-muted">{windowLabel(e.card.window.days)}</span>
                <span className={`text-right tabular-nums ${up ? "text-accent" : "text-bad"}`}>{returnLabel(e.card.stats)}</span>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
