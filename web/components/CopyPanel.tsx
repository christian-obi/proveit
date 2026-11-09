"use client";

// Copy from this tab. The feed hands over new trades; each is sized to the follower's account
// and placed straight from the browser to Hyperliquid with a short-lived agent key. Nothing
// keeps trading when the tab closes, and the app's server never sees the address or the key.

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { DEFAULT_SETTINGS, planCopy, type CopyRecord, type CopySettings, type Plan } from "@/lib/copy-plan";
import { approveNewAgent, cloidFor, loadFollower, loadMarket, placeOrder, wirePrice, wireSize, type Agent, type Follower, type HlNetwork, type Market } from "@/lib/hyperliquid";
import { connectEvm } from "@/lib/wallets";

export type Destination = "simulate" | HlNetwork;
export type CopyHandle = { copy: (seq: number, record: CopyRecord) => void; incoming: (entries: { seq: number; record: CopyRecord }[]) => void };

type Log = { id: number; label: string; outcome: string; tone: "good" | "bad" | "muted" };

const MAX_ERRORS = 3;
const button = "rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-fg disabled:opacity-40";
const ghost = "rounded-md border border-line px-3 py-2 text-xs disabled:opacity-40";
const TONE = { good: "text-accent", bad: "text-bad", muted: "text-muted" };
const DEST_LABEL: Record<Destination, string> = { simulate: "Simulate", testnet: "Hyperliquid testnet", mainnet: "Real money" };

const doneKey = (network: string, address: string, cardHash: string) => `copied:${network}:${address.toLowerCase()}:${cardHash}`;

function readDone(key: string): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set();
  }
}

function writeDone(key: string, done: Set<number>) {
  try {
    localStorage.setItem(key, JSON.stringify([...done]));
  } catch {
    // Without storage the client order id still stops a duplicate.
  }
}

