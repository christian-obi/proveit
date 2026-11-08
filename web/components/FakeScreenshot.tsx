"use client";

// A generic "PnL share image" of the kind scammers fake with inspect-element. Deliberately
// not styled after any real exchange. Verifying it shows why a screenshot proves nothing.

import { useState } from "react";

const REASONS = [
  ["Enclave signature", "none: anyone can type these numbers"],
  ["On-chain record", "none: nothing on any chain says this trade happened"],
  ["Enclave code", "none: no code computed it"],
  ["TEE attestation", "none: no hardware vouches for it"],
  ["Account", "unknown: could be a demo account, or someone else's"],
];

export default function FakeScreenshot() {
  const [checked, setChecked] = useState(false);
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-[#1b1530] to-[#0d1424] p-5 text-white">
        <span className="absolute right-3 top-3 rounded bg-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">sample fake</span>
        <p className="text-xs text-white/60">BTC-PERP · Long · 50x</p>
        <p className="mt-3 text-xs text-white/60">ROE</p>
        <p className="text-5xl font-bold tabular-nums text-[#3ee6a3]">+1,284.6%</p>
        <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-white/50">Entry price</p>
            <p className="font-medium tabular-nums">61,240.0</p>
          </div>
          <div>
            <p className="text-white/50">Mark price</p>
            <p className="font-medium tabular-nums">77,013.5</p>
          </div>
        </div>
        <p className="mt-5 text-[11px] text-white/40">Edited in 5 seconds with inspect-element. Looks real. Proves nothing.</p>
      </div>
      <button onClick={() => setChecked(true)} className="rounded-md border border-line px-4 py-1.5 text-sm">
        Verify the screenshot
      </button>
      {checked && (
        <ul className="space-y-2 rounded-lg border border-bad/40 bg-panel p-4 text-sm">
          {REASONS.map(([label, why]) => (
            <li key={label} className="flex gap-3">
              <span className="w-4 shrink-0 font-bold text-bad">✕</span>
              <span>
                <span className="font-medium">{label}</span>
                <span className="text-muted"> · {why}</span>
              </span>
            </li>
          ))}
          <li className="pt-1 font-medium text-bad">Can&apos;t be verified. There&apos;s nothing to check.</li>
        </ul>
      )}
    </div>
  );
}
