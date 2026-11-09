"use client";

// Motion level: full, lite or off, remembered per browser. The attribute itself is set before
// first paint by the inline script in the root layout.

import { useEffect, useState } from "react";

const LEVELS = ["full", "lite", "off"] as const;
type Level = (typeof LEVELS)[number];

export default function FxToggle() {
  const [level, setLevel] = useState<Level>("full");

  useEffect(() => {
    const current = document.documentElement.dataset.fx as Level | undefined;
    if (current && LEVELS.includes(current)) setLevel(current);
  }, []);

  const choose = (next: Level) => {
    setLevel(next);
    document.documentElement.dataset.fx = next;
    try {
      localStorage.setItem("fx", next);
    } catch {
      // Private windows can refuse storage; the choice still applies to this page.
    }
  };

  return (
    <div className="fx-toggle" role="group" aria-label="Motion effects">
      <span aria-hidden>FX</span>
      {LEVELS.map((l) => (
        <button key={l} onClick={() => choose(l)} aria-pressed={l === level} className={l === level ? "is-on" : ""}>
          {l}
        </button>
      ))}
    </div>
  );
}
