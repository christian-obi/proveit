"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cardPath } from "@/lib/cards";
import { config } from "@/lib/config";

// Paste a card link (or "registry card-id") and open it with the checks running.
export default function VerifyPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const v = input.trim();
    let id: string | undefined;
    let registry: string | undefined;
    try {
      const u = new URL(v);
      const m = u.pathname.match(/\/(c|demo)\/(\d+)/);
      id = m?.[2];
      registry = m?.[1] === "demo" ? config.demoRegistry : config.registry;
    } catch {
      const parts = v.split(/\s+/);
      if (parts.length === 2 && /^\d+$/.test(parts[1])) [registry, id] = parts;
      else if (/^\d+$/.test(v)) id = v;
    }
    if (!id) return setError("Paste a card link like …/c/1, or a registry and card number.");
    router.push(`${cardPath(Number(id), registry ?? config.registry)}?verify=1`);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Verify a card</h1>
      <p className="text-muted">
        Paste a Prove-It card link. Your browser checks the enclave&apos;s signature, the NEAR record, the enclave build and the TEE attestation,
        using public data only.
      </p>
      <form onSubmit={go} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`${config.siteUrl}/c/1`}
          className="flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm"
          aria-label="Card link"
        />
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg">Verify</button>
      </form>
      {error && <p className="text-sm text-bad">{error}</p>}
    </section>
  );
}
