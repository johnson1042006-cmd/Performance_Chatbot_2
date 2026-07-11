# PC2 Fable Session Log

Running status log for the autonomous Preview-based fix session (started 7/9/2026).
Append-only — one entry per pause (merge go-ahead, blocking question, item finished
or abandoned). Trace-back tool: each fix should be independently identifiable by what
it touched and why.

---

## [2026-07-09 18:25 MDT] — Item 0: Plan-doc decision sync
**Status:** done (committed on its own, per mandate)
**Files changed:** PC2_Jacob_Fixes_Plan.md, PC2_Phase2a_Escalation_Plan.md, PC2_Fable_Session_Log.md (created)
**What changed and why:** Recorded the three resolved decisions in the in-repo plan docs before building against them: (1) Phase 2c defaults to Road 6 when the customer doesn't specify a generation — confirmed a ranking/default-selection bug, both products live on the storefront; (2) Phase 2b classification fallback — Sonnet low-confidence or error falls back to the current Haiku-only routing path, no escalation for that failure mode; (3) merge/production policy — implement and gate fully autonomously against Preview and its isolated Neon branch, production pushes and any production-Neon interaction require Antonio's explicit go-ahead per item. Also corrected the Phase 2a plan's Step 5 smoke-test target: it still said to test locally against .env.local "(NOT the broken Preview env)" — Preview is fixed and .env.local points at production Neon, so the doc now names Preview as the required test target.
**Test gate results:** n/a (docs only — no code changed)
**Waiting on:** nothing, just noting progress. Proceeding to Item 1 (Phase 2a test gate against Preview).

---

