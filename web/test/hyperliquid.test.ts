// Signatures must match the official hyperliquid-python-sdk (tests/signing_test.py).

import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { actionHash, cloidFor, msgpack, orderAction, roundSize, signL1Action, wirePrice, wireSize } from "@/lib/hyperliquid";

const KEY = "0x0123456789012345678901234567890123456789012345678901234567890123";
const wallet = privateKeyToAccount(KEY);
const same = (a: string, b: string) => expect(BigInt(a)).toBe(BigInt(b));
const eth = { asset: 1, isBuy: true, price: "100", size: "100", reduceOnly: false, tif: "Gtc" as const };

describe("signing matches the official SDK", () => {
  it("phantom agent hash", () => {
    const order = orderAction({ asset: 4, isBuy: true, price: "1670.1", size: "0.0147", reduceOnly: false, tif: "Ioc" });
    expect(actionHash(order, 1677777606040)).toBe("0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908");
  });

  it("dummy action, mainnet and testnet", async () => {
    const action = { type: "dummy", num: 100000000000 };
    const main = await signL1Action(wallet, action, 0, "mainnet");
    same(main.r, "0x53749d5b30552aeb2fca34b530185976545bb22d0b3ce6f62e31be961a59298");
    same(main.s, "0x755c40ba9bf05223521753995abb2f73ab3229be8ec921f350cb447e384d8ed8");
    expect(main.v).toBe(27);
    const test = await signL1Action(wallet, action, 0, "testnet");
    same(test.r, "0x542af61ef1f429707e3c76c5293c80d01f74ef853e34b76efffcb57e574f9510");
    same(test.s, "0x17b8b32f086e8cdede991f1e2c529f5dd5297cbe8128500e00cbaf766204a613");
    expect(test.v).toBe(28);
  });

  it("order", async () => {
    const main = await signL1Action(wallet, orderAction(eth), 0, "mainnet");
    same(main.r, "0xd65369825a9df5d80099e513cce430311d7d26ddf477f5b3a33d2806b100d78e");
    same(main.s, "0x2b54116ff64054968aa237c20ca9ff68000f977c93289157748a3162b6ea940e");
    expect(main.v).toBe(28);
    const test = await signL1Action(wallet, orderAction(eth), 0, "testnet");
    same(test.r, "0x82b2ba28e76b3d761093aaded1b1cdad4960b3af30212b343fb2e6cdfa4e3d54");
    expect(test.v).toBe(27);
  });

  it("order with a client id", async () => {
    const action = orderAction({ ...eth, cloid: "0x00000000000000000000000000000001" });
    const main = await signL1Action(wallet, action, 0, "mainnet");
    same(main.r, "0x41ae18e8239a56cacbc5dad94d45d0b747e5da11ad564077fcac71277a946e3");
    same(main.s, "0x3c61f667e747404fe7eea8f90ab0e76cc12ce60270438b2058324681a00116da");
    expect(main.v).toBe(27);
    const test = await signL1Action(wallet, action, 0, "testnet");
    same(test.r, "0xeba0664bed2676fc4e5a743bf89e5c7501aa6d870bdb9446e122c9466c5cd16d");
    expect(test.v).toBe(28);
  });

  it("an agent's signature recovers to the agent", async () => {
    const typed = { domain: { chainId: 1337, name: "Exchange", verifyingContract: "0x0000000000000000000000000000000000000000", version: "1" }, types: { T: [{ name: "x", type: "string" }] }, primaryType: "T", message: { x: "y" } } as const;
    expect(await recoverTypedDataAddress({ ...typed, signature: await wallet.signTypedData(typed) })).toBe(wallet.address);
  });
});

describe("wire formats", () => {
  it("encodes the smallest MessagePack form", () => {
    expect([...msgpack(127)]).toEqual([127]);
    expect([...msgpack(128)]).toEqual([0xcc, 128]);
    expect([...msgpack(70000)]).toEqual([0xce, 0, 1, 0x11, 0x70]);
    expect([...msgpack({ a: true })]).toEqual([0x81, 0xa1, 0x61, 0xc3]);
  });
  it("prices have 5 significant figures and no trailing zeros", () => {
    expect(wirePrice(1234.5678, 2)).toBe("1234.6");
    expect(wirePrice(100, 2)).toBe("100");
    expect(wirePrice(0.012345678, 0)).toBe("0.012346");
    expect(wirePrice(0.000012345678, 0)).toBe("0.000012");
    expect(wirePrice(98765.4, 5)).toBe("98765");
  });
  it("sizes round down to the lot", () => {
    expect(roundSize(1.2399, 2)).toBe(1.23);
    expect(roundSize(0.29, 2)).toBe(0.29);
    expect(wireSize(1.5, 3)).toBe("1.5");
    expect(wireSize(2, 0)).toBe("2");
  });
  it("the client id is stable and 128 bits", () => {
    expect(cloidFor("abc", 1)).toBe(cloidFor("abc", 1));
    expect(cloidFor("abc", 1)).not.toBe(cloidFor("abc", 2));
    expect(cloidFor("abc", 1)).toMatch(/^0x[0-9a-f]{32}$/);
  });
});
