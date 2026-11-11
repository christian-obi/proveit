#!/usr/bin/env python3
"""Leak check: does a secret appear anywhere in a set of NEAR transactions?

Pulls each transaction with every receipt, argument, log and return value, also
decodes any base64 string, and searches for the needle (case-insensitive).
Exit 0 when nothing is found, 1 when something is.

  scripts/leakcheck.py --network testnet --signer proveit-realist.testnet \
      --needle 0x0000000000000000000000000000000000000001 <tx hash> [<tx hash> ...]

`--control <text>` adds a string that MUST be found, so a broken scan can't pass.
For an EVM address, the bare 40-hex form is searched too.
"""

import argparse
import base64
import json
import sys
import urllib.request

RPC = {
    "testnet": "https://archival-rpc.testnet.fastnear.com",
    "mainnet": "https://archival-rpc.mainnet.fastnear.com",
}


def fetch_tx(rpc, tx_hash, signer):
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "EXPERIMENTAL_tx_status",
        "params": {"tx_hash": tx_hash, "sender_account_id": signer, "wait_until": "FINAL"},
    }).encode()
    req = urllib.request.Request(rpc, body, {"Content-Type": "application/json", "User-Agent": "proveit-leakcheck"})
    answer = json.load(urllib.request.urlopen(req, timeout=60))
    if "error" in answer:
        sys.exit(f"{tx_hash}: {answer['error']}")
    return answer["result"]


def strings(node):
    """Every string in the response, plus the text of any that base64-decodes to UTF-8."""
    if isinstance(node, dict):
        for v in node.values():
            yield from strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v)
    elif isinstance(node, str):
        yield node
        try:
            yield base64.b64decode(node, validate=True).decode("utf-8")
        except Exception:
            pass


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--network", choices=RPC, default="testnet")
    p.add_argument("--signer", required=True)
    p.add_argument("--needle", action="append", required=True)
    p.add_argument("--control", action="append", default=[])
    p.add_argument("tx", nargs="+")
    a = p.parse_args()

    needles = set()
    for n in a.needle:
        needles.add(n.lower())
        if n.lower().startswith("0x") and len(n) == 42:
            needles.add(n.lower()[2:])

    found = 0
    blobs = []
    for h in a.tx:
        blob = "\n".join(strings(fetch_tx(RPC[a.network], h, a.signer))).lower()
        blobs.append(blob)
        hits = {n: blob.count(n) for n in sorted(needles)}
        found += sum(hits.values())
        # Counts only: the needle is the private address, so it is never printed.
        print(f"{h}: " + ", ".join(f"needle {i + 1}: {n}" for i, n in enumerate(hits.values())))

    for c in a.control:
        n = sum(b.count(c.lower()) for b in blobs)
        print(f"control {c!r}: {n} hit(s)")
        if n == 0:
            sys.exit("control string not found: the scan is not reading what it should")

    print("PASS: no needle found" if found == 0 else f"FAIL: {found} hit(s)")
    sys.exit(0 if found == 0 else 1)


if __name__ == "__main__":
    main()
