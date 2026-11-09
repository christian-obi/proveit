// Reactions are a social signal only: anonymous, unverified, and never part of a card's checks
// or its rank. Pure helpers, shared by the server, the page and the tests.

export const KINDS = ["fire", "proveit", "near"] as const;
export type Kind = (typeof KINDS)[number];
export type Counts = Record<Kind, number>;

export const NO_COUNTS: Counts = { fire: 0, proveit: 0, near: 0 };
export const LABEL: Record<Kind, string> = { fire: "Fire", proveit: "Prove-It", near: "NEAR" };
export const ICON: Record<Kind, string> = { fire: "/reactions/fire.svg", proveit: "/reactions/proveit.svg", near: "/reactions/near.svg" };

/** Counts only rise, so the higher of two views is always the newer one. */
export const mergeCounts = (a: Counts, b: Counts): Counts => ({ fire: Math.max(a.fire, b.fire), proveit: Math.max(a.proveit, b.proveit), near: Math.max(a.near, b.near) });

export const totalOf = (c: Counts) => c.fire + c.proveit + c.near;

/** How many icons to draw for a count: one each up to 60, then slower, so huge counts still fit. */
export const pileSize = (count: number) => (count <= 60 ? count : Math.min(140, Math.round(60 + 30 * Math.log10(count / 60))));

/** 0 to 1: how warm a row looks. Logarithmic, so early clicks show. */
export const heatOf = (total: number) => Math.min(1, Math.log10(total + 1) / 4);

const TIERS = [1, 10, 50, 250, 1000];
export const TIER_NAMES = ["", "Warm", "Hot", "Blazing", "Inferno", "Legend"];

/** 0 to 5: how much motion a card earns. Each step switches on more effects. */
export const tierOf = (total: number) => TIERS.filter((t) => total >= t).length;

export const dominant = (c: Counts): Kind => KINDS.reduce((best, k) => (c[k] > c[best] ? k : best), "fire" as Kind);

export const CARD_KEY = /^[a-z0-9._-]{2,64}:\d{1,9}$/;

/** A small deterministic generator, so a card's pile lands the same way for everyone. */
export function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
