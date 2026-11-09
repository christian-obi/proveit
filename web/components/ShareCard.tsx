// The 1200×630 images shown when a link is pasted into X, Telegram and the like.
// Same look as the site: dark panel, the card's emblem, flames in the card's colour.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import CardPicture from "@/components/CardPicture";
import { loadCard } from "@/lib/cards";
import { pct, returnLabel, volume, windowLabel } from "@/lib/format";
import { dominant, ICON, KINDS, seeded, totalOf, type Kind } from "@/lib/reaction-kinds";
import { countsOf } from "@/lib/reactions";

const SIZE = { width: 1200, height: 630 };
const BG = "#0a0d0c";
const FG = "#e9efeb";
const MUTED = "#929d96";
const LINE = "#2b3531";
const MINT = "#5cffb1";
const BAD = "#ff5a64";
const WARN = "#ffb35a";
const HEAT: Record<Kind, string> = { fire: "#ff5428", proveit: MINT, near: "#96beff" };

const asset = (path: string) => `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public", path)).toString("base64")}`;

type Font = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" };

/** Google serves TrueType to an old user agent, which is what the image renderer needs. */
async function googleFont(family: string, weight: 400 | 600 | 700, name: string): Promise<Font | null> {
  try {
    const signal = AbortSignal.timeout(4_000);
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, { headers: { "User-Agent": "Mozilla/4.0" }, signal })).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    return { name, weight, style: "normal", data: await (await fetch(url, { signal })).arrayBuffer() };
  } catch {
    return null;
  }
}

let fontLoad: Promise<Font[]> | null = null;
/** If the fonts can't be fetched the image still renders, in the default face. */
function fonts() {
  fontLoad ??= Promise.all([googleFont("JetBrains+Mono", 400, "Mono"), googleFont("JetBrains+Mono", 700, "Mono"), googleFont("Fraunces", 600, "Display")]).then((list) => {
    const ok = list.filter((f): f is Font => f !== null);
    if (ok.length < list.length) fontLoad = null;
    return ok;
  });
  return fontLoad;
}

