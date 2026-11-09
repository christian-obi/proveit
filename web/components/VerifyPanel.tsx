"use client";

// Runs the five checks from packages/verify in the browser, against public data only, and
// offers tamper mode: edit a number and watch the checks fail.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verifyCard, type Cache, type Check, type Report } from "@proveit/verify/checks";
import Card, { type CardData } from "@/components/Card";
import { endpointsFor } from "@/lib/config";

const ICON: Record<Check["status"], string> = { pass: "✓", fail: "✕", warn: "!" };
const TONE: Record<Check["status"], string> = { pass: "text-accent", fail: "text-bad", warn: "text-warn" };

type Edits = { return_bps: string; max_dd_bps: string; trades: string };

export default function VerifyPanel({ registry, cardId, cardJson, autoRun = false }: { registry: string; cardId: number; cardJson: string; autoRun?: boolean }) {
  const original = useMemo(() => JSON.parse(cardJson), [cardJson]);
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tamperOn, setTamperOn] = useState(false);
  const [edits, setEdits] = useState<Edits>({
    return_bps: (original.stats.return_bps / 100).toFixed(2),
    max_dd_bps: (original.stats.max_dd_bps / 100).toFixed(2),
    trades: String(original.stats.trades),
  });

  const edited = useMemo(() => {
    if (!tamperOn) return null;
    const c = structuredClone(original);
    const toBps = (s: string) => Math.round(Number(s) * 100);
    if (!Number.isNaN(Number(edits.return_bps))) c.stats.return_bps = toBps(edits.return_bps);
    if (!Number.isNaN(Number(edits.max_dd_bps))) c.stats.max_dd_bps = toBps(edits.max_dd_bps);
    if (/^\d+$/.test(edits.trades)) c.stats.trades = Number(edits.trades);
    return c;
  }, [tamperOn, edits, original]);
  const isEdited = !!edited && JSON.stringify(edited) !== JSON.stringify(original);

  // Each edit starts a new check while older ones may still be in flight. Only the latest
  // run may update the panel; otherwise a slower check of the unedited card could finish
  // last and show a tampered card as verified.
  const latest = useRef(0);
  // The record, config, versions and attestation don't change while you edit; only
  // verify_card is asked again (and public RPCs rate-limit).
  const cache = useRef<Cache>(new Map());
  const run = useCallback(async () => {
    const id = ++latest.current;
    setRunning(true);
    setError(null);
    try {
      const r = await verifyCard({ registry, cardId, cardJson: edited ? JSON.stringify(edited) : undefined }, endpointsFor(registry), fetch, cache.current);
      if (id === latest.current) setReport(r);
    } catch (e) {
      if (id === latest.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === latest.current) setRunning(false);
    }
  }, [registry, cardId, edited]);

  useEffect(() => {
    if (!autoRun && !report) return;
    // Re-run after each edit once checks have been shown, waiting for typing to pause.
    const t = setTimeout(run, edited ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edited]);

  const fails = report?.checks.filter((c) => c.status === "fail").length ?? 0;

  return (
    <div className="space-y-4">
      {edited && <Card card={edited as CardData} id={cardId} edited={isEdited} />}
      <div className="rounded-lg border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Verification</h2>
          <div className="flex gap-2">
            <button onClick={() => setTamperOn((t) => !t)} className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
              {tamperOn ? "Stop tampering" : "Tamper mode"}
            </button>
            <button onClick={run} disabled={running} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40">
              {running ? "Checking…" : report ? "Check again" : "Verify"}
            </button>
          </div>
        </div>

        {tamperOn && (
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-md border border-dashed border-line p-3 text-sm">
            <p className="col-span-3 text-xs text-muted">Change a number like a faked screenshot would. The checks re-run on every edit.</p>
            {(
              [
                ["return_bps", "Return %"],
                ["max_dd_bps", "Max drawdown %"],
                ["trades", "Trades"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="space-y-1">
                <span className="text-xs text-muted">{label}</span>
                <input
                  value={edits[k]}
                  onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}
                  className="w-full rounded border border-line bg-bg px-2 py-1 font-mono tabular-nums"
                  inputMode="decimal"
                  aria-label={label}
                />
              </label>
            ))}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        {report && (
          <>
            <ul className="mt-4 space-y-2">
              {report.checks.map((c, i) => (
                <li key={`${c.id}:${c.status}`} className="check-in flex gap-3 text-sm" style={{ "--i": i } as React.CSSProperties} data-check={c.id} data-status={c.status}>
                  <span className={`w-4 shrink-0 font-bold ${TONE[c.status]}`}>{ICON[c.status]}</span>
                  <span>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-muted"> · {c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className={`mt-4 text-sm font-medium ${fails ? "text-bad" : "text-accent"}`} data-verdict={fails ? "fail" : "pass"}>
              {fails ? `Not verified: ${fails} check${fails > 1 ? "s" : ""} failed.` : "Verified: these are the numbers the enclave computed and signed."}
            </p>
            {report.attestationUrl && (
              <a className="mt-1 inline-block text-xs text-muted underline" href={report.attestationUrl} target="_blank" rel="noreferrer">
                Raw TEE attestation
              </a>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-muted">
          Checked in your browser from public data only: the NEAR registry {registry} and OutLayer&apos;s attestation API. Same checks as{" "}
          <span className="font-mono">pnpm verify</span>.
        </p>
      </div>
    </div>
  );
}
