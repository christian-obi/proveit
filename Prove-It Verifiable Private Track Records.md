# Prove-It: Verifiable Private Track Records

Oct 29, 2026 · @Christian

## Summary

**Prove-It turns a private trading account into a public, unfakeable track record without revealing the wallet, the positions or the strategy.**

A trader connects a read-only key. Code running inside a hardware enclave (a TEE) on NEAR's OutLayer reads the account, computes the stats, and signs a performance card. The enclave's attestation proves exactly which code ran on which inputs. Anyone can verify the card on NEAR in one click. Followers who want more than the headline can buy time-delayed viewing keys that reveal past trades after a delay of the trader's choosing.

- **Who it's for:** private and confidential-perps traders, copy-trading followers, signal groups, funds raising capital, and trading competitions.
- **Tracks:** DeFi, Privacy, Security.
- **One-line pitch:** "Screenshots can be faked. Prove-It cards can't, and they still keep your trades private."

## The problem

**Trading reputation runs on screenshots, and screenshots are trivially faked.** One scammer took over $650K from more than 250 people using fabricated PnL screenshots. Signal groups, copy-trading platforms and "alpha" accounts all sell trust that nobody can check.

There are two broken options today:

1. **Show a screenshot.** It's private, but anyone can fake it with an inspect-element edit or a demo account.
2. **Publish your wallet.** It's verifiable, but it exposes every position, so you get front-run, copied, and targeted.

**NEAR has made this sharper.** Confidential Intents and the confidential perps launched with Hyperliquid in September 2026 hide position ownership by default. That's good for privacy, but it also means a skilled private trader now has *no* way to prove their skill. The privacy NEAR sells needs a matching way to prove reputation, or private traders can't build careers or raise capital.

The missing primitive is **selective proof**: prove a fact about your trading ("+X% over 90 days, max drawdown Y, at least K trades") without revealing anything else.

## The solution and the eureka moment

**Prove-It is a third option: private and verifiable at once.** The trader never hands over their wallet or a trading key. The enclave sees the data, computes only the agreed stats, and outputs a signed claim. The raw data never leaves the enclave.

**The product has three layers:**

- **Proof Card.** A public, shareable card: return %, period, max drawdown, win rate, trade count, and the verification badge. It embeds in X posts, Telegram and Discord, and links to an on-chain record.
- **Viewing keys.** Followers pay to unlock trades after a delay the trader chooses (for example 7 days). The trader keeps their edge, and followers can still audit that the card wasn't cherry-picked.
- **Verify page.** Paste any card link and see the attestation check: which code hash ran, which account source, which time window, and when it was signed. If it's green, it's real.

**The eureka moment for judges:** the demo puts a convincing fake screenshot next to a Prove-It card. One click on the card shows a green attestation linked to NEAR. One edit to the card's number turns verification red. The audience sees in about 10 seconds that a fake no longer works, and that the trader's positions stayed hidden throughout.

## How it works

**Trader flow (about 2 minutes):**

1. Sign in with a NEAR account (or HOT wallet).
2. Create a read-only API key on the venue (Hyperliquid first). Paste it into the enclave's sealed input. It's encrypted to the enclave's key, so Prove-It's servers never see it in plaintext.
3. Choose the window (30, 90 or 180 days) and which stats to publish. Return %, drawdown and trade count are always shown, so traders can't hide drawdown.
4. The enclave fetches the trade history, computes the stats, and signs the result together with its attestation report.
5. A NEAR contract records the card: the hash of the stats, the code hash, the window, the account commitment and the timestamp.
6. Share the card. Optionally, enable viewing keys and set a price and a delay.

**Follower flow:**

1. Open a card link and see the stats and the verification status.
2. Click **Verify** to check the attestation and the on-chain record.
3. Optionally, buy a viewing key, paid in any token through NEAR Intents. It unlocks trades older than the delay, re-checked by the enclave against the same account commitment.

**Anti-gaming rules built into the enclave code:**

- One account commitment per card, so a trader can't silently switch to a better account.
- Cards refresh on a schedule, and a stale card shows its age.
- Minimum trade count and minimum window before a card can be issued.
- An account with several cards gets a profile showing all of them, so a trader can't open 20 accounts and only publish the winner without it being visible at the profile level. (Fully solving multi-account cherry-picking is an open problem. See Risks.)

## Architecture

**Only the enclave ever sees raw trades. NEAR stores hashes and attestations, never positions.**

&#91;embedded content: Prove-It architecture · 7 components\]

The top row issues a card and the bottom row consumes it. A follower's payment through Intents is recorded on the registry, and the enclave then releases trades older than the trader's delay.

**Components:**

- **Enclave job (Rust or Python on OutLayer):** decrypts the key inside the TEE, pulls fills, computes the stats deterministically, and outputs `{stats, window, account_commitment, code_hash}` plus the TDX attestation quote.
- **Registry contract (Rust, near-sdk):** stores cards, checks that the code hash is on an allow-list of audited versions, and handles revocation and viewing-key grants.
- **Account commitment:** a salted hash of the venue account ID. It's the same on every refresh, but it can't be reversed to find the wallet.
- **Viewing keys:** a grant recorded on-chain. The enclave serves trades older than the delay only to holders of the grant.
- **Frontend (Next.js):** card page, OG share image, verify page and trader dashboard.

## Why NEAR, and which partner tools

**NEAR is the only stack that has private trading, attested compute and chain-abstracted payments in one place.** That's why this belongs on NEAR and nowhere else first.

