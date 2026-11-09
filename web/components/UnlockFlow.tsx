"use client";

// Buy a viewing key for a card and see its trades:
//   1. connect a NEAR wallet
//   2. pay the price in USDC (ft_transfer_call to the registry); some offers need approval
//   3. reveal: the enclave encrypts the trades older than the key's delay to a key made in
//      this browser; they come back in the transaction's result and are checked here
//      against the card's orders root
// The card's issuer sees their offer form, waiting buyers and earnings instead.

import { useEffect, useState } from "react";
import { checkReveal, followerKey, openReveal, type Revealed, type RevealCheck } from "@proveit/verify/reveal";
import { unhex } from "@proveit/verify/bytes";
import { config, networkFor } from "@/lib/config";
import { explain } from "@/lib/errors";
import {
  buyTx,
  duration,
  formatAmount,
  getGrant,
  getOffer,
  isWaiting,
  revealTx,
  tokenBalance,
  txHash,
  waitForReveal,
  type Grant,
  type OfferView,
  type TokenMeta,
} from "@/lib/keys";
import { view } from "@/lib/near";
import { uiState, type OneClickToken, type Quote, type UiState } from "@/lib/oneclick";
import { connectNear, type NearSession } from "@/lib/wallets";

declare global {
  interface Window {
    /** Playwright only: a fixed follower secret, so a recorded reveal can be replayed. */
    __proveitFollowerSecret?: string;
  }
}

type Props = {
  registry: string;
  cardId: number;
  cardHash: string;
  issuer: string;
  orders: { root: string; count: number };
  initialOffer: OfferView | null;
  token: TokenMeta | null;
};

type Phase =
  | { step: "idle" }
  | { step: "working"; label: string }
  | { step: "waiting"; label: string; seconds: number }
  | { step: "revealed"; data: Revealed; check: RevealCheck }
  | { step: "error"; message: string };

const button = "rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-40";
const ghost = "rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-40";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hourLabel(hour: number) {
  return new Date(hour * 3_600_000).toISOString().slice(0, 13).replace("T", " ") + ":00";
}
const bps = (n: number, signed = false) => `${signed && n > 0 ? "+" : ""}${(n / 100).toFixed(2)}%`;

