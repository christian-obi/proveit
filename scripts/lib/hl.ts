// Minimal Hyperliquid info API client for scripts (recording fixtures, cross-checks).
// Pagination mirrors enclave/src/hl.rs: pages start AT the last timestamp (startTime is
// inclusive) and duplicates are dropped by tid.

export const INFO_URL = "https://api.hyperliquid.xyz/info";
export const PAGE_SIZE = 2000;

export type Point = [number, string];
export type Series = { accountValueHistory: Point[]; pnlHistory: Point[]; vlm: string };
export type Fill = {
  coin: string; px: string; sz: string; side: string; time: number; dir: string;
  closedPnl: string; fee: string; feeToken: string; oid: number; tid: number;
  [k: string]: unknown;
};

export async function info<T>(body: object): Promise<T> {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "proveit-scripts" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`hyperliquid ${JSON.stringify(body)} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function portfolio(user: string): Promise<[string, Series][]> {
  return info({ type: "portfolio", user });
}

export async function fillsBetween(user: string, startTime: number, endTime: number): Promise<Fill[]> {
  const seen = new Set<number>();
  const out: Fill[] = [];
  let cursor = startTime;
  for (;;) {
    const page = await info<Fill[]>({ type: "userFillsByTime", user, startTime: cursor, endTime });
    for (const f of page) if (!seen.has(f.tid)) { seen.add(f.tid); out.push(f); }
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1].time;
    if (last <= cursor) throw new Error(`full page at one millisecond ${cursor}`);
    cursor = last;
  }
  return out.sort((a, b) => a.time - b.time || a.tid - b.tid);
}
