# Performance Chatbot 2 — Master Fix & Upgrade Plan (v2)

The single, ordered source of truth for finishing PC2. Work the Order of Operations top to bottom. Each item has a paste-ready Cursor prompt (in a code block) and a verify step. Apply one, verify it, move on.

> **Revision note (June 21, 2026):** Neon is now on the **Launch Plan** (paid). The original plan assumed the free-tier compute was exhausted and dead until the July 1 reset, so every DB-path item was parked under "verify after July 1." **That constraint is gone — the database is live, so DB-path items (#4, #5, #6 delivery, #7 semantic search) are now buildable *and* verifiable this week.** Two consequences are folded in below: the "When verifiable" column flips to **Now** for those items, and **#4's rationale changes from "prevent free-tier re-exhaustion / outage" to "control compute cost"** (idle queries now bill continuously instead of causing an outage). The #4 recurring-query audit has also been completed against the repo and is included inline.

---

## STATUS

- **Internal service-department testing only** — not live with real customers. (An earlier note said "real traffic"; corrected — this is service-dept testing at Performance Cycle.)
- **Neon: Launch Plan active.** Database is live. DB-path work can be applied **and verified now** — no need to wait for the July 1 free-tier reset. Watch compute/billing instead of CU-hour exhaustion.
- **Codebase is mature, not half-built:** phased migrations (0000–0006), real unit + Playwright coverage, a RUNBOOK, link-audit and stress-test scripts, structured takeover and escalation logic. Remaining work is finishing and tuning, not rebuilding.

### The dividing line for "can I do it now?"
- **AI-path fixes** (hours, catalog-term leak, escalation wording, tools mode) → apply and fully verify now against preview.
- **DB-path fixes** (Neon hygiene, takeover reproduction, escalation delivery, semantic search) → apply **and verify now** (DB is up).

---

## ORDER OF OPERATIONS

| # | Task | Type | When verifiable |
|---|------|------|-----------------|
| 1 | Confirm `USE_AI_TOOLS` is on in both envs | Config | Now |
| 2 | Fix hours drift (deterministic guard) — **deploy blocker** | AI-path | Now |
| 3 | Fix "STORE CATALOG" term leak | AI-path | Now |
| 4 | Neon compute hygiene (now cost control) | DB-path | **Now** (was: after July 1) |
| 5 | Takeover fallback — decide + tune | DB-path | **Now** (was: after July 1) |
| 6 | Escalation consistency — decision | AI-path / DB-path | **Now** (behavior + delivery) |
| 7 | Search roadmap (Stages 0–4) | Mixed | Post-launch |

> **Working scope for this session:** the only items that don't change what the bot *says* are **#1** and **#4**. **#2** is the first change to chatbot behavior — stop there and gameplan before applying #2, #3, #5, #6, #7.

---

## 1 — Confirm tools mode is actually ON (do first)

The agentic search loop already exists in `lib/ai/tools.ts` and is wired into `buildPrompt.ts`, gated behind `USE_AI_TOOLS`. If it's set in Vercel but missing from `.env.local`, your local tests run a different search path than production — which makes every other test suspect. Five-minute check, so do it before anything else.

**Manual checks (do these yourself — not visible to Cursor):**
- Vercel dashboard → project → Settings → Environment Variables → confirm `USE_AI_TOOLS=true` exists for **Production**.
- Open local `.env.local` → confirm it's there too. If it's in one but not the other, add it to the missing side.

**Cursor prompt:**

```text
I need to confirm our agentic tools search path actually executes at runtime, not just that the env var is set. USE_AI_TOOLS gates the tool path in lib/ai/tools.ts, wired through buildPrompt.ts. Do three things: (1) Check whether USE_AI_TOOLS is present in .env.local and report its value. (2) Trace where the flag is read and confirm that when it's true, the tool-instructions block in buildPrompt.ts and the tool definitions in lib/ai/tools.ts are actually reached at request time — add a single temporary log line (use the existing lib/log util) at the exact point the tool path is taken, e.g. "[tools-path] USE_AI_TOOLS active, tool loop entered". (3) Tell me how to trigger it locally so I can watch the log fire. Don't change any gating logic or behavior — this is purely a diagnostic log I'll remove after confirming. Show me the diff.
```

**Verify:** fire one chat message locally; the log fires; the flag is set the same in both environments. Then remove the log.

---

## 2 — Hours drift (DEPLOY BLOCKER) — *behavior change; stop and gameplan before applying*

**Corrected diagnosis. This is NOT a data bug.** The `store_hours` knowledge entry already holds the right values (Saturday 9 AM–6 PM, Sunday CLOSED) and a "quote VERBATIM, don't invent hours" instruction, and `buildPrompt` injects every knowledge entry on every turn. The correct hours were in the prompt during the chats where the bot still said "Sat 9–5" / "Sat–Fri." So it's model-adherence drift on a low-salience detail — it happens when the bot tacks hours onto an unrelated query as a footer. Correcting data that's already correct won't fix it. Make it deterministic instead.

**Cursor prompt:**

```text
The store hours bug is NOT a data bug — the store_hours knowledge entry already has the correct values (Saturday 9 AM–6 PM, Sunday CLOSED) plus a "quote VERBATIM" instruction, and buildPrompt injects all knowledge entries every turn. The model still occasionally outputs "Sat 9–5" or a garbled "Sat–Fri" range when it tacks hours on as a footer to an unrelated query. Fix deterministically:
1. Add a post-generation guard in lib/ai/runAi.ts, after the response text is assembled and before it's persisted/returned. Detect any hours-like statement in the output (day-of-week names near AM/PM times, or Saturday/Sunday near a time) and replace the whole hours statement with one canonical constant: "Mon–Sat: 9 AM–6 PM MST · Sunday: Closed." Keep that constant in one shared module so the prompt and the guard can't disagree.
2. Add a rule HIGH in the rules block (not buried in the KB body) telling the model not to append store hours or the phone number as an unsolicited footer on product/parts/tire queries — only state hours when the customer asks about hours, location, or visiting. That removes the situation where drift happens.
3. Unit test: feed an AI output containing "Saturday 9 AM–5 PM" and assert the guard rewrites it to the canonical string. Do NOT edit the store_hours KB entry.
4. Show me the diff before applying.
```

**Verify:** ask hours, "open Sunday?", "what time Saturday?", then a tube/tire query and check it doesn't tack on wrong hours. All must read Mon–Sat 9–6, Sunday Closed.

---

## 3 — "STORE CATALOG" term leak — *behavior change*

**Confirmed and located.** The injected section header is literally `## STORE CATALOG (current stock)`, and many rules in `lib/ai/rules.ts` reference "STORE CATALOG" by name, so the model echoed it to a customer ("the STORE CATALOG confirms…"). Nothing currently forbids saying the literal section name. One-line rule addition — don't change what the rules do, just stop the label surfacing.

**Cursor prompt:**

```text
Internal prompt terminology leaked into a customer reply ("the STORE CATALOG confirms we stock oils").
1. In lib/ai/rules.ts, add an explicit instruction that the model must NEVER write the literal phrases "STORE CATALOG", "RELEVANT PRODUCTS", "KNOWLEDGE BASE", "PRODUCT PAIRINGS", or any internal section header in customer-facing text. These are internal-only labels. When confirming we carry something, phrase it naturally ("we do carry…").
2. Do not change what any rule does — only prevent the labels from surfacing.
3. Show me the diff before applying.
```

**Verify:** re-run "do you have 5w40 oil" and other brand/category-confirm queries — natural phrasing, no internal labels.

---

## 4 — Neon compute hygiene — *not a chatbot-behavior change; OK to do this session*

**Corrected diagnosis.** The DB layer uses the Neon serverless HTTP driver (`@neondatabase/serverless`), so there's no leaked connection pool to fix. The compute burn comes from frequent background queries keeping compute from idling to zero (scale-to-zero needs ~5 min of true inactivity).

**Updated rationale (Neon up):** On the Launch Plan there's no free-tier wall to hit, so a runaway background query won't *suspend* you anymore — it bills continuously in the background instead. Same fix, new reason: **cost control.**

### Repo audit (DONE — what actually hits Postgres, and when)

| Source | Interval | Hits Postgres? | Runs when… |
|--------|----------|----------------|------------|
| `/api/cron/tick` (`vercel.json` schedule `* * * * *`) | every 60s, 24/7 | **Yes — 4 ops/run** (`releaseStrandedHumanClaims`, `sweepStaleSessions`, `processDueAiClaims`, `evaluateAlertThresholds`) | **always, even with zero users connected** |
| Agent presence heartbeat (`PresenceHeartbeat.tsx` → `/api/presence/heartbeat`) | 30s | Yes (`UPDATE users` last_heartbeat_at) | only while a dashboard tab is open |
| Customer chat heartbeat (`ChatWidget.tsx` → `/api/sessions/[id]/heartbeat`) | per `HEARTBEAT_INTERVAL_MS` | Yes | only while the widget is open/visible |
| Customer message poll (`ChatWidget.tsx`) | 8s | Yes (`GET /messages`) | only while the widget is open |
| Session-status poll (`ChatWidget.tsx`) | 4s | Yes | only while a session is `waiting` for a claim |
| `/api/cron/cleanup` | monthly (`0 3 1 * *`) | Yes | negligible |
| `/api/cron/catalog-refresh` | daily (`30 7 * * *`) | Yes | negligible |

**Takeaway:** the heartbeats and polls only burn compute while a human is actively connected — acceptable. The **24/7 exhauster is the per-minute `tick` cron**: it alone fires DB queries every single minute forever, which is what kept compute from ever scaling to zero (nights, weekends, no users). That's the thing to fix.

### Decision needed before the change (gameplan item)

The `tick` cron can't just be naively slowed: the README states it's "required for the AI fallback timer to work reliably regardless of whether the dashboard is open," so lengthening its schedule pushes the AI fallback (default 60s) out to the new interval. Options:

- **(a) Lengthen the cron schedule** (e.g. `*/5 * * * *`) and accept a slower worst-case AI fallback. Smallest config change, worst UX hit.
- **(b) Keep `* * * * *` but make the tick early-exit cheaply** — one tiny "is there anything due / any open or waiting session?" query, and return immediately if not. Most ticks become near-free; fallback stays responsive. (Note: even one query/min keeps compute partly warm, so this reduces but doesn't zero idle burn.)
- **(c) Move the tick off Vercel cron entirely and trigger it lazily from dashboard/widget activity** — the codebase already has a "lazy backstop" pattern for Hobby plans. Gets you true zero-query idle (nothing runs when nobody's connected), at the cost of no sweep while everything's closed.

> **Pick (a), (b), or (c) before writing the change prompt.** (b) is the smallest safe change; (c) gets the lowest bill. The audit step below is already done — when you've decided, the change prompt can target the chosen approach directly.

**Cursor prompt (audit — already largely answered above; run to confirm against current code, then apply the chosen approach):**

```text
Our Neon compute keeps idling-warm because background queries never let it scale to zero (needs ~5 min of no queries). The DB uses the @neondatabase/serverless HTTP driver, so this is NOT a connection-pool leak.
1. Audit every recurring DB query and list each one's interval and whether it hits Postgres: the per-minute /api/cron/tick (vercel.json schedule), presence heartbeats (lib/presence.ts, components/providers/PresenceHeartbeat.tsx), customer heartbeats and polls (components/chat/ChatWidget.tsx), and the crons in app/api/cron/* and vercel.json.
2. Confirm my finding: the only source that queries Postgres when NO customer chat is active and NO dashboard is open is /api/cron/tick (* * * * *). Verify whether anything else fires on a timer independent of an open tab.
3. Show me what you find before changing anything — do not modify intervals yet.
```

**Verify (now — no need to wait for July 1):** with no chat active and no dashboard open, watch the Neon console — compute/billing should stop accruing within ~5 minutes once the idle queries are gone.

---

## 5 — Takeover fallback (decide, then tune) — *gameplan*

**Corrected diagnosis — not broken.** The handoff logic is solid: agents claim a session, the AI aborts mid-stream if a human claims (`makeHumanTakeoverError` in `runAi.ts`), and a fallback timer (`fallbackTimerSeconds` / `aiEnabled` in `app/api/chat/route.ts`) hands control back if the agent goes idle. The June 18 "AI replied an hour later" was that fallback timer firing after the agent went quiet — intended-ish, just possibly tuned too loose. This is a decision, not a defect.

**Decide:** (a) is the fallback window the right length, and (b) should the AI re-engage on a stale customer message (one sent while the agent was active) or only on a fresh one? Once decided:

**Cursor prompt:**

```text
Review the human-takeover fallback in app/api/chat/route.ts and lib/ai/runAi.ts. Current behavior: after an agent claims, if they go idle, fallbackTimerSeconds returns control to the AI, which can then answer a message the customer sent while the agent was active.
1. Show me where fallbackTimerSeconds is set and where control returns to the AI.
2. Make the fallback window configurable in bot settings (default: <your choice>).
3. Add a guard so that when the AI regains control via fallback, it does NOT auto-answer a customer message older than the fallback window — it waits for a fresh message instead. Show me the diff before applying.
```

**Verify (now):** claim a session as agent, go idle past the window, confirm the AI resumes only on a new message, not a stale one.

---

## 6 — Escalation consistency (decision) — *gameplan*

The escalation engine is structured (at most once per session, multiple defined triggers). The June 18 "instant punt" on the BMW tire question was a trigger firing with no help attempt first — a tuning choice, not a break. **Decide** whether fitment questions should always attempt a helpful answer (show candidate products / ask one clarifying question) before escalating. The behavior change is an AI-path rule (testable now); escalation delivery to the dashboard is now verifiable too (DB up). Not a blocker.

---

## 7 — Post-launch: smarter & cheaper (routing, search, token cost) — *gameplan*

The layer where the bot routes "like how Claude searches" — decide what to look up, search, see weak results, refine, then answer. Pays off three ways at once: lower token cost, fewer hallucinations, smarter retrieval. Build on real traffic after launch (the failed/empty queries you collect are the tuning data), with two cheap exceptions in Track C that are safe earlier.

**Track A — Smarter dispatch (cheaper + fewer hallucinations)**
- **Routing layer.** Prompt-level dispatch rule (not a separate ML classifier) that classifies intent (product search / fitment / color / sizing / service / order) and goes straight to the right tool path instead of reasoning every turn about whether to search. Saves tokens, makes routing predictable, lets you wire tool sequences (fitment → `search_products` → `get_product_details`). Fewer invented paths = fewer hallucinations, and it sidesteps escalation false-positives.
- **Agentic search loop.** The "like Claude" iteration — search, see weak results, refine, search again. Already exists behind tools mode; Step 1 confirms it's on. Nothing to build, just verify.
- **Query rewriting.** Before searching, rewrite casual phrasing into an optimal query ("something for my husband who just got his license" → "beginner helmet jacket gloves starter gear"). A pre-search prompt step; compounds everything below.

**Track B — Smarter retrieval (better results)**
- **Faceted search + exact SKU/part-number lookup.** Expose brand × subcategory × color × price × in-stock as separate `search_products` params, plus a dedicated SKU/part-number exact-match path. Part-number misses are genuine search gaps (not redaction — the AI receives the raw message). Highest-leverage single retrieval change.
- **Semantic / vector search** (~1 week, needs DB up — now available). Neon supports pgvector natively; the daily catalog cron already runs — add an embedding step with Voyage `voyage-3`, hybrid vector + keyword scoring. Turns "not found" on real products into hits.
- **Reranking + catalog enrichment.** Rerank candidates; optionally enrich products with use-case tags/synonyms for richer embeddings. Optional polish.

**Track C — Token cost (cheap, can do earlier)**
- **Prompt caching.** Cache the static head of the system prompt — Anthropic bills the cached prefix at ~10% of normal, so multi-turn chats (most of yours) drop ~90% on input cost. ~30 lines, not coupled to launch. Single biggest token-cost lever.
- **Consolidate the rules.** Collapse the ~40 numbered rules into ~11 themed sections. Fewer tokens every turn, and the model follows themed prose more reliably than a long numbered list — which directly reduces the kind of drift behind the hours bug. Doubles as a hallucination fix, not just a cost cut.

**Order within Part 7:** Track C first for immediate cost relief (caching especially — pre-launch-safe). Then Track A's routing layer + query rewriting. Track B's faceted/SKU lookup is the highest-leverage retrieval fix; semantic and reranking follow on real traffic with the DB up.

**Model note:** staying on Haiku 4.5 is right — the gaps are dispatch and retrieval, not reasoning depth, so a bigger model would share the blind spots and cost more. Make routing and search smarter first.

---

## CHECKLIST

**Do now (AI-path, testable without the DB):**
1. `USE_AI_TOOLS` confirmed on in both envs
2. Hours deterministic guard (deploy blocker)
3. "STORE CATALOG" term leak

**Now verifiable too (DB is up — was "after July 1"):**
4. Neon compute hygiene (now cost control; verify idle → zero now)
5. Takeover fallback window + stale-message guard
6. Escalation delivery to dashboard

**Decide:**
- 6 — Escalation: attempt-before-punt on fitment?
- 4 — Tick cron approach: (a) lengthen / (b) cheap early-exit / (c) lazy trigger

**Post-launch (smarter & cheaper):**
- 7a — Token cost: prompt caching (~90% input) + rules consolidation (~40 → ~11 themed)
- 7b — Dispatch: routing layer + query rewriting + confirm agentic loop on
- 7c — Retrieval: faceted + SKU lookup → semantic (pgvector / voyage-3) → rerank/enrich

---

*Compiled from the June 18 live service-worker test and a full read of the Performance_Chatbot_2 repo. v2 (June 21, 2026): Neon Launch Plan folded in — DB-path items now verifiable this week; #4 reframed as cost control with the recurring-query audit completed against the repo.*
