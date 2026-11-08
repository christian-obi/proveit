// T9.6: what /explore shows and in which order.

import { expect, test } from "vitest";
import { rank, type Entry } from "../lib/explore";

const entry = (id: number, stats: Partial<{ return_bps: number; max_dd_bps: number; trades: number }>, over: Partial<Entry> & { revoked?: boolean; superseded_by?: number | null; issued_at?: number; mode?: string } = {}): Entry =>
  ({
    registry: "proveit-registry.testnet",
    record: { id, revoked: over.revoked ?? false, superseded_by: over.superseded_by ?? null, issued_at: over.issued_at ?? 1_000 + id } as any,
    card: { mode: over.mode ?? "live", stats: { return_bps: 0, max_dd_bps: 0, trades: 0, ...stats } },
    offer: over.offer ?? null,
    stale: over.stale ?? false,
    retired: over.retired ?? false,
  }) as Entry;

const cards = [
  entry(0, { return_bps: 3_000, max_dd_bps: 2_000, trades: 30 }),
  entry(1, { return_bps: 9_000, max_dd_bps: 500, trades: 99 }, { revoked: true }),
  entry(2, { return_bps: 1_000, max_dd_bps: 800, trades: 60 }, { stale: true, offer: { seats_left: 3, offer: { max_seats: 5 } } as any }),
];

test("revoked cards are hidden; stale ones stay, marked", () => {
  const shown = rank(cards, "return");
  expect(shown.map((e) => e.record.id)).toEqual([0, 2]);
  expect(shown.find((e) => e.record.id === 2)!.stale).toBe(true);
});

test("each sort order", () => {
  expect(rank(cards, "return").map((e) => e.record.id)).toEqual([0, 2]);
  expect(rank(cards, "drawdown").map((e) => e.record.id)).toEqual([2, 0]);
  expect(rank(cards, "trades").map((e) => e.record.id)).toEqual([2, 0]);
  expect(rank(cards, "newest").map((e) => e.record.id)).toEqual([2, 0]);
});

test("replaced cards and cards from retired builds are hidden; demo cards come after live ones", () => {
  const more = [...cards, entry(3, { return_bps: 50_000 }, { superseded_by: 4 }), entry(5, { return_bps: 40_000 }, { retired: true }), entry(6, { return_bps: 80_000 }, { mode: "fixture" })];
  expect(rank(more, "return").map((e) => e.record.id)).toEqual([0, 2, 6]);
});

test("seats left come straight from get_offer", () => {
  expect(rank(cards, "return")[1].offer!.seats_left).toBe(3);
});
