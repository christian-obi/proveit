"use client";

// The live feed for a key holder (copy trading): the trader's new orders since the card,
// polled every 60 s through /api/reveal, decrypted here, and chain-checked page by page.
//   1. connect the NEAR wallet that holds the key
//   2. sign one message (NEP-413) that names this card and this browser's X25519 key, valid
//      for 12 hours: no transaction, no fee
//   3. each poll: the enclave checks the signature and your key on-chain, then encrypts
//      new orders to this browser; the relay in between can't read them

import { useEffect, useRef, useState } from "react";
import { checkPage, followerMessage, RECIPIENT, type FeedEntry, type FeedPage } from "@proveit/verify/feed";
import { followerKey, openSealed } from "@proveit/verify/reveal";
import { unhex } from "@proveit/verify/bytes";
import { config } from "@/lib/config";
import { explain } from "@/lib/errors";
import { connectNear, type NearSession, type SignedMessage } from "@/lib/wallets";

const POLL_MS = 60_000;
const VALID_SECS = 12 * 3600;
const button = "rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-40";
const bps = (n: number, signed = false) => `${signed && n > 0 ? "+" : ""}${(n / 100).toFixed(2)}%`;
const hourLabel = (h: number) => new Date(h * 3_600_000).toISOString().slice(0, 13).replace("T", " ") + ":00";

type Session = { near: NearSession; secret: Uint8Array; auth: SignedMessage; expires: number };
type Row = FeedEntry & { fresh: boolean };

export default function FeedFlow({ registry, cardId, cardHash }: { registry: string; cardId: number; cardHash: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; detail: string } | null>(null);
  const [heldBack, setHeldBack] = useState(0);
  const [attestation, setAttestation] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const cursor = useRef<{ next: number; head: string | null }>({ next: 0, head: null });

  async function start() {
    try {
      setError(null);
      setStatus("Connecting…");
      const near = await connectNear();
      const key =
        config.e2e && window.__proveitFollowerSecret
          ? { secret: unhex(window.__proveitFollowerSecret), pub: "" }
          : followerKey();
      if (!key.pub) {
        const { x25519 } = await import("@noble/curves/ed25519");
        key.pub = Array.from(x25519.getPublicKey(key.secret), (b) => b.toString(16).padStart(2, "0")).join("");
      }
      const expires = Math.floor(Date.now() / 1000) + VALID_SECS;
      setStatus("Sign the message in your wallet (no transaction, no fee)…");
      const auth = await near.signMessage(followerMessage(cardHash, key.pub, expires), RECIPIENT);
      setSession({ near, secret: key.secret, auth, expires });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    }
  }

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    async function poll() {
      try {
        setStatus("Checking for new trades…");
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
        setHeldBack(page.held_back);
        setAttestation(data.attestation);
        if (page.entries.length) {
          setRows((old) => [...page.entries.map((e) => ({ ...e, fresh: old.length > 0 })).reverse(), ...old.map((r) => ({ ...r, fresh: false }))]);
          setToast(`${page.entries.length} new trade${page.entries.length > 1 ? "s" : ""}`);
          setTimeout(() => setToast(null), 6000);
        }
        setError(null);
        setStatus(`Up to date · ${new Date().toLocaleTimeString()} · next check in 60 s`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("");
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [session, registry, cardId, cardHash]);

  return (
    <div className="space-y-4">
      {!session && (
        <div className="rounded-lg border border-line bg-panel p-4 text-sm">
          <p className="mb-3">
            Follow the trader&apos;s new trades as they settle (after your key&apos;s delay). You sign one message for 12 hours; there&apos;s no transaction and no fee.
          </p>
          <button className={button} onClick={start}>
            Connect wallet and follow
          </button>
        </div>
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
      {session && rows.length === 0 && !error && <p className="text-sm text-muted">No new trades since the card yet. This page checks every minute.</p>}
      {rows.length > 0 && (
        <ul className="space-y-2" data-feed>
          {rows.map((r) => (
            <li key={r.seq} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${r.fresh ? "border-accent" : "border-line"} bg-panel`}>
              <span className="tabular-nums">
                <span className="font-mono text-xs text-muted">#{r.seq} · {hourLabel(r.record.hour)}</span>{" "}
                <span className="font-medium">{r.record.dir}</span> {r.record.coin} · {bps(r.record.size_bps)} of equity
                {r.record.pnl_bps !== 0 && <span className={r.record.pnl_bps > 0 ? "text-accent" : "text-bad"}> · PnL {bps(r.record.pnl_bps, true)}</span>}
              </span>
              {/* Perps trades are signals: the follower places their own, sized to their account. */}
              <a className="rounded-md border border-line px-3 py-1 text-xs hover:text-fg" href={`https://app.hyperliquid.xyz/trade/${encodeURIComponent(r.record.coin)}`} target="_blank" rel="noreferrer">
                Trade {r.record.coin} ({bps(r.record.size_bps)} of your equity) ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
