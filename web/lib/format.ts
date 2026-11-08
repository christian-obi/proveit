export const pct = (bps: number, signed = false) => `${signed && bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

export const date = (secs: number) =>
  new Date(secs * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const windowLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);

export const volume = (band: string) => {
  const exp = Number(band.replace("1e", ""));
  const units = ["", "", "", "$1K+", "$10K+", "$100K+", "$1M+", "$10M+", "$100M+", "$1B+"];
  return units[exp] ?? `10^${exp}+`;
};