export default function CopyPanel({ cardHash, isLive, handle }: { cardHash: string; isLive: boolean; handle: Ref<CopyHandle> }) {
  const [destination, setDestination] = useState<Destination>("simulate");
  const [settings, setSettings] = useState<CopySettings>(DEFAULT_SETTINGS);
  const [simEquity, setSimEquity] = useState(1_000);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [agentReady, setAgentReady] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const agent = useRef<Agent | null>(null);
  const sim = useRef<Follower>({ equity: 1_000, exposure: 0, positions: {} });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const errors = useRef(0);
  const nextId = useRef(0);
  const live = useRef({ destination, settings, address, auto });
  live.current = { destination, settings, address, auto };

  const log = (label: string, outcome: string, tone: Log["tone"]) => setLogs((old) => [{ id: nextId.current++, label, outcome, tone }, ...old].slice(0, 40));

  useEffect(() => {
    sim.current = { equity: simEquity, exposure: 0, positions: {} };
  }, [simEquity]);

  // Changing where orders go always disarms, and a real-money key never carries over.
  const choose = (next: Destination) => {
    agent.current = null;
    setAgentReady(false);
    setAuto(false);
    setUnderstood(false);
    setError(null);
    setDestination(next);
  };

  const settingsOk = settings.multiplierPct > 0 && settings.multiplierPct <= 300 && settings.maxUsd >= 10 && settings.slippagePct > 0 && settings.slippagePct <= 3 && settings.maxLeverage > 0 && settings.maxLeverage <= 20;
  const ready = settingsOk && (destination === "simulate" || (agentReady && (destination === "testnet" || understood)));

  const execute = useCallback(
    (seq: number, record: CopyRecord, sample: boolean) => {
      queue.current = queue.current.then(async () => {
        const { destination: where, settings: s, address: who } = live.current;
        const label = `${record.dir} ${record.coin} · ${(record.size_bps / 100).toFixed(2)}% of equity`;
        const key = who && where !== "simulate" && !sample ? doneKey(where, who, cardHash) : null;
        const done = key ? readDone(key) : null;
        if (done?.has(seq)) return log(label, "already copied", "muted");
        try {
          const data: HlNetwork = where === "testnet" ? "testnet" : "mainnet";
          const market: Market | null = await loadMarket(data, record.coin);
          if (where === "simulate") {
            const plan = planCopy(record, sim.current, market, s);
            if (plan.kind === "skip") return log(label, `Skipped: ${plan.reason}`, "muted");
            const signed = plan.isBuy ? plan.size : -plan.size;
            const held = (sim.current.positions[record.coin] ?? 0) + signed;
            sim.current.positions[record.coin] = Math.abs(held) < 1e-12 ? 0 : held;
            sim.current.exposure = Object.entries(sim.current.positions).reduce((sum, [c, q]) => sum + (c === record.coin ? Math.abs(q) * market!.mid : 0), 0);
            return log(label, `Simulated ${describe(plan)}`, "good");
          }
          if (!who || !agent.current) return log(label, "Not armed: approve the agent first", "bad");
          const follower = await loadFollower(data, who);
          const plan = planCopy(record, follower, market, s);
          if (plan.kind === "skip") return log(label, `Skipped: ${plan.reason}`, "muted");
          const result = await placeOrder(agent.current, {
            asset: market!.asset,
            isBuy: plan.isBuy,
            price: wirePrice(plan.limit, market!.szDecimals),
            size: wireSize(plan.size, market!.szDecimals),
            reduceOnly: plan.reduceOnly,
            cloid: sample ? undefined : cloidFor(cardHash, seq),
          });
          if (result.status === "error") throw new Error(result.message);
          errors.current = 0;
          if (key && done) {
            done.add(seq);
            writeDone(key, done);
          }
          log(label, result.status === "filled" ? `Filled ${result.size} ${record.coin} at $${result.price}` : "Order placed", "good");
        } catch (e) {
          errors.current += 1;
          log(label, `Failed: ${e instanceof Error ? e.message : String(e)}`, "bad");
          if (errors.current >= MAX_ERRORS && live.current.auto) {
            setAuto(false);
            setError(`Automatic copying stopped after ${MAX_ERRORS} failures in a row.`);
          }
        }
      });
    },
    [cardHash],
  );

  useImperativeHandle(handle, () => ({
    copy: (seq, record) => execute(seq, record, false),
    // Only trades that arrive while armed are copied: old signals are never replayed.
    incoming: (entries) => {
      if (live.current.auto) for (const e of entries) execute(e.seq, e.record, false);
    },
  }), [execute]);

  async function arm() {
    try {
      setBusy(true);
      setError(null);
      const owner = address ?? (await connectEvm());
      setAddress(owner);
      if (destination === "simulate") return;
      agent.current = await approveNewAgent(destination, owner);
      setAgentReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const number = (key: keyof CopySettings, label: string, step: number) => (
    <label className="space-y-1">
      <span className="label block">{label}</span>
      <input type="number" step={step} min={0} value={settings[key]} disabled={auto} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} className="w-full border border-line px-2 py-1.5 font-mono text-sm" data-setting={key} />
    </label>
  );

  return (
    <section className="space-y-4 rounded-lg border border-line bg-panel p-4" data-copy-panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Copy from this tab</h2>
        <span className="label" data-copy-state={auto ? "on" : "off"}>
          {auto ? <span className="text-accent">Auto-copy on</span> : "Auto-copy off"}
        </span>
      </div>
      <p className="text-sm text-muted">Each new trade is sized to your account and sent straight from this browser to Hyperliquid. Copying stops when you close this tab, and old trades are never replayed.</p>

      <nav className="flex flex-wrap gap-2" aria-label="Where to copy">
        {(["simulate", "testnet", "mainnet"] as Destination[]).map((d) => (
          <button key={d} type="button" onClick={() => choose(d)} disabled={d === "mainnet" && !isLive} aria-pressed={d === destination} className={`chip disabled:opacity-40 ${d === destination ? "is-on" : ""}`}>
            {DEST_LABEL[d]}
          </button>
        ))}
      </nav>
      {!isLive && <p className="text-xs text-muted">This is a demo card, so real-money copying is off.</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {number("multiplierPct", "Size %", 10)}
        {number("maxUsd", "Max per trade $", 5)}
        {number("slippagePct", "Max slippage %", 0.1)}
        {number("maxLeverage", "Max leverage", 1)}
      </div>
      {destination === "simulate" && (
        <label className="block max-w-48 space-y-1">
          <span className="label block">Pretend balance $</span>
          <input type="number" min={0} value={simEquity} onChange={(e) => setSimEquity(Number(e.target.value))} className="w-full border border-line px-2 py-1.5 font-mono text-sm" data-sim-equity />
        </label>
      )}

      {destination !== "simulate" && !agentReady && (
        <div className="space-y-2">
          <button className={button} disabled={busy || !settingsOk} onClick={arm}>
            {busy ? "Check your wallet…" : "Approve a trading key"}
          </button>
          <p className="text-xs text-muted">One signature. The key can place trades but can&apos;t withdraw, stays in this tab&apos;s memory, and expires after 30 days.</p>
        </div>
      )}
      {destination === "mainnet" && agentReady && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={understood} disabled={auto} onChange={(e) => setUnderstood(e.target.checked)} data-real-money />
          <span>I understand this places real orders with my own money, and that I can lose it. The record shows past results, not future ones.</span>
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {auto ? (
          <button className="rounded-md bg-bad px-4 py-2 text-xs font-semibold text-accent-fg" onClick={() => setAuto(false)}>
            Stop copying
          </button>
        ) : (
          <button className={button} disabled={!ready} onClick={() => { errors.current = 0; setAuto(true); }}>
            Start auto-copy
          </button>
        )}
        {destination !== "mainnet" && (
          <button className={ghost} disabled={!ready} onClick={() => execute(-Date.now(), { coin: "BTC", dir: "Open Long", size_bps: 2_500 }, true)}>
            Try a sample trade
          </button>
        )}
      </div>
      {auto && <p className="text-xs text-muted">Stopping doesn&apos;t close open positions. Manage those on Hyperliquid.</p>}
      {error && <p className="text-sm text-bad">{error}</p>}

      {logs.length > 0 && (
        <ol className="max-h-64 space-y-1 overflow-y-auto border-t border-line pt-3 font-mono text-xs" data-copy-log>
          {logs.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-x-3">
              <span className="text-muted">{l.label}</span>
              <span className={TONE[l.tone]}>{l.outcome}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function describe(plan: Extract<Plan, { kind: "order" }>) {
  return `${plan.side.toLowerCase()} $${plan.notional.toFixed(2)}${plan.reduceOnly ? " (close)" : ""}`;
}
