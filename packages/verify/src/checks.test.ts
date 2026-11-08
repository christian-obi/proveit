// T6.1: the five checks, on a real recorded testnet card and on a synthetic live card
// signed with the PUBLIC test key, against a mock registry and attestation API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "./canonical.ts";
import { cardHash, enclaveOutput, sha256Hex, signingMessage } from "./card.ts";
import { tamper, verifyCard, type CardRecord, type Report } from "./checks.ts";

const RPC = "https://rpc.test";
const API = "https://outlayer.test";
const EP = { rpc: RPC, outlayerApi: API };

type World = {
  registry: string;
  records: Record<number, CardRecord>;
  config: { project_id: string; stale_after_secs: number };
  versions: [string, { approved_at: number; retired: boolean }][];
  attestation: Record<string, unknown> | null;
  statusOverride?: string;
};

/** A registry and attestation API that behave like the real ones, from `world`. */
function mockFetch(world: World): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (url === RPC) {
      const { params } = JSON.parse(String(init!.body));
      const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString());
      const reply = (v: unknown) => new Response(JSON.stringify({ result: { result: [...Buffer.from(JSON.stringify(v))] } }));
      switch (params.method_name) {
        case "get_card":
          return reply(world.records[args.card_id] ?? null);
        case "get_config":
          return reply(world.config);
        case "get_versions":
          return reply(world.versions);
        case "verify_card": {
          const rec = world.records[args.card_id];
          if (!rec) return reply({ status: "NOT_FOUND" });
          if (cardHash(JSON.parse(args.card_json)) !== rec.card_hash) return reply({ status: "HASH_MISMATCH" });
          return reply({ status: world.statusOverride ?? "VALID" });
        }
      }
      throw new Error(`unexpected view ${params.method_name}`);
    }
    if (url.startsWith(`${API}/attestations/by-request/`)) {
      return world.attestation ? new Response(JSON.stringify(world.attestation)) : new Response("not found", { status: 404 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

const statuses = (r: Report) => Object.fromEntries(r.checks.map((c) => [c.id, c.status]));

// ---- a synthetic live card -------------------------------------------------------------

const NOW = 1_794_100_000;
const VERSION = "2fc1b7276678a24af41a0125edaa37cd5eb38117ab43c496deabfff320925862";
const seed = createHash("sha256").update("proveit-test-card-key-v1").digest();
const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
const pubkey = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

function liveWorld(): World {
  const vector = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "test-vectors", "card-sig.json"), "utf8"));
  const card = { ...vector.card, mode: "live", issued_at: NOW - 3600, outlayer_request_id: "42", window: { ...vector.card.window, days: 30 } };
  const sig = sign(null, Buffer.from(signingMessage(card)), key).toString("hex");
  const record: CardRecord = {
    id: 0, card_hash: cardHash(card), card_json: canonical(card), sig, pubkey, issuer: card.issuer, commitment: card.commitment,
    version: VERSION, mode: "live", window_days: 30, issued_at: card.issued_at, outlayer_request_id: "42", revoked: false, supersedes: null, superseded_by: null,
  };
  return {
    registry: "proveit-registry.testnet",
    records: { 0: record },
    config: { project_id: "owner.testnet/enclave", stale_after_secs: 14 * 86_400 },
    versions: [[VERSION, { approved_at: NOW - 86_400, retired: false }]],
    attestation: {
      wasm_hash: VERSION, executed_wasm_sha256: VERSION, project_id: "owner.testnet/enclave",
      caller_account_id: card.issuer, output_hash: sha256Hex(enclaveOutput(card, sig)),
    },
  };
}

const run = (w: World, cardJson?: string, now = NOW, cardId = 0) => verifyCard({ registry: w.registry, cardId, cardJson, now }, EP, mockFetch(w));

test("a valid live card: five green checks", async () => {
  const r = await run(liveWorld());
  assert.deepEqual(statuses(r), { signature: "pass", record: "pass", code: "pass", attestation: "pass", freshness: "pass" });
  assert.equal(r.ok, true);
});

test("an edited stat: signature, record and attestation go red", async () => {
  const w = liveWorld();
  const r = await run(w, tamper(w.records[0].card_json, "return_bps=3494"));
  assert.deepEqual(statuses(r), { signature: "fail", record: "fail", code: "pass", attestation: "fail", freshness: "pass" });
  assert.equal(r.ok, false);
  assert.match(r.checks[0].detail, /signature mismatch/);
});

test("a card id the registry doesn't have: everything red", async () => {
  const r = await run(liveWorld(), undefined, NOW, 9);
  assert.ok(r.checks.every((c) => c.status === "fail"));
});

