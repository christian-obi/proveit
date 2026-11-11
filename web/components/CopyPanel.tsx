"use client";

// Copy from this tab. The feed hands over new trades; each is sized to the follower's account
// and placed straight from the browser to Hyperliquid with an agent key that can trade but
// not withdraw. The settings, the key (unless the follower opts out) and auto-copy are kept in
// this browser, so a reload carries on. The app's server never sees the address or the key.

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { DEFAULT_SETTINGS, planCopy, type CopyRecord, type CopySettings, type Plan } from "@/lib/copy-plan";
import { agentFromKey, approveNewAgent, cloidFor, loadCopyPnl, loadFollower, loadMarket, loadMids, placeOrder, wirePrice, wireSize, type Agent, type CopyPnl, type Follower, type HlNetwork, type Market } from "@/lib/hyperliquid";
import { useEvm } from "@/lib/use-wallet";

export type Destination = "simulate" | HlNetwork;
export type CopyHandle = { copy: (seq: number, record: CopyRecord) => void; incoming: (entries: { seq: number; record: CopyRecord }[]) => void };

type Log = { id: number; label: string; outcome: string; tone: "good" | "bad" | "muted" };
type SimBook = { realized: number; positions: Record<string, { size: number; entry: number }> };
type Saved = {
  destination: Destination;
  settings: CopySettings;
  simEquity: number;
  remember: boolean;
  understood: boolean;
  auto: boolean;
  armedFrom: number | null;
  address: `0x${string}` | null;
  agent: { key: `0x${string}`; network: HlNetwork; expiresAt: number } | null;
  sim: SimBook;
};

const MAX_ERRORS = 3;
/** Never act on a trade older than this: a follower who was away shouldn't buy in late. */
const STALE_HOURS = 1;
const PNL_MS = 15_000;
const button = "rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-fg disabled:opacity-40";
const ghost = "rounded-md border border-line px-3 py-2 text-xs disabled:opacity-40";
const TONE = { good: "text-accent", bad: "text-bad", muted: "text-muted" };
const DEST_LABEL: Record<Destination, string> = { simulate: "Simulate", testnet: "Hyperliquid testnet", mainnet: "Real money" };
const EMPTY_SIM: SimBook = { realized: 0, positions: {} };

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage: everything still works until the tab closes.
  }
};

const doneKey = (where: Destination, address: string | null, cardHash: string) => `copied:${where}:${(address ?? "sim").toLowerCase()}:${cardHash}`;
const oidsKey = (network: HlNetwork, address: string) => `copy-oids:${network}:${address.toLowerCase()}`;
const usd = (n: number) => `${n < 0 ? "-" : n > 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`;

/** The simulated book moves like a real one: average entry on adds, realised P&L on reduces. */
function simFill(book: SimBook, coin: string, signed: number, price: number): SimBook {
  const pos = book.positions[coin] ?? { size: 0, entry: price };
  let realized = book.realized;
  let size = pos.size;
  let entry = pos.entry;
  if (size === 0 || Math.sign(size) === Math.sign(signed)) {
    entry = (Math.abs(size) * entry + Math.abs(signed) * price) / (Math.abs(size) + Math.abs(signed));
    size += signed;
  } else {
    const closing = Math.min(Math.abs(signed), Math.abs(size));
    realized += closing * (price - entry) * Math.sign(size);
    size += signed;
    if (Math.abs(size) < 1e-12) size = 0;
    else if (Math.sign(size) === Math.sign(signed)) entry = price;
  }
  return { realized, positions: { ...book.positions, [coin]: { size, entry } } };
}

