# Performance Chatbot 2 — Jacob's Feedback Fix Plan

Source: Jacob's deployment notes (Jun 30, 2026) on the live-tested build, cross-referenced
against the repo (including existing debug logs and stress-test scripts already present
from a prior color-search investigation), and the escalation/routing-layer design drafted
in an earlier voice conversation. Target: shippable by Friday, July 10 (~7 working days,
accounting for the Jul 4 weekend).

Work top to bottom within each phase. Phase 1 has no open decisions - start there immediately.
Phase 2a is scoped and ready once you say go. Phase 2b (routing layer) is the piece most
likely to slip past Friday - treat Phase 1 + 2a as the hard commitment, 2b/2c as "as far as
we get," with 2b the highest-value stretch goal. Phase 2c is BLOCKED on BigCommerce
access (three checks pending) - do not start until that's unblocked. Phase 3 is explicitly
deferred - do not start.

---

## STATUS - how Jacob's 8 notes map to this plan

| # | Jacob's note | Where it lands |
|---|---|---|
| 1 | Color search broken (blue helmet -> not blue; green street -> "none") | Phase 2c (blocked on BC) |
| 2 | No clarifying questions, esp. tires | Phase 2b (routing layer) |
| 3 | Defaults to stale product generation (Michelin Road 5->6, Commander II->III tires) | Fully Phase 2c (blocked on BC). Phase 1 KB-content-edit portion RESOLVED: no hardcoded stale names found - both Road 5 and Commander 2/3 are live-BC-catalog issues (see item 1.4). |
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
Model note: don't broadly swap the whole bot to Sonnet. The gaps in Jacob's list
(phantom colors, stale SKUs, no clarifying questions) are dispatch/retrieval gaps, not
reasoning-depth gaps - a smarter model given the same loose process will still freelance,
just more articulately, at higher cost. Instead: try Sonnet specifically for the
classification step once the routing layer exists, and decide from real before/after data
whether it's worth it (possibly tiered - Sonnet classifies, Haiku still generates the
final reply).

Do not start this until Phase 1 and Phase 2a are closed out. When ready, this needs its
own gameplanning session before any Claude Code prompt is written - it's an architecture
change, not a guard.

---

## PHASE 2c - Color search + stale product surfacing (Jacob #1, #3) - BLOCKED

Blocked on BigCommerce access. Three checks needed before this can be scoped:
1. How color is actually represented in the BC catalog data (attribute? variant option?
   free-text in description?) - this determines why "blue helmet" search returns wrong
   results and "green street" returns none.
2. Whether stale/discontinued product GENERATIONS are still marked active/in-stock in BC,
   or whether the bot is defaulting to them from a stale local cache/KB independent of
   BC's actual current state. Two confirmed examples, both Michelin tire lines where an
   older generation surfaces over the current one: Michelin Road 5 -> 6 (sport-touring)
   and Michelin Commander II -> III (cruiser/touring). Neither model name is hardcoded
   anywhere in the repo (verified in item 1.4) - they surface from live BC catalog data,
   so the fix is BC-side generation / active-flag handling, not a content edit.
3. Whether there's a reliable "current/active" flag in BC that the catalog sync isn't
   currently respecting.

Do not start Claude Code work on this phase until these three checks come back.

---

## PHASE 3 - Explicitly deferred, do not start

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
