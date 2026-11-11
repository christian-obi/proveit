export const pct = (bps: number, signed = false) => `${signed && bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

export const date = (secs: number) =>
  new Date(secs * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const windowLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);

export const volume = (band: string) => {
  const exp = Number(band.replace("1e", ""));
  const units = ["", "", "", "$1K+", "$10K+", "$100K+", "$1M+", "$10M+", "$100M+", "$1B+"];
  if (exp < 3) return "under $1K";
  return units[exp] ?? `10^${exp}+`;
};

/** The published return: exact on old cards, a k-anonymous bucket on new ones (enclave/src/kanon.rs). */
export function returnLabel(s: { return_bps: number; return_precision_bps?: number }): string {
  const p = s.return_precision_bps;
  if (!p) return pct(s.return_bps, true);
  const lo = s.return_bps, hi = s.return_bps + p;
  const d = p < 100 ? 1 : 0;
  const f = (bps: number) => (bps / 100).toFixed(d);
  if (lo >= 0) return `+${f(lo)}–${f(hi)}%`;
  // A dash between two negative numbers reads as a double minus, so spell out the range.
  return `${f(lo)}% to ${hi > 0 ? "+" : ""}${f(hi)}%`;
}
