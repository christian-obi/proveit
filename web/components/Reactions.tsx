"use client";

// A card's three reaction buttons and all their motion: heat, flames, embers and lightning that
// grow by tier, a heap of icons along the bottom edge, and a hit on every click (burst, shake,
// combo). Place inside a `.reactive` box. Clicks show at once and are sent in small batches.

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { dominant, heatOf, ICON, KINDS, LABEL, mergeCounts, NO_COUNTS, pileSize, seeded, tierOf, TIER_NAMES, totalOf, type Counts, type Kind } from "@/lib/reaction-kinds";

const FLUSH_MS = 150;
const POLL_MS = 2_000;
const ICON_SIZE = 20;
const MAX_STACK = 40;
const GRAVITY = 0.0034;
const BOUNCE_MS = 170;
const HOP_MS = 340;
const COMBO_MS = 800;
const MAX_FLYING = 70;
const RGB: Record<Kind, string> = { fire: "255, 84, 40", proveit: "92, 255, 177", near: "150, 190, 255" };

type Piece = { kind: Kind; x: number; landed: number; spin: number; start: number | null; hop: number; hopAt: number };

let images: Record<Kind, HTMLImageElement> | null = null;
function icons() {
  images ??= Object.fromEntries(
    KINDS.map((k) => {
      const img = new Image();
      img.src = ICON[k];
      return [k, img];
    }),
  ) as Record<Kind, HTMLImageElement>;
  return images;
}

const fxLevel = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "off" : (document.documentElement.dataset.fx ?? "full"));

let flying = 0;
/** Icons thrown out of a button, in fixed position so a card's clipping can't cut them off. */
function burst(from: Element, kind: Kind, count: number) {
  const box = from.getBoundingClientRect();
  for (let i = 0; i < count && flying < MAX_FLYING; i++) {
    flying++;
    const img = new Image(20, 20);
    img.src = ICON[kind];
    img.alt = "";
    img.style.cssText = `position:fixed;left:${box.left + box.width / 2 - 10}px;top:${box.top - 4}px;z-index:50;pointer-events:none`;
    document.body.appendChild(img);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const reach = 50 + Math.random() * 90;
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach;
    const spin = (Math.random() - 0.5) * 900;
    const flight = img.animate(
      [
        { transform: "translate(0,0) scale(.5)", opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) scale(1.3) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx * 1.3}px,${dy + 130}px) scale(.7) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 620 + Math.random() * 260, easing: "cubic-bezier(.2,.75,.4,1)" },
    );
    flight.onfinish = flight.oncancel = () => {
      img.remove();
      flying--;
    };
  }
}

/** Icons fall, bounce once and settle on a height map. Seeded: everyone sees the same heap. */
function Pile({ cardKey, counts, kick }: { cardKey: string; counts: Counts; kick: MutableRefObject<(power: number) => void> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ counts, draw: () => {} });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let random = seeded(cardKey);
    let pieces: Piece[] = [];
    let heights: number[] = [];
    let drawn: Counts = { ...NO_COUNTS };
    let frame = 0;
    let visible = true;
    let primed = false;
    const img = icons();

    const addPieces = (animate: boolean, width: number, height: number) => {
      for (const kind of KINDS) {
        const want = pileSize(live.current.counts[kind]);
        for (let i = pileSize(drawn[kind]); i < want; i++) {
          const x = random() * Math.max(1, width - ICON_SIZE);
          const col = Math.floor(x / (ICON_SIZE * 0.55));
          const stack = Math.min(MAX_STACK, heights[col] ?? 0);
          heights[col] = stack + ICON_SIZE * 0.4;
          pieces.push({ kind, x, landed: height - ICON_SIZE - stack + 1, spin: (random() - 0.5) * 1.2, start: animate ? performance.now() + random() * 120 : null, hop: 0, hopAt: 0 });
        }
        drawn[kind] = live.current.counts[kind];
      }
    };

    const paint = (now: number) => {
      const scale = window.devicePixelRatio || 1;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, el.clientWidth, el.clientHeight);
      let moving = false;
      for (const p of pieces) {
        const image = img[p.kind];
        if (!image.complete) {
          moving = true;
          continue;
        }
        let y = p.landed;
        let spin = p.spin;
        if (p.start !== null) {
          const t = now - p.start;
          if (t < 0) {
            moving = true;
            continue;
          }
          const fall = Math.sqrt((p.landed + ICON_SIZE) / GRAVITY);
          if (t < fall) {
            y = -ICON_SIZE + GRAVITY * t * t;
            spin += (fall - t) * 0.012;
            moving = true;
          } else if (t < fall + BOUNCE_MS) {
            y = p.landed - Math.sin(((t - fall) / BOUNCE_MS) * Math.PI) * 11;
            moving = true;
          } else p.start = null;
        }
        if (p.hop) {
          const t = (now - p.hopAt) / HOP_MS;
          if (t >= 1) p.hop = 0;
          else if (t > 0) {
            y -= Math.sin(t * Math.PI) * p.hop;
            spin += Math.sin(t * Math.PI * 2) * 0.35;
            moving = true;
          } else moving = true;
        }
        ctx.save();
        ctx.translate(p.x + ICON_SIZE / 2, y + ICON_SIZE / 2);
        ctx.rotate(spin);
        ctx.drawImage(image, -ICON_SIZE / 2, -ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);
        ctx.restore();
      }
      frame = moving && visible ? requestAnimationFrame(paint) : 0;
    };

    const start = () => {
      if (!frame && visible) frame = requestAnimationFrame(paint);
    };

    const rebuild = () => {
      const scale = window.devicePixelRatio || 1;
      el.width = el.clientWidth * scale;
      el.height = el.clientHeight * scale;
      pieces = [];
      heights = [];
      drawn = { ...NO_COUNTS };
      random = seeded(cardKey);
      el.style.display = fxLevel() === "off" ? "none" : "";
      addPieces(false, el.clientWidth, el.clientHeight);
      primed = true;
      start();
    };

    live.current.draw = () => {
      if (!primed) return;
      const level = fxLevel();
      el.style.display = level === "off" ? "none" : "";
      addPieces(level === "full", el.clientWidth, el.clientHeight);
      start();
    };

    kick.current = (power) => {
      const now = performance.now();
      for (const p of pieces) {
        if (p.start !== null) continue;
        p.hop = (0.35 + Math.random() * 0.65) * power;
        p.hopAt = now + Math.random() * 70;
      }
      start();
    };

    const resize = new ResizeObserver(rebuild);
    resize.observe(el);
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    seen.observe(el);
    const fx = new MutationObserver(() => live.current.draw());
    fx.observe(document.documentElement, { attributes: true, attributeFilter: ["data-fx"] });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      fx.disconnect();
    };
  }, [cardKey, kick]);

  useEffect(() => {
    live.current.counts = counts;
    live.current.draw();
  }, [counts]);

  return <canvas ref={canvas} className="pile" aria-hidden />;
}

