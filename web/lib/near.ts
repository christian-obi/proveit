// NEAR reads over RPC, and the transactions the create flow sends.

import { config, MAX_GAS, REQUEST_DEPOSIT_YOCTO } from "./config";

export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const res = await fetch(config.nearRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "proveit",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const body = await res.json();
  if (body.error || body.result?.error) throw new Error(`${contract}.${method}: ${JSON.stringify(body.error ?? body.result.error)}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
}

export type RequestOutcome =
  | "Pending"
  | { Issued: { card_id: number; card_hash: string } }
  | { Refused: { code: string; message: string } }
  | { KeySet: { pubkey: string } };

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

export type Action = {
  type: "FunctionCall";
  params: { methodName: string; args: object; gas: string; deposit: string };
};
export type Tx = { receiverId: string; actions: Action[] };

export function storeSecretsArgs(projectId: string, owner: string, profile: string, encryptedBase64: string) {
  return {
    accessor: { Project: { project_id: projectId } },
    profile,
    encrypted_secrets_base64: encryptedBase64,
    // Judged against the transaction signer, so only the owner's own runs can decrypt it.
    access: { Whitelist: { accounts: [owner] } },
    vault_id: null,
  };
}

/** Exact storage cost of the secret, from the OutLayer contract itself. */
export async function storageCost(projectId: string, owner: string, profile: string, encryptedBase64: string): Promise<string> {
  const args = { ...storeSecretsArgs(projectId, owner, profile, encryptedBase64), owner };
  return view<string>(config.outlayerContract, "estimate_storage_cost", args);
}

export function storeSecretsTx(projectId: string, owner: string, profile: string, encryptedBase64: string, deposit: string): Tx {
  return {
    receiverId: config.outlayerContract,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: "store_secrets", args: storeSecretsArgs(projectId, owner, profile, encryptedBase64), gas: "100000000000000", deposit },
      },
    ],
  };
}

export function requestCardTx(registry: string, windowDays: number, profile: string | null): Tx {
  const args: Record<string, unknown> = { window_days: windowDays };
  if (profile) args.secrets_profile = profile;
  return {
    receiverId: registry,
    actions: [{ type: "FunctionCall", params: { methodName: "request_card", args, gas: MAX_GAS, deposit: REQUEST_DEPOSIT_YOCTO } }],
  };
}

/** The registry's request number, from the `request_started` event in a transaction outcome. */
export function requestNumber(outcome: unknown): number | null {
  const logs: string[] = [];
  const o = outcome as { receipts_outcome?: { outcome: { logs: string[] } }[] };
  for (const r of o?.receipts_outcome ?? []) logs.push(...r.outcome.logs);
  for (const log of logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(log.slice("EVENT_JSON:".length));
      if (e.standard === "proveit" && e.event === "request_started") return e.data[0].request;
    } catch {
      // not ours
    }
  }
  return null;
}

export async function waitForRequest(registry: string, request: number, onTick?: (seconds: number) => void): Promise<RequestOutcome> {
  const started = Date.now();
  for (;;) {
    const outcome = await view<RequestOutcome>(registry, "get_request", { request });
    if (outcome && outcome !== "Pending") return outcome;
    if (Date.now() - started > 5 * 60_000) throw new Error("the enclave did not answer within 5 minutes");
    onTick?.(Math.round((Date.now() - started) / 1000));
    await new Promise((r) => setTimeout(r, 2500));
  }
}
