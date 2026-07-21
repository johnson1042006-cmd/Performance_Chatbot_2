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
- Fast e2e: 109 passed / 2 flaky / **2 failed — both DB-verified pre-existing variance classes NOT touching this branch's code paths** (Alpinestars refinement: pre-existing 2a punt→no_data pause, isPassivePunt=true, aiEscalatedViaTool=false + an honest-acknowledgment regex too narrow for observed honest phrasings — regex broadened to intent in 8ec7c15; Helmet Accessories "helmet visor replacement": clarify-only wobble + one correct-but-past-timeout reply, no escalation events at all). Final fast rerun on 8ec7c15: **108 passed / 4 flaky / 1 failed** — Alpinestars now passes with the intent-aligned regex (flaky, recovered on retry), Helmet Accessories recovered on retry, fitment probe passed clean; the one hard failure is "Chain — brand-scoped query" ("chain and sprocket kit"), another pre-existing live-model variance case not touched by this branch (its search pipeline shipped in 2a/2c and is on main). Live-Claude suites are wobblier today across the board (multiple BigCommerce connect timeouts observed mid-suite). Precedent: the 2a gate recorded documented pre-existing failures the same way.
- e2e:slow: **47/50** — better than the 46/50 2a/2c baselines; soft fails a strict subset of the known set (helmet-default, jacket clarify-first, color must-phrase); "do you do service" passed
- Live pass on the branch Preview deployment (dpl_7TbtTrhtsT4Zxi2o7mt1syyv6XVx, classifier ON): **3/3** — every reply keeps Road 6 at $214.99 + sizes + service-team language + appended after-hours handoff; DB: all 3 sessions paused, exactly one escalate_to_human each
**Also noted (pre-existing, untouched):** tool-initiated pauses record ai_pause_reason "unsupported" while the tool event records the true reason (complex_fitment) — cosmetic dashboard-label quirk, flag for Phase 3.
**HOLD:** per Antonio — no merge, no production push. Branch pushed; awaiting review.

---

## [2026-07-11 21:30 MDT] — Session close: all three merges live on production; migration 0008 + colorway seed applied to prod
**Status:** done — the fitment, security, and color-search work is merged, pushed to `origin/main`, and live on the production Vercel deployment; production Neon carries migration 0008 and a fresh colorway seed. No open production actions.
**Merges now on `origin/main` (all three live on production):**
- *Fitment preserve-reply* — `47011a9` (merged/deployed in the prior session; production deploy `dpl_EyXJ5S…` at `47011a9`).
- *Color-search P1–P5* — merge `6f86982` (feature commits `f255288` P1+P2 shared color-option detection + colorway retrieval index, `01fbb75` P3+P4+P5 color-driven retrieval in the pipeline + cron + tests) plus standalone test-infra commit `0ea239d` (Vercel Deployment Protection bypass for e2e — `playwright.config.ts` `extraHTTPHeaders` + the four `e2e/global-setup.ts` warm-up fetches). Pushed `47011a9..6f86982`; production deploy `dpl_77k6E38U` READY at `6f86982`.
- *Security-hardening-audit* — merge `882bbf0` (commit `c9ee93e`: XSS, session-resume hijack, cost/authz hardening across chat intake / session-resume / admin surfaces + new unit coverage). Merged `--no-ff` clean (no overlap with color-search files), `npm run test` **696/696 PASS**, pushed `6f86982..882bbf0`. Local `main` and `origin/main` identical at `882bbf0`.
**Migration 0008 + colorway seed on PRODUCTION (confirmed):**
- Target verified before any write: production = Neon branch `br-proud-thunder-ak8d6v84` (name "main", primary+default), endpoint **`ep-withered-silence-akjootfm`** — distinct from the Preview branch `br-rough-leaf-akxuxfmx` / `ep-dark-rice-akzcs241` all the e2e work ran against. Host reported and confirmed before proceeding.
- Migration 0008 (`ADD COLUMN colorway_tsv` generated-stored tsvector over `regexp_replace(colorway_lower,'[/_,-]+',' ')` + GIN index `product_colorways_colorway_tsv_idx`) applied via Neon MCP against the prod branch — additive/idempotent, mirrors what ran on Preview. First attempt was silently denied by the auto-mode permission classifier; re-run succeeded after Antonio turned auto-mode off and approved. Verified: column ✅, GIN index ✅.
- Colorway seed run via the **real deployed production cron path** — `GET /api/cron/catalog-refresh` with the `CRON_SECRET` bearer (route exports GET only; initial POST returned 405 as expected), so it used `buildColorwayRows` → `rebuildProductColorways` with fresh BigCommerce data rather than a local script or raw INSERTs. Post-seed `product_colorways` row count confirmed on prod: **7,767 rows** (down from the 8,018 pre-seed rows — reflects the fresh catalog sweep). Color retrieval index is live in production.
**Also this session:** diagnosed the local `next build` failure — `.env.local` `VERCEL_URL=""` (a `vercel env pull` artifact) with no `NEXTAUTH_URL` makes NextAuth build `new URL('')` and fail every page at prerender; worked around per-run with an inline `NEXTAUTH_URL`, then Antonio added `NEXTAUTH_URL="http://localhost:3000"` to `.env.local` (VERCEL_URL left empty — correct for local dev). Local `@slow` run against the Preview branch DB passed **47/50** (threshold ≤5; the same known soft-fail trio — helmet-default, jacket clarify-first, color must-phrase; the "blue helmet under $500" color-retrieval itself worked, only tripping the markdown-bold `mentionsProduct` predicate). A remote-preview `@slow` attempt is NOT viable as-is (bot-quality creates a session per question and the live preview lacks `E2E_RATE_LIMIT_BYPASS`, so `data-session-ready` stalls under the 429 limiter — the bypass patch still helps the fast e2e specs against previews).
**Infra:** Vercel Firewall rate-limit rule is live in **log-only mode** (observe/measure, not yet blocking).
**Remaining backlog (nothing blocking; for a future session):**
1. LOW-severity security items from the audit (deferred — the merged fixes covered the higher-severity XSS / session-resume / cost-authz set).
2. Vercel **Bot Protection** toggle — evaluate/enable.
3. Query latency — investigate slow query paths.
4. Session-race migration — the mount-time double-session-create race (two sessions ~20–50 ms apart for one customer identifier); `verifySessionToken` / `sessionTokenStorage` landed in the security merge, but the durable DB-level fix/migration is still open.
5. Dashboard label cosmetic bug — tool-initiated pauses record `ai_pause_reason "unsupported"` while the tool event records the true reason (`complex_fitment`); label-only, no behavior impact.
**Waiting on:** nothing — session closed. Branch cleanup (`color-search-retrieval`, `security-hardening-audit`, both merged/live) offered, not yet actioned.

