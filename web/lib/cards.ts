// Server-side card loading for pages and share images. Public data from the registry.
//
// Live cards live at /c/<id> and demo cards at /demo/<id>. They are separate paths, not a
// ?registry= parameter, because share-image routes get no query string: a parameter would
// make a demo link preview the live registry's card with the same number.

import { config, isKnownRegistry } from "./config";
import { view, type CardRecord } from "./near";

export type LoadedCard = { registry: string; record: CardRecord; card: any };

export async function loadCard(id: string, registry: string): Promise<LoadedCard | null> {
  if (!isKnownRegistry(registry) || !/^\d+$/.test(id)) return null;
  const record = await view<CardRecord | null>(registry, "get_card", { card_id: Number(id) });
  if (!record) return null;
  return { registry, record, card: JSON.parse(record.card_json) };
}

export function cardPath(id: number, registry: string): string {
  return registry === config.demoRegistry ? `/demo/${id}` : `/c/${id}`;
}
