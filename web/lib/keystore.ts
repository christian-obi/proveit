// Getting the OutLayer keystore's public key for the trader's secret.
//
// The request carries only key NAMES (with empty values): the keystore validates names,
// so the real secret never leaves the browser unencrypted.
//
// OutLayer allows browser calls only from origins it lists (its dashboard and localhost).
// So the app calls OutLayer directly when it can, and otherwise goes through the app's own
// relay (/api/keystore-pubkey). The relay sees nothing secret, but it is a trust trade-off:
// a dishonest relay could return a key of its own, so the UI tells the trader which path
// was used. Running the app locally, or OutLayer allowlisting the domain, removes it.

import { networkFor } from "./config";

export type KeystoreRequest = { projectId: string; owner: string; profile: string };
export type KeystoreKey = { pubkey: string; path: "direct" | "relay" };

export const SECRET_NAMES = ["PROVEIT_SECRET"];

/** The body OutLayer expects. Built in one place so the relay can't be handed anything else. */
export function keystoreBody({ projectId, owner, profile }: KeystoreRequest) {
  return {
    accessor: { type: "Project", project_id: projectId },
    owner,
    profile,
    secrets_json: JSON.stringify(Object.fromEntries(SECRET_NAMES.map((n) => [n, ""]))),
  };
}

function parse(text: string): string {
  const { pubkey } = JSON.parse(text);
  if (!/^[0-9a-f]{64}$/.test(pubkey ?? "")) throw new Error(`unexpected keystore answer: ${text.slice(0, 120)}`);
  return pubkey;
}

export async function fetchKeystorePubkey(req: KeystoreRequest): Promise<KeystoreKey> {
  try {
    const res = await fetch(`${networkFor(req.projectId.split("/")[0]).outlayerApi}/secrets/pubkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(keystoreBody(req)),
    });
    if (res.ok) return { pubkey: parse(await res.text()), path: "direct" };
  } catch {
    // CORS refusal: fall through to the relay.
  }
  const res = await fetch("/api/keystore-pubkey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`keystore relay answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { pubkey: parse(await res.text()), path: "relay" };
}