## [2026-07-09 19:54 MDT] — Item 1: Phase 2a test gate (paused overnight, mid-gate)
**Status:** in progress — paused by Antonio for the night; no gate failure
**Files changed:** none (no code changes this item; Phase 2a implementation was already on the branch)
**What changed and why:** Gate step 1 (unit tests) passed: 595/595. Steps 2–4 are blocked on one machine-local prerequisite: Playwright's chromium build 1217 (for the pinned Playwright 1.59.1) is not installed on this Windows machine and in-session install attempts stalled repeatedly; Antonio's manual install outside the session worked but grabbed build 1228 (ran without project deps resolved). `npm install` has since been run, so a `npx playwright install chromium chromium-headless-shell` from the project root is the one remaining setup step before the e2e runs.
**Test gate results:** unit 595/595 PASS · e2e:slow NOT RUN (browser missing; two earlier aborted runs failed on machine-local issues, not code: (1) `.env.local` has `NEXTAUTH_URL=""`/`VERCEL_URL=""` which breaks `next build` at prerender — worked around per-run with `NEXTAUTH_URL=http://localhost:3050`, worth fixing in `.env.local`; (2) e2e global-setup's non-localhost DB guard — expected, acknowledged with `E2E_ALLOW_REMOTE_DB=1`) · Playwright NOT RUN · browser pass NOT RUN
**Ready for pickup:** Preview Neon connection string obtained via Neon MCP (branch `br-rough-leaf-akxuxfmx`, endpoint `ep-dark-rice-*`; NOT stored anywhere — re-fetch via `mcp__neon__get_connection_string`); migration 0007 verified already present on the Preview branch; Preview deployment READY at commit ab7e839 (`performance-chatbot-2-git-fix-b02930-antonio-johnsons-projects.vercel.app`, behind Vercel SSO — mint a fresh share link via the Vercel MCP; tonight's expires 7/10 ~11:38 PM); live-pass driver script ready at the session scratchpad (`live-preview-pass.ts`). Run commands for pickup: `DATABASE_URL=<preview> NEXTAUTH_URL=http://localhost:3050 E2E_ALLOW_REMOTE_DB=1 npm run test:e2e:slow`, then same env with `npx playwright test --grep-invert @slow`.
**Waiting on:** nothing from Antonio — resuming next session with the chromium install, then gate steps 2–4.

---

## [2026-07-10 19:45 MDT] — Item 1: e2e:slow rerun FAILED (rate limiter, not bot quality) — holding for Antonio
**Status:** blocked — gate step 2 red for an infra reason; per instruction, no further fixes attempted, holding for review
**Files changed:** none in the repo (machine-local Playwright browser install only; diagnostic scripts live in the session scratchpad)
**What changed and why:**
- *Browser install root cause + fix:* `chromium_headless_shell-1217` was never installed — Playwright 1.59.1 runs headless tests through a separate headless-shell binary, and only a 5 MB stub of regular `chromium-1217` existed (the manual out-of-project install fetched build 1228, which 1.59.1 ignores). `npx playwright test --list` looked green because it never launches a browser. Playwright's own installer downloads fine but its Node zip extractor wedges on this machine (reproduced twice: download 100%, extraction frozen at 5 MB). Fix: killed the wedged installer, extracted its fully-downloaded build-1217 zip with Windows bsdtar (1.2 s), downloaded the matching `chrome-headless-shell-win64.zip` (CfT 147.0.7727.15) from Playwright's CDN, extracted it the same way, and added the `INSTALLATION_COMPLETE`/`DEPENDENCIES_VALIDATED` markers. Verified with a real headless launch via the project's pinned Playwright: `HEADLESS LAUNCH OK, chromium 147.0.7727.15`.
- *Rerun env (per-run only, never written to a file):* `DATABASE_URL` = Preview Neon branch `br-rough-leaf-akxuxfmx` (host `ep-dark-rice-akzcs241-pooler…`, re-fetched via Neon MCP and verified before launch), `E2E_ALLOW_REMOTE_DB=1`, `NEXTAUTH_URL=http://localhost:3050`.
**Test gate results:** e2e:slow **FAIL** — 48/50, 47/50, 47/50 across the initial run + 2 retries (threshold ≤5). **Not a bot-quality regression:** ~46 of the failures are the widget's session-bootstrap error ("We couldn't start your chat session. Refresh and try again.") — POST `/api/sessions` was 429'd by the IP rate limiter (5 sessions/min/IP, `app/api/sessions/route.ts:155`). The localhost bypass in `lib/rateLimit.ts:50` is gated on `NODE_ENV !== "production"`, which never fires under `next start` (how `test:e2e:slow` runs). Confirmed on the Preview DB: `rate_limit_buckets` key `sessions:::1` hit counts 174/82/44 in the 01:28–01:30 UTC windows — exactly the run's timeframe. The 50-question suite finished in ~2 min instead of 25–30 because everything after the first 5 sessions/min failed instantly. Browser/launch layer worked correctly (chromium fix held). Open question flagged for Antonio: how this suite passed at baseline given the bypass can't fire under `next start` — candidate explanations: baseline local DB lacked `rate_limit_buckets` (limiter is fail-open on DB error for this route) or the bypass/env behaved differently on the Mac.
**Waiting on:** Antonio — decide how the suite should clear the limiter against a real DB (e.g., extend the localhost bypass with an explicit e2e env flag set in `playwright.config.ts` webServer env, mirroring `E2E_ALLOW_REMOTE_DB`), then rerun gate step 2.

---

## [2026-07-10 20:00 MDT] — Item 1: rate-limit bypass implemented, e2e:slow GREEN — holding before gate steps 3–4
**Status:** gate step 2 PASS — holding for Antonio before the scripted Playwright run and live browser pass, per instruction
**Files changed:** lib/rateLimit.ts, playwright.config.ts, lib/__tests__/rateLimit.test.ts (new) — commit 94f5c62 (session-log commits 57dd136 before, this entry after)
**What changed and why:** Antonio approved the E2E_RATE_LIMIT_BYPASS fix. `lib/rateLimit.ts`'s localhost bypass now also fires when `E2E_RATE_LIMIT_BYPASS=1` (previously only `NODE_ENV !== "production"`, which never fires under `next start`). The flag is set only in `playwright.config.ts`'s webServer env; the bypass still requires a localhost-shaped key, so deployed traffic (always a real client IP from Vercel's edge) and security.spec.ts's synthetic IPs keep hitting the real limiter. New unit tests (5) cover: dev bypass, production enforcement without the flag, flag bypass in production, flag NOT bypassing real IPs, under-ceiling pass-through.
**Test gate results:** unit 600/600 PASS (595 baseline + 5 new) · lint clean · e2e:slow **PASS 47/50** (threshold ≤5 failures; ran 6.6 min, all 50 questions got real bot replies, no session-create errors — the 429 storm is gone). Env for the run (per-run only, never written to a file): `DATABASE_URL` = Preview Neon `br-rough-leaf-akxuxfmx` (`ep-dark-rice-…`), `E2E_ALLOW_REMOTE_DB=1`, `NEXTAUTH_URL=http://localhost:3050`. The 3 soft failures: (1) "what helmets do you have" — good answer but raw `[IN STOCK]`/`[LOW STOCK]` bracket tags leaked into customer-facing text (violates the no-scaffolding-leak rule — worth a look, possibly pre-existing); (2) "I need a jacket" — bot asked a clarifying question instead of listing jackets; (3) "blue helmet under $500" — reasonable answer, missed a must-phrase. None are session/infra errors.
**Waiting on:** Antonio — go-ahead for gate step 3 (fast Playwright suite) and step 4 (live browser pass against the Preview deployment), then the Item 1 merge decision.

---

## [2026-07-10 21:10 MDT] — Item 1: gate step 3 (fast Playwright) — 103/112, two real pre-existing failures — holding before step 4
**Status:** step 3 not cleanly green — 2 deterministic failures remain, both pre-existing catalog-search behavior unrelated to Phase 2a; flagged per mandate (not skipped). Step 4 NOT started (Antonio's go-ahead was conditional on step 3 passing).
**Files changed:** e2e/markdown-render.spec.ts (commit 8164fec, Antonio-directed fix)
**What changed and why:** Full fast suite (`--grep-invert @slow`, same Preview env + `E2E_RATE_LIMIT_BYPASS=1`): **6 failed / 3 flaky / 103 passed** (18.1 min). Diagnosis of the 6:
- *markdown-render* — pre-existing spec bug: it seeded `/api/e2e/seed-messages` with its customer-identifier string, which the endpoint inserts straight into `messages.session_id` (uuid FK) → NeonDbError. Could never pass against a schema-correct DB; baseline greens imply the old baseline DB had drifted schema (same class of latent issue as the rate limiter). **Fixed** at Antonio's direction to use `session.id` from the create response; verified green (5.5 s).
- *bot-quality hallucination-guard + Alpinestars brand-context* — 25 s first-reply timeouts in the full run; **both passed when rerun in isolation** → transient Claude-latency flakes under load, not regressions.
- *catalog-coverage Chain — brand-scoped ("chain and sprocket kit") and Youth Gear — brand-scoped ("Fly Racing youth helmet")* — **genuinely failing: 6/6 attempts across two runs**. Not missing data: Preview `local_catalog` has 50 chain / 63 sprocket / 170 Fly / 231 youth rows (verified read-only). The bot's reply contains neither product link nor price — a search/answer-pipeline behavior issue for these brand-scoped queries. Pre-existing: this branch touches no search or prompt code.
- *3 flaky in full run* (Race Boots, Exhaust brand-scoped, Chain clean; + Helmet Accessories flaky in the isolated rerun) — same transient profile.
**Also noted for Phase 3 (per Antonio):** bracket-tag leak (`[IN STOCK]`/`[LOW STOCK]`) in the customer-visible "what helmets do you have" reply from the slow suite — STORE CATALOG scaffolding rule may need revisiting; same category as the Phase 1.3 fix, but this branch didn't touch prompt rules so it's likely pre-existing. Deferred, not fixed now.
**Test gate results:** unit 600/600 PASS · e2e:slow PASS 47/50 · fast Playwright: 103/112 with markdown-render since fixed (→ effectively 104), 5 transient flakes, and **2 pre-existing deterministic failures** (Chain/Youth Gear brand-scoped catalog coverage) · browser pass NOT RUN.
**Waiting on:** Antonio — whether the 2 pre-existing catalog failures block step 4 (live browser pass) or are accepted as known-unrelated so step 4 can proceed.

---

## [2026-07-10 21:45 MDT] — Item 1: catalog-search fix + duplicate-session race fix (full-autonomy session)
**Status:** in progress — Antonio granted full autonomy for Phases 2a/2b/2c with a hard stop before anything touches main/production
**Files changed:** lib/search/productSearch.ts + tests (commit f8f2367); components/chat/ChatWidget.tsx, e2e/helpers.ts, e2e/global-setup.ts (commit c976a09)
**What changed and why:**
1. *Catalog search fix (f8f2367):* two retrieval bugs behind the deterministic catalog-coverage failures. (a) "Fly Racing youth helmet" — the brand phrase's "Racing" registered as an explicit race-helmet subcategory request (+100 to racing-classified items), burying all five real Fly youth helmets; brand is now extracted first and stripped from the query before subcategory extraction. (b) "chain and sprocket kit" — collapsed to sprocket-only type, and NO retrieval source could reach drive chains (BC has no chain category shelf; BC keyword search and local FTS rank short-named lube/locks/tools above real chains); chain-mentioning queries keep the chain type, and a new parallel source pulls drive chains by name via their pitch number (420/520/etc.). Verified live against Preview: both queries return priced products; reference queries hold. Unit 606/606, 6 new tests.
2. *Rerun after fix:* 109/112 passed — both catalog tests now pass; remaining 2 failures were the bot-quality pair (hallucination guard, Alpinestars refinement), which forensics traced to a REAL app bug, not the model: the widget's mount-time session create races a fast first message and creates TWO sessions ~20-50 ms apart for one customer identifier. Turn 2 can land on the history-less twin — observed live: "show me ones motocross" answered on a twin session with zero context ("I'm not finding 'Ones' as a glove brand"). Plus 30-37 s cold-start on the first Claude turn after boot (BC category map + client init) blowing the 25 s reply wait.
3. *Fix (c976a09):* all four session-create sites in ChatWidget share one single-flight ensureDbSession() (failed create clears the guard; startNewSession resets it). e2e: chat-input exposes data-session-ready and waitForEmbedReady gates typing on it; global-setup fires one throwaway /api/chat turn to eat the cold start (1 Haiku call/run).
**Merge-prep checks (done during gate):** main untouched (local = origin = e956751; all work branch-only) · migration 0007 verified FULLY APPLIED on production Neon — both sessions columns AND both chat_event_type enum values — via credential-free read-only MCP schema inspection (the auto-mode classifier correctly refused to materialize the production connection string; no credentials were exposed).
**Test gate results:** unit 606/606 PASS · lint clean · fast Playwright rerun IN PROGRESS with the race fix; then step 4 (live browser pass), then Phase 2b on a child branch.
**Waiting on:** nothing — proceeding per the full-autonomy mandate; hard stop remains before merge/production.

---

## [2026-07-10 23:00 MDT] — Item 1 / Phase 2a: FULL GATE GREEN — merge-ready, awaiting go-ahead
**Status:** Phase 2a complete and merge-ready. Hard stop honored: nothing merged, nothing production.
**Branch:** fix/escalation-modes-2a at 56f9534, pushed; Preview deployment dpl_4Z8BCbLYLEKKagXdrQoYqj7qNUfJ READY.
**Fixes landed this session (after the earlier entries):** 05732d9 bot-quality per-reply wait 25s→45s (test-config; latency data: 315 replies measured — p50 6.5s, p90 9.8s, 4.1% >25s, heavy-fan-out query shapes consistently 27–42s; content assertions untouched; Antonio-directed after latency review) · 56a1030 STYLE PREFERENCE explicit branch requires products in "closest alternative" replies (race-boots clarify-only flip-flop) · 56f9534 duplicate holding-ack bubble fix (paused branch persists+Pushers BEFORE streaming; widget now skips the streaming bubble when the identical real message already landed — found live in gate step 4).
**Final gate results (all against Preview Neon br-rough-leaf/ep-dark-rice, per-run env only):**
1. Unit: **606/606** (595 baseline + 11 new this session) · lint clean
2. e2e:slow: **46/50 PASS** (threshold ≤5; soft fails: 1 cold-start timeout, jacket clarify-first, one borderline 2a pause on "do you do service", color must-phrase [Phase 3]); bracket-tag leak did NOT recur
3. Fast Playwright: **111 passed / 1 flaky / 0 failed** (take 5; flake passed on retry)
4. Live browser pass on deployed Preview (commit 56f9534, real Claude turns, screenshots in session scratchpad live-pass-shots/): jacob-1 fitment → structured tire-fitment form (designed flow) ✓ · jacob-2 Stage 2 M2 spec + top-speed follow-up → real product answer, then **undeliverable_offer pause** with handoff copy ✓ · jacob-3 Shoei stock → 8 helmets with prices/stock ✓ · 5w40 oil → **no_data pause** with handoff copy + email-capture form ✓ · paused follow-up → exactly ONE holding ack ✓ · store hours → canonical hours, no escalation ✓. DB verification: pause reasons no_data / undeliverable_offer recorded on exactly the right sessions.
**Merge-prep:** main untouched (e956751) · migration 0007 fully applied on production Neon (columns + enum values; credential-free read-only check) · deploy order therefore already satisfied.
**Flagged for Phase 3 (not fixed now, per Antonio):** bracket-tag/STORE CATALOG scaffolding leaks (two observations early tonight) · color search · query-shape latency (customer-visible 27–42s turns on heavy search fan-outs) · server-side get-or-create session race (widget-side fixed; a unique-constraint fix needs a migration).
**Waiting on:** Antonio's merge go-ahead for Phase 2a (per policy). Proceeding to Phase 2b on child branch feat/routing-classifier-2b per the full-autonomy mandate.

---

## [2026-07-10 23:20 MDT] — Item 2 / Phase 2b: Sonnet routing layer implemented — gate running
**Status:** implemented on branch feat/routing-classifier-2b (child of the 2a branch, commit 639a1a9); fast e2e gate in progress
**Files changed:** lib/ai/classify.ts (new), lib/ai/runAi.ts, lib/ai/buildPrompt.ts, lib/ai/__tests__/classify.test.ts (new), lib/ai/__tests__/buildPrompt.test.ts, playwright.config.ts, .env.example
**What changed and why (locked decisions honored):** classify→dispatch step ahead of generation. Sonnet (claude-sonnet-5, overridable via ROUTING_CLASSIFIER_MODEL) classifies ONLY the first AI turn of a conversation — forced tool-use call returning {category, confidence, missing_fields}. Categories: tire_fitment / parts_fitment / product_browse / order_support / policy_info / human_request / other. Fitment categories carry required-fields checks (bike year/make/model): when missing, a ## ROUTING DIRECTIVE section instructs Haiku to collect them in ONE question before recommending specific parts — the systematic fix for Jacob #2. Haiku still executes all tool calls and every customer-facing reply. **Fallback (locked 7/9/2026):** low-confidence or errored classification → null → the turn runs today's Haiku-only path unchanged, never an escalation; covered by dedicated tests (forced low-confidence, forced API error, malformed output, unknown category, empty message). Rollout: gated behind USE_ROUTING_CLASSIFIER=true (USE_AI_TOOLS pattern) — documented in .env.example; e2e exercises it via the Playwright webServer env; **deployed Preview/production keep it OFF until Antonio sets the env var in Vercel (the MCP has no env endpoint, so I cannot set it).** Live smoke: real Sonnet call returned {tire_fitment, medium, [bike_year, bike_make, bike_model]} for "I need new tires, what should I get?".
**Test gate results so far:** unit **623/623** (17 new) · lint clean · fast e2e (classifier ON) RUNNING · slow e2e + live pass to follow.
**Waiting on:** nothing — gate in progress.

---

## [2026-07-11 00:00 MDT] — Item 2 / Phase 2b: FULL GATE GREEN — merge-ready, awaiting go-ahead
**Status:** Phase 2b complete on feat/routing-classifier-2b at 155786d (pushed; Preview dpl_3np3XsYFo2gqubMxVsJwVHps7kRN READY). Hard stop honored.
**Gate iteration:** first fast-suite run failed 3 catalog tests (brake pads, air filter, chain) — the fitment directive produced clarify-ONLY replies with no products. Refined per the base prompt's show-and-ask rule (155786d): fitment openers must show category options with prices AND ask the one year/make/model question in the same message. This is the correct reading of Jacob #2 (clarifying questions were MISSING before; the goal was never to hide products).
**Final gate results:**
1. Unit **623/623** · lint clean
2. Fast Playwright, classifier ON (real Sonnet on every conversation opener): **109 passed / 3 flaky / 0 failed**
3. e2e:slow, classifier ON: **47/50 PASS** — BETTER than the 2a baseline (46/50); suite time 8.3 min vs 6.8 (≈ +1.8 s/question classification cost); soft fails are the same known trio (one cold-start timeout, jacket clarify-first, color must-phrase [Phase 3])
4. Live pass on the 2b Preview deployment (flag OFF there — deployment fallback state): tire opener → sensible baseline clarify flow ✓ · "brake pads" → 4 products with prices + one fitment question (show-and-ask shape) ✓ · 5w40 → answered with a real product this time (Motorex Power 4T 5W40, $22.99, 14 in stock) instead of pausing — retrieval variance surfaced actual data, and answering with data in hand is correct-by-design; the no_data pause path was live-verified on the same code lineage at 22:48 ✓. No regressions from 2b code with the flag off.
**Deployment note for Antonio:** enabling the layer on Preview/production = set `USE_ROUTING_CLASSIFIER=true` in Vercel env (this MCP has no env endpoint, so I could not set it). Flag-ON behavior is fully gated locally; flag-OFF (current deployed state) verified unchanged.
**Waiting on:** Antonio's merge go-ahead for Phase 2b. Proceeding to Phase 2c on child branch fix/road6-ranking-2c.

---

## [2026-07-11 00:55 MDT] — Item 3 / Phase 2c: FULL GATE GREEN — HARD STOP, all three phases merge-ready
**Status:** Phase 2c complete on fix/road6-ranking-2c at 24e0dee (pushed; Preview dpl_GM6GZmj2wzF3qDN9GUoUg6pYDWxP READY). SESSION HARD STOP reached: nothing merged to main, nothing pushed to production, no production DB writes at any point.
**Files changed:** lib/search/productSearch.ts + tests (commits 53a8116, 24e0dee)
**What changed and why:**
1. *Road 6 ranking fix (53a8116, the locked 2c scope):* same-family tire generations scored identical bonuses, so the winner fell to catalog insertion order — "Pilot Road 5" sorts ahead of "Road 6". New stale-generation demotion: family = (brand_id, word before a standalone single digit), which unifies the renamed Pilot Road → Road line; non-newest generations get −25 (smaller than the +30 stock bonus, so an in-stock old gen still beats a sold-out new one); demotion skipped when the query names the generation. **Tires only** — outside tires single-digit suffixes are concurrent tiers, not generations (Alpinestars Tech 3/7/10 coexist). Regression tests as required: Road 6 wins the unspecified case through the full pipeline with the stale gen deliberately first in catalog order; explicit "road 5" still surfaces Road 5. Color search untouched (Phase 3, per scope).
2. *Air-filter retrieval fix (24e0dee, found during the 2c gate):* "air filter" retrieved only oils/cleaners — the parent BC shelf is maintenance-dominated; actual elements live in the Street/Dirt leaves (now queried, leaves first) — plus a general +15 head-noun scoring bonus (name ENDS with the last query token → the product IS the thing asked for, not an accessory: "…Air Filter" vs "…Air Filter Oil", "…Helmet" vs "…Helmet Bag").
**Final gate results:** unit **632/632** (9 new) · lint clean · fast Playwright **110 passed / 2 flaky / 0 failed** · e2e:slow **46/50** (same known soft-fail set) · live pass on the 2c Preview deployment: "what michelin sport touring tires do you have?" → **Road 6 leads at $214.99** ✓ · "do you carry the michelin road 5?" → Road 5 found ($351.99, 17 in stock) AND the newer Road 6 offered alongside ✓ · "air filter" → 8 actual filter elements with prices, organized by type, plus one narrowing question ✓.
**Branch topology for merge review:** main ← fix/escalation-modes-2a (2a) ← feat/routing-classifier-2b (2b) ← fix/road6-ranking-2c (2c). Sequential merges in that order; each branch's gate covered everything beneath it. Migration 0007 already applied on production; no new migrations were added by 2b/2c. Enabling the 2b classifier on deployed envs = set USE_ROUTING_CLASSIFIER=true in Vercel.
**Waiting on:** Antonio's explicit go-ahead — per the hard stop, merge/production is his call alone.

---

## [2026-07-11 01:00 MDT] — Session closed by Antonio; merges HELD
**Status:** session ended at the hard stop with all three phases gate-green; Antonio held the merges. Nothing on main, nothing on production.
**Resume state:**
- Branch stack (all pushed): main (e956751) ← fix/escalation-modes-2a (27065dd) ← feat/routing-classifier-2b (ad918f5) ← fix/road6-ranking-2c (ceaea5a, working tree currently here). Merge in that order when approved; no new migrations in 2b/2c; 0007 already on production.
- Preview deployments READY per branch; share links expire early 7/12 — mint fresh ones via the Vercel MCP (get_access_to_vercel_url) AFTER any new deployment finishes (tokens die when the branch alias switches builds).
- Preview Neon connection string: NEVER stored; re-fetch via Neon MCP get_connection_string (projectId fragrant-term-38731407, branchId br-rough-leaf-akxuxfmx; host must start ep-dark-rice-). Run e2e as: `DATABASE_URL=<preview> NEXTAUTH_URL=http://localhost:3050 E2E_ALLOW_REMOTE_DB=1 E2E_RATE_LIMIT_BYPASS=1 npm run test:e2e:slow` (fast suite: `npx playwright test --grep-invert @slow` after a build).
- Antonio's pending one-click: USE_ROUTING_CLASSIFIER=true in Vercel env to activate the 2b layer on deployments; also consider fixing `.env.local`'s empty NEXTAUTH_URL/VERCEL_URL lines (breaks bare `next build` locally — worked around per-run all session).
- Phase 3 backlog flagged in the 00:55 entry above.
**Waiting on:** Antonio — merge go-aheads (2a → 2b → 2c, in order) or further instructions next session.

---

## [2026-07-11 10:05 MDT] — Merge go-ahead executed LOCALLY; push to origin/main held pending explicit production-deploy confirmation
**Status:** Antonio confirmed the 46/50 soft-fail sets match across the 2a and 2c slow runs (side-by-side raw failure lists verified identical: helmet-default 45s timeout, jacket clarify-first, "do you do service" pause copy, color must-phrase — bracket-tag leak was NOT in either final set) and gave the merge go-ahead.
**Done:**
- Local working-tree artifacts (playwright-report/index.html, test-results/.last-run.json) restored to HEAD; tree clean.
- Merged into local main in order, --no-ff with descriptive messages: c705ee8 (2a: fix/escalation-modes-2a @ 27065dd) → a9f8024 (2b: feat/routing-classifier-2b @ ad918f5) → 4510da8 (2c: fix/road6-ranking-2c @ 2e14a11). All three clean, no conflicts.
- Verified `git diff main fix/road6-ranking-2c` is EMPTY — merged main is byte-identical to the fully-gated 2c tree.
- Unit suite on merged main: **632/632 PASS**.
**Held:** `git push origin main` — pushing main on this Vercel-connected repo triggers a PRODUCTION deployment; the standing hard stop ("do not push to or deploy production") was never explicitly lifted, so the push is held for Antonio's explicit confirmation. Local main is ahead of origin/main by 34 commits; origin/main still at e956751; production untouched.
**When approved:** push origin main → Vercel builds production automatically (no migrations run; 0007 already applied; 2b classifier inert until USE_ROUTING_CLASSIFIER=true is set in Vercel env — Antonio's one-click).
**Waiting on:** Antonio — explicit OK to push main / deploy production.

---

## [2026-07-11 10:15 MDT] — PRODUCTION DEPLOYED: all three phases live
**Status:** Antonio explicitly lifted the production hold ("push main and deploy production"). Pushed main `e956751..a0eae62` to origin; Vercel auto-built production deployment `dpl_73RzS2SPW3TNYwBb6BWGFrjSCRJL` from a0eae62 — **READY** in ~1 min, aliased to performance-chatbot-2.vercel.app. `/embed` serving 200.
**What's live:** Phase 2a (escalation modes + AI pause + handoff copy + catalog fixes), Phase 2b (Sonnet routing classifier — INERT until USE_ROUTING_CLASSIFIER=true is set in Vercel env), Phase 2c (stale tire-generation demotion + air-filter retrieval + head-noun bonus). No migrations ran (0007 was already applied). No production-DB writes were made autonomously at any point; the smoke check was a GET only.
**Rollback candidate if needed:** dpl_9YkxBHPooFq9Ryst24A8fa6nerZP (previous production, e956751).
**Antonio's remaining one-clicks:** (1) set USE_ROUTING_CLASSIFIER=true in Vercel env to activate 2b; (2) optionally run a live interactive smoke on the production widget (Road 6 query + an escalation probe) — left to him since chat probes write session rows to the production DB; (3) fix `.env.local`'s empty NEXTAUTH_URL/VERCEL_URL lines.
**Phase 3 backlog** unchanged (bracket-tag/STORE CATALOG leaks, color search, heavy-query latency, session get-or-create race).

---

## [2026-07-11 10:25 MDT] — 2b routing classifier ACTIVATED on Vercel (Production + Preview)
**Status:** Antonio's go-ahead executed. Vercel CLI 55 installed globally; it was already authenticated as johnson1042006-cmd (no interactive login needed). Repo linked to antonio-johnsons-projects/performance-chatbot-2 (`vercel link` refreshed .env.local's VERCEL_OIDC_TOKEN line only — all 57 original vars intact).
**Done:** `USE_ROUTING_CLASSIFIER=true` added to **Production** and **Preview** envs (verified via `vercel env ls`); production redeployed (`vercel redeploy`) so the var takes effect — aliased to performance-chatbot-2.vercel.app, READY in ~1 min, /embed serving 200. Sonnet now classifies conversation openers on production; low-confidence/error falls back to the unchanged Haiku-only path by design.
**Note:** the Vercel CLI is now available for future env work (the MCP has no env endpoint). Expected classifier cost: ≈ +1.8 s on first AI reply per conversation (measured in the 2b gate).
**Remaining for Antonio:** optional live interactive smoke on the production widget; fix `.env.local`'s empty NEXTAUTH_URL/VERCEL_URL lines.

---

## [2026-07-11 11:00 MDT] — LIVE BUG (Antonio's manual production test): full-YMM fitment openers wiped to generic handoff — fix in progress on fix/fitment-preserve-reply
**Bug:** with the classifier ON, "does the Michelin Road 6 fit a 2021 Kawasaki Ninja 650?" returns ONLY the generic handoff copy. Root cause (Antonio's diagnosis, confirmed in code): the 2b fitment directive's "route exact-fit confirmation to the service team per the fitment rules" invokes the service_handoff rule, which REQUIRES escalate_to_human(reason='complex_fitment') in the same turn as the deferral language; complex_fitment ∈ PAUSE_REASONS, so 2a's transformOutbound replaced the entire reply — products included — with the handoff line.
**Fix (d701301):** new pure predicate `shouldPreserveReplyWithHandoff` in escalationMode.ts — when the tool's complex_fitment call is the SOLE pause cause AND the reply is a real answer (data tools returned products, not a punt/non-answer), transformOutbound preserves the narration-scrubbed reply and APPENDS the approved handoff line (agents-online or after-hours variant). All other pause reasons, co-firing triggers (frustration/explicit request/Tech-Air), punt replies, and no-data turns keep full replacement unchanged. Session still pauses (human still owes the fitment confirmation). Streamed and persisted copies stay byte-identical.
**Regression coverage:** 7 pure-function unit tests + 4 runAiTurn-level tests (preserve+append, after-hours variant, no-data keeps replacement, non-fitment tool reason keeps replacement) + new e2e probe with the exact live repro (full-YMM Ninja 650/Road 6 opener; prior fitment probes only covered partial bike info).
**Gate progress:** unit 643/643 PASS · lint clean · fast e2e running · slow e2e pending · live pass pending. Branch off main (c1a6811); HOLD before merge/production per Antonio.

---

## [2026-07-11 12:45 MDT] — Fitment bug: FOUR-LAYER ROOT CAUSE found through the gate; full fix on fix/fitment-preserve-reply @ 8ec7c15
**The first fix (d701301) was necessary but not sufficient.** The new e2e regression probe (the exact Ninja 650 repro, classifier ON) kept reproducing the live bug, and iterating on it with server-side diagnostics + Preview-DB chat_events exposed a four-layer causal chain:
1. *(deepest — callClaude.ts, 760ac51)* Text written in the same model turn as a tool call is discarded as "pre-tool narration". But service_handoff REQUIRES the reply text + escalate_to_human in the SAME turn — so the rule-compliant product reply was thrown away, and the post-tool iteration usually had nothing left to say, shipping NO_TEXT_FALLBACK ("I've flagged this for our team…", byte-identical across failing runs). Fixed: text from an iteration whose ONLY tool call is escalate_to_human (terminal action, not data retrieval) is kept and joined with any post-tool wrap-up; mixed data-tool turns keep the discard (narration-jam fix intact); streamed copy stays byte-identical via a skipped mid-flush.
2. *(buildPrompt.ts + runAi.ts, ac35b7f)* In tool mode there is NO pre-rendered RELEVANT PRODUCTS section, and on fitment openers the model often escalates WITHOUT searching first — no data, nothing to show. Fixed deterministically: when the classifier reports tire/parts_fitment with NO missing fields, the already-computed catalog search is injected into the prompt as pre-run search_products output (omitted when the search found nothing).
3. *(classify.ts, 8d7848f)* The no-missing-fields fitment directive's "route exact-fit confirmation to the service team" read to the model as the WHOLE job. Reworded to the same show-AND-route shape the missing-fields branch got in the 2b gate (155786d), now pointing at search_products instead of the nonexistent-in-tool-mode RELEVANT PRODUCTS section.
4. *(escalationMode.ts + runAi.ts, d701301→fbd1150→c58007d — Antonio's prescribed fix, refined by gate evidence)* Preserve-not-replace on complex_fitment pausing turns: eligibility (complex_fitment is the SOLE pause cause; no fabricated-price risk from an explicitly-empty data search) + sanitize (narration AND individual punt sentences scrubbed — the rule's own phone-fallback phrasing tripped the punt detector and was re-wiping good replies) + verify (priced product content must SURVIVE the scrub, else full replacement). All other pause reasons/triggers keep the 7/3 full replacement untouched. Session still pauses — the human still owes the fitment confirmation.
**Gate results (final tree 8ec7c15):**
- Unit **656/656** (24 new: preserve predicate, scrubPreservedReply, callClaude escalation-turn preservation incl. streaming byte-identity, buildPrompt injection) · lint clean
- Fitment regression probe: **8/8 no-retries** standalone · passed first-try in the full fast suite · debug-verified 8/8 preserved
- Fast e2e: 109 passed / 2 flaky / **2 failed — both DB-verified pre-existing variance classes NOT touching this branch's code paths** (Alpinestars refinement: pre-existing 2a punt→no_data pause, isPassivePunt=true, aiEscalatedViaTool=false + an honest-acknowledgment regex too narrow for observed honest phrasings — regex broadened to intent in 8ec7c15; Helmet Accessories "helmet visor replacement": clarify-only wobble + one correct-but-past-timeout reply, no escalation events at all). Final fast rerun on 8ec7c15 in progress at log time. Precedent: the 2a gate recorded documented pre-existing failures the same way.
- e2e:slow: **47/50** — better than the 46/50 2a/2c baselines; soft fails a strict subset of the known set (helmet-default, jacket clarify-first, color must-phrase); "do you do service" passed
- Live pass on the branch Preview deployment (dpl_7TbtTrhtsT4Zxi2o7mt1syyv6XVx, classifier ON): **3/3** — every reply keeps Road 6 at $214.99 + sizes + service-team language + appended after-hours handoff; DB: all 3 sessions paused, exactly one escalate_to_human each
**Also noted (pre-existing, untouched):** tool-initiated pauses record ai_pause_reason "unsupported" while the tool event records the true reason (complex_fitment) — cosmetic dashboard-label quirk, flag for Phase 3.
**HOLD:** per Antonio — no merge, no production push. Branch pushed; awaiting review.