export default function CopyPanel({
  cardHash,
  isLive,
  handle,
  feedNext,
  following,
  onAutoChange,
}: {
  cardHash: string;
  isLive: boolean;
  handle: Ref<CopyHandle>;
  feedNext: number | null;
  following: boolean;
  onAutoChange: (on: boolean) => void;
}) {
  const stateKey = `copy:v1:${cardHash}`;
  const { evm, connect: connectEvm } = useEvm();
  const [loaded, setLoaded] = useState(false);
  const [destination, setDestination] = useState<Destination>("simulate");
  const [settings, setSettings] = useState<CopySettings>(DEFAULT_SETTINGS);
  const [simEquity, setSimEquity] = useState(1_000);
  const [remember, setRemember] = useState(true);
  const [understood, setUnderstood] = useState(false);
  const [auto, setAutoState] = useState(false);
  const [armedFrom, setArmedFrom] = useState<number | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [agentInfo, setAgentInfo] = useState<Saved["agent"]>(null);
  const [sim, setSim] = useState<SimBook>(EMPTY_SIM);
  const [pnl, setPnl] = useState<CopyPnl | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const agent = useRef<Agent | null>(null);
  const simRef = useRef<SimBook>(EMPTY_SIM);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const errors = useRef(0);
  const nextId = useRef(0);
  const live = useRef({ destination, settings, address, auto, armedFrom, simEquity });
  live.current = { destination, settings, address, auto, armedFrom, simEquity };

  const log = (label: string, outcome: string, tone: Log["tone"]) => setLogs((old) => [{ id: nextId.current++, label, outcome, tone }, ...old].slice(0, 40));

  const setAuto = useCallback(
    (on: boolean) => {
      setAutoState(on);
      onAutoChange(on);
    },
    [onAutoChange],
  );

  // Back to where this browser left off.
  useEffect(() => {
    const s = read<Partial<Saved> | null>(stateKey, null);
    if (s) {
      const usable = s.agent && s.agent.expiresAt > Date.now() + 60_000 && s.agent.network === s.destination ? s.agent : null;
      setDestination(s.destination ?? "simulate");
      setSettings({ ...DEFAULT_SETTINGS, ...s.settings });
      setSimEquity(s.simEquity ?? 1_000);
      setRemember(s.remember ?? true);
      setUnderstood(!!s.understood);
      setArmedFrom(s.armedFrom ?? null);
      setAddress(s.address ?? null);
      setSim(s.sim ?? EMPTY_SIM);
      simRef.current = s.sim ?? EMPTY_SIM;
      if (usable) {
        agent.current = agentFromKey(usable.key, usable.network);
        setAgentInfo(usable);
      }
      const canResume = s.destination === "simulate" || (!!usable && (s.destination === "testnet" || s.understood));
      if (s.auto && canResume) setAuto(true);
    }
    setLoaded(true);
  }, [stateKey, setAuto]);

  useEffect(() => {
    if (!loaded) return;
    write(stateKey, {
      destination,
      settings,
      simEquity,
      remember,
      understood,
      auto,
      armedFrom,
      address,
      agent: remember ? agentInfo : null,
      sim,
    } satisfies Saved);
  }, [loaded, stateKey, destination, settings, simEquity, remember, understood, auto, armedFrom, address, agentInfo, sim]);

  // Your copy-trading P&L, refreshed while this page is open.
  useEffect(() => {
    if (destination === "simulate" || !address) return setPnl(null);
    let alive = true;
    const refresh = async () => {
      const oids = read<{ oid: number; coin: string }[]>(oidsKey(destination, address), []);
      if (!oids.length) return alive && setPnl({ realized: 0, fees: 0, open: 0 });
      const result = await loadCopyPnl(destination, address, new Set(oids.map((o) => o.oid)), new Set(oids.map((o) => o.coin))).catch(() => null);
      if (alive && result) setPnl(result);
    };
    void refresh();
    const t = setInterval(refresh, PNL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [destination, address, logs.length]);

  const [mids, setMids] = useState<Record<string, number>>({});
  useEffect(() => {
    if (destination !== "simulate" || !Object.values(sim.positions).some((p) => p.size !== 0)) return;
    let alive = true;
    const refresh = () => loadMids("mainnet").then((m) => alive && setMids(m)).catch(() => undefined);
    void refresh();
    const t = setInterval(refresh, PNL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [destination, sim]);

  const choose = (next: Destination) => {
    if (next === destination) return;
    agent.current = null;
    setAgentInfo(null);
    setAuto(false);
    setUnderstood(false);
    setError(null);
    setDestination(next);
  };

  const agentReady = destination === "simulate" || !!agentInfo;
  const settingsOk = settings.multiplierPct > 0 && settings.multiplierPct <= 300 && settings.maxUsd >= 10 && settings.slippagePct > 0 && settings.slippagePct <= 3 && settings.maxLeverage > 0 && settings.maxLeverage <= 20;
  const ready = settingsOk && agentReady && (destination !== "mainnet" || understood);

  const execute = useCallback(
    (seq: number, record: CopyRecord, sample: boolean) => {
      queue.current = queue.current.then(async () => {
        const { destination: where, settings: s, address: who, simEquity: equity } = live.current;
        const label = `${record.dir} ${record.coin} · ${(record.size_bps / 100).toFixed(2)}% of equity`;
        const key = sample ? null : doneKey(where, where === "simulate" ? null : who, cardHash);
        const done = new Set<number>(key ? read<number[]>(key, []) : []);
        if (done.has(seq)) return log(label, "already copied", "muted");
        const markDone = () => {
          if (!key) return;
          done.add(seq);
          write(key, [...done]);
        };
        try {
          const data: HlNetwork = where === "testnet" ? "testnet" : "mainnet";
          const market: Market | null = await loadMarket(data, record.coin);
          if (where === "simulate") {
            const book = simRef.current;
            const follower: Follower = {
              equity: equity + book.realized,
              exposure: Object.entries(book.positions).reduce((sum, [c, p]) => sum + Math.abs(p.size) * (c === record.coin && market ? market.mid : p.entry), 0),
              positions: Object.fromEntries(Object.entries(book.positions).map(([c, p]) => [c, p.size])),
            };
            const plan = planCopy(record, follower, market, s);
            if (plan.kind === "skip") return log(label, `Skipped: ${plan.reason}`, "muted");
            const next = simFill(book, record.coin, plan.isBuy ? plan.size : -plan.size, market!.mid);
            simRef.current = next;
            setSim(next);
            markDone();
            return log(label, `Simulated ${describe(plan)}`, "good");
          }
          if (!who || !agent.current) return log(label, "Not set up: approve a trading key first", "bad");
          const follower = await loadFollower(data, who);
          const plan = planCopy(record, follower, market, s);
          if (plan.kind === "skip") {
            markDone();
            return log(label, `Skipped: ${plan.reason}`, "muted");
          }
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
          markDone();
          const oids = read<{ oid: number; coin: string }[]>(oidsKey(data, who), []);
          write(oidsKey(data, who), [...oids, { oid: result.oid, coin: record.coin }].slice(-500));
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
    [cardHash, setAuto],
  );

  useImperativeHandle(
    handle,
    () => ({
      copy: (seq, record) => execute(seq, record, false),
      // Copies every trade at or after the point auto-copy was switched on, once, as long as
      // it is recent. The trades already there when it was switched on are history.
      incoming: (entries) => {
        if (!live.current.auto || !entries.length) return;
        let from = live.current.armedFrom;
        if (from === null) {
          from = Math.max(...entries.map((e) => e.seq)) + 1;
          setArmedFrom(from);
          live.current.armedFrom = from;
          return;
        }
        const oldest = Math.floor(Date.now() / 3_600_000) - STALE_HOURS;
        for (const e of entries) if (e.seq >= from! && (e.record.hour ?? oldest) >= oldest) execute(e.seq, e.record, false);
      },
    }),
    [execute],
  );

  async function approve() {
    try {
      setBusy(true);
      setError(null);
      const owner = evm ?? (await connectEvm());
      setAddress(owner);
      if (destination === "simulate") return;
      const approved = await approveNewAgent(destination, owner);
      agent.current = approved.agent;
      setAgentInfo({ key: approved.privateKey, network: destination, expiresAt: approved.expiresAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const startAuto = () => {
    errors.current = 0;
    // Everything the feed already showed is history; copying starts with the next trade.
    setArmedFrom(feedNext);
    live.current.armedFrom = feedNext;
    setAuto(true);
  };

  const number = (key: keyof CopySettings, label: string, step: number) => (
    <label className="space-y-1">
      <span className="label block">{label}</span>
      <input type="number" step={step} min={0} value={settings[key]} disabled={auto} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} className="w-full border border-line px-2 py-1.5 font-mono text-sm" data-setting={key} />
    </label>
  );

  const simOpen = Object.entries(sim.positions).reduce((sum, [c, p]) => sum + (mids[c] ? p.size * (mids[c] - p.entry) : 0), 0);
  const total = destination === "simulate" ? sim.realized + simOpen : pnl ? pnl.realized + pnl.open - pnl.fees : null;

  return (
    <section className="space-y-4 rounded-lg border border-accent/40 bg-panel p-4" data-copy-panel id="copy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Copy this trader</h2>
        <span className="label" data-copy-state={auto ? "on" : "off"}>
          {auto ? <span className="text-accent">Auto-copy on</span> : "Auto-copy off"}
        </span>
      </div>
      <ol className="grid gap-2 text-xs text-muted sm:grid-cols-3">
        <li className={following ? "text-accent" : ""}>1 · Follow the feed below {following ? "✓" : ""}</li>
        <li className={agentReady ? "text-accent" : ""}>2 · Choose where to copy and approve a key {agentReady && destination !== "simulate" ? "✓" : ""}</li>
        <li className={auto ? "text-accent" : ""}>3 · Start auto-copy {auto ? "✓" : ""}</li>
      </ol>

      <nav className="flex flex-wrap gap-2" aria-label="Where to copy">
        {(["simulate", "testnet", "mainnet"] as Destination[]).map((d) => (
          <button key={d} type="button" onClick={() => choose(d)} disabled={(d === "mainnet" && !isLive) || auto} aria-pressed={d === destination} className={`chip disabled:opacity-40 ${d === destination ? "is-on" : ""}`}>
            {DEST_LABEL[d]}
          </button>
        ))}
      </nav>
      {!isLive && <p className="text-xs text-muted">This is a demo card, so real-money copying is off.</p>}

      {total !== null && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-copy-pnl>
          {(destination === "simulate"
            ? [
                ["Your copy P&L", total],
                ["Closed", sim.realized],
                ["Open", simOpen],
              ]
            : [
                ["Your copy P&L", total],
                ["Closed", pnl!.realized],
                ["Open", pnl!.open],
                ["Fees", -pnl!.fees],
              ]
          ).map(([label, value]) => (
            <div key={label as string} className="border border-line px-3 py-2">
              <p className={`font-mono text-lg tabular-nums ${(value as number) > 0 ? "text-accent" : (value as number) < 0 ? "text-bad" : ""}`}>{usd(value as number)}</p>
              <p className="label">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {number("multiplierPct", "Size %", 10)}
        {number("maxUsd", "Max per trade $", 5)}
        {number("slippagePct", "Max slippage %", 0.1)}
        {number("maxLeverage", "Max leverage", 1)}
      </div>
      {destination === "simulate" && (
        <label className="block max-w-48 space-y-1">
          <span className="label block">Pretend balance $</span>
          <input type="number" min={0} value={simEquity} disabled={auto} onChange={(e) => setSimEquity(Number(e.target.value))} className="w-full border border-line px-2 py-1.5 font-mono text-sm" data-sim-equity />
        </label>
      )}

      {destination !== "simulate" && !agentInfo && (
        <div className="space-y-2">
          <button className={button} disabled={busy || !settingsOk} onClick={approve}>
            {busy ? "Check your wallet…" : "Approve a trading key"}
          </button>
          <p className="text-xs text-muted">One signature. The key can place trades but can&apos;t withdraw, and its approval expires after 30 days.</p>
        </div>
      )}
      {destination !== "simulate" && agentInfo && (
        <p className="text-xs text-muted">
          Trading key approved for <span className="font-mono text-fg">{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "your account"}</span> until {new Date(agentInfo.expiresAt).toLocaleDateString()}.
        </p>
      )}
      {destination !== "simulate" && (
        <label className="flex gap-2 text-xs text-muted">
          <input type="checkbox" checked={remember} disabled={auto} onChange={(e) => setRemember(e.target.checked)} data-remember />
          <span>Keep the trading key in this browser so copying carries on after a reload. Untick on a shared computer.</span>
        </label>
      )}
      {destination === "mainnet" && agentInfo && (
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
          <button className={button} disabled={!ready} onClick={startAuto}>
            Start auto-copy
          </button>
        )}
        {destination !== "mainnet" && (
          <button className={ghost} disabled={!ready} onClick={() => execute(-Date.now(), { coin: "BTC", dir: "Open Long", size_bps: 2_500 }, true)}>
            Try a sample trade
          </button>
        )}
        {destination === "simulate" && (sim.realized !== 0 || Object.keys(sim.positions).length > 0) && (
          <button className={ghost} disabled={auto} onClick={() => ((simRef.current = EMPTY_SIM), setSim(EMPTY_SIM))}>
            Reset simulation
          </button>
        )}
      </div>
      {auto && !following && <p className="text-xs text-warn">Auto-copy is on, but it needs the feed: press &quot;Connect wallet and follow&quot; below.</p>}
      {auto && <p className="text-xs text-muted">Copies new trades within seconds of the feed showing them, while this tab is open. Stopping doesn&apos;t close open positions.</p>}
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
