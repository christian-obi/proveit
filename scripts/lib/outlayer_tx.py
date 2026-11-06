#!/usr/bin/env python3
"""Pull an OutLayer run's request id and exact output bytes out of a NEAR transaction,
then check them against the run's TEE attestation.

  scripts/lib/outlayer_tx.py --network testnet --signer <acct> <tx hash> [--wasm <file>]

Prints JSON: request_id, output (as text), output_sha256, attestation fields, and the
result of each comparison. Exit 1 if any comparison fails.
"""

import argparse
import base64
import hashlib
import json
import sys
import urllib.request

NETS = {
    "testnet": ("https://archival-rpc.testnet.fastnear.com", "https://testnet-api.outlayer.ai", "outlayer.testnet"),
    "mainnet": ("https://archival-rpc.mainnet.fastnear.com", "https://api.outlayer.ai", "outlayer.near"),
}


def get(url, body=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body else None,
                                 {"Content-Type": "application/json", "User-Agent": "proveit-scripts"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--network", choices=NETS, default="testnet")
    p.add_argument("--signer", required=True)
    p.add_argument("--wasm", help="local wasm whose sha256 must equal the attested wasm_hash")
    p.add_argument("tx")
    a = p.parse_args()
    rpc, api, contract = NETS[a.network]

    tx = get(rpc, {"jsonrpc": "2.0", "id": 1, "method": "EXPERIMENTAL_tx_status",
                   "params": {"tx_hash": a.tx, "sender_account_id": a.signer, "wait_until": "FINAL"}})["result"]

    request_id, output = None, None
    for o in tx["receipts_outcome"]:
        for log in o["outcome"]["logs"]:
            if log.startswith("EVENT_JSON:") and '"execution_requested"' in log:
                data = json.loads(json.loads(log[len("EVENT_JSON:"):])["data"][0]["request_data"])
                request_id = data["request_id"]
        value = o["outcome"]["status"].get("SuccessValue")
        if o["outcome"]["executor_id"] == contract and value:
            output = base64.b64decode(value)
    if request_id is None or output is None:
        sys.exit("no OutLayer request or output in this transaction")

    att = get(f"{api}/attestations/by-request/{request_id}")
    out_sha = hashlib.sha256(output).hexdigest()
    checks = {"output_hash matches": att.get("output_hash") == out_sha}
    if a.wasm:
        local = hashlib.sha256(open(a.wasm, "rb").read()).hexdigest()
        checks["wasm_hash matches local build"] = att.get("wasm_hash") == local == att.get("executed_wasm_sha256")

    print(json.dumps({
        "request_id": request_id,
        "output": output.decode("utf-8", "replace"),
        "output_bytes": len(output),
        "output_sha256": out_sha,
        "attestation": {k: att.get(k) for k in ("task_id", "wasm_hash", "executed_wasm_sha256", "input_hash", "output_hash", "caller_account_id", "project_id")},
        "checks": checks,
    }, indent=2))
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == "__main__":
    main()
