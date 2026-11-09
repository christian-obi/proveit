// Server side of the live board. Short caches so many open tabs cost the public RPCs almost
// nothing, and a failed registry read keeps the last good list instead of blanking the board.

import { rpc } from "@proveit/verify/checks";
import type { BoardData } from "./board-view";
import { config } from "./config";
import { allCards, rank, type Entry } from "./explore";
import { allCounts } from "./reactions";

const CARDS_TTL_MS = 20_000;
const BLOCK_TTL_MS = 2_000;

let cards: { at: number; entries: Entry[] } | null = null;
let cardsLoad: Promise<void> | null = null;
let block: { at: number; height: number | null } | null = null;
let blockLoad: Promise<void> | null = null;

function loadCards() {
  cardsLoad ??= allCards()
    .then((all) => {
      const entries = rank(all, "newest");
      if (entries.length > 0 || !cards) cards = { at: Date.now(), entries };
      else cards.at = Date.now();
    })
    .catch(() => undefined)
    .finally(() => (cardsLoad = null));
  return cardsLoad;
}

function loadBlock() {
  blockLoad ??= rpc<{ header: { height: number } }>(config.nearRpc, "block", { finality: "final" })
    .then((b) => void (block = { at: Date.now(), height: b.header.height }))
    .catch(() => void (block = { at: Date.now(), height: block?.height ?? null }))
    .finally(() => (blockLoad = null));
  return blockLoad;
}

export async function boardData(): Promise<BoardData> {
  const now = Date.now();
  // The first request waits; later ones answer from cache and refresh behind it.
  if (!cards) await loadCards();
  else if (now - cards.at > CARDS_TTL_MS) void loadCards();
  if (!block) await loadBlock();
  else if (now - block.at > BLOCK_TTL_MS) void loadBlock();
  return { at: Date.now(), network: config.network, block: block?.height ?? null, entries: cards?.entries ?? [], reactions: allCounts() };
}
