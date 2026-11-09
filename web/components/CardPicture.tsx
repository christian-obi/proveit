// A card's picture: an emblem drawn only from its public on-chain hash, so every card has its
// own and nothing about the wallet goes in. The frame colour follows the card's return.

import { seeded } from "@/lib/reaction-kinds";

const tier = (bps: number) => (bps >= 5_000 ? "#ffd166" : bps >= 1_000 ? "#5cffb1" : bps >= 0 ? "#7cc4ff" : "#ff5a64");

function petal(random: () => number, reach: number): string {
  const a = 6 + random() * 12;
  const b = reach * (0.35 + random() * 0.35);
  return `M0 0C${a} ${-b * 0.4} ${a * 0.8} ${-b} 0 ${-reach}C${-a * 0.8} ${-b} ${-a} ${-b * 0.4} 0 0Z`;
}

export default function CardPicture({ seed, returnBps, label, size = 72 }: { seed: string; returnBps: number; label?: string; size?: number }) {
  const random = seeded(seed);
  const hue = Math.floor(random() * 360);
  const folds = 5 + Math.floor(random() * 5);
  const frame = tier(returnBps);
  const layers = [
    { reach: 42, color: `hsl(${hue} 85% 42%)`, turn: 0 },
    { reach: 31, color: `hsl(${(hue + 40 + random() * 60) % 360} 90% 58%)`, turn: 180 / folds },
    { reach: 19, color: `hsl(${(hue + 170 + random() * 40) % 360} 95% 72%)`, turn: 0 },
  ].map((l) => ({ ...l, d: petal(random, l.reach) }));
  const id = `pic-${seed.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="card-picture shrink-0" style={{ color: frame }} role="img" aria-label="Card emblem">
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor={`hsl(${hue} 70% 22%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 60% 6%)`} />
        </radialGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="16" fill={`url(#${id})`} stroke={frame} strokeWidth="4" />
      <g transform="translate(50 50)">
        {layers.map((l) =>
          Array.from({ length: folds }, (_, i) => <path key={`${l.reach}-${i}`} d={l.d} fill={l.color} opacity="0.9" transform={`rotate(${(360 / folds) * i + l.turn})`} />),
        )}
        <path d="M0-9 7.8-4.5v9L0 9l-7.8-4.5v-9Z" fill="#0a0d0c" stroke={frame} strokeWidth="2" />
      </g>
      {label && (
        <>
          <rect x="62" y="76" width="35" height="21" rx="5" fill="#0a0d0c" stroke={frame} strokeWidth="1.5" />
          <text x="79.5" y="91.5" textAnchor="middle" fontSize="13" fontFamily="monospace" fontWeight="700" fill={frame}>
            {label}
          </text>
        </>
      )}
    </svg>
  );
}