export default function UnlockFlow({ registry, cardId, cardHash, issuer, orders, initialOffer, token }: Props) {
  const [near, setNear] = useState<NearSession | null>(null);
  const [offer, setOffer] = useState<OfferView | null>(initialOffer);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const decimals = token?.decimals ?? 6;
  const symbol = token?.symbol ?? "USDC";
  const busy = phase.step === "working" || phase.step === "waiting";
  const fail = (e: unknown) => setPhase({ step: "error", message: e instanceof Error ? e.message : String(e) });

  async function refresh(account: string) {
    const [o, g, w] = await Promise.all([getOffer(registry, cardId), getGrant(registry, cardId, account), isWaiting(registry, cardId, account)]);
    setOffer(o);
    setGrant(g);
    setWaiting(w);
    if (o?.token) setBalance(await tokenBalance(o.token, account).catch(() => null));
  }

  async function onConnect() {
    try {
      setPhase({ step: "working", label: "Connecting…" });
      const s = await connectNear(networkFor(registry).network);
      setNear(s);
      await refresh(s.accountId);
      setPhase({ step: "idle" });
    } catch (e) {
      fail(e);
    }
  }

  async function onBuy() {
    if (!near || !offer?.token) return;
    try {
      setPhase({ step: "working", label: "Confirm the payment in your wallet…" });
      await near.signAndSendTransactions([buyTx(offer.token, registry, cardId, offer.offer.price)]);
      // The registry answers within the same transaction; give the RPC a moment to catch up.
      for (let i = 0; i < 10; i++) {
        setPhase({ step: "waiting", label: "Waiting for the registry", seconds: i * 2 });
        const [g, w] = await Promise.all([getGrant(registry, cardId, near.accountId), isWaiting(registry, cardId, near.accountId)]);
        if (g || w) {
          setGrant(g);
          setWaiting(w);
          setPhase({ step: "idle" });
          return refresh(near.accountId);
        }
        await sleep(2000);
      }
      throw new Error("The payment went through but no key appeared. If it was refused (sold out, or the price changed), the token contract refunded you.");
    } catch (e) {
      fail(e);
    }
  }

  async function onReveal() {
    if (!near) return;
    try {
      const key =
        config.e2e && window.__proveitFollowerSecret
          ? { secret: unhex(window.__proveitFollowerSecret), pub: "" }
          : followerKey();
      if (!key.pub) {
        const { x25519 } = await import("@noble/curves/ed25519");
        key.pub = Array.from(x25519.getPublicKey(key.secret), (b) => b.toString(16).padStart(2, "0")).join("");
      }
      setPhase({ step: "working", label: "Confirm the reveal in your wallet (0.05 NEAR for the enclave run, mostly refunded)…" });
      const [outcome] = await near.signAndSendTransactions([revealTx(registry, cardId, key.pub)]);
      const hash = txHash(outcome);
      if (!hash) throw new Error("the wallet didn't return the transaction hash");
      const result = await waitForReveal(registry, hash, near.accountId, (s) => setPhase({ step: "waiting", label: "The enclave is encrypting the trades to this browser", seconds: s }));
      if ("Refused" in (result as object)) {
        const r = (result as { Refused: { code: string; message: string } }).Refused;
        throw new Error(explain(r.code, r.message));
      }
      const revealed = (result as { Revealed?: { ciphertext: string | null } }).Revealed;
      if (!revealed?.ciphertext) throw new Error("the registry's answer had no ciphertext");
      const data = openReveal(key.secret, revealed.ciphertext);
      setPhase({ step: "revealed", data, check: checkReveal(data, { orders }, cardHash, near.accountId) });
    } catch (e) {
      fail(e);
    }
  }

  const isIssuer = near?.accountId === issuer;

  return (
    <div className="space-y-4">
      <OfferSummary offer={offer} decimals={decimals} symbol={symbol} />

      {!near ? (
        <button className={button} onClick={onConnect} disabled={busy}>
          Connect NEAR wallet
        </button>
      ) : (
        <p className="text-sm text-muted">
          Connected as <span className="font-mono text-fg">{near.accountId}</span>
          {balance !== null && offer?.token && (
            <>
              {" "}
              · {formatAmount(balance, decimals)} {symbol}
            </>
          )}
        </p>
      )}

      {near && isIssuer && <IssuerPanel registry={registry} cardId={cardId} near={near} offer={offer} decimals={decimals} symbol={symbol} onChange={() => refresh(near.accountId)} />}

      {near && !isIssuer && offer && !grant && !waiting && (
        <div className="rounded-lg border border-line bg-panel p-4">
          <p className="mb-3 text-sm">
            Pay <span className="font-semibold">{formatAmount(offer.offer.price, decimals)} {symbol}</span> for a{" "}
            {duration(offer.offer.duration_secs)} key. You&apos;ll see the trades once they are {offer.offer.delay_secs === 0 ? "made (live)" : `${duration(offer.offer.delay_secs)} old`}.
            {offer.offer.requires_approval && " The trader approves each buyer; until then your payment is held, and a rejection refunds it in full."}
          </p>
          <button className={button} onClick={onBuy} disabled={busy || offer.seats_left === 0}>
            {offer.seats_left === 0 ? "Sold out" : `Buy a key · ${formatAmount(offer.offer.price, decimals)} ${symbol}`}
          </button>
          {offer.seats_left > 0 && (
            <CrossChainPay
              registry={registry}
              cardId={cardId}
              buyer={near.accountId}
              onPaid={async () => {
                for (let i = 0; i < 15; i++) {
                  const g = await getGrant(registry, cardId, near.accountId);
                  const w = await isWaiting(registry, cardId, near.accountId);
                  if (g || w) return refresh(near.accountId);
                  await sleep(3000);
                }
              }}
            />
          )}
        </div>
      )}

      {near && waiting && !grant && (
        <p className="rounded-lg border border-line bg-panel p-4 text-sm" data-waiting>
          Paid. Waiting for the trader to approve you; if they reject you, you get everything back.{" "}
          <button className="underline" onClick={() => refresh(near.accountId)}>
            Check again
          </button>
        </p>
      )}

      {near && grant && (
        <div className="rounded-lg border border-line bg-panel p-4" data-grant>
          <p className="mb-3 text-sm">
            Your key is live until <span className="font-mono">{new Date(grant.expires_at * 1000).toUTCString()}</span>, with a {duration(grant.delay_secs)} delay.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={button} onClick={onReveal} disabled={busy}>
              Reveal trades
            </button>
            <a className="rounded-md border border-line px-4 py-2 text-sm" href={`${typeof window !== "undefined" ? window.location.pathname.replace(/\/unlock$/, "") : ""}/feed`} data-feed-link>
              Follow new trades live →
            </a>
          </div>
        </div>
      )}

      {phase.step === "working" && <p className="text-sm text-muted">{phase.label}</p>}
      {phase.step === "waiting" && (
        <p className="text-sm text-muted">
          {phase.label}… {phase.seconds}s
        </p>
      )}
      {phase.step === "error" && <p className="text-sm text-bad">{phase.message}</p>}
      {phase.step === "revealed" && <Trades data={phase.data} check={phase.check} />}
    </div>
  );
}

