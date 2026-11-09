// Pure views of the live board. Everything is derived from public registry data; nothing here
// invents activity, so an idle registry shows an idle board.

import { rank, type Entry } from "./explore";
import type { Counts } from "./reaction-kinds";

export type BoardData = {
  /** Server time of this answer, in ms. */
  at: number;
  network: string;
  /** Latest final NEAR block, or null if the RPC didn't answer. */
  block: number | null;
  entries: Entry[];
  /** Anonymous reaction counts by card key. Never used for ranking. */
  reactions: Record<string, Counts>;
};

export const entryKey = (e: Entry) => `${e.registry}:${e.record.id}`;

export function boardStats(entries: Entry[]) {
  const shown = rank(entries, "newest");
  return {
    cards: shown.length,
    live: shown.filter((e) => e.card.mode === "live").length,
    traders: new Set(shown.map((e) => e.record.issuer)).size,
    trades: shown.reduce((n, e) => n + e.card.stats.trades, 0),
    keys: shown.filter((e) => e.offer).length,
  };
}

/** Newest issuances first. */
export const tape = (entries: Entry[], limit = 30) => rank(entries, "newest").slice(0, limit);

/** What a row shows, so a poll can tell which rows changed. */
export const fingerprint = (e: Entry) => JSON.stringify([e.card.stats.return_bps, e.card.stats.trades, e.stale, e.record.revoked, e.record.superseded_by, e.offer]);

/** Rows that are new or different since the previous poll. Empty on the first poll. */
export function changedKeys(previous: Map<string, string> | null, entries: Entry[]): Set<string> {
  if (!previous) return new Set();
  return new Set(entries.filter((e) => previous.get(entryKey(e)) !== fingerprint(e)).map(entryKey));
}

/** "11-09 13:42", always UTC so the server and browser render the same text. */
export const utcStamp = (secs: number) => new Date(secs * 1000).toISOString().slice(5, 16).replace("T", " ");