function flames(seed: string, color: string): string {
  const random = seeded(seed);
  const tongues = Array.from({ length: 46 }, () => {
    const x = random() * 1240 - 20;
    const w = 26 + random() * 64;
    const h = 50 + random() * 150;
    const lean = (random() - 0.5) * 34;
    return `<path d="M${x - w} 260C${x - w} ${260 - h * 0.45} ${x - w * 0.15 + lean} ${260 - h * 0.6} ${x + lean} ${260 - h}C${x + w * 0.2 + lean} ${260 - h * 0.6} ${x + w} ${260 - h * 0.4} ${x + w} 260Z" fill="url(#f)" opacity="${(0.35 + random() * 0.55).toFixed(2)}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="260" viewBox="0 0 1200 260"><defs><linearGradient id="f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${color}" stop-opacity="1"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${tongues}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function Frame({ seed, color, children }: { seed: string; color: string; children: ReactNode }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: BG, color: FG, fontFamily: "Mono" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={flames(seed, color)} width={1200} height={260} alt="" style={{ position: "absolute", left: 0, bottom: 0 }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630, display: "flex", background: `linear-gradient(to top, ${color}38, ${BG}00 62%)` }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630, display: "flex", flexDirection: "column", padding: "44px 56px" }}>{children}</div>
    </div>
  );
}

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("logo.svg")} width={48} height={48} alt="" />
      <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 5, color: MINT }}>PROVE-IT</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#111614e6", border: `1px solid ${LINE}`, padding: "14px 18px" }}>
      <span style={{ fontSize: 30, fontWeight: 700 }}>{value}</span>
      <span style={{ fontSize: 16, letterSpacing: 2, color: MUTED, marginTop: 4 }}>{label}</span>
    </div>
  );
}

export async function cardImage(id: string, registry: string) {
  const loaded = await loadCard(id, registry);
  const fontData = await fonts();
  if (!loaded) {
    return new ImageResponse(
      (
        <Frame seed="missing" color={MUTED}>
          <Brand />
          <span style={{ fontFamily: "Display", fontSize: 72, marginTop: 150 }}>Card not found</span>
        </Frame>
      ),
      { ...SIZE, fonts: fontData },
    );
  }
  const { card, record } = loaded;
  const s = card.stats;
  const up = s.return_bps >= 0;
  const demo = card.mode !== "live";
  const counts = countsOf(`${registry}:${record.id}`);
  const heat = totalOf(counts) > 0 ? HEAT[dominant(counts)] : up ? MINT : BAD;
  const label = returnLabel(s);
  return new ImageResponse(
    (
      <Frame seed={record.card_hash} color={heat}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand />
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 3, padding: "8px 16px", color: demo ? WARN : MINT, border: `2px solid ${demo ? WARN : MINT}` }}>{demo ? "DEMO CARD" : "SIGNED IN A TEE"}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 26 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 22, letterSpacing: 3, color: MUTED }}>
              {`HYPERLIQUID · ${windowLabel(card.window.days).toUpperCase()} RETURN`}
            </span>
            <span style={{ fontSize: label.length > 8 ? 112 : 136, fontWeight: 700, letterSpacing: -5, lineHeight: 1.1, color: up ? MINT : BAD, textShadow: `0 0 44px ${up ? MINT : BAD}80` }}>{label}</span>
            <span style={{ fontFamily: "Display", fontSize: 34, marginTop: 4 }}>Screenshots can be faked. This can&apos;t.</span>
          </div>
          <div style={{ display: "flex", borderRadius: 44, boxShadow: `0 0 60px ${up ? MINT : BAD}66` }}>
            <CardPicture seed={record.card_hash} returnBps={s.return_bps} size={250} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
          <Stat label="MAX DRAWDOWN" value={pct(-s.max_dd_bps)} />
          <Stat label="WIN RATE" value={pct(s.win_rate_bps)} />
          <Stat label="TRADES" value={String(s.trades)} />
          <Stat label="VOLUME" value={volume(s.volume_band)} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", fontSize: 21 }}>
          <span style={{ display: "flex" }}>{s.k_anon ? `Wallet hidden · 1 of ≥ ${s.k_anon} accounts` : "Wallet hidden · recorded on NEAR"}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {totalOf(counts) > 0 &&
              KINDS.filter((k) => counts[k] > 0).map((k) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset(ICON[k].slice(1))} width={26} height={26} alt="" />
                  <span>{counts[k].toLocaleString("en-US")}</span>
                </div>
              ))}
            <span style={{ display: "flex", color: MINT, fontWeight: 700 }}>Verify it yourself →</span>
          </div>
        </div>
      </Frame>
    ),
    { ...SIZE, fonts: fontData },
  );
}

/** The image for every page without its own: the home page, Explore, the docs. */
export async function siteImage() {
  return new ImageResponse(
    (
      <Frame seed="prove-it" color={MINT}>
        <Brand />
        <span style={{ fontFamily: "Display", fontSize: 76, lineHeight: 1.08, marginTop: 44, letterSpacing: -2, maxWidth: 1080 }}>Screenshots can be faked. Prove-It cards can&apos;t.</span>
        <span style={{ fontSize: 28, color: FG, marginTop: 30, maxWidth: 980 }}>Verifiable private trading records. Signed in a TEE, recorded on NEAR, wallet never revealed.</span>
        <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
          {["NO API KEYS", "WALLET HIDDEN", "ANYONE CAN VERIFY"].map((t) => (
            <span key={t} style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, padding: "9px 16px", color: MINT, background: "#0a0d0ccc", border: `2px solid ${MINT}` }}>
              {t}
            </span>
          ))}
        </div>
      </Frame>
    ),
    { ...SIZE, fonts: await fonts() },
  );
}