| Tool | What Prove-It uses it for |
| --- | --- |
| OutLayer (Intel TDX enclaves) | Runs the stats code and returns results with hardware attestation of the exact code and inputs. This is the core of the product. |
| NEAR smart contract | A registry of cards: stats hash, code hash, window, account commitment, timestamp, revocation. |
| NEAR Intents / 1Click API | Followers pay for viewing keys in any token on any chain. Settlement goes to the trader in their chosen asset. |
| Confidential Intents | A future data source: proving performance on NEAR's own confidential perps, which is where the pain is sharpest. |
| NEAR AI Cloud / IronClaw | Optional: an agent writes a plain-English summary of the trader's style inside the TEE, with no raw trades leaked. |
| HOT wallet | Easy sign-in and payment for traders who already live in Telegram. |

**The value to NEAR:** confidential perps become *more* attractive, because privacy no longer costs a trader their reputation. Every shared card is a public advert for NEAR's privacy stack.

## Business model

**Prove-It earns by taking a cut of the trust it creates.** Basic cards stay free so they spread.

| Revenue stream | Who pays | How |
| --- | --- | --- |
| Viewing-key marketplace | Followers | Platform fee on each viewing-key or subscription sale |
| Pro cards | Traders | Paid tier: more venues, longer windows, custom branding, auto-refresh |
| Verification API | Copy-trading apps, signal groups, prop firms, competitions | Per-call or monthly fee to check cards and rank traders |
| Fund due diligence | Allocators and DAOs | Private, deeper reports for a trader raising capital |

**Growth loop:** each shared card carries a "Verified by Prove-It on NEAR" link. Followers start asking unverified traders "where's your Prove-It?", so not having a card becomes a warning sign.

Pricing and fee levels are open questions to test after the hackathon.

## Competition and differentiation

**Verified-PnL tools exist on other chains, but none on NEAR, and none of them are built for confidential trading or sell viewing keys.**

| Project | Approach | Where Prove-It differs |
| --- | --- | --- |
| FlexProver (Flare) | TEE-attested PnL proofs | Prove-It adds viewing keys, cross-chain payment via Intents, and a path to NEAR confidential perps |
| Tickr (Primus zkTLS) | zkTLS proofs from exchange web sessions | TEE runs richer stats (drawdown, trade count) more cheaply. No browser session needed. |
| Callscan (zkVerify) | Proves trading calls and PnL | Prove-It focuses on private accounts, not public call tracking |
| Public wallet trackers | Show everything on-chain | Prove-It reveals only the agreed stats |

**The moat:** first mover on NEAR's privacy stack, a network effect of cards and verifiers, and viewing-key sales that give traders a reason to stay.

**Watch-out:** Illia has publicly floated viewing keys, so another team may pitch something close. Prove-It needs to win on the demo and the polish of the card.

## Hackathon scope

**Build one venue, one card, one verify page and one viewing-key purchase, all working end to end.** Everything else is roadmap.

**MVP (must ship):**

- [ ] OutLayer enclave job: takes an encrypted Hyperliquid read-only key, fetches fills, computes return %, max drawdown, win rate and trade count, and signs the output
- [ ] NEAR contract: `issue_card`, `get_card`, `verify(card_id)`, `revoke`
- [ ] Card page with a share image (OG image) for X and Telegram
- [ ] Verify page: attestation check, code hash, on-chain record, with a green or red state
- [ ] Viewing-key purchase through the 1Click API, unlocking delayed trades
- [ ] Open-source repo with the enclave code hash published in the README

**Nice to have:** a second venue, a trader profile page, and an AI style summary.

**3-minute demo script:**

1. (0:00) Show a viral fake PnL screenshot and the $650K scam headline.
2. (0:30) A trader connects a read-only key and gets a card in under a minute.
3. (1:15) The card is posted, and a follower clicks Verify and sees green.
4. (1:45) Edit the card's number and it turns red. This is the eureka beat.
5. (2:15) The follower buys a 7-day-delayed viewing key, paying in USDC on another chain through Intents.
6. (2:45) Close: "Private trading on NEAR, now with a reputation nobody can fake."

The build order is enclave first (the hardest and riskiest part), then the contract, then the UI, then payments.

## Risks and mitigations

**The biggest risk is data access: confidential perps may not expose a read-only path yet.** Hyperliquid read-only keys are the safe first source.

| Risk | Mitigation |
| --- | --- |
| No read-only access to NEAR confidential accounts yet | Ship on Hyperliquid first. Pitch confidential perps as the next step and ask NEAR mentors for access during the event. |
| Cherry-picking across many accounts | A profile view, a minimum window and trade count, and cards bound to account age. State openly that this isn't fully solved. |
| Judges doubt what the TEE proves | Publish the enclave code, its hash and a one-line statement: code X ran on account Y's data for window Z. |
| TEE trust (hardware vulnerabilities) | Use OutLayer's attestation, refresh cards regularly, and plan an optional zkTLS cross-check later. |
| API key leakage | Accept read-only keys only. Encrypt to the enclave key, never store plaintext, and reject keys that have trade permission. |
| OutLayer or 1Click limits during the build | Prototype the enclave job on day one. Keep a mocked payment fallback for the demo. |
| A similar viewing-key project from another team | Win on the end-to-end demo, the card's design and the fake-vs-real moment. |

## Roadmap after the hackathon

1. **NEAR confidential perps as a data source.** This is the core of the NEAR story. Work with the NEAR Intents team on a selective-disclosure hook.
2. **More venues:** Binance, Bybit and OKX read-only keys, plus on-chain DEX wallets.
3. **Copy-trading integrations:** platforms call the verification API to rank and list only verified traders.
4. **Competitions:** trading leagues where entries are Prove-It cards, so nobody has to dox their wallet.
5. **Fund-raising reports:** deeper private reports for allocators and DAOs.
6. **Agent track records:** the same enclave proves an AI trading agent's performance, which ties into NEAR's agent push.