test("an unapproved or retired build: code red", async () => {
  const w = liveWorld();
  w.versions = [];
  assert.equal(statuses(await run(w)).code, "fail");
  const r = liveWorld();
  r.versions[0][1].retired = true;
  r.statusOverride = "VERSION_RETIRED";
  const s = statuses(await run(r));
  assert.equal(s.code, "fail");
  assert.equal(s.record, "fail");
});

test("an attestation for different output, build or project: attestation red", async () => {
  for (const [field, value] of [["output_hash", "00".repeat(32)], ["wasm_hash", "11".repeat(32)], ["project_id", "evil.testnet/enclave"], ["caller_account_id", "someone.testnet"]]) {
    const w = liveWorld();
    (w.attestation as any)[field] = value;
    assert.equal(statuses(await run(w)).attestation, "fail", field);
  }
});

test("revoked and superseded cards fail the record check", async () => {
  for (const s of ["REVOKED", "SUPERSEDED"]) {
    const w = liveWorld();
    w.statusOverride = s;
    assert.equal(statuses(await run(w)).record, "fail", s);
  }
});

test("a stale card: amber, but not a failure", async () => {
  const r = await run(liveWorld(), undefined, NOW + 30 * 86_400);
  assert.equal(statuses(r).freshness, "warn");
  assert.equal(r.ok, true);
});

test("a missing attestation is a warning, not a pass", async () => {
  const w = liveWorld();
  w.attestation = null;
  assert.equal(statuses(await run(w)).attestation, "warn");
});

test("tamper() edits stats by short name or by path", () => {
  const c = JSON.stringify({ stats: { return_bps: 1 }, mode: "live" });
  assert.equal(JSON.parse(tamper(c, "return_bps=5")).stats.return_bps, 5);
  assert.equal(JSON.parse(tamper(c, "stats.return_bps=-7")).stats.return_bps, -7);
  assert.equal(JSON.parse(tamper(c, "mode=fixture")).mode, "fixture");
});

// ---- a real card, recorded from testnet --------------------------------------------------

const real = JSON.parse(readFileSync(join(import.meta.dirname, "..", "test-data", "proveit-demo-registry.testnet-1.json"), "utf8"));
const realWorld = (): World => ({
  registry: real.registry,
  records: { [real.cardId]: real.record },
  config: real.config,
  versions: real.versions,
  attestation: real.attestation,
});

test("real testnet card #1: signature, record, code and attestation pass; flagged as a demo card", async () => {
  const r = await verifyCard({ registry: real.registry, cardId: real.cardId, now: real.record.issued_at + 600 }, EP, mockFetch(realWorld()));
  assert.deepEqual(statuses(r), { signature: "pass", record: "pass", code: "pass", attestation: "pass", freshness: "warn" });
  assert.match(r.checks[4].detail, /demo card/);
});

test("real testnet card #1, return edited: three checks go red", async () => {
  const edited = tamper(real.record.card_json, "return_bps=3494");
  const r = await verifyCard({ registry: real.registry, cardId: real.cardId, cardJson: edited, now: real.record.issued_at + 600 }, EP, mockFetch(realWorld()));
  const s = statuses(r);
  assert.deepEqual([s.signature, s.record, s.attestation], ["fail", "fail", "fail"]);
});

// ---- rate limits and caching ------------------------------------------------------------

test("a rate-limited RPC endpoint falls through to the next one", async () => {
  const w = liveWorld();
  const good = mockFetch(w);
  const seen: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push(url);
    if (url === "https://busy.rpc") return new Response(JSON.stringify({ error: { code: -429, message: "Rate limits exceeded" } }));
    return good(url === "https://spare.rpc" ? RPC : url, init);
  }) as typeof fetch;
  const r = await verifyCard({ registry: w.registry, cardId: 0, now: NOW }, { rpc: ["https://busy.rpc", "https://spare.rpc"], outlayerApi: API }, f);
  assert.equal(r.ok, true);
  assert.ok(seen.includes("https://busy.rpc") && seen.includes("https://spare.rpc"));
});

test("with a cache, a re-check (tamper mode) asks the registry only verify_card again", async () => {
  const w = liveWorld();
  const base = mockFetch(w);
  const methods: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (url === RPC) methods.push(JSON.parse(String(init!.body)).params.method_name);
    else methods.push("attestation");
    return base(url, init);
  }) as typeof fetch;
  const cache = new Map();
  await verifyCard({ registry: w.registry, cardId: 0, now: NOW }, EP, f, cache);
  methods.length = 0;
  const r = await verifyCard({ registry: w.registry, cardId: 0, now: NOW, cardJson: tamper(w.records[0].card_json, "return_bps=1") }, EP, f, cache);
  assert.deepEqual(methods, ["verify_card"]);
  assert.equal(r.ok, false);
});
