// P0 spike S6: find out whether a near.com confidential-perps "dedicated" Hyperliquid
// account is a Chain Signatures address, and if so, which predecessor + path derive it.
//
// Usage:
//   node match.mjs --hl 0xDEDICATED_ADDR --user alice.near [--predecessor perps.near ...] [--path extra-path ...]
//
// It derives EVM addresses for every (predecessor, path) candidate from the MPC root key
// and reports any that equal the dedicated Hyperliquid address.

import { secp256k1 } from "@noble/curves/secp256k1";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { base58 } from "@scure/base";

const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.fastnear.com";
const SIGNER = process.env.MPC_SIGNER ?? "v1.signer";
// Prefix the MPC contract hashes with the predecessor and path to get the derivation tweak.
const EPSILON_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";

function parseArgs(argv) {
  const out = { hl: null, user: null, predecessors: [], paths: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === "--hl") out.hl = value.toLowerCase();
    else if (flag === "--user") out.user = value;
    else if (flag === "--predecessor") out.predecessors.push(value);
    else if (flag === "--path") out.paths.push(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!out.hl || !/^0x[0-9a-f]{40}$/.test(out.hl)) throw new Error("--hl must be a 0x EVM address");
  if (!out.user) throw new Error("--user (the near.com NEAR account) is required");
  return out;
}

async function view(method, args) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: SIGNER,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = await res.json();
  if (body.error || body.result?.error) {
    throw new Error(`${method}: ${JSON.stringify(body.error ?? body.result.error)}`);
  }
  return JSON.parse(Buffer.from(body.result.result).toString());
}

// "secp256k1:<base58 of 64 bytes x||y>" -> curve point
function parseNearSecpKey(key) {
  const [curve, data] = key.split(":");
  if (curve !== "secp256k1") throw new Error(`unexpected key type ${curve}`);
  const xy = base58.decode(data);
  return secp256k1.ProjectivePoint.fromHex(bytesToHex(new Uint8Array([4, ...xy])));
}

function deriveLocal(root, predecessor, path) {
  const tweak = BigInt("0x" + bytesToHex(sha3_256(`${EPSILON_PREFIX}${predecessor},${path}`)));
  return root.add(secp256k1.ProjectivePoint.BASE.multiply(tweak % secp256k1.CURVE.n));
}

function evmAddress(point) {
  const uncompressed = point.toRawBytes(false).slice(1);
  return "0x" + bytesToHex(keccak_256(uncompressed).slice(-20));
}

function candidatePaths(user, extra) {
  const bases = ["ethereum-1", "ethereum", "evm", "eth", "hyperliquid", "hyperliquid-1", "hl", "perps", "perp", "trading", "near.com"];
  const withUser = bases.flatMap((b) => [`${b},${user}`, `${b}-${user}`, `${b}/${user}`, `${user},${b}`, `${user}-${b}`, `${user}/${b}`]);
  return [...new Set([...bases, user, ...withUser, ...extra, ""])];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = parseNearSecpKey(await view("public_key", {}));

  // Trust the local formula only if it reproduces the contract's own derivation.
  const probe = { predecessor: args.user, path: "ethereum-1" };
  const official = parseNearSecpKey(await view("derived_public_key", probe));
  const local = deriveLocal(root, probe.predecessor, probe.path);
  if (!official.equals(local)) {
    throw new Error("local derivation does not match v1.signer.derived_public_key; the epsilon formula changed, so results would be meaningless");
  }
  console.log("✔ local derivation matches v1.signer.derived_public_key");

  const predecessors = [args.user, ...args.predecessors];
  const paths = candidatePaths(args.user, args.paths);
  let tried = 0;
  const matches = [];
  for (const predecessor of predecessors) {
    for (const path of paths) {
      tried++;
      if (evmAddress(deriveLocal(root, predecessor, path)) === args.hl) matches.push({ predecessor, path });
    }
  }

  console.log(`tried ${tried} candidates (${predecessors.length} predecessors × ${paths.length} paths)`);
  if (matches.length === 0) {
    console.log("✘ no match: either near.com uses another predecessor/path, or the account is not a Chain Signatures address");
    process.exitCode = 1;
    return;
  }
  for (const m of matches) {
    console.log(`✔ MATCH predecessor=${m.predecessor} path=${JSON.stringify(m.path)}`);
    // Confirm with the contract so the result does not rest on our local formula.
    const confirmed = evmAddress(parseNearSecpKey(await view("derived_public_key", m))) === args.hl;
    console.log(confirmed ? "  ✔ confirmed by v1.signer.derived_public_key" : "  ✘ contract disagrees; investigate");
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 2;
});
