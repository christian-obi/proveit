// The five checks behind the Verify button and `pnpm verify`. Each uses only public data:
// the registry contract (over NEAR RPC) and OutLayer's attestation API. Nothing is taken
// from Prove-It's own servers.
//
//   1 signature    the card verifies under the enclave key the registry recorded
//   2 record       the registry holds exactly this card (hash), and it isn't revoked
//   3 code         the enclave build that made it is approved and not retired
//   4 attestation  OutLayer's TEE attestation for the run names that build, the registry's
//                  project and the issuer, and its output hash equals this card + signature
//   5 freshness    issued recently enough; demo ("fixture") and 1-day cards are flagged

import { canonical } from "./canonical.ts";
import { cardHash, enclaveOutput, sha256Hex, verifyCardSignature } from "./card.ts";

export type Status = "pass" | "fail" | "warn";
export type CheckId = "signature" | "record" | "code" | "attestation" | "freshness";
export type Check = { id: CheckId; label: string; status: Status; detail: string };

export type CardRecord = {
  id: number;
  card_hash: string;
  card_json: string;
  sig: string;
  pubkey: string;
  issuer: string;
  commitment: string;
  version: string;
  mode: string;
  window_days: number;
  issued_at: number;
  outlayer_request_id: string | null;
  revoked: boolean;
  supersedes: number | null;
  superseded_by: number | null;
};

/** `rpc` may list several endpoints: on a rate limit (HTTP 429 / code -429) the next one is tried. */
export type Endpoints = { rpc: string | string[]; outlayerApi: string; attestationPage?: string };

/**
 * Answers that can't change while a card is being checked (the record, the registry config,
 * the approved versions, the attestation). Pass the same object to repeated verifyCard calls,
 * as tamper mode does, and only `verify_card` is asked again.
 */
export type Cache = Map<string, Promise<unknown>>;

export type Report = {
  ok: boolean;
  checks: Check[];
  record: CardRecord | null;
  card: Record<string, any> | null;
  attestationUrl: string | null;
};

const LABELS: Record<CheckId, string> = {
  signature: "Enclave signature",
  record: "On-chain record",
  code: "Enclave code",
  attestation: "TEE attestation",
  freshness: "Freshness",
};

function b64(s: string): string {
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "utf8").toString("base64");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A view call, trying each RPC endpoint in turn on rate limits, with backoff between rounds. */
/** A JSON-RPC call over the endpoints, falling through on rate limits and server errors. */
export async function rpc<T>(rpc: string | string[], method: string, params: unknown, f: typeof fetch = fetch): Promise<T> {
  const endpoints = Array.isArray(rpc) ? rpc : [rpc];
  const payload = JSON.stringify({ jsonrpc: "2.0", id: "proveit-verify", method, params });
  let last = "";
  for (let round = 0; round < 3; round++) {
    for (const url of endpoints) {
      let body: any;
      try {
        const res = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
        if (res.status === 429 || res.status >= 500) {
          last = `${url} answered HTTP ${res.status}`;
          continue;
        }
        body = await res.json();
      } catch (e) {
        last = `${url}: ${(e as Error).message}`;
        continue;
      }
      const err = body.error ?? body.result?.error;
      if (err && (err.code === -429 || /rate limit/i.test(JSON.stringify(err)))) {
        last = `${url} is rate-limiting`;
        continue;
      }
      if (err) throw new Error(`${method}: ${JSON.stringify(err)}`);
      return body.result as T;
    }
    await sleep(400 * 2 ** round);
  }
  throw new Error(`${method}: every RPC endpoint failed (${last})`);
}

export async function view<T>(endpoints: string | string[], contract: string, method: string, args: object, f: typeof fetch = fetch): Promise<T> {
  const params = { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: b64(JSON.stringify(args)) };
  try {
    const result = await rpc<{ result: number[] }>(endpoints, "query", params, f);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
  } catch (e) {
    throw new Error(`${contract}.${method}: ${(e as Error).message.replace(/^query: /, "")}`);
  }
}

/**
 * Check a card. Without `cardJson` the registry's own copy is checked; with it, those exact
 * JSON bytes are (the verify page's tamper mode and pasted cards).
 */
