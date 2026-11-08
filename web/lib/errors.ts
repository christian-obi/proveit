// What each refusal means for the trader. Codes come from the enclave (enclave/src/error.rs)
// and the registry (contract/src/lib.rs).

const MESSAGES: Record<string, string> = {
  CARD_NOT_FOUND: "This card was issued by an older enclave build that didn't keep its trades for viewing keys. The trader can refresh it to sell keys.",
  TOO_FEW_TRADES: "This account doesn't have 20 trades in the window yet. Trade a bit more, or pick a shorter window.",
  WINDOW_TOO_SHORT: "This account didn't hold capital for the whole window. Pick a shorter window.",
  ACCOUNT_TOO_NEW: "This account is newer than the window you picked. Pick a shorter window.",
  FILL_CAP_EXCEEDED: "Hyperliquid only serves the 10,000 most recent fills, and this window has more. Pick a shorter window.",
  SIG_INVALID: "The signature wasn't made by this Hyperliquid account's wallet. Sign again with the right wallet.",
  SIG_EXPIRED: "The signature expired. Sign again.",
  NEAR_ACCOUNT_MISMATCH: "The signature names a different NEAR account. Sign again while connected with the right NEAR account.",
  NO_DATA: "Hyperliquid has no history for this account.",
  UPSTREAM: "Hyperliquid or OutLayer didn't answer properly. Try again in a minute.",
  BAD_INPUT: "The request was malformed. Reload the page and try again.",
  NONCE_REUSED: "This signature was already used for a card. Sign again.",
  WRONG_ISSUER: "The card names a different issuer. Reload and try again.",
  FIXTURE_REFUSED: "This registry only accepts live cards.",
  OUTLAYER_FAILED: "OutLayer rejected the request. Your deposit was refunded.",
  NO_KEY: "The registry isn't set up yet (no enclave key).",
};

export function explain(code: string, message: string): string {
  return MESSAGES[code] ?? `${code}: ${message}`;
}
