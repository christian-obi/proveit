// Discovery: every card on the registries, ranked. Revoked cards, replaced cards and cards
// from retired builds are hidden; stale ones are badged. Public data only.

import { config, registriesOf, type Network } from "./config";
import { getOffer, type OfferView } from "./keys";
import { view, type CardRecord } from "./near";

export type Sort = "return" | "drawdown" | "trades" | "newest";
export const SORTS: Sort[] = ["return", "drawdown", "trades", "newest"];

export type Entry = {
  registry: string;
  record: CardRecord;
  card: any;
  offer: OfferView | null;
  stale: boolean;
  retired: boolean;
};

/** What /explore shows, in order. */
export function rank(entries: Entry[], sort: Sort): Entry[] {
  const shown = entries.filter((e) => !e.record.revoked && e.record.superseded_by === null && !e.retired);
  const key: Record<Sort, (e: Entry) => number> = {
    return: (e) => -e.card.stats.return_bps,
    drawdown: (e) => e.card.stats.max_dd_bps,
    trades: (e) => -e.card.stats.trades,
    newest: (e) => -e.record.issued_at,
  };
  // Live cards before demo cards, then by the chosen order, then newest first.
  return shown.sort((a, b) => Number(a.card.mode !== "live") - Number(b.card.mode !== "live") || key[sort](a) - key[sort](b) || b.record.issued_at - a.record.issued_at);
}

type Config = { cards: number; stale_after_secs: number };

async function load(registry: string, now: number): Promise<Entry[]> {
  const cfg = await view<Config>(registry, "get_config");
  const versions = new Map((await view<[string, { retired: boolean }][]>(registry, "get_versions")).map(([h, v]) => [h, v.retired]));
  const ids = Array.from({ length: Math.min(cfg.cards, 200) }, (_, i) => i);
  const out: Entry[] = [];
  // Small batches: public RPCs rate-limit.
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(
      ids.slice(i, i + 8).map(async (id) => {
        const record = await view<CardRecord | null>(registry, "get_card", { card_id: id });
        if (!record) return null;
        const offer = await getOffer(registry, id).catch(() => null);
        return {
          registry,
          record,
          card: JSON.parse(record.card_json),
          offer,
          stale: now - record.issued_at > cfg.stale_after_secs,
          retired: versions.get(record.version) ?? true,
        } satisfies Entry;
      }),
    );
    out.push(...batch.filter((e): e is Entry => e !== null));
  }
  return out;
}

export async function allCards(network: Network = config.network, now = Math.floor(Date.now() / 1000)): Promise<Entry[]> {
  const lists = await Promise.all(registriesOf(network).map((r) => load(r, now).catch(() => [])));
  return lists.flat();
}

/** A profile: every card an account issued, newest first, grouped by trading account. */
export async function cardsOf(account: string, now = Math.floor(Date.now() / 1000)): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const registry of [...registriesOf("testnet"), ...registriesOf("mainnet")]) {
    const cfg = await view<Config>(registry, "get_config").catch(() => null);
    if (!cfg) continue;
    const versions = new Map((await view<[string, { retired: boolean }][]>(registry, "get_versions")).map(([h, v]) => [h, v.retired]));
    const records = await view<CardRecord[]>(registry, "get_cards_by_issuer", { issuer: account }).catch(() => []);
    for (const record of records) {
      out.push({ registry, record, card: JSON.parse(record.card_json), offer: await getOffer(registry, record.id).catch(() => null), stale: now - record.issued_at > cfg.stale_after_secs, retired: versions.get(record.version) ?? true });
    }
  }
  return out.sort((a, b) => b.record.issued_at - a.record.issued_at);
}
