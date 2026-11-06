// Canonical JSON, byte-for-byte the same as enclave/src/canonical.rs:
// object keys sorted by UTF-16 code unit order (identical to byte order for ASCII), no
// whitespace, integers only, ASCII strings only.

export function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`canonical JSON allows safe integers only, got ${value}`);
    return String(value);
  }
  if (typeof value === "string") {
    if (!/^[\x00-\x7f]*$/.test(value)) throw new Error("canonical JSON allows ASCII strings only");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${canonical(k)}:${canonical(v)}`).join(",")}}`;
  }
  throw new Error(`canonical JSON can't encode ${typeof value}`);
}
