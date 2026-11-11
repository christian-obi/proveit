// T5.3: run the whole live create flow in a real browser and check that the Hyperliquid
// address never reaches this app's own server, and that the transactions carry only
// ciphertext. The EVM wallet is a mock that signs with Anvil's PUBLIC test key; the NEAR
// wallet is the build-time fake (NEXT_PUBLIC_E2E=1) that records transactions.

import { expect, test, type Page, type Request } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const ADDRESS = signer.address;
const BARE = ADDRESS.slice(2).toLowerCase();

async function installMockEvmWallet(page: Page) {
  await page.exposeFunction("__signTyped", async (json: string) => {
    const data = JSON.parse(json);
    delete data.types.EIP712Domain;
    data.message.nonce = BigInt(data.message.nonce);
    data.message.expiry = BigInt(data.message.expiry);
    return signer.signTypedData(data);
  });
  await page.addInitScript((address) => {
    (window as any).ethereum = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_signTypedData_v4") return (window as any).__signTyped(params![1]);
        throw new Error(`mock wallet: unsupported ${method}`);
      },
    };
  }, ADDRESS);
}

type Seen = { url: string; body: string };

function record(page: Page) {
  const own: Seen[] = [];
  const external: Seen[] = [];
  page.on("request", (r: Request) => {
    const seen = { url: r.url(), body: r.postData() ?? "" };
    (new URL(r.url()).origin === "http://localhost:3000" ? own : external).push(seen);
  });
  return { own, external };
}

async function runLiveFlow(page: Page) {
  await page.goto("/create");
  await page.getByRole("button", { name: "Connect NEAR wallet" }).click();
  // The account also shows in the header now, so look for it in the flow itself.
  await expect(page.getByText("Issuing as")).toBeVisible();
  // An EVM wallet that already allowed this site is picked up without a click.
  await page.getByRole("button", { name: "Connect EVM wallet" }).click({ timeout: 5_000 }).catch(() => undefined);
  await expect(page.getByText("Only the enclave will see the full address")).toBeVisible();
  await page.getByRole("button", { name: "30 days" }).click();
  await page.getByRole("button", { name: "Sign and create card" }).click();
  await expect(page.getByText("Transactions sent.")).toBeVisible({ timeout: 60_000 });
  return page.evaluate(() => (window as any).__proveitSent);
}

function containsAddress(s: string) {
  return s.toLowerCase().includes(BARE);
}

test("the address never reaches this app's server, and transactions carry only ciphertext", async ({ page }) => {
  await installMockEvmWallet(page);
  const { own, external } = record(page);
  const sent = await runLiveFlow(page);

  expect(own.filter((r) => containsAddress(r.url) || containsAddress(r.body))).toEqual([]);

  const [txs] = sent;
  expect(txs.map((t: any) => t.actions[0].params.methodName)).toEqual(["store_secrets", "request_card"]);
  expect(containsAddress(JSON.stringify(txs))).toBe(false);
  expect(txs[0].actions[0].params.args.encrypted_secrets_base64.length).toBeGreaterThan(200);

  // The keystore was reached directly from localhost, with an empty placeholder value.
  const keystore = external.filter((r) => r.url.includes("/secrets/pubkey"));
  expect(keystore.length).toBeGreaterThan(0);
  for (const r of keystore) {
    expect(containsAddress(r.body)).toBe(false);
    expect(JSON.parse(r.body).secrets_json).toBe('{"PROVEIT_SECRET":""}');
  }
  // Nothing else external sees it either (RPC reads, the keystore).
  expect(external.filter((r) => containsAddress(r.url) || containsAddress(r.body))).toEqual([]);
});

test("when OutLayer is unreachable, the relay is used and still sees no secret", async ({ page }) => {
  await installMockEvmWallet(page);
  await page.route("**/testnet-api.outlayer.ai/secrets/pubkey", (route) => route.abort());
  const { own } = record(page);
  await runLiveFlow(page);

  const relayed = own.filter((r) => r.url.endsWith("/api/keystore-pubkey"));
  expect(relayed).toHaveLength(1);
  expect(containsAddress(relayed[0].body)).toBe(false);
  expect(Object.keys(JSON.parse(relayed[0].body)).sort()).toEqual(["owner", "profile", "projectId"]);
  await expect(page.getByText("came through this app's relay")).toBeVisible();
  expect(own.filter((r) => containsAddress(r.url) || containsAddress(r.body))).toEqual([]);
});
