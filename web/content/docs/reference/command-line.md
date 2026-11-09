---
description: "Verifying cards from a terminal."
---

# Command line

Needs Node 22+ and pnpm. Nothing here needs a wallet.

```bash
git clone https://github.com/christian-obi/proveit && cd proveit
pnpm i
pnpm demo                # verifies a real card, then an edited copy that fails
pnpm verify https://proveit-production-d47c.up.railway.app/demo/3
pnpm agent-guard https://proveit-production-d47c.up.railway.app/demo/3 --allow-demo --max-dd 70
```

`pnpm agent-guard` accepts `--min-trades N`, `--max-dd PCT`, `--min-days N`, `--allow-demo`, `--allow-warnings`, `--tamper field=value` and `--json`.

| Exit code | `verify` | `agent-guard` |
|---|---|---|
| 0 | No check failed | Follow |
| 1 | A check failed | Refuse, with reasons |
| 2 | Bad usage | Bad usage |
