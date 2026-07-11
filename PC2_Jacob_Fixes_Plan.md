# Performance Chatbot 2 — Jacob's Feedback Fix Plan

Source: Jacob's deployment notes (Jun 30, 2026) on the live-tested build, cross-referenced
against the repo (including existing debug logs and stress-test scripts already present
from a prior color-search investigation), and the escalation/routing-layer design drafted
in an earlier voice conversation.

**Sprint target (updated 7/6/2026 — supersedes the original Friday Jul 10 target):**
two-week sprint from July 6. This week (Jul 6–10): finish and merge Phase 2a. Next week
(Jul 13–17): Phase 2b (Sonnet classification layer) + the Phase 2c ranking fix. Remaining
time is buffer before Phase 3 and maintenance-only mode.

**Merge/production policy (decided 7/9/2026, applies to every remaining item):**
implementation and the full test gate (unit suite, e2e:slow, scripted Playwright, and a
real-browser pass against the live Preview deployment) run fully autonomously against the
Vercel Preview environment and its isolated Neon branch. Production pushes and ANY
interaction with the production Neon database require Antonio's explicit go-ahead at each
item - nothing is auto-merged. Each item stops at "gate green, awaiting go-ahead."

Work top to bottom within each phase. Phase 1 has no open decisions - start there immediately.
Phase 2a is scoped and ready once you say go. Phase 2c is no longer blocked (reframed
7/6/2026): it's now a direct code fix for the Road 5 vs Road 6 ranking bug, no BigCommerce
access needed - BC access is deferred to a Phase 3 dependency instead. Phase 3 is
explicitly deferred - do not start.

---

## STATUS - how Jacob's 8 notes map to this plan

| # | Jacob's note | Where it lands |
|---|---|---|
| 1 | Color search broken (blue helmet -> not blue; green street -> "none") | Phase 3 (BC-dependent; moved out of 2c 7/6/2026) |
| 2 | No clarifying questions, esp. tires | Phase 2b (routing layer) |
| 3 | Defaults to stale product generation (Michelin Road 5->6, Commander II->III tires) | Phase 2c - direct code ranking fix (prefer current generation when unspecified; decided 7/6/2026, no BC access needed). Phase 1 KB-content-edit portion RESOLVED: no hardcoded stale names found - both Road 5 and Commander 2/3 are live-BC-catalog issues (see item 1.4). |
| 4 | Offers to answer specs it then can't deliver | Phase 2a (escalation mode) |
| 5 | Can't answer off-catalog questions, doesn't connect to a human | Phase 2a (escalation mode) |
| 6 | Doesn't know if in-store stock exists (5w40 oil case), tells customer to call | Phase 2a (escalation mode) |
| 7 | Recommends least-popular stock | Not in this sprint - no popularity data exists in schema (would need Lightspeed POS import). Logged as a post-launch roadmap item. |
| 8 | [Phone] bug eating part numbers | Phase 1 - already diagnosed, ready to fix |

Also carried over from the Master Fix plan and folded in here since they're deterministic
and quick: #2 hours guard close-out, #3 STORE CATALOG leak.

---

## PHASE 1 - Deterministic quick fixes (no open decisions, start now)

### 1.1 - Close out Master Fix item #2 (hours guard)
Already applied, 7/7 unit tests passing including the holiday-guard cases. Two things still
owed before this is truly done:
1. Run the full test suite (npx vitest run) - the new rule at index 0 renumbers the
   behavior-rules array, which could break any test keying off rule order/count/prompt length.
