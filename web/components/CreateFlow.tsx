"use client";

// The trader's create flow:
//   1. connect a NEAR wallet (the card's issuer)
//   2. connect the Hyperliquid account's EVM wallet and sign the ownership message
//   3. encrypt it to the OutLayer keystore in this browser
//   4. send two transactions: store the encrypted secret, request the card
//   5. wait for the enclave's answer through the registry
// "Demo data" skips 2–3: the demo registry's enclave uses a recorded public account.

import { useEffect, useState } from "react";
import { cardPath } from "@/lib/cards";
import { config, WINDOWS, networkFor, NETWORKS, type Network } from "@/lib/config";
import { useNetwork } from "@/components/NetworkSwitch";
import { encryptForKeystore } from "@/lib/ecies";
import { explain } from "@/lib/errors";
import { demoCardTransactions, liveCardTransactions, profileFor } from "@/lib/flow";
import { fetchKeystorePubkey } from "@/lib/keystore";
import { requestNumber, storageCost, waitForRequest, type RequestOutcome } from "@/lib/near";
import { randomNonce, secretJson, VALIDITY_SECS, type OwnershipProof } from "@/lib/ownership";
import { connectEvm, connectNear, signOwnership, type NearSession } from "@/lib/wallets";

type Mode = "live" | "demo";
type Phase =
  | { step: "idle" }
  | { step: "working"; label: string }
  | { step: "waiting"; seconds: number }
  | { step: "done"; outcome: RequestOutcome; registry: string }
  | { step: "sent" }
  | { step: "error"; message: string };

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-accent text-accent-fg" : "border border-line text-muted"}`}>
          {done ? "✓" : n}
        </span>
        <h2 className="font-medium">{title}</h2>
      </div>
      {children}
    </div>
  );
}

const button = "rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-40";
const ghost = "rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-fg";

/** The recorded demo account only has enough trades for this window. */
const DEMO_WINDOW = 30;

export default function CreateFlow() {
  const network = useNetwork();
  return <Flow key={network} network={network} />;
}