export async function verifyCard(
  opts: { registry: string; cardId: number; cardJson?: string; now?: number },
  ep: Endpoints,
  f: typeof fetch = fetch,
  cache?: Cache,
): Promise<Report> {
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache) return load();
    if (!cache.has(key)) cache.set(key, load().catch((e) => (cache.delete(key), Promise.reject(e))));
    return cache.get(key) as Promise<T>;
  };
  const checks: Check[] = [];
  const add = (id: CheckId, status: Status, detail: string) => checks.push({ id, label: LABELS[id], status, detail });
  const done = (record: CardRecord | null, card: Record<string, any> | null, attestationUrl: string | null): Report => ({
    ok: checks.every((c) => c.status !== "fail"),
    checks,
    record,
    card,
    attestationUrl,
  });

  const record = await once(`card:${opts.registry}:${opts.cardId}`, () => view<CardRecord | null>(ep.rpc, opts.registry, "get_card", { card_id: opts.cardId }, f));
  if (!record) {
    for (const id of Object.keys(LABELS) as CheckId[]) add(id, "fail", `card #${opts.cardId} isn't in the registry ${opts.registry}`);
    return done(null, null, null);
  }

  const config = await once(`config:${opts.registry}`, () => view<{ project_id: string; stale_after_secs: number }>(ep.rpc, opts.registry, "get_config", {}, f));

  let card: Record<string, any>;
  try {
    card = JSON.parse(opts.cardJson ?? record.card_json);
    canonical(card);
  } catch (e) {
    for (const id of Object.keys(LABELS) as CheckId[]) add(id, "fail", `not a valid card: ${(e as Error).message}`);
    return done(record, null, null);
  }

  // 1. signature
  if (verifyCardSignature(card, record.sig, record.pubkey)) {
    add("signature", "pass", `signed by the enclave key ${record.pubkey.slice(0, 12)}…, which the registry learned from the enclave itself`);
  } else {
    add("signature", "fail", "signature mismatch: these numbers are not what the enclave signed");
  }

  // 2. record
  const onchain = await view<{ status: string }>(ep.rpc, opts.registry, "verify_card", { card_id: opts.cardId, card_json: canonical(card) }, f);
  const recordMessages: Record<string, [Status, string]> = {
    VALID: ["pass", `card #${record.id} is recorded on ${opts.registry} with hash ${record.card_hash.slice(0, 12)}…`],
    STALE: ["pass", `card #${record.id} is recorded on ${opts.registry} (see freshness)`],
    HASH_MISMATCH: ["fail", `the registry holds a different card under #${record.id}: this one was edited`],
    REVOKED: ["fail", "the issuer revoked this card"],
    SUPERSEDED: ["fail", `replaced by card #${record.superseded_by}`],
    VERSION_RETIRED: ["fail", "made by an enclave build that has since been retired"],
    BAD_CARD: ["fail", "the registry couldn't read this card"],
    NOT_FOUND: ["fail", "not in the registry"],
  };
  const [rs, rd] = recordMessages[onchain.status] ?? ["fail", `registry answered ${onchain.status}`];
  add("record", rs, rd);

  // 3. code
  const versions = await once(`versions:${opts.registry}`, () => view<[string, { approved_at: number; retired: boolean }][]>(ep.rpc, opts.registry, "get_versions", {}, f));
  const v = versions.find(([h]) => h === record.version);
  if (!v) add("code", "fail", `enclave build ${record.version.slice(0, 12)}… was never approved by this registry`);
  else if (v[1].retired) add("code", "fail", `enclave build ${record.version.slice(0, 12)}… has been retired`);
  else add("code", "pass", `enclave build ${record.version.slice(0, 12)}…: open source, rebuild it with enclave/build.sh and compare`);

  // 4. attestation
  let attestationUrl: string | null = null;
  const requestId = record.outlayer_request_id ?? card.outlayer_request_id;
  if (!requestId) {
    add("attestation", "warn", "this card names no OutLayer request, so its attestation can't be looked up");
  } else {
    attestationUrl = `${ep.outlayerApi}/attestations/by-request/${requestId}`;
    try {
      const url = attestationUrl;
      const att = await once<any>(`att:${url}`, async () => {
        const res = await f(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });
      const problems: string[] = [];
      if (att.wasm_hash !== record.version || att.executed_wasm_sha256 !== record.version) problems.push("ran a different enclave build");
      if (att.project_id !== config.project_id) problems.push(`ran project ${att.project_id}, not the registry's ${config.project_id}`);
      if (att.caller_account_id !== record.issuer) problems.push("was requested by a different account");
      if (att.output_hash !== sha256Hex(enclaveOutput(card, record.sig))) problems.push("produced different output than this card");
      if (problems.length) add("attestation", "fail", `the TEE run ${problems.join(", ")}`);
      else add("attestation", "pass", `Intel TDX attestation for OutLayer request ${requestId}: this build, this project, this issuer, this exact output`);
    } catch (e) {
      add("attestation", "warn", `couldn't fetch the attestation (${(e as Error).message})`);
    }
  }

  // 5. freshness
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const days = Math.floor((now - card.issued_at) / 86_400);
  const notes: string[] = [];
  let fresh: Status = "pass";
  if (now - card.issued_at > config.stale_after_secs) {
    fresh = "warn";
    notes.push(`issued ${days} days ago; the trader should refresh it`);
  } else notes.push(days === 0 ? "issued today" : `issued ${days} day${days === 1 ? "" : "s"} ago`);
  if (card.mode !== "live") {
    fresh = "warn";
    notes.push("a demo card from a recorded public account, not the issuer's own");
  }
  if (card.window?.days === 1) {
    fresh = "warn";
    notes.push("a 1-day card, meant for testing");
  }
  add("freshness", fresh, notes.join("; "));

  return done(record, card, attestationUrl);
}

/** Apply a tamper edit like "return_bps=3830" or "stats.max_dd_bps=0" to a card's JSON. */
export function tamper(cardJson: string, edit: string): string {
  const [path, raw] = edit.split("=");
  if (!path || raw === undefined) throw new Error(`tamper edits look like field=value, got "${edit}"`);
  const card = JSON.parse(cardJson);
  const keys = path.includes(".") ? path.split(".") : path in card ? [path] : ["stats", path];
  let target = card;
  for (const k of keys.slice(0, -1)) target = target[k];
  const value = /^-?\d+$/.test(raw) ? Number(raw) : raw;
  target[keys[keys.length - 1]] = value;
  return JSON.stringify(card);
}

export { cardHash };