/** The always-moving layer. More appears at each tier; off screen it pauses. */
function Heat({ cardKey, tier, heat, rgb }: { cardKey: string; tier: number; heat: number; rgb: string }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new IntersectionObserver(([entry]) => {
      el.dataset.paused = entry.isIntersecting ? "0" : "1";
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  const parts = useMemo(() => {
    const r = seeded(`${cardKey}:heat`);
    const place = (n: number) => Array.from({ length: n }, () => ({ x: r() * 100, delay: r(), speed: r(), size: r() }));
    return { tongues: place(32), embers: place(18), bolts: place(3) };
  }, [cardKey]);

  const tongues = [0, 8, 14, 20, 26, 32][tier];
  const embers = [0, 0, 5, 10, 14, 18][tier];
  const bolts = [0, 0, 0, 1, 2, 3][tier];

  return (
    <span ref={box} className="heat" aria-hidden data-tier={tier} style={{ "--heat": heat, "--heat-rgb": rgb } as React.CSSProperties}>
      <span className="lava" />
      {parts.tongues.slice(0, tongues).map((p, i) => (
        <i key={i} className="tongue" style={{ left: `${p.x}%`, width: 18 + p.size * 34, height: 22 + tier * 9 + p.size * 26, animationDuration: `${520 + p.speed * 420}ms`, animationDelay: `${-p.delay * 900}ms` }} />
      ))}
      {parts.embers.slice(0, embers).map((p, i) => (
        <i key={i} className="ember" style={{ left: `${p.x}%`, animationDuration: `${900 + p.speed * 900}ms`, animationDelay: `${-p.delay * 1800}ms` }} />
      ))}
      {parts.bolts.slice(0, bolts).map((p, i) => (
        <i key={i} className="bolt" style={{ left: `${p.x}%`, animationDuration: `${1500 + p.speed * 1400}ms`, animationDelay: `${-p.delay * 2400}ms` }} />
      ))}
    </span>
  );
}

export default function Reactions({ cardKey, counts: server }: { cardKey: string; counts?: Counts }) {
  const [counts, setCounts] = useState<Counts>(server ?? NO_COUNTS);
  const [combo, setCombo] = useState<{ n: number; kind: Kind } | null>(null);
  const [popped, setPopped] = useState<Kind | null>(null);
  const queue = useRef<Partial<Record<Kind, number>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streak = useRef({ kind: "fire" as Kind, n: 0, last: 0 });
  const comboEnd = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kick = useRef<(power: number) => void>(() => {});
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef<number | null>(null);

  useEffect(() => {
    if (server) setCounts((c) => mergeCounts(c, server));
  }, [server]);

  // Used outside the board (card pages, profiles), where no poll supplies the counts.
  const standalone = server === undefined;
  useEffect(() => {
    if (!standalone) return;
    const load = () =>
      fetch(`/api/reactions?card=${encodeURIComponent(cardKey)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setCounts((c) => mergeCounts(c, d.counts)))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => !document.hidden && load(), POLL_MS);
    return () => clearInterval(t);
  }, [standalone, cardKey]);

  const flush = useCallback(() => {
    timer.current = null;
    const batch = queue.current;
    queue.current = {};
    for (const kind of KINDS) {
      const n = batch[kind];
      if (!n) continue;
      fetch("/api/reactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: cardKey, kind, n }), keepalive: true })
        .then((r) => r.json())
        .then((d) => d.counts && setCounts((c) => mergeCounts(c, d.counts)))
        .catch(() => undefined);
    }
  }, [cardKey]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        flush();
      }
      if (comboEnd.current) clearTimeout(comboEnd.current);
    },
    [flush],
  );

  const total = totalOf(counts);
  const tier = tierOf(total);
  const lead = dominant(counts);

  // A tier reached while watching, by anyone, gets its own moment. Not on first load.
  useEffect(() => {
    const before = shown.current;
    shown.current = tier;
    if (before === null || tier <= before || fxLevel() === "off") return;
    const card = root.current?.closest(".reactive");
    card?.animate([{ transform: "scale(1)", filter: "brightness(1.9)" }, { transform: "scale(1.018)", filter: "brightness(1.4)", offset: 0.35 }, { transform: "scale(1)", filter: "brightness(1)" }], 620);
    if (fxLevel() === "full" && root.current) {
      burst(root.current, lead, 22);
      kick.current(30);
    }
  }, [tier, lead]);

  // Other people's clicks arriving: the heap jumps a little so the row visibly answers.
  const lastTotal = useRef(total);
  useEffect(() => {
    if (total > lastTotal.current && Date.now() - streak.current.last > COMBO_MS && fxLevel() === "full") kick.current(6);
    lastTotal.current = total;
  }, [total]);

  const react = (kind: Kind, button: HTMLElement) => {
    setCounts((c) => ({ ...c, [kind]: c[kind] + 1 }));
    const pending = (queue.current[kind] ?? 0) + 1;
    queue.current[kind] = pending;
    if (pending >= 50) {
      if (timer.current) clearTimeout(timer.current);
      flush();
    } else timer.current ??= setTimeout(flush, FLUSH_MS);

    const now = Date.now();
    const s = streak.current;
    s.n = s.kind === kind && now - s.last < COMBO_MS ? s.n + 1 : 1;
    s.kind = kind;
    s.last = now;
    setPopped(null);
    requestAnimationFrame(() => setPopped(kind));

    const level = fxLevel();
    if (level === "off") return;
    if (s.n > 1) setCombo({ n: s.n, kind });
    if (comboEnd.current) clearTimeout(comboEnd.current);
    comboEnd.current = setTimeout(() => setCombo(null), COMBO_MS);
    if (level !== "full") return;

    burst(button, kind, Math.min(4 + Math.floor(s.n / 2), 14));
    kick.current(Math.min(10 + s.n * 2.5, 34));
    const push = Math.min(1.5 + s.n * 0.5, 7);
    root.current?.closest(".reactive")?.animate(
      [
        { transform: "translate(0,0)", boxShadow: `inset 0 0 ${24 + push * 8}px rgba(${RGB[kind]}, .75)` },
        { transform: `translate(${-push}px,${push * 0.5}px)` },
        { transform: `translate(${push}px,${-push * 0.5}px)` },
        { transform: `translate(${-push * 0.5}px,0)` },
        { transform: "translate(0,0)", boxShadow: `inset 0 0 0 rgba(${RGB[kind]}, 0)` },
      ],
      { duration: 240, easing: "ease-out" },
    );
  };

  return (
    <>
      <Heat cardKey={cardKey} tier={tier} heat={heatOf(total)} rgb={RGB[lead]} />
      <Pile cardKey={cardKey} counts={counts} kick={kick} />
      <div ref={root} className="relative flex flex-wrap items-center gap-1.5" data-reactions={cardKey} data-tier={tier}>
        {KINDS.map((kind) => (
          <button key={kind} type="button" onClick={(e) => react(kind, e.currentTarget)} className={`react-pill ${popped === kind ? "is-hit" : ""}`} data-kind={kind} aria-label={`React with ${LABEL[kind]}, ${counts[kind]} so far`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ICON[kind]} alt="" width={16} height={16} />
            <span key={counts[kind]} className="value-tick tabular-nums" data-count>
              {counts[kind].toLocaleString("en-US")}
            </span>
          </button>
        ))}
        {tier > 0 && (
          <span key={tier} className="tier-chip" style={{ "--heat-rgb": RGB[lead] } as React.CSSProperties}>
            {TIER_NAMES[tier]}
          </span>
        )}
        {combo && (
          <span key={combo.n} className="combo" style={{ "--heat-rgb": RGB[combo.kind], fontSize: `${Math.min(16 + combo.n * 0.9, 34)}px` } as React.CSSProperties} aria-hidden>
            ×{combo.n}
          </span>
        )}
      </div>
    </>
  );
}