---

## [2026-07-12 17:05 MDT] — Fitment sweep fix: real customer message on sweep-served AI turns (fix/sweep-empty-latest-message)
**Status:** full gate green — branch `fix/sweep-empty-latest-message` pushed, live-verified on its Preview deployment under the exact bug condition. **HOLD per Antonio — no merge to main, no production push.**
**Root cause (confirmed on prod evidence before coding):** `processDueAiClaims` (lib/sessions/state.ts) called `runAiTurn` with `latestMessage: ""`; `classifyRouting("")` returns null silently (no log line), so the Phase 2b routing directive AND `includeProductContext` never applied on sweep-served turns. The sweep serves fresh sessions exactly when an agent dashboard is online (session waits out the 10s fallback timer; lazy tick fires from customer polling) — which is why production failed with the dashboard open while Preview smoke tests (agents offline → inline path passes the real message) kept passing. Prod evidence: sessions `a763cd5e`/`0c3e758d`/`b115af56` — searchProducts diag found "Michelin Road 6 Sport Touring Tires" (score 180) but ZERO `ai.classify.*` log lines on those turns; chat_events showed escalate_to_human(complex_fitment) as the only tool call, `toolDataOutcome: "no_tools_ran"`, reply = bare HANDOFF_HUMAN_COMING. Ruled out: flags (`ai.classify.routed` fired for a product_browse turn on the same prod deployment 8 min earlier; USE_AI_TOOLS/USE_ROUTING_CLASSIFIER present in both envs; ANTHROPIC_API_KEY identical) and stale deploy (prod 882bbf0 contains the whole d701301..c9ee93e fitment chain). Note for future diagnosis: the `complex_fitment` reason in AI Trace is the MODEL's escalate_to_human tool-call reason, not the Sonnet routing classifier — the two are independent signals.
**Fix (commit `1f5e491`):**
- `processDueAiClaims` loads the session's latest customer message from the DB (select content from messages where session_id + role='customer' order by sent_at desc limit 1) before `runAiTurn`.
- `/api/chat/ai-fallback` falls back to the stored latest customer message when the body omits `latestMessage` (cron/legacy caller shape).
- `classifyRouting` logs `ai.classify.empty_input_skipped` on blank input instead of bailing silently.
**Regression coverage:** new `lib/sessions/__tests__/processDueAiClaims.test.ts` drives the SWEEP entry point end-to-end (agents online, escalate-only tool turn): classifier receives the real opener, buildPrompt gets `includeProductContext: true` + the routing directive, persisted reply keeps priced product content with the handoff appended — 3/4 tests verified failing against pre-fix state.ts before landing. Existing preserve tests (escalation.test.ts §5b) only invoke runAiTurn directly (inline shape). Also added: route-level body-omitted fallback test (chat.test.ts), classifier empty-input log test (classify.test.ts).
**Gate:**
- Lint clean; unit **701/701 PASS**.
- Fast e2e (local, Preview Neon `ep-dark-rice`): **107 passed, 5 flaky-passed (catalog retries), 1 failed** — the failure is `markdown-render.spec.ts` and is PRE-EXISTING on main since the security merge (`c9ee93e` #2 session-resume hardening: the spec seeds a session via API, so the browser widget holds no session token, resume is now correctly refused, and the seeded message never renders). First exposed here because the security merge gated on unit tests only. Spec needs updating to pass the token to the widget — flagged, not fixed on this branch.
- @slow e2e (local, Preview Neon): **46/50 PASS** (threshold ≤5). Three of four failures are the documented soft-fail trio (helmet-default — a 45s reply timeout this run; jacket clarify-first; color must-phrase whose reply actually showed correct blue helmets). Fourth, `[policy] "do you do service"`, got a handoff-only reply on the INLINE path (after-hours copy, agents offline — not touched by this fix); net-new vs last session's 47/50, bot-variance territory, flagged.
- The new Ninja 650 full-YMM fitment probe **passed** (ran in the fast suite).
- **LIVE preview smoke — the exact bug condition** (deployment `dpl_ACmQT4Qo…` of this branch, agent dashboard logged in + presence ONLINE, fresh /embed session): asked "does the Michelin Road 6 fit a 2021 Kawasaki Ninja 650?" → reply arrived after **32s** (>10s fallback timer → sweep path), containing **"Michelin Road 6 Sport Touring Tires — $214.99"** + service-team language + appended HANDOFF_HUMAN_COMING; NOT the bare handoff. Corroborated in preview runtime logs for smoke session `d83259da…`: `ai.classify.routed {category: tire_fitment, confidence: high, missingFields: []}` fired ON the sweep turn (absent on all failing prod turns), only tool call = escalate_to_human(complex_fitment), `no_tools_ran` → product content provably came from the pre-rendered prompt section. Session paused for human follow-up as designed. Known cosmetic: one phone-fallback sentence survived the punt scrub (documented low-harm tradeoff in scrubPreservedReply).
**Infra notes:**
- `.env.production.local` (7/11 `vercel env pull` artifact; 25 sensitive vars pulled as `""`, incl. `NEXTAUTH_URL=""`, plus the PROD DATABASE_URL) **breaks local `next build`** at prerender (next-auth `new URL("")`) and, worse, points any local `next start` at the PRODUCTION database. Temporarily renamed during the gate (e2e ran with DATABASE_URL explicitly exported to the Preview branch + `E2E_ALLOW_REMOTE_DB=1`), then RESTORED as-is. Recommend deleting or fixing this file — flagged for Antonio.
- Stray `prod.env`/`preview.env` credential pulls from the diagnosis (repo root + scratchpad) deleted; verified never committed to git history.
**Waiting on:** Antonio's go-ahead to merge `fix/sweep-empty-latest-message` → main and deploy to production. Nothing else open on this fix.

---

## [2026-07-12 17:40 MDT] — Sweep fix LIVE on production + five follow-ups (fix/e2e-resume-token-spec)
**Deployed:** merge `59e6664` on `origin/main`, production deploy `dpl_836PKs2Ez…` READY (~47s build), aliased to performance-chatbot-2.vercel.app. Merge was created via `git commit-tree` (byte-identical to `--no-ff`) because local `main` is checked out in the `pc2-main-check` worktree; local `main` ref deliberately NOT moved (staged changes there). Push also published `89effac` (7/11 session-log commit that had never left the machine).
**PRODUCTION smoke (final proof):** dashboard open (agent presence online) + fresh /embed session on prod → Michelin/Ninja question answered after 41s (sweep path) with "Michelin Road 6 Sport Touring Tires — $214.99" + size range + appended handoff; prod logs show `ai.classify.routed {tire_fitment, high, []}` ON the sweep turn (session `7a71302e…`). One paused test session left in the prod queue — Antonio closing it himself.
**Worktree `~/Desktop/pc2-main-check` (investigated, untouched):** staged tree is byte-for-byte `main@4510da8` (7/10, pre-fitment/color/security) — the staged D of `sessions-resume-auth.test.ts` etc. is a mechanical side effect of staging the old tree, not targeted; the two PC2 planning docs are identical to the main repo's untracked copies; the session-log "edit" is just the older version. Nothing unique — disposable, Antonio deciding separately.
**Fixes on `fix/e2e-resume-token-spec` (commit `82e028a`):**
- `e2e/markdown-render.spec.ts` — seeds the widget's localStorage token (`pc-st:<customerIdentifier>`) from the create response via addInitScript, so resume survives the security hardening's ownership proof; passes 1/1 in 13s standalone.
- `docs/RUNBOOK.md` — new "Local env files — pull safely" section; `.env.production.local` DELETED (pull artifact: sensitive vars as `""` broke prerender, DATABASE_URL pointed local servers at PROD DB). Local `next build` works again with no workaround.
**"do you do service" (46/50 slow-run failure) — confirmed unrelated:** after-hours handoff copy ⇒ agents offline ⇒ inline path (auto-claim with the real message); Preview chat_events for the turn show punt→`no_data` pause (`isPassivePunt: true`, `no_tools_ran`, no tool escalation) — the pre-existing Phase 2a variance class; KB topics `service_info`/`tire_wheel_services` exist and the same question passed 7/11. Track if it recurs.
**Gate on `82e028a`:** full fast e2e **111 passed / 2 flaky-passed (known variance pair) / 0 failed**, exit 0 — markdown-render now green inside the full suite; fitment probe passed clean. RUNBOOK change is docs-only.
**Waiting on:** Antonio's go-ahead to merge `fix/e2e-resume-token-spec` → main.

---

## [2026-07-17 09:40 MDT] — Pre-Monday wrap-up: cleanup, re-verified gate, spec-fix merged + deployed + prod-smoked
**Status:** done — `main` = `a665008` on origin, production deploy READY, post-deploy smoke PASS. Repo is launch-ready for Monday.
**Cleanup (Antonio-directed, verified each step):**
- Prod test session `7a71302e…` needed no manual close — it had already closed itself: widget end-of-visit beacon + stale sweep (`stale_closed` chat event at 23:21:24Z on 7/12, matching `closed_at` exactly). Genuinely closed through the state machine.
- `~/Desktop/pc2-main-check` worktree removed (`git worktree remove --force`; directory gone, only the primary checkout remains). Local `main` re-pointed at `origin/main` and tracking restored — `git rev-parse main origin/main` byte-equal.
**Merge candidate re-verified before merge:** fresh full fast e2e on `fix/e2e-resume-token-spec` — **109 passed / 4 flaky-passed (known live-model variance family) / 0 failed**, exit 0 (second consecutive zero-hard-failure run on the branch; first was 111/0). Diff re-confirmed test/docs-only: `e2e/markdown-render.spec.ts`, `docs/RUNBOOK.md`, `PC2_Fable_Session_Log.md` — no runtime surface.
**Merge + deploy (Antonio's explicit go):** `git merge --no-ff` → merge commit **`a665008`** pushed to `origin/main` (normal checkout merge this time — the worktree pin was gone). Vercel production deploy `dpl_59Wk9hK7…` built from `a665008`, READY in ~87s, aliased to performance-chatbot-2.vercel.app, no alias errors.
**Post-deploy production smoke (same procedure as the incident verification): PASS.** Agent dashboard logged in (presence online) + fresh /embed session → Michelin/Ninja full-YMM opener answered after **34s** (>10s fallback timer ⇒ sweep path) with "Michelin Road 6 Sport Touring Tires — $214.99" + in-stock size options + service-team language + appended HANDOFF_HUMAN_COMING. The smoke's own session will self-close via beacon + stale sweep as before.
**Standing watch items for launch week (unchanged):** web-push 403 warns (stale VAPID subscription — Pusher realtime unaffected); "do you do service" punt variance (recurred once 7/12, inline path); Vercel Firewall rate-limit rule still log-only; post-launch backlog per the 7/11 entry (LOW-sev security items, Bot Protection, query latency, session-race durable fix, pause-reason label).

## [2026-07-20 18:23 MDT] — Phase 3 / Phase A audit (A1–A4): read-only verification COMPLETE — no code changes, holding for decisions

**A1 — Confirmed ranking pipeline (corrects the snapshot hypothesis).** The stale-generation penalty does NOT live in `buildPrompt.ts` — it is inside `searchProducts()` itself (`lib/search/productSearch.ts:1111-1114`), applied as a `-25` term in the single `scoreProduct()` pass, gated on `productType === "tire"`. Confirmed end-to-end order:

```
searchProducts(query)                       [lib/search/productSearch.ts]
  1. SKU exact-match short-circuit
  2. Signal extraction: productType, brand, subcategory, budget, color, keywords
  3. Candidate pool: 8 parallel strategies, unioned + deduped (≤200)
  4. ProductType compatibility filter (only applies if ≥5 survivors)
  5. scoreProduct() single pass:
       +120 brand · +100 explicit subcategory · +60 type term · +40 color
       +30 in-stock · +10/kw (max 40) · +15 head-noun · −50 off-street bias
       −25 stale tire generation (tires only, newer sibling in pool,
            suppressed if query names the generation digit)
       −1000 over stated budget max
  6. Sort desc → hard budget filter → brand diversify (cap 3/brand, top 12;
     cap lifted when brand named) → color-confirm branch
                                            [lib/ai/buildPrompt.ts:340-395]
  7. primarySearch + latestSearch union; discussedProduct unshifted to front
  8. featureSorted (MIPS/waterproof re-rank, stable)
  9. sortByBudget
 10. capByBrand(…, 10) → displayProducts → RELEVANT PRODUCTS block
```

Key implication for Phase B: the generation-penalty anchor is in `productSearch.ts` scoring, not `buildPrompt` — B1 generalization extends `computeStaleGenerationPenalties()` (`productSearch.ts:643`, pure, unit-testable) and its call-site gate. Comment at :606-611 documents WHY it's tire-gated: single-digit suffixes elsewhere are concurrent tiers (Alpinestars Tech 3/7/10), exactly the false-positive class B1 must design around. Penalty (25) deliberately < in-stock bonus (30).

**A2 — CONFIRMED: premium-first is prompt-only.** No premium/tier weighting anywhere in the scoring path. The only brand list in code is `KNOWN_BRANDS_LOWER` (`productSearch.ts:503`) — used solely by `extractBrand()` for query parsing, tier-unaware. Premium ordering exists only as the `brand_preference` rule (`lib/ai/rules.ts:141-142`) plus the budget rule's cross-reference (`rules.ts:162`). Phase C's premise holds; whether it's *needed* still depends on A5 drift measurement.

**A3 — CONFIRMED: USE_AI_TOOLS=true in Production.** Direct env read blocked (classifier denied `vercel env pull` — full secret dump), so confirmed from ground truth instead: production `chat_events` has 257 `type='tool_call'` rows, latest **today (7/20)** — `search_products` 171, `escalate_to_human` 41, `get_product_details` 38, `get_product_by_variant_sku` 3, `lookup_helmet_sizing` 3, `lookup_order` 1. Tools are live and firing daily ⇒ ranking changes must be verified on BOTH injection paths (pre-retrieved RELEVANT PRODUCTS block and tool-returned results); both share `searchProducts`, so a scoring-level change covers both — but gate smokes should exercise both. `USE_ROUTING_CLASSIFIER` also present (Production, added 7/11).

**A4 — KB inventory: 21 rows, ZERO lineage facts.** Live prod `knowledge_base` topics: arai_vas_system, bicycles_disclaimer, bopis, bot_persona, bot_settings, ebike_info, financing, gift_cards, helmet_sizing_guide, jacket_sizing, motobucks, payment_methods, return_policy, service_info, shipping_geography, shipping_policy, store_catalog, store_catalog_index (refreshed 7/20), store_hours, tire_wheel_services, what_we_sell. No FAQ rows (`is_faq=true` count: 0). No model-lineage / "current generation" knowledge exists for ANY family — the tire freshness win was purely ranking-side. Phase D is greenfield.

**Gate A status:** A1–A4 were read-only — zero diffs, nothing to test. A5 (measurement logging) NOT started: it is the phase's only code change and Antonio's decision list (#1: merge A5 early vs. keep on-branch) precedes any code. Holding at the decision gate.

## [2026-07-20 19:05 MDT] — Phase A5: ranking + link telemetry implemented, GATE GREEN — merging early per Antonio's go

**Antonio's decisions (this session):** A5 merge early ✅; B3 precedence proposal accepted; C and E gated on A5 data; D scope (tires/flagship helmets/Tech-Air/top jackets) accepted. Working phase-by-phase; hard stop before Phase B.

**Change (branch `feat/a5-ranking-telemetry`) — telemetry only, zero behavior change:**
- `lib/ai/brandTiers.ts` (new, pure): premium/budget tier lookup mirroring the `brand_preference` rule lists; unit test enforces sync with rules.ts prose. Becomes Phase C's single source of truth if tiering is promoted to a ranking signal.
- `lib/ai/replyAudit.ts` (new, pure): reply link/bold scanner — link count, bold count, unlinked-bold count, and per-shown-product mentioned/linked status via a key-phrase matcher (leading year stripped, generic tail nouns trimmed so "the Shoei RF-1400" matches "Shoei RF-1400 Helmet").
- `lib/ai/buildPrompt.ts`: emits `event="ai.ranking_snapshot"` per turn (productType, color, budgetMax/Min, featureCount, preSortIds vs postSortIds + `reordered` flag, leadBrandTier, leadName, colorMatchCount/otherColorsOnlyCount — same predicate as the rendered [COLOR MATCH] tags — and toolMode). Returns optional `rankingMeta` in PromptResult. Try/caught so telemetry can never kill a turn.
- `lib/ai/runAi.ts`: emits `event="ai.reply_link_audit"` on turns with shown products, measured against `assessedText` (the UNREPLACED model reply, so pausing-turn handoff replacement doesn't mask dropped links). Carries colorBranch + leadBrandTier for correlation. Try/caught.

**Live-sample finding folded back in:** first real turn showed the model links products as `**[Name](url)**` (bold wrapping link), not `[**Name**](url)`. Both are working links; the scanner initially miscounted the former as unlinked-bold. Fixed (bold counts as linked if it sits inside a link text OR fully wraps a link) + regression test quoting the live sample.

**Gate results:**
- Unit: 716/716 green (incl. 16 new brandTiers/replyAudit tests), lint clean, typecheck hook clean.
- Live local verification (dev server, real Claude turns, tool mode on): both events fired with correct payloads on (a) "blue street helmet under $300" — productType/color/budget all detected, leadBrandTier=premium, colorMatch 10/10, reply audited 1 link/1 linked product; (b) "klim marrakesh jacket in pink" — low-confidence turn audited correctly with zero product mentions.
- Fast e2e vs Preview Neon (`E2E_ALLOW_REMOTE_DB=1`): 110 passed / 2 flaky-passed / 1 "failed" — Exhaust catalog row, shown to be the known cold-turn latency family (failure artifact = 25s widget timeout still "Waiting for an agent"; different exhaust rows failed vs flaked across runs; isolated warm rerun **2/2 passed in 21.9s**). Zero reproducible failures. Slow suite not required: prompt bytes, tool gating, and search pipeline untouched.

**Early ranking signals already visible in the two local samples (Phase B fodder, logged not acted on):** "blue street helmet under $300" ranked "Shoei RF-1400 Helmet Shield (CWR-F2)" (an accessory) at #1 — head-noun +15 didn't outweigh brand+type+color on an accessory; "klim marrakesh in pink" led with "Klim Neck Warmer". Accessory-vs-product separation may deserve a slot in the B3 precedence discussion.

## [2026-07-20 19:10 MDT] — Phase A5 MERGED + DEPLOYED to production — Phase A complete, HARD STOP before Phase B

Merge commit `ef51600` pushed to origin/main; Vercel auto-deploy `dpl_3io1EKpTooHxvoVqw9vktfziJ5wK` built and aliased to performance-chatbot-2.vercel.app (Ready, 41s build). Read-only prod checks: /embed 200, zero error/fatal runtime logs on the new deployment. The permission classifier (correctly) blocked sending a synthetic customer message to production, so the in-prod event confirmation rides on the first organic AI turn — grep `ai.ranking_snapshot` / `ai.reply_link_audit` in Vercel logs; local live verification on the same commit already confirmed both events fire with correct payloads. No organic turns in the first minutes post-deploy (Sunday evening).

**Phase A closed.** Next session opens Phase B (freshness/generation ranking) — anchor: generalize `computeStaleGenerationPenalties()` (lib/search/productSearch.ts:643) + its tire-only call-site gate (:1111), per the A1-confirmed pipeline. B3 precedence accepted by Antonio; note the accessory-vs-product observation from the A5 samples as a candidate discussion item. C/E remain gated on accumulating A5 production data.