function OfferSummary({ offer, decimals, symbol }: { offer: OfferView | null; decimals: number; symbol: string }) {
  if (!offer) return <p className="text-sm text-muted">The trader isn&apos;t selling viewing keys for this card.</p>;
  const o = offer.offer;
  const rows: [string, string][] = [
    ["Price", `${formatAmount(o.price, decimals)} ${symbol}`],
    ["Delay", o.delay_secs === 0 ? "live" : duration(o.delay_secs)],
    ["Key lasts", duration(o.duration_secs)],
    ["Seats left", `${offer.seats_left} of ${o.max_seats}`],
    ["Approval", o.requires_approval ? "the trader approves each buyer" : "instant"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-line bg-panel p-4 text-sm sm:grid-cols-5" data-offer>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Trades({ data, check }: { data: Revealed; check: RevealCheck }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className={`mb-3 text-sm font-medium ${check.ok ? "text-accent" : "text-bad"}`} data-reveal-check={check.ok ? "pass" : "fail"}>
        {check.ok ? "✓" : "✕"} {check.shown}/{check.total} Merkle-verified · {check.detail}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm tabular-nums">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">Hour (UTC)</th>
              <th className="py-1 pr-3 font-normal">Coin</th>
              <th className="py-1 pr-3 font-normal">Side</th>
              <th className="py-1 pr-3 font-normal">Size (% of equity)</th>
              <th className="py-1 pr-3 font-normal">PnL (% of equity)</th>
              <th className="py-1 font-normal">Fills</th>
            </tr>
          </thead>
          <tbody>
            {data.records.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-3 font-mono text-xs">{hourLabel(r.hour)}</td>
                <td className="py-1 pr-3">{r.coin}</td>
                <td className="py-1 pr-3">{r.dir}</td>
                <td className="py-1 pr-3">{bps(r.size_bps)}</td>
                <td className={`py-1 pr-3 ${r.pnl_bps > 0 ? "text-accent" : r.pnl_bps < 0 ? "text-bad" : ""}`}>{r.pnl_bps === 0 ? "–" : bps(r.pnl_bps, true)}</td>
                <td className="py-1">{r.fills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Coarsened so they can&apos;t be matched back to the wallet: the hour, not the second; sizes and PnL as a share of the account, not dollars; no order IDs or hashes.
        Decrypted in this browser; the key never left it.
      </p>
    </div>
  );
}

function IssuerPanel({
  registry,
  cardId,
  near,
  offer,
  decimals,
  symbol,
  onChange,
}: {
  registry: string;
  cardId: number;
  near: NearSession;
  offer: OfferView | null;
  decimals: number;
  symbol: string;
  onChange: () => Promise<void>;
}) {
  const o = offer?.offer;
  const [price, setPrice] = useState(o ? formatAmount(o.price, decimals) : "1");
  const [delayH, setDelayH] = useState(String(o ? o.delay_secs / 3600 : 0));
  const [days, setDays] = useState(String(o ? o.duration_secs / 86_400 : 30));
  const [seats, setSeats] = useState(String(o?.max_seats ?? 10));
  const [approval, setApproval] = useState(o?.requires_approval ?? false);
  const [waitingList, setWaitingList] = useState<{ buyer: string; paid: string }[]>([]);
  const [earned, setEarned] = useState<string>("0");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    view<{ buyer: string; paid: string }[]>(registry, "get_waiting", { card_id: cardId }).then(setWaitingList).catch(() => {});
    view<string>(registry, "get_balance", { account: near.accountId }).then(setEarned).catch(() => {});
  }, [registry, cardId, near.accountId, offer]);

  const call = async (methodName: string, args: object) => {
    try {
      setMsg("Confirm in your wallet…");
      await near.signAndSendTransactions([{ receiverId: registry, actions: [{ type: "FunctionCall", params: { methodName, args, gas: "100000000000000", deposit: "0" } }] }]);
      setMsg("Done.");
      await onChange();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const toRaw = (s: string) => {
    const [w, f = ""] = s.split(".");
    return (BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-line p-4 text-sm">
      <h2 className="font-medium">Your card: sell viewing keys</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [`Price (${symbol})`, price, setPrice],
            ["Delay (hours, 0 = live)", delayH, setDelayH],
            ["Key lasts (days)", days, setDays],
            ["Seats", seats, setSeats],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label} className="space-y-1">
            <span className="text-xs text-muted">{label}</span>
            <input value={value} onChange={(e) => set(e.target.value)} aria-label={label} className="w-full rounded border border-line bg-bg px-2 py-1 font-mono" inputMode="decimal" />
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Approve each buyer myself
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          onClick={() =>
            call("set_offer", {
              card_id: cardId,
              price: toRaw(price),
              delay_secs: Math.round(Number(delayH) * 3600),
              duration_secs: Math.round(Number(days) * 86_400),
              max_seats: Number(seats),
              requires_approval: approval,
            })
          }
        >
          {offer ? "Update offer" : "Start selling"}
        </button>
        {offer && (
          <button className={ghost} onClick={() => call("remove_offer", { card_id: cardId })}>
            Stop selling
          </button>
        )}
        {BigInt(earned) > 0n && (
          <button className={ghost} onClick={() => call("withdraw", {})}>
            Withdraw {formatAmount(earned, decimals)} {symbol}
          </button>
        )}
      </div>
      {waitingList.length > 0 && (
        <ul className="space-y-1">
          {waitingList.map((w) => (
            <li key={w.buyer} className="flex items-center gap-2">
              <span className="font-mono">{w.buyer}</span> paid {formatAmount(w.paid, decimals)} {symbol}
              <button className={ghost} onClick={() => call("approve_buyer", { card_id: cardId, buyer: w.buyer })}>
                Approve
              </button>
              <button className={ghost} onClick={() => call("reject_buyer", { card_id: cardId, buyer: w.buyer })}>
                Reject (refund)
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}

/**
 * Pay from another chain through NEAR Intents 1Click (mainnet only): pick a token, give
 * your own address on that chain for refunds, send the quoted amount to the deposit
 * address. 1Click delivers exactly the price in USDC to the registry, which writes the key.
 */
function CrossChainPay({ registry, cardId, buyer, onPaid }: { registry: string; cardId: number; buyer: string; onPaid: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [asset, setAsset] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<UiState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mainnet = config.network === "mainnet" && registry === config.registry;

  useEffect(() => {
    if (!open || !mainnet || tokens.length) return;
    fetch("/api/oneclick/tokens")
      .then((r) => r.json())
      .then((d) => {
        setTokens(d.tokens ?? []);
        setAsset(d.tokens?.[0]?.assetId ?? "");
      })
      .catch((e) => setErr(String(e)));
  }, [open, mainnet, tokens.length]);

  useEffect(() => {
    if (!quote?.depositAddress || state?.final) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/oneclick/status?depositAddress=${encodeURIComponent(quote.depositAddress!)}`).then((r) => r.json()).catch(() => null);
      if (!r?.status) return;
      const u = uiState(r.status);
      setState(u);
      if (u.status === "SUCCESS") await onPaid();
    }, 5000);
    return () => clearInterval(t);
  }, [quote, state?.final, onPaid]);

  async function getQuote() {
    setErr(null);
    const r = await fetch("/api/oneclick/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId, buyer, originAsset: asset, refundTo }) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error ?? `HTTP ${r.status}`);
    setQuote(d.quote);
    setState(uiState("PENDING_DEPOSIT"));
  }

  const token = tokens.find((t) => t.assetId === asset);
  if (!open)
    return (
      <button className="ml-2 text-sm underline" onClick={() => setOpen(true)}>
        Pay from another chain
      </button>
    );
  if (!mainnet) return <p className="mt-3 text-xs text-muted">Paying from another chain (NEAR Intents 1Click) works on mainnet cards; this is a testnet card, so pay with {"t"}USDC above.</p>;
  return (
    <div className="mt-4 space-y-3 rounded-md border border-dashed border-line p-3 text-sm" data-crosschain>
      {!quote ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted">Pay with</span>
              <select value={asset} onChange={(e) => setAsset(e.target.value)} className="w-full rounded border border-line bg-bg px-2 py-1" aria-label="Pay with">
                {tokens.map((t) => (
                  <option key={t.assetId} value={t.assetId}>
                    {t.symbol} on {t.blockchain}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">Your address on {token?.blockchain ?? "that chain"} (for refunds)</span>
              <input value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} className="w-full rounded border border-line bg-bg px-2 py-1 font-mono" aria-label="Refund address" />
            </label>
          </div>
          <button className={button} onClick={getQuote} disabled={!asset || !refundTo}>
            Get a quote
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <p>
            Send exactly <span className="font-semibold">{quote.amountInFormatted} {token?.symbol}</span> on {token?.blockchain} to
          </p>
          <p className="break-all rounded bg-bg p-2 font-mono text-xs" data-deposit-address>
            {quote.depositAddress}
          </p>
          <button className="text-xs underline" onClick={() => navigator.clipboard.writeText(quote.depositAddress ?? "")}>
            Copy address
          </button>
          {quote.deadline && <p className="text-xs text-muted">Before {new Date(quote.deadline).toUTCString()}; after that, or if anything fails, it is refunded to your address.</p>}
          {state && (
            <p className={state.tone === "ok" ? "text-accent" : state.tone === "bad" ? "text-bad" : "text-muted"} data-oneclick-status={state.status}>
              {state.message}
            </p>
          )}
        </div>
      )}
      {err && <p className="text-bad">{err}</p>}
    </div>
  );
}
