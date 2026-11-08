// POST /api/reveal {registry, op: "feed" | "reveal", card_id, since?, auth}
//
// Forwards a follower's request to the enclave over OutLayer HTTPS, paying with the app's
// payment key (OUTLAYER_PAYMENT_KEY, server-side only). The request carries only the
// follower's NEP-413 signature and public X25519 key; the answer is encrypted to that key
// inside the TEE. So this relay learns neither the trader's address nor any trade: it can
// refuse to forward, but not read or forge (the enclave checks the signature and grant,
// and each answer has a TEE attestation).

import { NextResponse } from "next/server";
import { config, isKnownRegistry } from "@/lib/config";
import { view } from "@/lib/near";

export const dynamic = "force-dynamic";

const AUTH_FIELDS = ["account_id", "public_key", "signature", "message", "nonce", "recipient"] as const;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 4096) return NextResponse.json({ error: "request too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad JSON" }, { status: 400 });
  }
  const { registry, op, card_id, since, auth } = body as { registry?: string; op?: string; card_id?: unknown; since?: unknown; auth?: Record<string, unknown> };
  if (typeof registry !== "string" || !isKnownRegistry(registry)) return NextResponse.json({ error: "unknown registry" }, { status: 400 });
  if (op !== "feed" && op !== "reveal") return NextResponse.json({ error: "op must be feed or reveal" }, { status: 400 });
  if (!Number.isInteger(card_id) || (card_id as number) < 0) return NextResponse.json({ error: "bad card_id" }, { status: 400 });
  if (since !== undefined && (!Number.isInteger(since) || (since as number) < 0)) return NextResponse.json({ error: "bad since" }, { status: 400 });
  if (!auth || typeof auth !== "object" || !AUTH_FIELDS.every((k) => typeof auth[k] === "string")) {
    return NextResponse.json({ error: "auth must be a NEP-413 signed message" }, { status: 400 });
  }
  const key = process.env.OUTLAYER_PAYMENT_KEY;
  if (!key) return NextResponse.json({ error: "the relay has no OutLayer payment key configured" }, { status: 503 });

  // Rebuild the input from the checked fields only, so nothing else can be smuggled in.
  const input: Record<string, unknown> = { op, card_id, auth: Object.fromEntries(AUTH_FIELDS.map((k) => [k, auth[k]])) };
  if (op === "feed") input.since = since ?? 0;
  const project = registry === config.demoRegistry ? config.demoEnclaveProject : config.enclaveProject;
  // Run exactly the build the registry approved, so the attestation names it.
  const { active_version } = await view<{ active_version: string | null }>(registry, "get_config");
  if (!active_version) return NextResponse.json({ error: "the registry has no active enclave version" }, { status: 503 });
  const res = await fetch(`${config.outlayerApi}/call/${project}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Payment-Key": key, "X-Compute-Limit": "100000" },
    body: JSON.stringify({ input, version_key: active_version, resource_limits: { max_instructions: 30_000_000_000, max_memory_mb: 256, max_execution_seconds: 60 } }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== "completed") {
    return NextResponse.json({ error: data.error ?? data.message ?? `OutLayer answered HTTP ${res.status}` }, { status: 502 });
  }
  const output = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
  const attestation = data.attestation_url ? new URL(data.attestation_url, config.outlayerApi).toString() : null;
  return NextResponse.json({ output, attestation, call_id: data.call_id });
}
