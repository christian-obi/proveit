"use client";

// React hooks over the shared wallet sessions in lib/wallets: every component sees the same
// connection, and a wallet connected earlier comes back by itself after a reload.

import { useCallback, useEffect, useState } from "react";
import type { Network } from "./config";
import { connectEvm, connectNear, currentEvm, currentNear, onWalletChange, restoreEvm, restoreNear, type NearSession } from "./wallets";

export function useNear(network: Network) {
  const [near, setNear] = useState<NearSession | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let alive = true;
    setNear(currentNear(network));
    setRestoring(true);
    restoreNear(network)
      .then((s) => alive && setNear(s))
      .finally(() => alive && setRestoring(false));
    const off = onWalletChange(() => setNear(currentNear(network)));
    return () => {
      alive = false;
      off();
    };
  }, [network]);

  const connect = useCallback(() => connectNear(network), [network]);
  return { near, connect, restoring };
}

export function useEvm() {
  const [evm, setEvm] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    setEvm(currentEvm());
    void restoreEvm().then(setEvm);
    return onWalletChange(() => setEvm(currentEvm()));
  }, []);
  return { evm, connect: connectEvm };
}
