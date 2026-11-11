"use client";

// Connect once, in the header, like any other dapp. The connection is shared by every page
// and survives a reload.

import { useState } from "react";
import { useNetwork } from "@/components/NetworkSwitch";
import { useNear } from "@/lib/use-wallet";

export default function WalletButton() {
  const network = useNetwork();
  const { near, connect, restoring } = useNear(network);
  const [error, setError] = useState(false);

  if (near) {
    return (
      <span className="wallet-chip" data-wallet={near.accountId}>
        <span className="truncate font-mono">{near.accountId}</span>
        <button type="button" onClick={() => void near.disconnect()} aria-label="Disconnect wallet" title="Disconnect">
          ×
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="wallet-connect"
      disabled={restoring}
      onClick={() => {
        setError(false);
        connect().catch(() => setError(true));
      }}
      title={error ? "The wallet didn't connect. Try again." : undefined}
    >
      {restoring ? "…" : "Connect wallet"}
    </button>
  );
}
