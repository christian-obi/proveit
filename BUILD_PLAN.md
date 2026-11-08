# Prove-It — Build Plan (NEAR HACKATHON, Nov 2026)

Written 2026-11-03 (hackathon day 3 of 14). Source spec: `Prove-It Verifiable Private Track Records.md`.

> **Deadline:** Sat **14 Nov 2026, 23:59 UTC** (public repo + public X demo post + form). Internal freeze: **14 Nov 12:00 UTC**.
> **Judging:** 16–18 Nov. Claude Code and Codex screen every entry first: they check that it runs and does what the README says. Then human judges decide.
> **Prizes:** $55K grand prize (one winner overall); $10K / $3K / $2K for 1st/2nd/3rd in each of 13 tracks. One project may enter several tracks.

---

## 0. TL;DR — the winning thesis

1. **Ship one honest loop that works end to end on mainnet:** a trader proves ownership of a Hyperliquid account → an OutLayer TDX enclave computes stats → the registry contract on NEAR records a signed card → anyone verifies it in one click → a follower pays from another chain through 1Click and unlocks delayed trades.
2. **Win the 10-second moment:** a fake screenshot next to a real card. Click Verify and it goes green. Edit one digit and it goes red, live in the browser.
3. **Be better than the spec on trust:** research found three gaps in the original design (§1). Fixing them visibly (no API keys at all, k-anonymity against the public leaderboard, Merkle-committed viewing keys) is what separates us from FlexProver-style clones in front of judges like Mert, Haseeb, Kain and Illia.
4. **Make the AI screeners' job trivial:** a README with "do X, see Y" steps, a pre-issued mainnet card, `pnpm verify <card-url>` working with no wallet, golden-file tests, and a reproducible enclave build hash.
5. **Build the product Illia described** (his post: *"private trading where you sell your viewing keys for people to follow/copy trade … PnL can be publicly displayed so people can choose to buy in"*): verified public PnL cards, viewing keys sold with seats, expiry and an optional live delay, a copy-trade feed, a discovery page, and NEAR Intents confidential trading as a venue once 1Click history access is granted (F12).
6. **Tracks:** **Privacy & Private AI** (primary), **Unstoppable DeFi**, **AI Security & Defense** (reputation for AI trading agents plus a verification API). All three are eligible for the grand prize.

---

## 1. Research findings that change the spec

