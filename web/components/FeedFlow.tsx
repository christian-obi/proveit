"use client";

// The live feed for a key holder: the trader's new orders since the card, fetched through
// /api/reveal, decrypted here and chain-checked page by page. It drives copy trading.
//   1. the wallet that holds the key signs one message (NEP-413) naming this card and this
//      browser's X25519 key, valid for 12 hours: no transaction, no fee
//   2. each check: the enclave verifies the signature and the key on-chain, then encrypts new
//      orders to this browser; the relay in between can't read them
// The signed message and its key are kept in this browser until they expire, so a reload
// carries on following without asking again.

import { useCallback, useEffect, useRef, useState } from "react";
import { checkPage, followerMessage, RECIPIENT, type FeedEntry, type FeedPage } from "@proveit/verify/feed";
import { followerKey, openSealed } from "@proveit/verify/reveal";
import { unhex } from "@proveit/verify/bytes";
import CopyPanel, { type CopyHandle } from "@/components/CopyPanel";
import { config, networkFor } from "@/lib/config";
import { errorText, explain } from "@/lib/errors";
import { useNear } from "@/lib/use-wallet";
import type { SignedMessage } from "@/lib/wallets";

/** How often to ask the enclave. Each check is a small paid OutLayer run. */
const POLL_MS = 30_000;
const AUTO_POLL_MS = 10_000;
const VALID_SECS = 12 * 3600;
const button = "rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-40";
const bps = (n: number, signed = false) => `${signed && n > 0 ? "+" : ""}${(n / 100).toFixed(2)}%`;
const hourLabel = (h: number) => new Date(h * 3_600_000).toISOString().slice(0, 13).replace("T", " ") + ":00";
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

type Session = { secret: Uint8Array; auth: SignedMessage; expires: number };
type Saved = { secret: string; auth: SignedMessage; expires: number };
type Row = FeedEntry & { fresh: boolean };

const storageKey = (registry: string, cardId: number) => `feed:${registry}:${cardId}`;

function loadSaved(key: string): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? "null") as Saved | null;
    if (!s || s.expires * 1000 < Date.now() + 60_000) return null;
    return { secret: unhex(s.secret), auth: s.auth, expires: s.expires };
  } catch {
    return null;
  }
}

function save(key: string, s: Session | null) {
  try {
    if (s) localStorage.setItem(key, JSON.stringify({ secret: hex(s.secret), auth: s.auth, expires: s.expires } satisfies Saved));
    else localStorage.removeItem(key);
  } catch {
    // Without storage the feed still works; it just asks again after a reload.
  }
}

