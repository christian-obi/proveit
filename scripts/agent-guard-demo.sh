#!/usr/bin/env bash
# T9.4: the agent guard's demo log (docs/agent-guard-demo.log). An AI agent about to copy a
# trader asks the guard first: a verified card within its policy → FOLLOW (exit 0); the same
# card handed over with an inflated return → REFUSE (exit 1); a card outside the policy → REFUSE.
#
#   CARD_URL=https://<app>/demo/<id> scripts/agent-guard-demo.sh

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${CARD_URL:?set CARD_URL to a card link}"
LOG="$ROOT/docs/agent-guard-demo.log"
guard() { node "$ROOT/packages/verify/bin/agent-guard.ts" "$@"; }

{
  echo "# agent-guard demo, $(date -u +%Y-%m-%dT%H:%MZ), card $URL"
  echo
  echo "## 1. A verified card, policy: demo cards allowed (it's testnet), max drawdown 70%"
  guard "$URL" --allow-demo --max-dd 70; echo "exit $?"
  echo
  echo "## 2. The same card, handed to the agent with the return edited to +90%"
  guard "$URL" --allow-demo --max-dd 70 --tamper return_bps=9000; echo "exit $?"
  echo
  echo "## 3. The real card against the default policy (max drawdown 30%, live cards only)"
  guard "$URL"; echo "exit $?"
} 2>&1 | tee "$LOG"
