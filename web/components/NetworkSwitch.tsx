"use client";

// Testnet or mainnet, remembered in a cookie so server-rendered pages can read it too. It picks
// what the board lists and where new cards go. Card links never depend on it: each network's
// cards have their own address (/c mainnet, /t testnet, /demo demo).

import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { config, NETWORK_COOKIE, parseNetwork, type Network } from "@/lib/config";

const CHANGED = "proveit-network-changed";

function read(): Network {
  return parseNetwork(document.cookie.match(new RegExp(`(?:^|; )${NETWORK_COOKIE}=([^;]*)`))?.[1]);
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

export const useNetwork = () => useSyncExternalStore(subscribe, read, () => config.network);

export default function NetworkSwitch() {
  const network = useNetwork();
  const router = useRouter();
  const path = usePathname();

  const choose = (next: Network) => {
    if (next === network) return;
    document.cookie = `${NETWORK_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new Event(CHANGED));
    // A card page belongs to one network, so leave it for the board of the new one.
    if (/^\/[ct]\//.test(path)) router.push("/explore");
    router.refresh();
  };

  return (
    <div className="network-switch" role="group" aria-label="Network" data-network={network}>
      {(["testnet", "mainnet"] as Network[]).map((n) => (
        <button key={n} type="button" onClick={() => choose(n)} aria-pressed={n === network} className={n === network ? "is-on" : ""}>
          {n}
        </button>
      ))}
    </div>
  );
}
