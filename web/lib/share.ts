// What a shared card says, and where it goes. Pure, so the button and the tests agree.
// The link itself carries the picture: every card URL has a 1200×630 preview image.

import { returnLabel, windowLabel } from "./format";

export type ShareStats = { return_bps: number; return_precision_bps?: number; max_dd_bps: number; trades: number };

export function shareText(stats: ShareStats, days: number, demo: boolean): string {
  const lead = `${returnLabel(stats)} on Hyperliquid in ${windowLabel(days)}${demo ? " (demo card)" : ""}`;
  return `${lead}, signed in a TEE and recorded on NEAR. Wallet stays private. Screenshots can be faked. This can't. Verify it yourself:`;
}

export function shareTargets(text: string, url: string) {
  const t = encodeURIComponent(text);
  const u = encodeURIComponent(url);
  return {
    x: `https://x.com/intent/post?text=${t}&url=${u}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
    image: `${url}/opengraph-image`,
  };
}
