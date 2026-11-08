// Small byte helpers that work the same in browsers and Node.

export const utf8 = (s: string) => new TextEncoder().encode(s);

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function unhex(s: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(s)) throw new Error("not a hex string");
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
