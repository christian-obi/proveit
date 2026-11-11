// Server store for reaction counts: one small JSON file, kept in memory and written shortly after
// a change. It holds only card ids and numbers. Without a persistent disk (REACTIONS_PATH on a
// Railway volume) counts start again from zero on each deploy.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KINDS, NO_COUNTS, type Counts, type Kind } from "./reaction-kinds";

type Store = { counts: Map<string, Counts>; timer: ReturnType<typeof setTimeout> | null; buckets: Map<string, { tokens: number; at: number }> };

const path = () => process.env.REACTIONS_PATH || join(process.cwd(), ".data/reactions.json");

function load(): Map<string, Counts> {
  try {
    const raw = JSON.parse(readFileSync(path(), "utf8")) as Record<string, Partial<Counts>>;
    return new Map(Object.entries(raw).map(([k, v]) => [k, { ...NO_COUNTS, ...v }]));
  } catch {
    return new Map();
  }
}

// On globalThis because Next bundles each route separately, and they must share one store.
const g = globalThis as unknown as { __reactions?: Store; __reactionsFlushOnStop?: boolean };
const store = (): Store => (g.__reactions ??= { counts: load(), timer: null, buckets: new Map() });

function writeNow() {
  const s = store();
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  try {
    const file = path();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(s.counts)));
    renameSync(`${file}.tmp`, file);
  } catch (error) {
    console.error("could not save reactions", error);
  }
}

function save() {
  const s = store();
  if (!s.timer && !g.__reactionsFlushOnStop) {
    // A deploy stops this process: write what's pending instead of losing the last second.
    g.__reactionsFlushOnStop = true;
    process.once("SIGTERM", () => store().timer && writeNow());
  }
  s.timer ??= setTimeout(writeNow, 1_000);
}

export const isKind = (k: unknown): k is Kind => KINDS.includes(k as Kind);

export const countsOf = (card: string): Counts => store().counts.get(card) ?? NO_COUNTS;

export const allCounts = (): Record<string, Counts> => Object.fromEntries(store().counts);

export function addReaction(card: string, kind: Kind, n: number): Counts {
  const s = store();
  const next = { ...countsOf(card), [kind]: countsOf(card)[kind] + n };
  s.counts.set(card, next);
  save();
  return next;
}

const BUCKET_SIZE = 200;
const REFILL_PER_SEC = 25;

/** Per-address click limit, in memory only: addresses are never written anywhere. */
export function allowClicks(ip: string, n: number, now = Date.now()): boolean {
  const { buckets } = store();
  if (buckets.size > 5_000) buckets.clear();
  const b = buckets.get(ip) ?? { tokens: BUCKET_SIZE, at: now };
  b.tokens = Math.min(BUCKET_SIZE, b.tokens + ((now - b.at) / 1000) * REFILL_PER_SEC);
  b.at = now;
  buckets.set(ip, b);
  if (b.tokens < n) return false;
  b.tokens -= n;
  return true;
}
