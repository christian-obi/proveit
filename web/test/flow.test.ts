// The transactions the create flow sends, and the keystore relay: nothing secret leaves
// the browser unencrypted, and the shapes match what OutLayer and the registry expect.

import { afterEach, describe, expect, test, vi } from "vitest";
import { config } from "@/lib/config";
import { demoCardTransactions, liveCardTransactions, profileFor } from "@/lib/flow";
import { requestNumber } from "@/lib/near";
import { POST } from "@/app/api/keystore-pubkey/route";

const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const proof = { account: ADDRESS, nearAccount: "trader.testnet", nonce: 123456789, expiry: 1_800_000_000, signature: "0xabc" as `0x${string}` };
const PUBKEY = "a1".repeat(32);

describe("live card transactions", () => {
  const { txs, profile, encrypted } = liveCardTransactions({ proof, keystorePubkey: PUBKEY, storageDeposit: "5000000000000000000000", windowDays: 30 });

  test("store the secret, then request the card", () => {
    expect(txs.map((t) => [t.receiverId, t.actions[0].params.methodName])).toEqual([
      [config.outlayerContract, "store_secrets"],
      [config.registry, "request_card"],
    ]);
  });

  test("store_secrets matches the OutLayer contract's arguments", () => {
    const args = txs[0].actions[0].params.args as Record<string, unknown>;
    expect(args).toEqual({
      accessor: { Project: { project_id: config.enclaveProject } },
      profile,
      encrypted_secrets_base64: encrypted,
      access: { Whitelist: { accounts: ["trader.testnet"] } },
      vault_id: null,
    });
    expect(txs[0].actions[0].params.deposit).toBe("5000000000000000000000");
  });

  test("request_card names the window and the stored profile, with 0.07 NEAR and 300 Tgas", () => {
    const p = txs[1].actions[0].params;
    expect(p.args).toEqual({ window_days: 30, secrets_profile: profile });
    expect(p.deposit).toBe("70000000000000000000000");
    expect(p.gas).toBe("300000000000000");
    expect(profile).toBe(profileFor(proof.nonce));
    expect(profile).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  test("no transaction contains the address or the signature in the clear", () => {
    const all = JSON.stringify(txs).toLowerCase();
    expect(all).not.toContain(ADDRESS.slice(2).toLowerCase());
    expect(all).not.toContain('"signature"');
  });
});

test("a demo card is one request to the demo registry with no secret", () => {
  const txs = demoCardTransactions(7);
  expect(txs).toHaveLength(1);
  expect(txs[0].receiverId).toBe(config.demoRegistry);
  expect(txs[0].actions[0].params.args).toEqual({ window_days: 7 });
});

test("the request number comes from the registry's request_started event", () => {
  const event = { standard: "proveit", version: "1.0.0", event: "request_started", data: [{ request: 7, signer: "t.testnet", version: "x" }] };
  const outcome = { receipts_outcome: [{ outcome: { logs: ["other", `EVENT_JSON:${JSON.stringify(event)}`] } }] };
  expect(requestNumber(outcome)).toBe(7);
  expect(requestNumber({ receipts_outcome: [] })).toBeNull();
});

describe("keystore relay", () => {
  afterEach(() => vi.unstubAllGlobals());

  function relay(body: unknown) {
    return POST(new Request("http://x/api/keystore-pubkey", { method: "POST", body: JSON.stringify(body) }));
  }

  test("forwards only names, with empty placeholder values, even if handed a secret", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(JSON.stringify({ pubkey: PUBKEY }));
    });
    const res = await relay({ projectId: config.enclaveProject, owner: "trader.testnet", profile: "card-1", secrets_json: `{"PROVEIT_SECRET":"${ADDRESS}"}` });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toEqual({
      accessor: { type: "Project", project_id: config.enclaveProject },
      owner: "trader.testnet",
      profile: "card-1",
      secrets_json: '{"PROVEIT_SECRET":""}',
    });
    expect(sent[0]).not.toContain(ADDRESS);
  });

  test("refuses other projects and malformed names", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}"));
    expect((await relay({ projectId: "evil.testnet/x", owner: "a.testnet", profile: "p" })).status).toBe(400);
    expect((await relay({ projectId: config.enclaveProject, owner: "A B", profile: "p" })).status).toBe(400);
    expect((await relay({ projectId: config.enclaveProject, owner: "a.testnet", profile: "bad profile!" })).status).toBe(400);
  });
});
