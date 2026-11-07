// Relay for the OutLayer keystore's public key (see lib/keystore.ts for why it exists).
// It rebuilds the request from three validated names, so it can never forward a secret,
// and it passes OutLayer's answer through unchanged.

import { config } from "@/lib/config";
import { keystoreBody } from "@/lib/keystore";

const NAME = /^[a-z0-9._-]{2,64}(\/[A-Za-z0-9._/-]{1,64})?$/;
const PROFILE = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(req: Request) {
  let body: { projectId?: unknown; owner?: unknown; profile?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("expected JSON", { status: 400 });
  }
  const { projectId, owner, profile } = body;
  if (typeof projectId !== "string" || projectId !== config.enclaveProject) return new Response("unknown project", { status: 400 });
  if (typeof owner !== "string" || !NAME.test(owner)) return new Response("bad owner", { status: 400 });
  if (typeof profile !== "string" || !PROFILE.test(profile)) return new Response("bad profile", { status: 400 });

  const upstream = await fetch(`${config.outlayerApi}/secrets/pubkey`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "proveit-keystore-relay" },
    body: JSON.stringify(keystoreBody({ projectId, owner, profile })),
    cache: "no-store",
  });
  return new Response(await upstream.text(), { status: upstream.status, headers: { "Content-Type": "application/json" } });
}