| # | Spec assumption | What research found | Change to the plan |
|---|---|---|---|
| F1 | "Create a **read-only API key** on Hyperliquid" | Hyperliquid has **no read-only keys**. Account data (`userFills`, `portfolio`, `clearinghouseState`, ledger) is **public and needs no auth, by address**. API/agent wallets can *trade*. | **Drop API keys entirely.** The trader proves ownership with an **EIP-712 signature** from the account's wallet. The enclave verifies it (`k256` ecrecover) and then reads public data. No key can leak, so "API key leakage" leaves the risk table. |
| F2 | "Positions stay hidden" | Hyperliquid trades are public. What is private is the **link from wallet to person**. The public leaderboard (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`, **~48K accounts**, ROI and PnL per day/week/month/allTime) can **fingerprint a card's exact stats back to the wallet**. Our measurement: a 30-day ROI matched to ±0.5pp still leaves ~86–200 candidates, but exact values plus trade count would narrow it to one. | Add a **k-anonymity guard inside the enclave**: it counts the leaderboard accounts consistent with the published (rounded) stats and coarsens the rounding until k ≥ 25. The card shows **"1 of ≥ K accounts"**. This is novel and very demo-able. |
| F3 | Confidential perps are a "future data source" | NEAR confidential perps (live 17 Sep 2026, cross-margin 22 Oct) give each user a **dedicated Hyperliquid account**. Deposits are confidential, but trades sit on Hyperliquid's public book. So **the data path already exists**. Only ownership proof is missing, because near.com users sign with passkeys and may not hold the Hyperliquid key. | Move confidential perps from roadmap to a **stretch demo**: a **"control challenge"** ownership proof (place a tiny order of an enclave-chosen exact size; the enclave checks it in public order history). Spike S6 (§5, T0.8) checks whether the dedicated account is a Chain Signatures address, which would allow a trustless ownership proof. |
| F4 | "Paste key into the enclave's sealed input" | OutLayer **HTTPS mode sends plaintext input through the coordinator, which is closed source**. On-chain `input_data` is **public**. | The trader's address and signature travel as an **OutLayer encrypted secret** (ECIES: X25519 + HKDF-SHA256 + ChaCha20-Poly1305, format v1), stored by the trader and referenced via `secrets_ref`. Only the TEE decrypts it. |
| F5 | "Contract checks the code hash is on an allow-list" | OutLayer gives us better primitives: **`outlayer:signing-keys`** (ed25519 key derived in TEE, bound to project and caller), **`outlayer:encryption-keys` `mac`** (keyed HMAC), a manifest embedded in the wasm and covered by its hash, and **`callers.contract.only`**. | Only the registry can issue cards: the enclave checks in code that `issue` arrives on-chain from the registry (§4.1; a manifest `callers` block can't also admit the HTTPS feed), and the registry pins `version_key`. The key's `caller: "predecessor"` makes **one card-signing key that belongs to the registry**. The registry learns its public key **from the enclave itself** (`bootstrap_key`). |
| F6 | "Attestation proves code and inputs" | Confirmed live: `GET https://api.outlayer.ai/attestations/{task_id}` returns `tdx_quote`, `wasm_hash`, `input_hash`, `output_hash`, `caller_account_id`, `project_id`, `timestamp`. Workers' keys are registered on-chain only after `register-contract` verifies a TDX quote with `dcap-qvl` and all 5 measurements. | The verify page **re-hashes the card output in the browser** and compares it with `output_hash`, checks `wasm_hash` against approved versions, and deep-links to OutLayer's DCAP view. |
| F7 | Account commitment = "salted hash" | A public salt is brute-forceable, because the set of Hyperliquid addresses is enumerable from the leaderboard. | Commitment = **`mac("commit", address)`** with an enclave-only derived key, so it cannot be brute-forced. It is stable across code versions because the key is project-bound. |
| F8 | Viewing keys "unlock trades" | Revealed exact trades (time, price, size, hash) can be matched to public Hyperliquid data and **reveal the wallet to the buyer**. | Reveal **coarsened records**: hour bucket, size as % of equity, no hashes or IDs. Each one is **Merkle-proven against `fills_root` committed in the card at issuance**, so the follower can audit that nothing was cherry-picked. |
| F9 | Pay via 1Click | Confirmed: 1Click `/v0/quote` supports **`appFees`** (our platform fee), **`recipientType: CONFIDENTIAL_INTENTS`** (the trader is paid privately) and `customRecipientMsg` (`ft_transfer_call` into a contract; marked experimental). It is **mainnet-only**. | Deploy everything on **mainnet** (OutLayer mainnet is live: one worker has ~36K completed tasks). Develop on testnet where possible. |
| F10 | Competition | **FlexProver** (ETHGlobal Cannes 2026, Flare TEE, 2nd in its track) encrypts CEX API keys to a TEE. **Obscura** (Horizen) uses ZK and commits to all trades in a window. **Illia "viewing keys"**: no primary source found. Treat it as "another team may pitch close". | Our differentiators: **no keys at all**, **k-anon guard**, **Merkle-committed delayed reveal**, **cross-chain paid unlock**, **confidential-perps path**, **on-chain `verify_card` callable by other contracts**. |
| F12 | Illia's post (Nov 2026): a social trading app on NEAR Intents confidential trading where traders sell viewing keys so select people can follow or copy trade, with PnL publicly displayed | 1Click has an authenticated account API: `POST /v0/auth/authenticate` (signed `MultiPayload`) returns access and refresh tokens; `GET /v0/account/history` returns **public and confidential** history (status, assets, amounts, USD values) and `GET /v0/account/balances` returns private balances. History is **"invite-only for now"**. | Add (a) viewing keys built for copy trading: delay down to 0 (live), expiry, seat cap, optional approval; (b) a live copy-trade feed with a "Copy" button that builds the same swap via 1Click; (c) `/explore` discovery; (d) **NEAR Intents (confidential) as a second venue**, gated on history access (spike S7). Quote-reply to Illia's post with the demo. |
| F11 | Judging | Claude Code and Codex check that the project runs and does what the README claims. The README must disclose any pre-hackathon code (none) and AI-generated code, list the NEAR protocols used, include a LICENSE, and have the repo public before the deadline. The demo post must say "built at NEAR HACKATHON", tag @NEARProtocol and use #NEARHackathon. | §9 and §10 are written for the screeners. |

---

## 2. Strategy: tracks, judges, positioning

**Tracks to enter (all three on one submission):**

| Track | Our angle | What we must show |
|---|---|---|
| **Privacy & Private AI** (primary) | Selective proof: a TEE computes the stats, the wallet stays unlinkable, the leaderboard k-anon guard. Optional AI style summary on NEAR AI Cloud. | TEE attestation verified live, an explicit privacy budget, a written threat model |
| **Unstoppable DeFi** | Reputation layer for perps and copy-trading. Paid unlocks through **NEAR Intents 1Click**, any token from any chain, with `appFees`. | A real cross-chain payment on mainnet; REFUNDED and FAILED handled in the UI |
| **AI Security & Defense** | "Reputation systems / scam detection": **Agent cards** for AI trading agents, plus `verify_card` and an HTTP verify API that agents call before copying a trader or allocating to one. | A small agent-side script that refuses to follow an unverified or red card (the demo log) |

**Judges and what each will probe:**

- **Illia (NEAR):** confidential perps narrative, Intents, OutLayer. Lead the story with "privacy needs reputation".
- **Kain (Synthetix/Infinex):** a perps trader. Stats must be *correct*: deposit-adjusted returns, drawdown on the equity curve, no cherry-picking.
- **Mert (Helius) and Haseeb (Dragonfly):** will attack the trust model. Answer them upfront with a "What exactly is proven / what is not" table and the k-anon guard.
- **Eddy (a16z), Avichal (Electric), Stepan (cyber•Fund):** business and moat. Growth loop, verification API, viewing-key marketplace fee via `appFees`.

**One-liner:** *"Screenshots can be faked. Prove-It cards can't, and they still keep your wallet private."*

---

## 3. Final architecture

```
                         ISSUE (trader)                                         CONSUME (follower / agent)
 ┌──────────────┐  EIP-712 sig   ┌───────────────────────┐            ┌─────────────────────────────┐
 │ Trader       │───────────────▶│ Web app on Railway    │            │ Card page /c/[id] + OG image │
 │ EVM wallet + │  NEAR login    │ - ECIES-encrypt       │            │ Verify page (5 checks)       │
 │ NEAR wallet  │───────────────▶│   {addr,sig,nonce}    │            │ Unlock (1Click any chain)    │
 └──────────────┘                └───┬───────────┬───────┘            └───────┬──────────┬──────────┘
                tx1 store_secrets    │           │ tx2 request_card            │ view     │ pay
                        ┌────────────▼──┐   ┌────▼──────────────────┐          │          ▼
                        │ outlayer.near │◀──│ proveit registry      │◀─────────┘   ┌───────────────┐
                        │ (secrets +    │   │ (near-sdk 5)          │  ft_on_      │ 1Click API    │
                        │  yield/resume)│──▶│ cards, versions,      │◀─transfer────│ (Intents)     │
                        └──────┬────────┘   │ grants, verify_card   │              └───────────────┘
                               │ task       └───────────────────────┘
                        ┌──────▼─────────────────────────────────────┐   public, no auth
                        │ OutLayer TDX worker → proveit-enclave.wasm │──────────────▶ api.hyperliquid.xyz/info
                        │ verify ownership → fetch → stats → k-anon  │──────────────▶ stats-data…/leaderboard
                        │ → mac(commit) → merkle(fills) → sign(card) │
                        └──────┬─────────────────────────────────────┘
                               └─▶ attestation: api.outlayer.ai/attestations/{task_id}
```

**Rule:** raw fills and the Hyperliquid address exist only inside the enclave (and in OutLayer worker storage, encrypted, readable only by Prove-It code). NEAR holds hashes, commitments, rounded stats, signatures and grants.

### 3.1 What is proven, and what is not (put this in the README)

| Claim | Proven by |
|---|---|
| These stats were computed by open-source code with hash H | the version pinned by the registry + OutLayer `wasm_hash` in the attestation + reproducible build |
| …on the Hyperliquid account the issuer controls | EIP-712 ownership signature, verified inside the TEE and bound to the NEAR signer and a nonce |
| …over window W, from Hyperliquid's own public API | code + attestation (the host is hard-coded; the network allowlist is in the manifest) |
| The card was not edited after issuance | ed25519 signature by the registry-bound enclave key + on-chain `card_hash` |
| The same account produced all of an issuer's cards | `commitment` (MAC) repeats across cards; the profile page lists every card |
| Revealed trades are the full committed set | Merkle proofs against `fills_root` + revealed count == committed count |
| A key holder's live feed is complete | each record extends a per-card hash chain signed by the enclave key; every follower sees the same chain head |
| **Not proven:** the trader has no *other* accounts | Mitigated with account-age and inception-to-date options and a visible profile. Stated openly as an open problem. |
| **Trust assumptions** | Intel TDX hardware, OutLayer worker measurements and keystore/MPC, Hyperliquid API honesty |

---

## 4. Component specs

### 4.1 Enclave — `enclave/` (Rust, `wasm32-wasip2`, OutLayer project `proveit.near/enclave`)

**Manifest (`enclave/manifest.json`, embedded in the `outlayer.manifest` custom section):**
```jsonc
{
  "display": { "name": "Prove-It enclave", "author": "proveit.near" },
  "operations": ["pubkey", "issue", "reveal"],
  "capabilities": { "network": ["api.hyperliquid.xyz", "stats-data.hyperliquid.xyz", "rpc.mainnet.fastnear.com"] },
  "signing_keys":   [{ "path": "cards",  "type": "ed25519", "bind": "project", "caller": "predecessor" }],
  "encryption_keys":[{ "path": "commit", "bind": "project", "caller": "predecessor" }],
  "storage_account": "predecessor"
}
```
- **No `callers` block, by design.** The live feed (P8) needs HTTPS runs, and a `callers` block cannot combine `contract.only` with an HTTPS door (the worker refuses to parse it). Instead the enclave enforces the door in code from platform-set env vars, which the caller cannot forge: `issue` and `pubkey` run only when `OUTLAYER_EXECUTION_TYPE == "NEAR"` and `NEAR_PREDECESSOR_ID == registry`; `feed` and `reveal` also accept HTTPS. The `cards` key is bound to the caller (`predecessor`), so a run through any other door gets a different key and its signatures fail verification anyway.
- Add `1click.chaindefuser.com` to `capabilities.network` when the Intents venue lands (P9).
- A `dev` cargo feature builds a variant with `https: "allow"` for local and HTTPS testing. It gets a different hash, so it is never approved in the registry.
- **Confirmed in source** (`worker/src/connector_manifest.rs`, `resolve_network_policy`): a declared `capabilities.network` is enforced for **any** project, connector or not: exact host match, case-insensitive, no subdomain wildcard. Without the field, egress is unrestricted, so always declare it.

**Operations (stdin JSON → stdout JSON):**

| op | Input (public, on-chain) | Secret (env, decrypted in TEE) | Output (keep < 1 KB) |
|---|---|---|---|
| `pubkey` | `{op}` | — | `{op, pubkey_ed25519}` |
| `issue` | `{op, window_days, publish:{…}, nonce, issuer}` | `PROVEIT_SECRET = {venue:"hyperliquid", address, eip712_sig, sig_nonce, sig_expiry}` | `{card, sig}` (see 4.3) |
| `reveal` | `{op, card_hash, follower, follower_x25519_pub, grant_proof}` | — (reads worker storage) | `{ciphertext}`: ECIES to the follower; contains coarsened records + Merkle proofs |
| `feed` | `{op, card_hash, follower, follower_x25519_pub, since_cursor, nep413_auth}` (over HTTPS via `/api/reveal`) | — (reads worker storage) | `{ciphertext, cursor}`: trades newer than `since_cursor` and older than `now − delay`, each signed into a per-card hash chain |
| `issue` with `venue: "intents"` (P9) | same as `issue` | `PROVEIT_SECRET = {venue:"intents", account_id, refresh_token}` | `{card, sig}` |

**`issue` pipeline (`src/`):**
1. `ownership.rs`: verify the EIP-712 typed data `ProveIt(string statement,address account,string nearAccount,uint64 nonce,uint64 expiry)` (domain `{name: "Prove-It", version: "1"}`, no chain ID so the wallet never asks for a network switch; the statement tells the trader the signature can't move funds). Require `nearAccount == NEAR_SENDER_ID`, `now < expiry ≤ now + 24 h`, a low-s signature, and the recovered address == `account`. A stretch module adds `challenge.rs` (control challenge, F3).
2. `hl.rs`: POST `https://api.hyperliquid.xyz/info`:
   - `portfolio` → **total-account** `month` / `allTime` `accountValueHistory` and `pnlHistory` (`[ts_ms, "decimal"]`). **Not `perp*`** (P1 finding: perp-only value moves on spot↔perp transfers and can sit at zero while the account trades); `allTime` also gives the account-age date, so no ledger call is needed
   - `userFillsByTime` paginated (2,000 per page, oldest first, `startTime` inclusive: each page restarts **at** the last timestamp and de-duplicates by `tid`; more than 10,000 fills → `FILL_CAP_EXCEEDED`)
3. `stats.rs` (pure, deterministic, golden-tested; use `rust_decimal`, never floats in the signed output):
   - **Return: linked Modified Dietz TWR** (P1 finding: `ΔPnL / AV_{i−1}` divides by zero at the first funding and blew up to +294,886% on a real account): `flow_i = ΔAV_i − ΔPnL_i`, `base_i = AV_{i−1} + flow_i/2`, `r_i = ΔPnL_i / base_i`, `TWR = Π(1+r_i) − 1`; measurement starts at the first sample ≥ $100 and periods with base < $100 are skipped. Full spec: `docs/METHODOLOGY.md`.
   - **Flow turnover:** Σ\|flow\| ÷ average capital, published on the card, because large flows make dollar PnL and TWR disagree (a real fixture: −8.4% TWR while +$1,323).
   - **Max drawdown:** on the index `E_i = Π_{j≤i}(1+r_j)`, `MDD = max_i (peak_i − E_i)/peak_i`.
   - **Trades:** group fills by `oid` where `dir` starts with `Close` or `closedPnl ≠ 0`. A trade's net = Σ`closedPnl` − Σ USDC `fee`. **Win rate** = trades with net > 0 / trades. Counting per order, not per fill, stops a trader inflating the trade count by splitting orders (a real fixture: 739 fills, 6 trades).
   - **Profit factor**, **active days**, **volume bucket** (log10 band, never exact).
   - Windows: 30d from `month`; 90/180d from `allTime` points inside the window (the card shows the sample count). Stretch: daily reconstruction from fills + `userFunding`.
4. `rules.rs` (anti-gaming, refuse to issue otherwise): `trades ≥ 20`; capital held for ≥ N − 1 days of an N-day window (`WINDOW_TOO_SHORT`); first funded (from `allTime`) before the window starts (`ACCOUNT_TOO_NEW`). Return, MDD and trade count are **always** published.
5. `kanon.rs`: stream-parse the leaderboard (~40 MB; **spike S4** checks memory and time limits). Count accounts whose `month.roi` falls in the card's published return bucket. Coarsen the precision from 0.1% → 1% → 5% → named band until `k ≥ 25`. Output `k_anon` and `precision`. Fallback if it is too heavy: run it only for 30d cards, or ship a pinned leaderboard snapshot hash in the input.
6. `commit.rs`: `commitment = hex(mac("commit", "hl:" ‖ lowercase(address)))`.
7. `merkle.rs`: leaves = `sha256(canonical(coarsened_fill))` in time order. `fills_root` plus `fills_count`.
8. `storage`: `set_worker("card:"+card_hash, {address, window, fills_root})` so reveals and refreshes work without the trader online.
9. `card.rs`: canonical JSON (sorted keys, integers in basis points) → `msg = sha256("proveit-card-v1\n" ‖ canonical)` → `sign("cards", msg)`. Include `outlayer_request_id = NEAR_REQUEST_ID` so the verify page can find the attestation.

**Reveal pipeline (built in P7, `enclave/src/reveal.rs`):** the registry checks the grant itself and passes the key's delay in its own call (`request_reveal`), so the on-chain door is enough. `issue` stores the coarsened order records, each order's last-fill time and the newest salt in encrypted worker storage; a reveal loads them, re-checks them against the card's root, and never calls Hyperliquid (its rolling account-value windows would change the records). It shows the oldest-first prefix of orders whose last fill is at least `delay` old (an order exactly `delay` old is shown), with a prefix proof of at most ⌈log2 n⌉ hashes, and ECIES-encrypts it to `follower_x25519_pub` (X25519 + HKDF-SHA256 "proveit-reveal-v1" + ChaCha20-Poly1305). **Leaves are salted** (`sha256(0x00 ‖ salt_i ‖ record)`, `salt_{i-1} = sha256("proveit-salt-v1" ‖ salt_i)`): a record has little entropy, so an unsalted sibling hash of a still-hidden order could be brute-forced; a reveal hands over only the salt of its last shown order. The ciphertext comes back in the follower's transaction result, never in contract state. Reveals over HTTPS (with a NEP-413-signed follower and an RPC grant check) come with the feed in P8. **Output size (confirmed in source, `worker/src/near_client.rs`):** results under 1,024 bytes resolve in one call; larger ones use `submit_execution_output_and_resolve` (stored in `outlayer.near` state, then resumed). There is no fixed contract cap; the worker caps stdout at 10 MiB, and NEAR's transaction-argument limit (about 4 MiB) and gas are the practical bounds. **Confirmed live (T0.6):** 16 KB arrived intact in 11 blocks at 0.00104 NEAR, the same as 850 B, so one-off reveals stay on-chain. The HTTPS proxy (`/api/reveal` on the Railway `web` service, §4.8) stays as a fallback if those costs are too high; its output stays encrypted to the follower, so the proxy learns nothing.

**Feed pipeline (copy trading, P8):** the follower signs a NEP-413 message once per session; `/api/reveal` forwards it with their ephemeral X25519 key. The enclave verifies the NEP-413 signature, reads the grant from the registry over RPC (exists, not expired), fetches trades newer than `since_cursor` and older than `now − delay` (delay 0 = live), coarsens them the same way, and appends each to the card's **hash chain** (`head_n = sha256(head_{n−1} ‖ record)`, head kept in worker storage and signed with `cards`). A follower who sees the same chain head as everyone else knows no trade was dropped for them. Records issued after the card are proven by the signed chain, not by `fills_root`.

**Intents venue (P9, gated on S7):** ownership is the 1Click login itself: the trader signs 1Click's `MultiPayload` in the browser, and only the resulting refresh token goes into `PROVEIT_SECRET`. The enclave calls `/v0/auth/refresh`, then `/v0/account/history` and `/v0/account/balances`. Stats: realized PnL per completed swap from `amountInUsd` / `amountOutUsd`, unrealized PnL on current balances at `/v0/tokens` prices, return on average capital, max drawdown on the daily equity series, win rate per closed position. Commitment = `mac("commit", "intents:" ‖ account_id)`. S7 must confirm the session token cannot move funds before any real user's token goes in.

**Tests:** `cargo test` with recorded Hyperliquid fixtures (`enclave/fixtures/*.json`) → golden `expected_card.json`. Property tests: TWR is invariant to injected deposits; MDD lies in [0, 1].

**Build:** `enclave/build.sh` runs in a pinned Docker image (`rust:1.85` + `wasm32-wasip2`) and prints sha256. The README publishes the hash; CI rebuilds and diffs it.

### 4.2 Registry contract — `contract/` (near-sdk 5.x, `cargo near build`)

**State**
```rust
owner: AccountId, outlayer: AccountId,                 // outlayer.near
enclave_project: String, approved_versions: IterableSet<String>, active_version: String,
card_pubkey: Option<[u8; 32]>,                         // learned from the enclave via bootstrap
cards: IterableMap<u64, Card>, card_by_hash: LookupMap<[u8;32], u64>,
by_issuer: LookupMap<AccountId, Vec<u64>>, by_commitment: LookupMap<String, Vec<u64>>,
pending: LookupMap<u64, Pending>,                      // request nonce → issuer, window
offers: LookupMap<u64, Offer { price_usdc: U128, delay_secs: u64 /*0 = live*/, duration_secs: u64, max_seats: u32,
                                 requires_approval: bool, payout: PayoutTarget }>,
grants: LookupMap<(u64, AccountId), Grant { granted_at: u64, expires_at: u64 }>,
seats_used: LookupMap<u64, u32>, pending_approvals: LookupMap<(u64, AccountId), U128 /*escrowed payment*/>,
balances: LookupMap<AccountId, U128>, fee_bps: u16, usdc: AccountId
```
`Card { hash, card_json, sig, issuer, commitment, version, request_id, issued_at, window_end, revoked }`

**Methods**

| Method | Who | Notes |
|---|---|---|
| `bootstrap_key()` | owner | Calls the enclave `pubkey` op → `on_pubkey` stores `card_pubkey`. Emits an event so anyone can audit the attestation of that run. |
| `approve_version(hash)` / `retire_version` | owner | The allow-list of audited versions; events carry a GitHub release link |
| `request_card(window_days, publish, secrets_profile)` payable ≥ 0.05 NEAR | trader | Calls `outlayer.request_execution` with `{Project, version_key: active_version}`, `secrets_ref {account_id: signer, profile}`, `response_format: "Json"`, `payer_account_id: signer` |
| `on_card(#[callback_result])` | private | Parses `OutLayerResponse`; **`env::ed25519_verify(sig, msg, card_pubkey)`**; checks `issuer == pending.issuer` and `version ∈ approved`; stores the card; emits `card_issued` (NEP-297) |
| `verify_card(card_id, card_json) -> VerifyResult` | anyone / contracts | Recomputes the hash and checks signature, revocation and staleness. **The composable primitive for copy-trading contracts and agents.** |
| `get_card`, `get_cards_by_issuer`, `get_cards_by_commitment`, `get_offer`, `has_grant` | view | |
| `revoke(card_id)` / `refresh(card_id)` | issuer | Refresh re-runs `issue` with the stored secret and links `supersedes` |
| `set_offer(card_id, price, delay_secs, duration_secs, max_seats, requires_approval, payout)` | issuer | `delay_secs: 0` = live key; `payout` = NEAR account or Confidential Intents recipient |
| `ft_on_transfer(sender, amount, msg{card_id, buyer})` | USDC contract | Checks the price and that a seat is free; without approval: credits the issuer net of `fee_bps`, writes a grant expiring at `now + duration_secs`, emits `viewing_key_granted`; with approval: escrows the payment in `pending_approvals` |
| `approve_buyer(card_id, buyer)` / `reject_buyer(card_id, buyer)` | issuer | Approve → grant + payout; reject → full refund to the buyer ("select people") |
| `revoke_grant(card_id, buyer)` | issuer | Ends a key early and refunds the unused share pro rata |
| `get_offer(card_id)` → includes `seats_left`; `get_grant(card_id, buyer)` | view | Used by the enclave's feed check and the `/explore` page |
| `request_reveal(card_id, x25519_pub)` payable | grantee | Calls `reveal` on the enclave → `on_reveal` emits the ciphertext (or the HTTPS fallback path) |
| `withdraw()` | issuer | Pays out the balance |
| `grant(card_id, buyer, deposit_address)` | relayer account only | Fallback B only (§4.5). The relayer runs on Railway with a function-call key scoped to this one method |

**Tests:** unit tests plus `near-workspaces` sandbox tests with a **mock OutLayer contract** that returns fixture outputs signed by a test key. This covers parse, signature, rules and the grant flow without the network.

### 4.3 Card format (v1)
```json
{
  "v": 1, "venue": "hyperliquid", "kind": "trader|agent",
  "issuer": "alice.near", "commitment": "d8aca93b…",
  "window": { "start": 1791325080034, "end": 1793978799608, "days": 30, "samples": 46 },
  "scope": "account", "mode": "live",
  "stats": { "return_bps": 1494, "max_dd_bps": 6283, "win_rate_bps": 6190, "trades": 42,
             "profit_factor_x100": 209, "volume_band": "1e7", "active_days": 16, "flow_turnover_bps": 661 },
  "orders": { "root": "ccbb2ed0…", "count": 91 },
  "issued_at": 1793981611, "nonce": 0, "outlayer_request_id": "10776"
}
```
(Real values from the T2.8 run inside the OutLayer TEE. P9 adds `"privacy": {"k_anon", "k_min"}` and `"precision_bps"`.)

- **Canonical bytes:** sorted keys, no whitespace, integers only, ASCII only (`enclave/src/canonical.rs`, `packages/verify/src/canonical.ts`).
- **Signature:** `ed25519(cards key, sha256("proveit-card-v1\n" ‖ canonical))`. `card_hash = sha256(canonical)` is what the registry stores.
- **No code hash in the card:** the code can't know its own hash. The registry records the version it pinned, and the attestation's `wasm_hash` proves which binary ran.
- **`orders`, not `fills`:** the Merkle leaves are one coarsened record per order (`hour, coin, dir, size_bps, pnl_bps, fills`: no IDs, prices or dollar sizes). Per-fill leaves would make reveals 2–3× larger (the `winner` fixture: 2,352 fills, 91 orders).

### 4.4 Verify algorithm — `packages/verify` (TypeScript library + CLI, shared by the web app)

| # | Check | How | Red when |
|---|---|---|---|
| 1 | Signature | `@noble/ed25519` against `registry.card_pubkey` | any byte edited |
| 2 | On-chain record | NEAR RPC `get_card(id)`: hash match, not revoked | missing, revoked, or hash mismatch |
| 3 | Code version | `version ∈ approved_versions`; link to the release and reproducible-build hash | unapproved or retired |
| 4 | TEE attestation | `api.outlayer.ai/attestations/by-request/{outlayer_request_id}` (**not** `/attestations/{id}`, which is keyed by task ID; confirmed in T0.2): `wasm_hash == version`, `caller`/`project` == registry/enclave, `sha256(raw_output) == output_hash`; deep link to OutLayer's DCAP page | any mismatch |
| 5 | Freshness and privacy | age vs refresh policy; `k_anon ≥ k_min` | stale (amber), k too low |

CLI (runs on the judge's own machine): `pnpm verify https://<app>.up.railway.app/c/12` prints the five rows and exits non-zero on red. Agent mode: `pnpm agent-guard <card-url>` refuses to "follow" unless all checks are green. This is the Security-track demo log.

### 4.5 Viewing keys and payments
**The offer is the trader's choice:** price, delay (0 = live, for copy trading; 7 days = audit only), duration (keys expire, so it is a subscription), seat cap (scarcity and "select people") and optional approval. Live keys give away the trader's edge, which is why the trader prices them; verified PnL is what makes them worth buying.

- **Primary:** 1Click `/v0/quote` (`dry:false`, `swapType: EXACT_OUTPUT`, destination USDC on NEAR, `recipient: proveit.near`, `customRecipientMsg: {"card_id":…,"buyer":…}`, `appFees: [{recipient: proveit.near, fee: 100}]`, `refundTo` = buyer's origin address, `deadline` = now + 30 min). Show the deposit address and QR, poll `/v0/status`, and handle `PENDING_DEPOSIT → PROCESSING → SUCCESS | REFUNDED | FAILED` in the UI.
- **Fallback A:** the buyer pays USDC on NEAR directly with `ft_transfer_call` (always works, and is good for judges with NEAR wallets).
- **Fallback B:** 1Click to the registry's Intents account, plus a relayer (Railway `worker` service, §4.8) that polls `/v0/status` and calls the registry's relayer-only `grant(card_id, buyer, deposit_address)` after `SUCCESS`, signing with a function-call key limited to `grant`. Documented as trusted.
- **Private payout (stretch):** the trader's offer uses `recipientType: CONFIDENTIAL_INTENTS`.
- Test every path with **$1** first. `customRecipientMsg` is flagged "HIGHLY EXPERIMENTAL", and funds are lost without `storage_deposit`. Call `storage_deposit` for the registry on USDC at deploy.

### 4.6 Web app — `web/` (Next.js 15 App Router, Tailwind, shadcn/ui)

| Route | Purpose |
|---|---|
| `/` | Landing: **fake screenshot vs real card** side by side, "Verify both" (the eureka) |
| `/create` | Trader flow: NEAR login (HOT / near-connect) → connect EVM wallet (wagmi/viem) → sign EIP-712 → ECIES-encrypt → `store_secrets` + `request_card` (batched with `signAndSendTransactions`) → live progress ("enclave running… attested… recorded") |
| `/c/[id]` | Card page; OG image via `next/og` (X/Telegram/Discord previews); "Verify" and "Unlock trades" buttons |
| `/verify` | Paste a link or JSON → 5 check rows; **Tamper mode** (edit a number inline, watch row 1 and row 4 turn red) |
| `/c/[id]/unlock` | Pick a token and chain → 1Click quote → deposit → status → decrypt and show revealed trades + "Merkle-verified 64/64" |
| `/c/[id]/feed` | Key holders only: live or delayed trade feed, decrypted in the browser; **Copy** on Intents swaps (1Click quote for the same pair, scaled to the follower's size) and a signal view for perps trades |
| `/explore` | Discovery: verified cards ranked by return, drawdown, trade count and age; key price, delay and seats left on each |
| `/p/[account]` | Profile: every card by issuer and by commitment (anti-cherry-pick view) |
| `/api/verify?card=` | JSON verification API (business model and the agent guard) |

Design: a dark trading-terminal look. The card is the hero asset, so design it in Phase P6 with real care (spec watch-out: "win on the polish of the card").

### 4.7 Repo layout
```
proveit/
  README.md  LICENSE (MIT)  BUILD_PLAN.md  .github/workflows/ci.yml
  docs/ ARCHITECTURE.md  TRUST_MODEL.md  THREAT_MODEL.md  DEMO.md
  enclave/  Cargo.toml manifest.json build.sh src/{main,ownership,hl,stats,rules,kanon,commit,merkle,card,reveal,ecies}.rs fixtures/ tests/
  contract/ Cargo.toml src/{lib,cards,versions,viewing,ft,events}.rs tests/ mock-outlayer/
  packages/verify/  src/{index,checks,canonical,near,outlayer}.ts bin/verify.ts bin/agent-guard.ts
  web/  app/ components/ lib/{near,evm,ecies,oneclick}.ts railway.toml   # Railway config-as-code (service root dir: web/)
  scripts/ deploy-mainnet.sh issue-demo-card.sh demo.sh e2e-testnet.sh record-fixtures.ts reference-stats.ts gen-eip712-vectors.ts crosscheck.ts leakcheck.py p0-live.sh p1-check.sh
  test-vectors/  eip712.json merkle.json card-sig.json ecies.json ecies-follower.json   # shared by Rust and TS tests
  spikes/        s1 … s5 (P0 throwaway code)
  docs/          PHASES.md (test log) SPIKES.md METHODOLOGY.md CLAIMS.md
  web/e2e/       Playwright tests (no-leak.spec.ts)
```

### 4.8 Where every part is built and where it runs

Prove-It has **three homes**: OutLayer (the TEE), NEAR (the contract), and **Railway** (the website and a small backend). Nothing that sees a wallet address or computes stats ever runs on Railway.

| Part | Built where | Deployed / runs where | How it gets there | Who can change it |
|---|---|---|---|---|
| **Enclave** (`enclave/`) | Your machine, inside the pinned Docker image (`enclave/build.sh`); CI rebuilds it and diffs the sha256 | **OutLayer Intel TDX workers.** The `.wasm` is stored on FastFS; project `proveit.testnet/enclave` for dev, `proveit.near/enclave` for prod | `outlayer upload <wasm>` → `outlayer deploy enclave <FastFS URL>`. The registry then runs `approve_version(<sha256>)` | Nobody can change a published version: it is named by its hash. A new version only runs after `approve_version` |
| **Registry contract** (`contract/`) | Your machine: `cargo near build` | **NEAR blockchain**: `proveit.testnet` (dev), `proveit.near` (prod) | `cargo near deploy` + `init`, then `storage_deposit` on the USDC contract, `bootstrap_key`, `approve_version` | Only the `proveit.near` full-access key. Remove it or hand it to a multisig after the hackathon if you want it immutable |
| **Web app** (`web/`, Next.js) | **Railway** builds it from GitHub on every push (`next build`, Railpack/Nixpacks auto-detects Next.js) | **Railway service `web`** (`next start`, listens on `$PORT`), URL `https://<app>.up.railway.app` or a custom domain | Connect the GitHub repo → service root directory `web/` → set env vars → deploy | Whoever controls the Railway project. It **cannot** forge cards: verification runs in the user's browser against NEAR and OutLayer |
| **Backend routes** (inside `web/app/api/`) | Same Railway build | **Same Railway service `web`** | Ships with the web app | Same as above |
| **Relayer** (only if fallback B in §4.5 is used) | Same repo, `web/scripts/relayer.ts` | **Second Railway service `worker`** (always-on loop, same repo, start command `pnpm relayer`) | Railway → New Service → same repo → custom start command | Holds **one function-call key** that may only call `grant` on the registry. It cannot move funds or issue cards |
| **Verify library + CLI** (`packages/verify/`) | Your machine / CI (`pnpm build`) | Bundled into the Railway web app; the CLI runs **on the judge's machine** (`pnpm verify …`, `pnpm demo`) | pnpm workspace dependency of `web/` | — |
| **Scripts** (`scripts/`) | — | **Your machine only** (deploy, issue demo card, record fixtures) | Run by hand | — |
| **Third-party services we call** | — | Hyperliquid API, 1Click API, OutLayer API, NEAR RPC (fastnear) | — | Not us |

**Backend routes on Railway (the full list; keep it this small):**

| Route | Purpose | Secret it holds (Railway env var) | Sees private data? |
|---|---|---|---|
| `/api/verify?card=` | JSON verification API for agents and apps | none | No: reads public NEAR + OutLayer data |
| `/api/oneclick/quote`, `/api/oneclick/status` | Proxies 1Click so the partner JWT stays off the client | `ONECLICK_JWT` | No: only token, amount and the buyer's refund address |
| `/api/og/[id]` (or `next/og` on `/c/[id]`) | Renders the share image | none | No: renders public card data |
| `/api/reveal` | Forwards the follower's signed feed/reveal request to OutLayer HTTPS (the live feed polls it) | `OUTLAYER_PAYMENT_KEY` (owned by `proveit.near`) | No: the follower's request carries only their NEP-413 signature and public key, and the response is encrypted to the follower before it leaves the TEE |

**Railway env vars:** `NEXT_PUBLIC_NETWORK=mainnet`, `NEXT_PUBLIC_REGISTRY=proveit.near`, `NEXT_PUBLIC_OUTLAYER_API=https://api.outlayer.ai`, `NEXT_PUBLIC_NEAR_RPC=https://rpc.mainnet.fastnear.com`, `NEXT_PUBLIC_SITE_URL=<railway URL>` (used for OG image absolute URLs), plus `ONECLICK_JWT`, `OUTLAYER_PAYMENT_KEY` (for `/api/reveal`), and only if fallback B is used `RELAYER_PRIVATE_KEY` (function-call key). `NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.

**Hard rule:** the trader's Hyperliquid address and signature are encrypted **in the browser** to OutLayer's keystore and go straight to `outlayer.near` from the user's wallet. They never touch Railway. If a Railway route ever needs plaintext wallet data, the design is wrong.

---

## 5. Phased build plan

Build one phase at a time. Each phase has a goal, a target date, what it depends on, its tasks, and **exit tests**. **A phase is complete only when every exit test passes.**

### 5.0 Rules for every phase
1. **Exit tests are the definition of done.** "It works on my machine" is not a pass. Paste the command output or the tx hash into `docs/PHASES.md` next to each test ID.
2. **Automated tests join CI when the phase closes** (`.github/workflows/ci.yml`) and must stay green in every later phase. A red old test reopens its phase.
3. **Live tests** (testnet/mainnet, Railway) are run by hand and logged with the tx hash, URL or screenshot.
4. **Never put wallet data on Railway.** Phases 4, 5 and 7 have a leak test that enforces this.
5. **Shared test vectors** live in `test-vectors/*.json` and are used by Rust *and* TypeScript tests, so the enclave, the contract and the verifier can never silently disagree.
6. **If you are behind,** apply the cut order (§5.13) instead of skipping exit tests.

### 5.1 Phase tracker

| Phase | Name | Target date | Depends on | Status |
|---|---|---|---|---|
| P0 | Setup and risk spikes | Tue 3 Nov | — | ☐ |
| P1 | Enclave core: ownership, data, stats | Wed 4 Nov | P0 | ☐ |
| P2 | Enclave card: commit, Merkle, signing, OutLayer testnet | Thu 5 Nov (AM) | P1 | ☐ |
| P3 | Registry contract on testnet | Thu 5 – Fri 6 Nov (AM) | P2 | ☐ |
| P4 | **M1:** first real card on mainnet | Fri 6 Nov | P3 | ☐ |
| P5 | Web app: trader create flow (Railway) | Sat 7 Nov | P4 | ☐ |
| P6 | **M2:** card page, verify, tamper mode | Sun 8 Nov | P5 | ◐ 4/6 (T6.5, T6.6 yours) |
| P7 | Viewing keys: seats, expiry, live delay (direct USDC) | Mon 9 Nov | P4 (P6 for UI) | ◐ 8/9 (T7.6 on mainnet) |
| P8 | **M3:** 1Click unlock + copy-trade feed | Tue 10 Nov | P7 | ☐ |
| P9 | Explore, Intents venue, privacy depth, agent guard | Wed 11 Nov | P6 (Intents venue: S7) | ☐ |
| P10 | Hardening for the AI screeners | Thu 12 Nov | P8, P9 | ☐ |
| P11 | Demo, launch, submit | Fri 13 – Sat 14 Nov | P10 | ☐ |
| PS | Stretch goals (optional) | only after P10 | P10 | ☐ |

**Parallel lanes for a team:** after P2, one person takes P3→P4 (contract), another starts P5 against the testnet contract, and a third prepares P8's 1Click client against recorded responses. Solo: go in order.

---

### P0 — Setup and risk spikes (Tue 3 Nov)
**Goal:** prove the four risky platform assumptions before building on them. Spikes are throwaway code in `spikes/`.

**Tasks**
- [ ] Accounts: `proveit.testnet`, `proveit.near`; `outlayer` CLI login; OutLayer trial or payment key; GitHub repo; **Railway project** linked to the repo with service `web` (root `web/`) serving a placeholder page.
- [ ] Monorepo skeleton (§4.7) with `pnpm` workspaces and a Cargo workspace; `docs/PHASES.md` and `docs/SPIKES.md` created.
- [ ] **S1** Hello Hyperliquid: a WASI P2 module fetches `portfolio` (start from `out-layer/weather-example`).
- [ ] **S2** Keys: `signing_keys` + `encryption_keys` in the manifest; `public-key`, `sign`, `mac` called in a run **started by a test contract** (`spikes/s2-contract`).
- [ ] **S3** Secrets: get the key from `POST https://api.outlayer.ai/secrets/pubkey` (no auth; send a `User-Agent` header or Cloudflare answers 403) with `{"accessor":{"type":"Project","project_id":"proveit.near/enclave"},"owner":<trader>,"profile":<profile>,"secrets_json":"{\"PROVEIT_SECRET\":\"\"}"}` → `{"pubkey": <X25519 hex>}`. The keystore only validates key names, so **send placeholder values**: the real secret never leaves the browser unencrypted. Keys differ per owner (confirmed live). Then ECIES v1 encryption in Node (`@noble/*`), `store_secrets`, and reference via `secrets_ref` from a contract-started run.
- [ ] **S4** Leaderboard: fetch + stream-parse 40 MB inside the enclave.
- [ ] **S5** Callback limits: output size, gas and latency from `request_execution` to callback.
- [ ] **S7** NEAR Intents history: request invite access to 1Click `/v0/account/history` from the NEAR Intents team (message in §7). With access: sign in with a test account via `/v0/auth/authenticate`, record one confidential swap's history item and balances into `spikes/s7-intents-history/fixtures/`, and test what the session token **cannot** do (no endpoint accepts it to withdraw or submit intents).
- [ ] **S6** Confidential-perps ownership: `spikes/s6-chainsig-match` checks whether a near.com dedicated Hyperliquid address is a Chain Signatures address (needs a near.com test account).

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T0.1 | `echo '{"user":"0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"}' \| wasmtime -S http spikes/s1/target/wasm32-wasip2/release/s1.wasm` | prints JSON containing `perpMonth` with a non-empty `accountValueHistory` |
| T0.2 | Run S1 on OutLayer testnet, then `curl https://testnet-api.outlayer.ai/attestations/<task_id>` (or the testnet equivalent) | `wasm_hash` equals local `sha256sum` of the wasm, and `output_hash` equals `sha256` of the returned output |
| T0.3 | S2: two runs through the test contract, and one run of a second version | the same ed25519 public key all three times; `node spikes/s2/verify.mjs` verifies the signature with `@noble/ed25519`; `mac("x")` is identical across runs |
| T0.4 | S3: `node spikes/s3/encrypt.mjs` → `store_secrets` → run that prints `sha256(PROVEIT_SECRET)` | the hash matches the local hash; the plaintext appears in **no** tx argument (inspect both txs via RPC) |
| T0.5 | S4 timing run | time and peak memory recorded in `docs/SPIKES.md`; pass if < 60 s and under `NEAR_MAX_MEMORY_MB`, else switch to the snapshot fallback |
| T0.6 | S5: return 0.9 KB, 4 KB and 16 KB outputs | all arrive intact in the callback (source says they should); gas and latency recorded for each |
| T0.7 | `curl -sI https://<app>.up.railway.app` | `HTTP/2 200` |
| T0.8 | `node spikes/s6-chainsig-match/match.mjs --hl <dedicated addr> --user <near.com account> --predecessor <near.com contract>` | result (match with predecessor + path, or no match) recorded in `docs/SPIKES.md`. Either outcome passes; a match promotes confidential perps from PS to a P1 ownership mode |

| T0.9 | S7: authenticated `GET /v0/account/history` for a test account with one confidential swap | a history item with `depositType` or `recipientType` = `CONFIDENTIAL_INTENTS` and USD amounts is saved as a fixture; the session-token scope check is recorded. **Without access by 8 Nov:** record "no access" (passes; the Intents venue moves to PS) |

**Done when:** T0.1–T0.9 are logged and `docs/SPIKES.md` records the **G0 decision**: S1+S2 green → plan stands. S2 red → `PROTECTED_` ed25519 secret plus pubkey attestation. S3 red → secrets via CLI for the demo. S4 red → leaderboard snapshot hash. S5 red → reveal over HTTPS (`/api/reveal`).

---

### P1 — Enclave core: ownership, data, stats (Wed 4 Nov)
**Goal:** the enclave computes correct, deterministic stats from real Hyperliquid data and only for a proven owner.

**Tasks**
- [x] `scripts/record-fixtures.ts`: records `portfolio` and paginated `userFillsByTime` for 5 public accounts into `enclave/fixtures/`: `winner`, `loser` (both pass), `few_orders`, `late_funded`, `hlp_vault` (each refused for a different rule).
- [x] `scripts/reference-stats.ts`: an **independent** TypeScript implementation of the same spec; the golden `expected_stats.json` files come from it, not from the Rust code.
- [x] `hl.rs` client with pagination and a fixture source; the binary's fixture mode is a compile-time feature that never ships.
- [x] `ownership.rs`: EIP-712 as in §4.1; `test-vectors/eip712.json` generated with viem (`scripts/gen-eip712-vectors.ts`).
- [x] `stats.rs`: linked Modified Dietz TWR, MDD, flow turnover, trade grouping, win rate, profit factor, volume band, active days (`rust_decimal`, integers only in outputs).
- [x] `rules.rs` with error codes `TOO_FEW_TRADES`, `WINDOW_TOO_SHORT`, `ACCOUNT_TOO_NEW`, `SIG_INVALID`, `SIG_EXPIRED`, `NEAR_ACCOUNT_MISMATCH`, `FILL_CAP_EXCEEDED`.
- [x] `docs/METHODOLOGY.md`; `scripts/p1-check.sh` runs every exit test; `.github/workflows/ci.yml` runs it offline on every push.

**Exit tests** (`scripts/p1-check.sh`, all green)

| ID | Test | Pass when |
|---|---|---|
| T1.1 | `ownership::valid_signature` | the viem-generated vector is accepted |
| T1.2 | `ownership::rejects_*` | other key / tampered fields / high-s → `SIG_INVALID`; other NEAR account → `NEAR_ACCOUNT_MISMATCH`; past expiry → `SIG_EXPIRED`; expiry > 24 h away → `BAD_INPUT` |
| T1.3 | `stats::golden_*` (5 fixtures) | the Rust output equals `expected_stats.json` from the independent TypeScript reference, and the goldens are in sync with it |
| T1.4 | `stats::twr_ignores_deposits` (proptest) | random deposits and withdrawals (never more than the account holds) don't change TWR: it equals Π(1 + r) of the generated returns |
| T1.5 | `stats::mdd_bounds` | MDD always in [0, 10000] bps; strictly rising equity → MDD = 0 |
| T1.6 | `stats::trade_grouping` | hand-built fixture: 3 orders with partial fills → exactly 3 trades and the known win rate |
| T1.7 | `hl::pagination_no_duplicates` | 4,500-fill fixture split over pages → 4,500 unique fills (no duplicates at page boundaries) |
| T1.8 | `rules::*` | 19 trades → `TOO_FEW_TRADES`; first activity after window start → `ACCOUNT_TOO_NEW`; > 10K fills → `FILL_CAP_EXCEEDED` |
| T1.9 | `node scripts/crosscheck.ts <addr…>` | on ≥ 2 accounts with no flows **and** a current leaderboard snapshot, our 30d return is within ±1pp of the leaderboard `month.roi` (which is `PnL ÷ starting value`, not time-weighted, and often a stale snapshot) |
| T1.10 | `wasmtime` run of the module in fixture mode | prints a complete unsigned card JSON that deserializes into the strict `Card` type |

**Done when:** T1.1–T1.10 pass, they are in CI, and `docs/METHODOLOGY.md` documents every formula.

---

### P2 — Enclave card: commit, Merkle, signing, OutLayer testnet (Thu 5 Nov AM)
**Goal:** the enclave outputs a signed, compact, canonical card, and the deployed binary is reproducible.

**Tasks**
- [x] `commit.rs` (`mac("commit", "hyperliquid:"+addr)`), `merkle.rs`, `orders.rs` (per-order records), `canonical.rs`, `card.rs` (canonical JSON + `sign("cards", …)`), encrypted worker storage write (`card:<hash>` → address, window, root), `pubkey` op.
- [x] `Platform` trait: OutLayer host functions inside the TEE, a public test key (`test-keys` feature) for tests and local runs.
- [x] `packages/verify/src/{canonical,merkle,card}.ts` (the start of the P6 verifier) and `scripts/gen-p2-vectors.ts` → `test-vectors/merkle.json`, `test-vectors/card-sig.json`, so the Rust code is checked against an independent TypeScript implementation.
- [x] Reproducible `enclave/build.sh` (Rust image pinned by digest, `--locked`, fixed paths, **linux/amd64**: arm64 builds produce different bytes); `enclave/expected-hashes.txt`, checked by a CI job.
- [x] Builds: `live`, `fixtures` (local), `demo-fixture` (a recorded account compiled in, signed with the TEE's keys). The demo build is a **separate project** (`enclave-demo`), because signing keys are per project and a fixture card must never carry the production key.
- [x] Deployed to OutLayer testnet: `proveit-realist.testnet/enclave` (live, `8fac34b1…`) and `proveit-realist.testnet/enclave-demo` (`3b2ab5f6…`); test contract `p2.proveit-realist.testnet`.

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T2.1 | `card::canonical_is_stable` | the same card with shuffled keys → identical bytes; floats rejected |
| T2.2 | `merkle::proofs` | every leaf's proof verifies; a modified leaf fails; root equals the vector in `test-vectors/merkle.json` |
| T2.3 | `card::signature_vector` | signing with the test key reproduces `test-vectors/card-sig.json` |
| T2.4 | `card::output_size` | the largest fixture card serializes to < 1,024 bytes (keeps the fast 1-call resolve path) |
| T2.5 | `./enclave/build.sh` twice from a clean tree | identical sha256 both times (also a CI job) |
| T2.6 | `wasm-tools print enclave.wasm \| grep -c outlayer.manifest` | ≥ 1 |
| T2.7 | Testnet: `pubkey` op of the live build through a test contract | returns a 32-byte key, stable across 2 runs |
| T2.8 | Testnet: `issue` inside the TEE (demo build: a recorded real account, no ownership check) | returns a signed card that verifies in Rust **and** TypeScript; its attestation shows `wasm_hash` = the reproducible build hash and `output_hash` = sha256 of the output. **Deviation:** the plan first asked for a real ownership signature here; no team wallet had signed yet, so that moves to T3.6. The ownership check itself is covered by T1.1–T1.2 and the live local wasm run. |

**Done when:** T2.1–T2.8 pass and the testnet wasm hash is logged in `docs/PHASES.md`.

---

### P3 — Registry contract on testnet (built 7 Nov)
**Goal:** the contract issues, stores and verifies cards, and only from approved enclave versions.

**Tasks**
- [x] `contract/` (near-sdk 5, Rust 1.86): `bootstrap_key`, `approve_version`/`retire_version`, `request_card`/`refresh` → `on_result` callback, `verify_card(card_id, card_json?)`, `revoke`, views (`get_card`, `get_card_by_hash`, `get_cards_by_issuer`, `get_cards_by_commitment`, `get_request`, `get_config`, `get_versions`), NEP-297 events (`standard: "proveit"`).
- [x] The callback recomputes canonical bytes with **explicit key sorting** (not serde_json's map order, which a dependency's `preserve_order` feature would change), pinned to the enclave and TypeScript by `test-vectors/card-sig.json`.
- [x] Each card stores the key that verified it; fixture cards are accepted only by registries initialised with `accept_fixture_cards: true`; live nonces are single-use; refused cards refund the 0.02 NEAR storage fee, and a failed OutLayer call refunds everything.
- [x] Enclave: **door check** (`enclave/src/door.rs`, done early from T7.9): `issue`/`pubkey` run only on-chain from the registry compiled in as `PROVEIT_REGISTRY`, so each registry has its own reproducible build (`enclave/expected-hashes.txt`).
- [x] Enclave and contract: **7-day and 1-day windows** (Hyperliquid's `week` and `day` series), so a new account can get a real card before the deadline; goldens from the TypeScript reference. A 1-day card is for live testing and is labelled as such in the UI.
- [x] Testnet: `proveit-demo-registry.testnet` → project `enclave-demo` (fixture cards accepted) and `proveit-registry.testnet` → project `enclave` (live only); `scripts/e2e-testnet.sh`.
- [~] ~~`contract/mock-outlayer/` + near-workspaces sandbox~~: replaced by unit tests that drive the real `on_result` callback with mocked OutLayer results (including refund receipts), plus the same flow against the **real** OutLayer on testnet. A sandbox would only have re-tested the cross-contract wiring that the testnet run already exercises for real.

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T3.1 | `cd contract && cargo test` | the callback rejects bad signature, edited card, wrong issuer, wrong window, unknown fields, malformed output, missing key, failed promise, fixture card on a live registry, reused nonce; accepts a valid card |
| T3.2 | issuance end to end | unit: `request_card` → `on_result` → `get_card` / `get_card_by_hash` return the card; **live testnet**: a card issued through the demo registry and the real OutLayer TEE |
| T3.3 | `bootstrap_key` | the key is set from the enclave's own `pubkey` output (unit and live); non-owner panics |
| T3.4 | `verify_card` | VALID; same JSON in another key order → VALID; edited → `HASH_MISMATCH`; bad JSON → `BAD_CARD`; unknown → `NOT_FOUND`; old → `STALE`; retired → `VERSION_RETIRED`; revoked → `REVOKED`; refreshed → `SUPERSEDED` (unit; VALID and HASH_MISMATCH also live) |
| T3.5 | permissions and money | non-owner bootstrap/approve and non-issuer revoke panic; deposit below 0.07 NEAR panics; refusal refunds the storage fee and a failed call refunds everything (asserted on the created receipts, and the 0.02 NEAR refund seen live) |
| T3.6 | Live testnet: `scripts/e2e-testnet.sh` | issues a card for a real Hyperliquid account **with a real ownership signature from its wallet** (moved here from T2.8); `verify_card` returns VALID |
| T3.7 | Gas log | `request_card` + callback under 300 Tgas with ≥ 20% margin (value logged) |

**Done when:** T3.1–T3.7 pass and the contract tests are in CI.

---

### P4 — M1: first real card on mainnet (Fri 6 Nov)
**Goal:** a real card exists on NEAR mainnet and leaks nothing.

**Tasks**
- [x] `scripts/deploy-mainnet.sh` (idempotent, with a `preflight` step): OutLayer mainnet project `<owner>/enclave`, registry `proveit.near` (free on 7 Nov), `approve_version`, `bootstrap_key`. `storage_deposit` on USDC moves to P7, where payments start. Rehearsed on testnet; mainnet build `16f515c2…03aa`.
- [x] `scripts/issue-demo-card.sh` (store, request, check — the check runs T4.3–T4.6) for the demo Hyperliquid account; a **1-day card** is enough (funded 24 h earlier, ≥ 20 trades). Rehearsed on testnet.
- [x] `scripts/leakcheck.py --signer <acct> --needle <hl-addr> [--control <text>] <tx-hash…>`: pulls every receipt, argument, log and return value of the given txs (decoding base64), searches case-insensitively for the address with and without `0x`, and requires the control string to be found so a broken scan can't pass. Built and proven in P0 (T0.4).

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T4.1 | Run `deploy-mainnet.sh` twice | the second run changes nothing and exits 0 |
| T4.2 | `near view proveit.near get_config` | the approved version equals the T2.5 reproducible hash; `card_pubkey` is set |
| T4.3 | `scripts/issue-demo-card.sh` | prints a card ID; `near view proveit.near verify_card` → `{"valid":true}` |
| T4.4 | Fetch the card's attestation from `api.outlayer.ai/attestations/by-request/<request_id>` | `wasm_hash`, `output_hash`, `caller_account_id` and `project_id` all match |
| T4.5 | `scripts/leakcheck.py --network mainnet --signer <trader> --needle <hl-addr> --control <card_hash> <store_secrets tx> <request_card tx>` | **PASS** (0 matches) with the control found |
| T4.6 | Inspect the card JSON | no address, tx hash, order ID or exact equity value appears |

**Done when:** T4.1–T4.6 pass. **This is the minimum viable submission:** if everything after this went wrong, you still have a real product.

---

### P5 — Web app: trader create flow (built 7 Nov)
**Goal:** a new trader goes from zero to a card in the browser in under 2 minutes, on the Railway deployment.

**Tasks**
- [x] Next.js 16 app in `web/` (React 19, Tailwind 4), deployed from the repo root (`railway.toml`) so the pnpm workspace builds.
- [x] NEAR wallets through HOT's `near-connect` (testnet: Meteor, Intear, Nightly, Ledger; HOT and MyNearWallet don't list testnet); EVM wallet through the injected provider with viem's `signTypedData`.
- [x] `web/lib/ecies.ts` (the S3 code), `store_secrets` + `request_card` sent together, request number read from the registry's `request_started` event, progress while the enclave runs, a message for every refusal code.
- [x] **Demo data** mode: one `request_card` to the demo registry, no Hyperliquid account or EVM wallet needed, for judges and the AI screeners.
- [x] Keystore relay `/api/keystore-pubkey` for origins OutLayer doesn't allow (see §7); the UI says when it was used.
- [x] `web/test/*` (vitest) and `web/e2e/no-leak.spec.ts` (Playwright) in CI.

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T5.1 | `pnpm --filter web test lib/ecies` | TS-encrypted vector `test-vectors/ecies.json` decrypts in a Rust test, and vice versa |
| T5.2 | `pnpm --filter web test lib/eip712` | the TS typed-data hash equals the hash in `test-vectors/eip712.json` |
| T5.3 | Playwright `e2e/no-leak.spec.ts` (network intercept) | during the create flow, **no request to our own origin** (Railway) contains the Hyperliquid address in its URL, headers or body |
| T5.4 | Railway build log + `curl -sI <railway-url>/create` | build succeeds; `200` |
| T5.5 | Live, by hand on desktop Chrome and mobile Safari | a fresh NEAR account creates a mainnet card in < 2 min (timed and logged) |
| T5.6 | Live error path | an account with < 20 trades shows the `TOO_FEW_TRADES` message, and the deposit is refunded |

**Done when:** T5.1–T5.6 pass and T5.1–T5.3 are in CI.

---

### P6 — M2: card page, verify, tamper mode (Sun 8 Nov)
**Goal:** the eureka moment works for a stranger in under 10 seconds.

**Tasks**
- [x] `packages/verify` with the 5 checks (§4.4) + `bin/verify.ts` (isomorphic, noble crypto; RPC fallback list with backoff on rate limits; per-panel cache so tamper mode re-asks only `verify_card`).
- [x] `/verify` page with Tamper mode; `/c/[id]` with the OG image; landing page with fake vs real. Demo-registry cards live at `/demo/[id]` (OG image routes get no query string, so the registry is in the path).
- [x] Card design pass (it is the hero asset).
- [x] Tamper race: only the latest check may update the panel (a slow check of the unedited card can't show a tampered card as verified); edits debounced 350 ms.

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T6.1 | `pnpm --filter verify test` | valid vector → 5 green; any edited stat → signature red; wrong ID → on-chain red; unapproved version → code red; `output_hash` mismatch → attestation red; stale → amber |
| T6.2 | `pnpm verify <railway-url>/c/<id>` | exit code 0 and 5 ✔ rows |
| T6.3 | `pnpm verify --tamper return_bps=3830 <railway-url>/c/<id>` | exit code 1 and "signature mismatch" |
| T6.4 | `curl -s <railway-url>/c/<id> \| grep 'og:image'`, then fetch that image | the tag exists; the image is `image/png`, 1200×630 |
| T6.5 | Paste the card link into X (card validator) and Telegram | the preview shows the card image and title |
| T6.6 | Hallway test with 3 people who haven't seen it | each one verifies green and makes it red in < 10 s (times logged) |

**Done when:** T6.1–T6.6 pass. **Demo beats 2–4 now work.**

---

### P7 — Viewing keys with direct USDC (Mon 9 Nov)
**Goal:** a follower pays in USDC on NEAR for a key with the trader's terms (delay, expiry, seats, approval) and sees wallet-safe, Merkle-verified trades.

**Tasks**
- [x] Enclave `reveal` op: delay filter (delay 0 allowed), coarsening, salted leaves with a prefix proof, ECIES to the follower. The grant check is the registry's (it only forwards live key holders, with the key's delay).
- [x] Enclave door: every op, `reveal` included, only on-chain from the registry (P3 code). **Moved to P8:** `reveal`/`feed` over HTTPS, which needs the NEP-413 follower signature and an RPC grant check inside the enclave.
- [x] Contract (`contract/src/keys.rs`): `set_offer`/`remove_offer` with `delay_secs`, `duration_secs`, `max_seats`, `requires_approval`, `payout`; `ft_on_transfer` (refunds by return value); `approve_buyer` / `reject_buyer` / `revoke_grant` (pro-rata); expiring grants, renewals; `request_reveal` (result returned, not stored); `withdraw` with failed payouts owed again; `set_payments` (token, fee ≤ 10%); `migrate` from the P3–P6 state.
- [x] `/c/[id]/unlock` and `/demo/[id]/unlock` with the direct-USDC path (fallback A): price, delay, duration, seats left; key in the browser; decrypted and Merkle-checked in the page; the issuer's offer form, approvals and withdraw on the same page.
- [x] Testnet: tUSDC (`contract/mock-usdc`, 6 decimals) on `proveit-usdc.testnet`; `scripts/p7-live.sh`. Mainnet: `deploy-mainnet.sh` sets native USDC and registers the registry with it.

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T7.1 | `reveal::delay_boundary` | a trade exactly at `now − delay` follows the documented rule; newer trades are never returned |
| T7.2 | `reveal::coarsening` | revealed records contain no `hash`, `tid`, `oid`, exact `sz` or exact `px` with time (field-absence assertions) |
| T7.3 | `reveal::proofs_match_card` | every revealed record's proof verifies against the card's `fills.root`; count equals `fills.count` when the whole window is past the delay |
| T7.4 | `test-vectors/ecies-follower.json` | a Rust-encrypted payload decrypts in the TS client |
| T7.5 | Sandbox: payments | wrong token → full refund; underpayment → full refund; exact payment → grant written and issuer balance = price − fee; reveal without a grant panics; `withdraw` pays out |
| T7.6 | Live mainnet: $1 USDC `ft_transfer_call` | the browser shows the trades and "N/N Merkle-verified" |
| T7.7 | `leakcheck.py` on the payment and reveal txs | 0 matches for the address; no plaintext trade data on-chain |
| T7.8 | Sandbox: offer terms | the seat after `max_seats` is refunded; an expired grant fails `get_grant` and the enclave's check; `requires_approval` escrows, then `approve_buyer` grants and pays out, `reject_buyer` refunds in full; `revoke_grant` refunds the unused share |
| T7.9 | `enclave::door_checks` | `issue` over HTTPS → refused; `issue` from a contract other than the registry → refused; `reveal` over HTTPS with a valid grant → allowed. **Issue/pubkey part done in P3** (`enclave/tests/door.rs`, and refused live on testnet) |

**Done when:** T7.1–T7.9 pass.

---

### P8 — M3: 1Click cross-chain unlock (Tue 10 Nov)
**Goal:** a follower pays from another chain in any supported token, then follows and copies the trader's new trades.

**Tasks**
- [ ] Enclave `feed` op + per-card hash chain (§4.1); `/api/reveal` on Railway; `/c/[id]/feed` polls every 60 s, decrypts in the browser, shows new trades with a toast.
- [ ] **Copy** button on Intents swaps: a 1Click quote for the same asset pair, sized as the same % of the follower's balance, sent from the follower's own wallet. Perps trades show as signals with a link to trade on near.com.
- [ ] `web/lib/oneclick.ts` + `/api/oneclick/*` routes on Railway (JWT server-side); quote with `appFees` and `customRecipientMsg`; deposit address + QR; status polling.
- [ ] Recorded 1Click responses in `web/test/fixtures/oneclick/`.
- [ ] If `customRecipientMsg` fails: fallback B (`worker` service on Railway + `grant`).

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T8.1 | `pnpm --filter web test oneclick` | the UI state machine handles every status enum in the 1Click OpenAPI spec (`PENDING_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`, `FAILED`, …) |
| T8.2 | Snapshot test of the quote request body | contains `appFees`, `customRecipientMsg` with `card_id` + `buyer`, `refundTo` and a deadline |
| T8.3 | `grep -r "ONECLICK" web/.next/static` after build | no match (the JWT is not in the client bundle) |
| T8.4 | Live: $1 USDC from **Base** | the grant appears on-chain and the trades unlock; elapsed time logged |
| T8.5 | Live: a deliberately underpaid deposit (optional, costs a little) | the UI shows REFUNDED, and the funds return to the refund address |
| T8.6 | Backup | a raw screen recording of T8.4 saved in the team drive |
| T8.7 | `enclave::feed_chain` | heads chain correctly across 3 polls; a dropped or reordered record breaks the head check in the TS client |
| T8.8 | `enclave::feed_auth` | a bad NEP-413 signature, an expired grant or another account's grant → refused before any data is read |
| T8.9 | Live: a key holder's feed shows a new trade the demo account places (delay 0) | the trade appears within 2 polls; the copy quote's pair and size match |
| T8.10 | Playwright `e2e/no-leak.spec.ts` extended to the feed | no request to Railway contains the trader's address or plaintext trades |

**Done when:** T8.1–T8.4 and T8.6–T8.10 pass. **Full demo works end to end on mainnet.**

---

### P9 — Privacy depth, profile, agent guard (Wed 11 Nov)
**Goal:** discovery, the NEAR Intents venue, and the features that answer the hard judge questions.

**Tasks**
- [ ] `/explore`: verified cards ranked by return, drawdown, trade count and age; key price, delay and seats left.
- [ ] **NEAR Intents venue** (only if T0.9 got access): 1Click sign-in in `/create`, refresh token encrypted to the enclave, `hl.rs` sibling `intents.rs`, stats per §4.1, golden tests on the S7 fixtures.
- [ ] `kanon.rs` (or the S4 snapshot fallback); the card shows "1 of ≥ K".
- [ ] `/p/[account]` profile; refresh + supersede; stale badge; inception-to-date window.
- [ ] `kind: "agent"` cards; `bin/agent-guard.ts`; `/api/verify` route on Railway.

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T9.1 | `kanon::coarsens_until_k` | fixture leaderboard plus a unique return → precision widens until k ≥ 25; output never has `k_anon < k_min` |
| T9.2 | Sandbox: profile indices | 3 cards from 2 commitments → `get_cards_by_issuer` returns 3 and `get_cards_by_commitment` groups them correctly |
| T9.3 | Sandbox: refresh | the new card links `supersedes`; the old card verifies as `SUPERSEDED` |
| T9.4 | `pnpm agent-guard <green-card-url>` / `<tampered-url>` | exit 0 / exit 1 with a reason; log saved to `docs/agent-guard-demo.log` |
| T9.5 | `curl '<railway-url>/api/verify?card=<id>'` | JSON with the 5 checks, matching the CLI output |
| T9.6 | `/explore` with 3 cards (one revoked, one stale) | revoked cards are hidden; stale ones are badged; sort orders are correct; seats left match `get_offer` |
| T9.7 | `intents::golden_*` on the S7 fixtures (if the venue is built) | realized and unrealized PnL, return and drawdown match `expected_stats.json` |
| T9.8 | Live Intents card (if built) | a card issued from a confidential-trading account verifies green; `leakcheck.py` finds the account ID in no tx |

**Done when:** T9.1–T9.6 pass, plus T9.7–T9.8 if the Intents venue is built.

---

### P10 — Hardening for the AI screeners (Thu 12 Nov)
**Goal:** a stranger (or Claude Code/Codex) can clone the repo, follow the README and confirm every claim.

**Tasks**
- [ ] README per §9; `docs/TRUST_MODEL.md`, `THREAT_MODEL.md`, `METHODOLOGY.md`.
- [ ] `scripts/demo.sh` (`pnpm demo`): verifies the pre-issued mainnet card and a tampered copy, no wallet needed.
- [ ] Security pass (checklist below), CI complete, Railway production config final.

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T10.1 | Clean-machine run: fresh clone in a `node:22` + Rust Docker container, following the README only | `pnpm i && pnpm demo` prints `✔ 5/5` then `✘ signature mismatch` |
| T10.2 | Simulated screener: a fresh Claude Code session with the prompt "Clone this repo, follow the README, and report which claims you could and could not verify" | every README claim is verified, or the README is fixed |
| T10.3 | CI | all suites green on `main`, plus the reproducible-hash job |
| T10.4 | Claims table `docs/CLAIMS.md` | every claim in the README maps to a test ID or a live link |
| T10.5 | Security checklist, each item ticked with its test: enclave signs only messages it composes; EIP-712 domain has app name and version, and the message binds the NEAR account, nonce and expiry; nonces single-use; callbacks `#[private]`; failed runs refund; `ft_on_transfer` checks the sender is the USDC contract; relayer key is function-call only | every item ✔ |
| T10.6 | Railway production | all env vars from §4.8 set; `/`, `/create`, `/verify`, `/c/<id>`, `/api/verify` return 200; OG previews still render |

**Done when:** T10.1–T10.6 pass. **Feature freeze starts here.**

---

### P11 — Demo, launch, submit (Fri 13 – Sat 14 Nov)
**Goal:** a submission judges can open and verify.

**Tasks**
- [ ] Record the 3-minute video (§8); screenshots; X post draft.
- [ ] Freeze at 12:00 UTC on 14 Nov; tag `v1.0-hackathon`; make the repo public.
- [ ] Publish the X post **as a quote-reply to Illia's viewing-keys post** ("Built this at #NEARHackathon"); fill the submission form (review the payload first, because you only get one attempt).

**Exit tests**

| ID | Test | Pass when |
|---|---|---|
| T11.1 | Video | ≤ 3:00 and covers every beat in §8 |
| T11.2 | Repo and links from a logged-out incognito browser | repo public; tag `v1.0-hackathon` exists; README links and the Railway site open |
| T11.3 | X post | quote-replies Illia's viewing-keys post; says "built at NEAR HACKATHON", tags @NEARProtocol, uses #NEARHackathon, has the video attached, links the repo and the site |
| T11.4 | Submission form | tracks = Privacy & Private AI, Unstoppable DeFi, AI Security & Defense; **mainnet** payout account; description ≤ 2,000 characters; confirmation received |
| T11.5 | Final smoke test right after submitting | `pnpm verify <railway-url>/c/<id>` still exits 0 |

**Done when:** T11.1–T11.5 pass. Keep the repo public and the Railway site up through 18 Nov.

---

### PS — Stretch goals (only after P10)
Pick one at a time; each needs its own passing test before it goes into the demo.

| Stretch | Exit test |
|---|---|
| NEAR AI Cloud style summary inside the TEE | the summary on a card verifies under the same signature; a test asserts the summary prompt receives only coarsened data |
| Confidential-perps control challenge (F3) | a near.com account gets a card by placing the enclave-chosen order size; `leakcheck.py` still finds 0 matches |
| In-browser DCAP verification (`dcap-qvl` wasm) | a real quote verifies green; a quote with one flipped byte verifies red |

### 5.13 Cut order if behind schedule
Cut from the top of this list first: stretch → P9 agent guard → Intents venue (if S7 access is late) → copy button (keep the feed) → live k-anon (keep the snapshot fallback) → profile page → 90/180d windows → P8 (keep P7's direct USDC path plus the recorded 1Click run) → reveal coarsening extras. **Never cut:** P4 (mainnet issuance), P6 (verify + tamper), P7 viewing keys with seats/expiry/delay (the core of Illia's idea), P10 (README reproducibility).

---

## 6. Risk register (updated)

| Risk | Likelihood | Mitigation |
|---|---|---|
| OutLayer signing-key or secrets behaviour differs from the docs | Med | Spikes S2/S3 in P0; `PROTECTED_` key fallback; source code is the fallback reference (`github.com/out-layer/outlayer`) |
| Card output exceeds the callback size or gas | Med | Compact basis-point JSON; S5; move reveal to HTTPS |
| No Hyperliquid account with ≥ 30 days and ≥ 20 trades for the demo | Med | Use a teammate's real account; otherwise use `kind:"agent"` with a bot account started **today**, and for 30d use an older account |
| 1Click `customRecipientMsg` loses funds | Low–Med | Test with $1; `storage_deposit` first; fallbacks A and B |
| Leaderboard parsing too heavy in WASM | Med | Snapshot hash plus bucket table; limit to 30d |
| Judges doubt what the TEE proves | Med | §3.1 table in the README; live attestation link; reproducible hash |
| Stats challenged by a perps expert | Med | Documented formulas, golden tests on public accounts (HLP vault), "methodology" link on every card |
| AI screeners cannot run it | Med | `scripts/demo.sh` needs no wallet; a pre-issued mainnet card; no env vars needed for read-only paths |
| Similar viewing-key project from another team | Med | No-keys ownership, k-anon, Merkle reveal, cross-chain unlock, polish |

---

## 7. Questions
**One open question, to send to the NEAR Intents team now** (it gates the Intents venue, S7 / T0.9):

> "I'm building Prove-It for the hackathon: verified PnL cards and viewing keys for NEAR Intents confidential trading (the social trading idea Illia posted). Could I get invite access to 1Click `/v0/account/history`? And can a 1Click session token do anything beyond reading balances and history?"

**A second ask, to the OutLayer team** (removes the keystore relay, P5):

> "Could you add `https://proveit-production-d47c.up.railway.app` (and later our custom domain) to the CORS allowlist for `POST /secrets/pubkey` on testnet and mainnet? Our web app encrypts traders' secrets in the browser and currently has to fetch the keystore key through a relay."

Everything else is answered, or a test in this plan produces the answer:

| Question | Answer / where it gets answered |
|---|---|
| Can a near.com confidential-perps user prove control of their dedicated Hyperliquid account? | NEAR's answer: Chain Signatures addresses are derived from a NEAR account + path. Whether near.com uses this is settled by **spike S6 (test T0.8)** with your near.com test account. Match → P1 ownership mode; no match → exact-size order challenge (PS). |
| Is `capabilities.network` enforced for projects that aren't connectors? | **Yes, whenever declared** (`worker/src/connector_manifest.rs`, §4.1). |
| Max output size on the `request_execution` callback? | **No fixed small cap:** ≥ 1 KB uses the stored two-call flow (§4.1). Gas and latency measured in **S5 (T0.6)**. |
| Public endpoint for the keystore encryption pubkey? | **`POST https://api.outlayer.ai/secrets/pubkey`**, tested live (P0 S3). |
| Does 1Click's `customRecipientMsg` reliably reach the registry's `ft_on_transfer`? | Settled by the live **$1 test T8.4** in P8. If it fails, switch to fallback B (§4.5) the same day. |

---

## 8. Demo script (3:00) — revised
| t | Beat | On screen |
|---|---|---|
| 0:00 | Problem | "$650K stolen with fake PnL screenshots" headline; the inspect-element edit of a screenshot in 5 s |
| 0:25 | Why now | "NEAR confidential perps made your wallet private. Now your skill is unprovable too." |
| 0:40 | Trader | Sign in (HOT) → sign one message in the EVM wallet → **no API key** → card in < 60 s; show "enclave attested" |
| 1:20 | Follower | Card posted on X (OG preview) → Verify → **5 green rows** |
| 1:45 | **Eureka** | Tamper mode: change +18.3% to +38.3% → rows 1 and 4 go **red** instantly; the fake screenshot "verifies" nothing |
| 2:05 | Privacy | "1 of ≥ 112 accounts"; the wallet never appears; the commitment profile |
| 2:15 | Explore | `/explore`: verified traders ranked; one card shows "live key · $10 / 30 days · 3 of 10 seats left" |
| 2:25 | Buy and follow | Pay **from Base** via 1Click → feed opens; the trader places a trade → it appears in the follower's feed → **Copy** builds the same swap via 1Click |
| 2:45 | Close | "Private trading on NEAR where you sell viewing keys, and the PnL can't be faked." Agent-guard log blocks a red card. |

**X post template:** problem line → 30-s clip → "Built at NEAR HACKATHON with OutLayer (TDX), NEAR Intents 1Click, a NEAR registry contract" → repo + live link → a question ("Traders: what stat would you need to see before copying someone?") → @NEARProtocol #NEARHackathon.

---

## 9. README skeleton (written for the AI screeners and the human judges)
1. **What it is** (2 lines) + the problem
2. **Try it in 60 seconds, no wallet:** `pnpm i && pnpm demo` → expect `✔ 5/5 checks` then `✘ signature mismatch` for the tampered copy
3. **Try it live:** open `https://<app>.up.railway.app/c/1`, press Verify, toggle Tamper
3b. **Where each part runs:** the §4.8 table (OutLayer TEE / NEAR contract / Railway web app), so judges can see Railway never handles wallet data
4. **Issue your own card** (needs a NEAR mainnet account + a Hyperliquid account with ≥ 20 trades)
5. **What is proven / not proven** (table §3.1) + trust assumptions
6. **Architecture** + **NEAR protocols used:** OutLayer (TDX, signing keys, encrypted secrets), NEAR contract, NEAR Intents 1Click, Confidential Intents (payout), HOT wallet
7. **Enclave hash** (reproducible): `sha256 = …`, how to rebuild and compare
8. **Mainnet addresses:** registry, OutLayer project, demo card IDs, attestation links
9. **Tests:** `pnpm test` (enclave, contract, verify)
10. **Disclosures:** no pre-hackathon code; AI-assisted code (Claude Code); libraries; submission tag `v1.0-hackathon`
11. **License:** MIT

---

## 10. Submission checklist
- [ ] Repo public, LICENSE, README per §9, tag `v1.0-hackathon`
- [ ] Clean-machine run of `pnpm demo` passes
- [ ] Railway site up (and the `worker` service, if fallback B is used); demo card verifies green on mainnet
- [ ] X post live with video, @NEARProtocol, #NEARHackathon, "built at NEAR HACKATHON"
- [ ] Form: tracks = Privacy & Private AI, Unstoppable DeFi, AI Security & Defense; **mainnet** payout wallet; description ≤ 2,000 chars
- [ ] The repo stays public through 18 Nov

---

## 11. Sources
- Hackathon rules, tracks, judges: https://nearhackathon.com · https://nearhackathon.com/HACKATHON.md · track prompts: https://github.com/nearai/near-hackathon-prompt-examples
- OutLayer: https://app.outlayer.ai/docs · full docs: https://app.outlayer.ai/llms-full.txt · source: https://github.com/out-layer/outlayer (see `wasi-examples/CONNECTOR_MANIFEST.md`, `WORKER_ATTESTATION.md`, `keystore-worker/src/crypto.rs`) · examples: https://github.com/out-layer/eas-attestor, https://github.com/out-layer/weather-example, https://github.com/out-layer/signing-key-probe-repo · NEAR docs: https://docs.near.org/primitives/off-chain-compute/outlayer
- Live attestation example: https://api.outlayer.ai/attestations/293467
- Hyperliquid info API (live-tested): https://api.hyperliquid.xyz/info · leaderboard: https://stats-data.hyperliquid.xyz/Mainnet/leaderboard
- 1Click: https://docs.near-intents.org/near-intents/1click-api · OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml
- Confidential perps: https://perps.near.com/ · https://crypto.news/nears-private-perps-now-share-margin-who-can-see-the-risk/ · https://cryptobriefing.com/near-protocol-private-perps-hyperliquid/
- Competitors: https://ethglobal.com/showcase/flexprover-7xuf8 · https://blog.horizen.io/trade-with-proof-not-trust-how-obscura-is-making-reputation-private-and-verifiable