function Flow({ network }: { network: Network }) {
  const [mode, setMode] = useState<Mode>("live");
  const [near, setNear] = useState<NearSession | null>(null);
  const [evm, setEvm] = useState<`0x${string}` | null>(null);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [agent, setAgent] = useState(false);
  const [keyPath, setKeyPath] = useState<"direct" | "relay" | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  const busy = phase.step === "working" || phase.step === "waiting";
  const fail = (e: unknown) => setPhase({ step: "error", message: e instanceof Error ? e.message : String(e) });

  // On a mainnet site, demo cards still go to testnet, so a change of mode needs the other wallet.
  useEffect(() => {
    if (network === "mainnet") setNear(null);
  }, [mode]);

  async function onConnectNear() {
    try {
      setNear(await connectNear(mode === "demo" ? networkFor(config.demoRegistry).network : network));
    } catch (e) {
      fail(e);
    }
  }

  async function onConnectEvm() {
    try {
      setEvm(await connectEvm());
    } catch (e) {
      fail(e);
    }
  }

  async function onCreate() {
    if (!near) return;
    try {
      let txs;
      let registry: string;
      if (mode === "demo") {
        registry = config.demoRegistry;
        txs = demoCardTransactions(windowDays, agent ? "agent" : "trader");
      } else {
        if (!evm) return;
        registry = NETWORKS[network].registry;
        setPhase({ step: "working", label: "Waiting for your Hyperliquid wallet to sign…" });
        const nonce = randomNonce();
        const expiry = Math.floor(Date.now() / 1000) + VALIDITY_SECS;
        const signature = await signOwnership(evm, near.accountId, nonce, expiry);
        const proof: OwnershipProof = { account: evm, nearAccount: near.accountId, nonce, expiry, signature };

        setPhase({ step: "working", label: "Encrypting your proof so only the enclave can read it…" });
        const profile = profileFor(nonce);
        const key = await fetchKeystorePubkey({ projectId: NETWORKS[network].enclaveProject, owner: near.accountId, profile });
        setKeyPath(key.path);
        const encrypted = encryptForKeystore(key.pubkey, JSON.stringify({ PROVEIT_SECRET: secretJson(proof) }));
        const storageDeposit = await storageCost(NETWORKS[network].enclaveProject, near.accountId, profile, encrypted);
        txs = liveCardTransactions({ proof, keystorePubkey: key.pubkey, storageDeposit, windowDays, encrypted, kind: agent ? "agent" : "trader", network }).txs;
      }

      setPhase({ step: "working", label: mode === "demo" ? "Approve the request in your NEAR wallet…" : "Approve the two transactions in your NEAR wallet…" });
      const outcomes = await near.signAndSendTransactions(txs);
      const request = requestNumber(outcomes[outcomes.length - 1]);
      if (request === null) {
        setPhase({ step: "sent" });
        return;
      }
      setPhase({ step: "waiting", seconds: 0 });
      const outcome = await waitForRequest(registry, request, (seconds) => setPhase({ step: "waiting", seconds }));
      setPhase({ step: "done", outcome, registry });
    } catch (e) {
      fail(e);
    }
  }

  const ready = !!near && (mode === "demo" || !!evm) && !busy;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-sm">
        {(["live", "demo"] as const).map((m) => (
          <button key={m} onClick={() => {
              setMode(m);
              if (m === "demo") setWindowDays(DEMO_WINDOW);
            }} disabled={busy} className={`rounded-md border px-3 py-1.5 ${mode === m ? "border-accent text-fg" : "border-line text-muted"}`}>
            {m === "live" ? "My Hyperliquid account" : "Demo data (no Hyperliquid account needed)"}
          </button>
        ))}
      </div>
      {mode === "demo" && (
        <p className="text-sm text-muted">
          Demo cards come from a recorded public Hyperliquid account, are signed by the real enclave on {networkFor(config.demoRegistry).network}, and are marked
          &quot;fixture&quot; so they&apos;re never mistaken for a live card.
        </p>
      )}

      <Step n={1} title="Connect your NEAR wallet" done={!!near}>
        {near ? (
          <div className="flex items-center justify-between text-sm">
            <span>
              Issuing as <span className="font-mono">{near.accountId}</span>
            </span>
            <button className={ghost} onClick={() => near.disconnect().then(() => setNear(null))} disabled={busy}>
              Disconnect
            </button>
          </div>
        ) : (
          <button className={button} onClick={onConnectNear}>
            Connect NEAR wallet
          </button>
        )}
        <p className="mt-2 text-xs text-muted">The card names this account as its issuer. Network: {mode === "demo" ? networkFor(config.demoRegistry).network : network}.</p>
      </Step>

      {mode === "live" && (
        <Step n={2} title="Connect the Hyperliquid account's wallet" done={!!evm}>
          {evm ? (
            <p className="text-sm">
              Account <span className="font-mono">{evm.slice(0, 6)}…{evm.slice(-4)}</span>. Only the enclave will see the full address.
            </p>
          ) : (
            <button className={button} onClick={onConnectEvm} disabled={busy}>
              Connect EVM wallet
            </button>
          )}
        </Step>
      )}

      <Step n={mode === "live" ? 3 : 2} title="Choose a window and create the card">
        <div className="mb-3 flex flex-wrap gap-2">
          {WINDOWS.filter((w) => mode === "live" || w.days === DEMO_WINDOW).map((w) => (
            <button
              key={w.days}
              onClick={() => setWindowDays(w.days)}
              disabled={busy}
              className={`rounded-md border px-3 py-1.5 text-sm ${windowDays === w.days ? "border-accent text-fg" : "border-line text-muted"}`}
            >
              {w.label}
              {"note" in w && <span className="ml-1 text-xs text-muted">({w.note})</span>}
            </button>
          ))}
        </div>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={agent} onChange={(e) => setAgent(e.target.checked)} disabled={busy} /> This account is traded by an AI agent (the card says
          so, for agents and allocators looking for verified bots)
        </label>
        <p className="mb-3 text-xs text-muted">
          Return, max drawdown and trade count are always shown. The account needs 20+ trades in the window and must have held capital
          for (almost) all of it. You attach 0.07 NEAR: 0.02 pays for storing the card (refunded if it&apos;s refused) and OutLayer refunds
          what the run doesn&apos;t use.
        </p>
        <button className={button} onClick={onCreate} disabled={!ready}>
          {mode === "live" ? "Sign and create card" : "Create demo card"}
        </button>
      </Step>

      {keyPath === "relay" && (
        <p className="rounded-md border border-warn/40 p-3 text-xs text-warn">
          Your browser couldn&apos;t reach the OutLayer keystore directly (it only allows listed sites), so the encryption key came through
          this app&apos;s relay. The relay never sees your proof, but you&apos;re trusting it to pass on the real key. To avoid that, run the app
          locally: it talks to OutLayer directly from localhost.
        </p>
      )}

      <Status phase={phase} />
    </div>
  );
}

function Status({ phase }: { phase: Phase }) {
  if (phase.step === "idle") return null;
  if (phase.step === "working") return <p className="text-sm text-muted">{phase.label}</p>;
  if (phase.step === "waiting")
    return <p className="text-sm text-muted">The enclave is computing your stats inside the TEE… {phase.seconds}s (usually 15–30s)</p>;
  if (phase.step === "sent") return <p className="text-sm text-muted">Transactions sent.</p>;
  if (phase.step === "error") return <p className="text-sm text-bad">{phase.message}</p>;
  const o = phase.outcome;
  if (typeof o === "object" && "Issued" in o) {
    return (
      <div className="rounded-lg border border-accent/50 p-4 text-sm">
        <p className="font-medium">Card #{o.Issued.card_id} issued and recorded on NEAR.</p>
        <p className="mt-1 break-all font-mono text-xs text-muted">hash {o.Issued.card_hash}</p>
        <a className="mt-2 inline-block text-accent underline" href={`${cardPath(o.Issued.card_id, phase.registry)}?verify=1`}>
          Open the card
        </a>
        <a className="mt-2 ml-4 inline-block text-accent underline" href={`${cardPath(o.Issued.card_id, phase.registry)}/unlock#sell`}>
          Sell viewing keys to followers
        </a>
      </div>
    );
  }
  if (typeof o === "object" && "Refused" in o) {
    return (
      <div className="rounded-lg border border-bad/50 p-4 text-sm">
        <p className="font-medium text-bad">No card issued</p>
        <p className="mt-1">{explain(o.Refused.code, o.Refused.message)}</p>
        <p className="mt-1 text-xs text-muted">The 0.02 NEAR storage fee was refunded.</p>
      </div>
    );
  }
  return <p className="text-sm text-muted">{JSON.stringify(o)}</p>;
}
