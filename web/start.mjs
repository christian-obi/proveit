// Production entry point. Runs `next start` and turns a requested stop (SIGTERM from Railway
// when it replaces a deployment, or SIGINT) into a clean exit 0. Without this, the stop
// surfaced as a failure (pnpm's ELIFECYCLE, then Next's exit code 143) and Railway reported
// every replaced deployment as crashed. A real crash still exits non-zero.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const next = spawn(process.execPath, [join(here, "node_modules/next/dist/bin/next"), "start"], { cwd: here, stdio: "inherit" });

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    next.kill(signal);
  });
}

next.on("exit", (code) => process.exit(stopping ? 0 : (code ?? 1)));