export default function FeedFlow({ registry, cardId, cardHash, isLive = false }: { registry: string; cardId: number; cardHash: string; isLive?: boolean }) {
  const { near, connect } = useNear(networkFor(registry).network);
  const key = storageKey(registry, cardId);
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; detail: string } | null>(null);
  const [heldBack, setHeldBack] = useState(0);
  const [attestation, setAttestation] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [feedNext, setFeedNext] = useState<number | null>(null);
  const cursor = useRef<{ next: number; head: string | null }>({ next: 0, head: null });
  const copier = useRef<CopyHandle>(null);

  // A signed message from earlier in the 12 hours: keep following without asking again.
  useEffect(() => {
    const saved = loadSaved(key);
    if (saved) setSession(saved);
  }, [key]);

  async function start() {
    try {
      setError(null);
      setStatus("Connecting…");
      const wallet = near ?? (await connect());
      const k =
        config.e2e && window.__proveitFollowerSecret
          ? { secret: unhex(window.__proveitFollowerSecret), pub: "" }
          : followerKey();
      if (!k.pub) {
        const { x25519 } = await import("@noble/curves/ed25519");
        k.pub = hex(x25519.getPublicKey(k.secret));
      }
      const expires = Math.floor(Date.now() / 1000) + VALID_SECS;
      setStatus("Sign the message in your wallet (no transaction, no fee)…");
      const auth = await wallet.signMessage(followerMessage(cardHash, k.pub, expires), RECIPIENT);
      const s = { secret: k.secret, auth, expires };
      save(key, s);
      setSession(s);
    } catch (e) {
      setError(errorText(e));
      setStatus("");
    }
  }

  const stop = () => {
    save(key, null);
    setSession(null);
    setRows([]);
    setChain(null);
    setStatus("");
    cursor.current = { next: 0, head: null };
  };

  const onAuto = useCallback((on: boolean) => setAuto(on), []);

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    const every = (config.e2e && window.__proveitFeedPollMs) || (auto ? AUTO_POLL_MS : POLL_MS);
    async function poll() {
      if (document.hidden && !auto) return;
      try {
        const res = await fetch("/api/reveal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registry, op: "feed", card_id: cardId, since: cursor.current.next, auth: session!.auth }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        const out = data.output;
        if (out.status !== "ok") throw new Error(explain(out.code, out.message));
        const page = openSealed<FeedPage>(session!.secret, out.ciphertext);
        const check = checkPage(page, cursor.current.head, cardHash, session!.auth.account_id);
        setChain(check);
        if (!check.ok) throw new Error(check.detail);
        if (stopped) return;
        cursor.current = { next: page.next, head: page.head };
        setFeedNext(page.next);
        setHeldBack(page.held_back);
        setAttestation(data.attestation);
        copier.current?.incoming(page.entries);
        if (page.entries.length) {
          setRows((old) => [...page.entries.map((e) => ({ ...e, fresh: old.length > 0 })).reverse(), ...old.map((r) => ({ ...r, fresh: false }))]);
          if (cursor.current.next > page.entries.length) {
            setToast(`${page.entries.length} new trade${page.entries.length > 1 ? "s" : ""}`);
            setTimeout(() => setToast(null), 6000);
          }
        }
        setError(null);
        setStatus(`Up to date · ${new Date().toLocaleTimeString()} · checking every ${every / 1000} s`);
      } catch (e) {
        setError(errorText(e));
        setStatus("");
      }
    }
    void poll();
    const t = setInterval(poll, every);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [session, registry, cardId, cardHash, auto]);

  return (
    <div className="space-y-4">
      <CopyPanel cardHash={cardHash} isLive={isLive} handle={copier} feedNext={feedNext} following={!!session} onAutoChange={onAuto} />

      {!session ? (
        <div className="rounded-lg border border-line bg-panel p-4 text-sm">
          <p className="mb-3">
            Follow the trader&apos;s new trades as they happen (after your key&apos;s delay). You sign one message for 12 hours; there&apos;s no transaction and no fee. This browser remembers it, so a reload keeps following.
          </p>
          <button className={button} onClick={start}>
            Connect wallet and follow
          </button>
        </div>
      ) : (
        <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
          Following as <span className="font-mono text-fg">{session.auth.account_id}</span> until {new Date(session.expires * 1000).toLocaleTimeString()}
          <button className="underline" onClick={stop}>
            Stop following
          </button>
        </p>
      )}
      {toast && (
        <div className="fixed bottom-4 right-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-lg" role="status" data-toast>
          {toast}
        </div>
      )}
      {status && <p className="text-sm text-muted">{status}</p>}
      {error && <p className="text-sm text-bad">{error}</p>}
      {chain && (
        <p className={`text-sm font-medium ${chain.ok ? "text-accent" : "text-bad"}`} data-feed-chain={chain.ok ? "pass" : "fail"}>
          {chain.ok ? "✓" : "✕"} Feed {chain.detail} · {rows.length} trade{rows.length === 1 ? "" : "s"} since the card{heldBack ? ` · ${heldBack} newer than your key's delay` : ""}
          {attestation && (
            <>
              {" · "}
              <a className="underline" href={attestation} target="_blank" rel="noreferrer">
                TEE attestation
              </a>
            </>
          )}
        </p>
      )}
      {session && rows.length === 0 && !error && <p className="text-sm text-muted">No new trades since the card yet.</p>}
      {rows.length > 0 && (
        <ul className="space-y-2" data-feed>
          {rows.map((r) => (
            <li key={r.seq} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${r.fresh ? "border-accent" : "border-line"} bg-panel`}>
              <span className="tabular-nums">
                <span className="font-mono text-xs text-muted">#{r.seq} · {hourLabel(r.record.hour)}</span>{" "}
                <span className="font-medium">{r.record.dir}</span> {r.record.coin} · {bps(r.record.size_bps)} of equity
                {r.record.pnl_bps !== 0 && <span className={r.record.pnl_bps > 0 ? "text-accent" : "text-bad"}> · PnL {bps(r.record.pnl_bps, true)}</span>}
              </span>
              <span className="flex gap-2">
                <button type="button" className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg" onClick={() => copier.current?.copy(r.seq, r.record)}>
                  Copy
                </button>
                <a className="rounded-md border border-line px-3 py-1 text-xs hover:text-fg" href={`https://app.hyperliquid.xyz/trade/${encodeURIComponent(r.record.coin)}`} target="_blank" rel="noreferrer">
                  Trade {r.record.coin} ({bps(r.record.size_bps)} of your equity) ↗
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
