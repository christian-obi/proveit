// Server side of the live board. Short caches so many open tabs cost the public RPCs almost
// nothing, and a failed registry read keeps the last good list instead of blanking the board.

import { rpc } from "@proveit/verify/checks";
import type { BoardData } from "./board-view";
import { config, NETWORKS, type Network } from "./config";
import { allCards, rank, type Entry } from "./explore";
import { allCounts } from "./reactions";

const CARDS_TTL_MS = 20_000;
const BLOCK_TTL_MS = 2_000;

type State = {
  cards: { at: number; entries: Entry[] } | null;
  cardsLoad: Promise<void> | null;
  block: { at: number; height: number | null } | null;
  blockLoad: Promise<void> | null;
};

const fresh = (): State => ({ cards: null, cardsLoad: null, block: null, blockLoad: null });
const states: Record<Network, State> = { testnet: fresh(), mainnet: fresh() };

function loadCards(network: Network) {
  const s = states[network];
  s.cardsLoad ??= allCards(network)
    .then((all) => {
      const entries = rank(all, "newest");
      if (entries.length > 0 || !s.cards) s.cards = { at: Date.now(), entries };
      else s.cards.at = Date.now();
    })
    .catch(() => undefined)
    .finally(() => (s.cardsLoad = null));
  return s.cardsLoad;
}

function loadBlock(network: Network) {
  const s = states[network];
  s.blockLoad ??= rpc<{ header: { height: number } }>(NETWORKS[network].nearRpc, "block", { finality: "final" })
    .then((b) => void (s.block = { at: Date.now(), height: b.header.height }))
    .catch(() => void (s.block = { at: Date.now(), height: s.block?.height ?? null }))
    .finally(() => (s.blockLoad = null));
  return s.blockLoad;
}

export async function boardData(network: Network = config.network): Promise<BoardData> {
  const s = states[network];
  const now = Date.now();
  // The first request waits; later ones answer from cache and refresh behind it.
  if (!s.cards) await loadCards(network);
  else if (now - s.cards.at > CARDS_TTL_MS) void loadCards(network);
  if (!s.block) await loadBlock(network);
  else if (now - s.block.at > BLOCK_TTL_MS) void loadBlock(network);
  return { at: Date.now(), network, block: s.block?.height ?? null, entries: s.cards?.entries ?? [], reactions: allCounts() };
}