2. Deploy the branch to a Vercel preview (not production) and run a 3-probe smoke test:
   - Ask a normal hours question -> should return the canonical weekly line
     (Mon-Sat 9 AM-6 PM, Sun Closed - no timezone, since it's wrong half the year in CO).
   - Ask something unrelated that happens to contain a day + time-shaped string -> confirm the
     tightened regex (DAY + RANGE/STATE/HOURS_WORD, not DAY + any single clock time) doesn't
     false-positive.
   - Ask "are you open July 4th?" -> should defer to the website per the KB, NOT assert the
     weekly hours line. This proves the holiday guard holds in the live path, not just the
     unit test - time-sensitive given July 4th is this Saturday.

If the suite is green and all 3 probes behave, merge. If not, report the failing test/probe
output before touching anything else.

### 1.2 - The [Phone] bug (Jacob #8)
Root cause: PHONE_RE in lib/utils/redactPII.ts is matching numeric part numbers and
replacing them with [PHONE] before persistence - which is why the part number vanishes
from the stored row, the dashboard, the transcript, and the next-turn AI history (the AI
never even sees it, since redaction runs before storage, not just before display).

Task for Claude Code:
In lib/utils/redactPII.ts, PHONE_RE is over-matching numeric part numbers as phone
numbers and replacing them with [PHONE] before the message is persisted. Show me
the current regex and every call site. Tighten the pattern so it only matches
genuine phone-number shapes (e.g. standard 10-digit US formats with typical
separators/parens) and does not match bare alphanumeric part numbers or SKU-style
strings. Add/update unit tests in the corresponding test file covering: a real
phone number (should redact), a bare numeric part number (should NOT redact), and
an alphanumeric SKU (should NOT redact). Propose the diff - do not apply until I
approve.

### 1.3 - STORE CATALOG leak (Master Fix #3)
One-line rule addition in rules.ts forbidding internal section labels from appearing in
customer-facing text.

Task for Claude Code:
In the rules file used to build the system prompt (rules.ts), add a HIGH-priority
rule instructing the model to never output internal section labels like "STORE
CATALOG" verbatim in customer-facing replies - these are prompt-internal headers,
not customer language. Show me where similar rules live in the file so the new
rule matches the existing format and priority ordering. Propose the diff first.

### 1.4 - Stale KB model names (part of Jacob #3)
RESOLVED (see Phase 2c): no hardcoded stale model names found. Full-repo search confirmed
the only "Commander" in source is `Airoh: Commander 2` in taxonomy.ts (the Airoh helmet -
correct/current, and unrelated to Jacob's note, which was about Michelin Commander tires),
and "Road 5" appears in no content file at all. Both Road 5 and Michelin Commander 2/3 are
live-BC-catalog artifacts, not hardcoded content - moved to Phase 2c. Zero code changes.

Original scoping note (kept for context): Content edit, not code: the KB taxonomy hardcodes
outdated model names (e.g. "Airoh: Commander 2", "Road 5") that are no longer current stock.

Task for Claude Code:
Find where the knowledge base / product taxonomy content defines helmet and tire
model names (likely a KB seed file, JSON, or markdown content file - search for
"Commander 2" and "Road 5" to locate it). Show me the current entries and their
file location. Do not change anything yet - I need to confirm the correct current
model names before this is edited.

(You'll need to supply the correct current model names before Claude Code applies this one.)

---

## PHASE 2a - Escalation mode split (Jacob #4, #5, #6)

Design: Two escalation behaviors depending on situation, replacing the current
notify-only escalation (which doesn't stop the bot from continuing to answer questions it
just said it would defer):
- (a) Pause mode - for questions the bot cannot answer at all (off-catalog, needs
  in-store stock check) - flag for human, and stop generating further attempts on that
  specific question rather than guessing or repeating the offer to help.
- (b) Flag-and-stop mode - for questions the bot offers to answer but then can't
  deliver on (e.g., detailed specs it doesn't actually have data for) - don't make the
  offer in the first place if the data isn't available; if it's already made the offer,
  flag immediately rather than stalling.

**Status update 7/6/2026:** Migration 0007 (`0007_phase2a_escalation.sql`) is DONE -
applied and verified against production Neon: adds the `ai_paused` / `ai_pause_cleared`
enum values and the `ai_paused_at` / `ai_pause_reason` columns on `sessions`. No longer
a blocker. Remaining 2a work: finish and merge this week per the sprint target above.

Task for Claude Code:
Read the current escalation logic (search for where human-agent escalation is
triggered and notified - likely near the takeover/fallback code). Today it's
notify-only: it alerts a human but doesn't stop the AI from continuing to answer
in the same thread. I want to design (not yet implement) two escalation modes:
(a) pause mode - for questions the bot has no data to answer (off-catalog,
in-store-only stock checks) - flag for a human AND suppress further AI attempts
on that specific question; (b) flag-and-stop - for cases where the bot has already
offered to answer something it can't deliver - flag immediately, don't let it
stall or repeat the offer. Show me: where escalation is currently triggered, what
data is available at that point to distinguish case (a) vs (b), and a proposed
design for the mode split before writing any code.

---

## PHASE 2b - Routing / classification layer (Jacob #2)

Design: A deterministic classify->dispatch step ahead of generation. Each category
(e.g. parts_specialist for tires) can carry its own required-fields check (e.g., bike
year/make/model must be collected before the tool is called) and its own escalation
behavior baked in - this is what closes the "no clarifying questions" gap systematically
instead of patching it case by case.

This is a bigger lift than the Phase 1 guards - real engineering, not a one-file fix.
Model note (decided 7/6/2026): Sonnet handles ONLY the first routing/categorization
decision per conversation. Haiku still does all execution - tool calls and every
customer-facing reply. This is a classification-layer addition, not a full model swap.
(Original rationale stands: the gaps in Jacob's list are dispatch/retrieval gaps, not
reasoning-depth gaps - a smarter model given the same loose process would still
freelance, just more articulately, at higher cost.)

Fallback rule (decided 7/9/2026): if Sonnet's classification comes back low-confidence
or the classification call errors out, fall back to the current Haiku-only routing path
(exactly what runs today, as if the classification layer weren't there). Do NOT escalate
to a human/queue for this failure mode - escalation stays reserved for the Phase 2a
escalation-mode triggers. The fallback path needs its own tests (forced low-confidence,
forced error) since it's a new failure mode with no existing coverage.

Do not start this until Phase 1 and Phase 2a are closed out. When ready, this needs its
own gameplanning session before any Claude Code prompt is written - it's an architecture
change, not a guard.

---

## PHASE 2c - Stale-generation ranking fix (Jacob #3) - REFRAMED 7/6/2026, no longer blocked

Decided 7/6/2026: going with a direct code fix for the Road 5 vs Road 6 ranking bug -
when the customer doesn't specify a generation, prefer the current one (Road 6 over
Road 5; same principle covers Michelin Commander II -> III). This does NOT require
BigCommerce admin access, so 2c is no longer blocked. Scheduled alongside Phase 2b in
the week of Jul 13 (see sprint target at top).

Default rule confirmed 7/9/2026: when the customer doesn't specify a generation, the
bot defaults to Road 6 (the newer model). Confirmed this is a ranking/default-selection
bug, not a missing-product bug - both Road 5 and Road 6 are live on the storefront. The
fix must include a regression test asserting Road 6 wins the unspecified case. Color
search stays out of scope (Phase 3, pending BigCommerce admin access).

BigCommerce access is deferred to a Phase 3 dependency instead of blocking 2c. The
BC-dependent work moves with it:
- Color search (Jacob #1) - depends on how color is actually represented in the BC
  catalog data (attribute? variant option? free-text in description?) - now Phase 3.
- The BC-side checks originally scoped here: whether stale generations are still marked
  active/in-stock in BC, and whether there's a reliable "current/active" flag the
  catalog sync isn't respecting. (Neither model name is hardcoded in the repo -
  verified in item 1.4 - they surface from live BC catalog data.) Verify under Phase 3
  once BC access exists; the 2c code fix handles the customer-facing symptom meanwhile.

---

## PHASE 3 - Explicitly deferred, do not start

Dependency (added 7/6/2026): BigCommerce admin access - deferred here from Phase 2c.
It unblocks the BC-dependent items moved out of 2c: color search (Jacob #1) and the
BC-side stale-generation / active-flag checks.

Jacob #7 (recommends least-popular stock) - no popularity data exists in the current
schema; would require a Lightspeed POS import. Logged as a post-launch roadmap item, not
part of this sprint.

---

## Known infra gaps (flagged, not a plan phase - fix before public launch)

- **RESOLVED 7/2/2026 - Vercel Preview env was missing core secrets (scoped
  Production-only).** All 8 vars are now present in Preview scope: `NEXTAUTH_SECRET` and
  `ANTHROPIC_API_KEY` were mirrored into new Preview-scoped records (values copied from
  Production, verified identical); the 6 Pusher vars (`PUSHER_APP_ID`, `PUSHER_KEY`,
  `PUSHER_SECRET`, `PUSHER_CLUSTER`, `NEXT_PUBLIC_PUSHER_KEY`,
  `NEXT_PUBLIC_PUSHER_CLUSTER`) are stored as Vercel "sensitive" type (values not
  readable), so their existing records were target-extended to Production + Preview
  instead - Production values untouched either way. `NEXTAUTH_URL` was deliberately NOT
  added: NextAuth falls back to the per-deploy `VERCEL_URL` on Preview, which is correct.
  `CRON_SECRET` and the `VAPID_*` set remain Production-only (non-critical).
  Original issue (kept for context): every Preview deployment 500'd at the root with a
  NextAuth `NO_SECRET` error (digest 694159012), discovered 6/30/2026 while trying to
  preview-test item 1.1; the 1.1 code was fine - purely an env-scope gap, and 1.1 was
  smoke-tested locally as a workaround.
  - **Follow-up (not urgent):** Preview and Production currently share live Pusher
    channels/credentials, so Preview test traffic publishes to the same channels
    production does - fine for now, worth isolating (separate Pusher app or
    Preview-scoped creds) before Preview becomes a permanent staging environment
    alongside real customer-facing Production traffic.
- **RESOLVED 7/2/2026 - No isolated Preview/branch database.** Preview `DATABASE_URL`
  now points at Antonio's isolated Neon branch (`ep-dark-rice-...`), as its own
  Preview-scoped record; Production and Development are unchanged (still
  `ep-withered-silence-...`). The connection string was supplied as a one-time CLI
  instruction and is deliberately not recorded in this repo.
  - **Tripwire caveat:** the Neon-integration fallback vars (`POSTGRES_URL`,
    `POSTGRES_URL_NON_POOLING`, `DATABASE_URL_UNPOOLED`, `PGHOST`, etc.) still span all
    three environments and point at the PROD database. They are currently inert because
    `lib/db/index.ts` reads `DATABASE_URL` first in its precedence chain - but if the
    Preview-scoped `DATABASE_URL` record is ever deleted, Preview would silently fall
    back to reading/writing production. Don't remove that record without re-pointing
    the fallbacks too.
- **Migration journal gap (not urgent - housekeeping):** migrations
  `0006_session_token.sql` and `0007_phase2a_escalation.sql` exist as raw SQL in
  `drizzle/` but are not journaled in `drizzle/meta/_journal.json` (entries stop at
  0005) - both were applied by hand rather than via `drizzle-kit migrate`. Fine as-is,
  but backfill the journal entries if this repo ever moves to the formal drizzle-kit
  migration flow.
