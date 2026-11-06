// P0 placeholder so the Railway URL exists from day 0 (test T0.7). Replaced in P5.
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3000);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prove-It</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f7f5; --fg: #16181d; --muted: #5b6070; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e1014; --fg: #eceef2; --muted: #9aa0ad; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.5 system-ui, sans-serif; padding: 0 16px; }
  main { max-width: 34rem; }
  p { color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Prove-It</h1>
  <p>Verifiable private track records on NEAR. Under construction for NEAR HACKATHON 2026.</p>
</main>
</body>
</html>`;

http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page);
  })
  .listen(PORT, () => console.log(`placeholder listening on :${PORT}`));
