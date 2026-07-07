# PC2 Phase 2a - Escalation Mode Split (Implementation Plan for Claude Code / Fable)

**Owner:** Antonio
**Timeframe:** End of July (no hard weekly deadline - prioritize getting the design
right over speed)
**BigCommerce dependency:** NONE. This phase is fully independent of BC access. It
touches escalation/handoff logic only, not the product catalog.
**Working discipline:** ONE step at a time. Investigate -> propose -> wait for approval
-> apply -> verify. Never auto-apply. Never batch. Never jump ahead to the next step
until the current one is explicitly confirmed done. Show a diff before every code
change and run the full test suite (npx vitest run) after every applied change.

---

## 1. Background - what problem this solves

Three of Jacob's eight live-test complaints trace to the same root cause: the bot's
escalation is notify-only. When the bot hits something it can't handle, it alerts
a human in the background but keeps talking to the customer anyway - guessing,
stalling, or passively telling them to "call the store" or "check the website." The
customer then leaves without ever being connected to a person.

Jacob's exact words from his feedback email:
"When it doesn't know if we have something, it should connect them to us rather
than just telling them to call. For example, I had asked if we have 5w40 oil. We
don't have it on the website, but we have it in store, but it basically said it
didn't know and to check the chemical page... If it isn't sure, it should try to
connect it to one of us so the customer doesn't check, not see it, and leave."

And:
"It tends to prompt me to ask follow up questions it can't answer. It asked me if I
wanted to know the specs on the stage 2 m2 I asked about, but when I asked for the
top speed, it didn't know and moved on."

The three complaints this phase addresses:
- #4 - Bot offers to answer specs it then can't deliver (the "stage 2 M2 top
  speed" case)
- #5 - Bot can't answer off-catalog questions and doesn't connect to a human
- #6 - Bot doesn't know if in-store stock exists (the 5w40 oil case), tells the
  customer to call instead of connecting them

---

## 2. The design - two escalation modes + active handoff

Replace notify-only escalation with two distinct, deliberate modes. The core behavior
change in BOTH modes: when escalation fires, the bot stops trying to answer the
thing it can't answer, and instead performs an ACTIVE handoff to a human.

### Mode (a) - Pause mode
When: The bot has no data to answer the question at all.
Examples: off-catalog questions, in-store-only stock checks (5w40 oil), anything
where the answer simply isn't in the bot's reach.
Behavior:
- Flag for a human (the existing notify path).
- Suppress further AI generation attempts on that specific question - do not
  guess, do not redirect to the website, do not repeat an offer to help.
- Emit an active-handoff message to the customer.

### Mode (b) - Flag-and-stop mode
When: The bot has already offered to answer something it then can't deliver on
(offered helmet/vehicle specs, then didn't have the data when asked).
Behavior:
- Ideally: don't make the offer in the first place if the data isn't available
  (prevention). See section 6 for how far to take this in 2a vs. defer.
- If the offer was already made and the follow-up can't be answered: flag
  immediately and hand off - do NOT stall, change the subject, or "move on" (the
  exact failure Jacob described).

### The active-handoff requirement (applies to both modes)
Per Jacob, the customer-facing message must read like an active handoff, not a
passive punt. The difference:

- Passive (current, failing): "I'm not sure - you can call the store at
  303-744-2011" / "check the chemical page on our website."
- Active (target): "Let me get someone from our team to help you with this -
  hang tight for a moment." (plus whatever backend action actually surfaces the
  session to a human with appropriate urgency.)

The copy should make the customer feel handed off, not dismissed. Exact wording is a
step in the plan below (section 5, step 4) - propose 2-3 variants for Antonio to pick.

---

## 3. STEP-BY-STEP PLAN

Each step is investigate/propose-first. Do not write code until the step says
"implement," and even then, show the diff and wait for approval before applying.

### Step 0 - Read and map the current escalation system (investigation only)
Produce a written map, no code changes:
1. Where is escalation currently triggered? (Search for the escalation/takeover/
   fallback code - likely escalateToHuman, notifyEscalation, or similar.) List
   every trigger point and what condition fires it.
2. What is the current escalation payload/flow? What happens after a trigger -
   what gets written to the DB, what Pusher event fires, what the dashboard shows,
   what (if anything) the customer sees.
3. Critically: after escalation fires today, does the AI keep generating replies
   in that thread? Confirm the exact code path that shows it's notify-only (this
   is the behavior we're changing). Quote the relevant lines.
4. What data is available at the escalation decision point to distinguish mode
   (a) from mode (b)? (e.g., is there conversation state showing the bot previously
   offered something? is there a confidence/reason field already? what does the
   escalation reason enum currently contain?)
5. Is there an existing "reason" or "confidence" signal on escalation we can extend,
   or do we need a new field?

Deliverable: a written map + the answer to "what distinguishes (a) vs (b) with
data we already have vs. data we'd need to add." Then STOP for review.

### Step 1 - Design the mode split (design only, no code)
Based on Step 0, propose:
1. How mode (a) vs (b) is determined at runtime - the actual decision logic.
   Be explicit about what signal drives it. If the bot's own output has to be
   classified (e.g., "did it just offer something?"), say how.
2. The data model change (if any): new escalation reason/mode enum values, a
   pause flag on the session, etc. Show the proposed schema/type change.
3. The suppression mechanism for mode (a): how do we actually stop the AI from
   generating further attempts on that question? (e.g., a session-level or
   turn-level pause flag checked before runAiTurn.) Be specific about where the
   check goes and what resets it (does a human reply clear it? does a new unrelated
   question clear it?).
4. Edge cases to address explicitly:
   - Customer keeps typing after handoff fires but before a human responds - what
     happens? (Bot should not resume answering the paused question; should it
     acknowledge, stay quiet, reassure?)
   - False positive: bot escalates something it actually could have answered - how
     recoverable is this? (A human sees it and can just answer - acceptable - but
     confirm the flow doesn't lock the session weirdly.)
   - No human available / after hours - what does the customer see then? (This is
     important: an active handoff that goes nowhere is worse than a passive punt.
     Needs a defined fallback - see section 4 open question.)

Deliverable: written design covering all of the above. STOP for review. Do not
proceed to code until Antonio approves the design.

### Step 2 - Implement the data model / state changes
Only after Step 1 is approved. Implement the schema/type/enum changes for the mode
split and the pause mechanism. If this touches the DB schema (Drizzle), propose the
migration explicitly and note it's a migration (phased migrations 0000-0006 exist;
this would be the next one). Show the diff. Run npx vitest run. STOP for review.

### Step 3 - Implement the suppression logic (mode a - pause)
Wire the pause flag so that when mode (a) fires, subsequent AI generation on that
question is suppressed. Add/extend the check before the AI turn runs. Show the diff.
Add unit tests covering: pause fires -> AI does not generate; pause clears correctly
on the defined reset condition. Run npx vitest run. STOP for review.

### Step 4 - Implement the active-handoff customer message + mode (b)
1. Propose 2-3 variants of the customer-facing handoff copy (active, warm, not
   dismissive) for Antonio to choose from - for both the "human coming" case and
   the after-hours/no-human fallback case.
2. Wire mode (b): when the bot has offered something and can't deliver the follow-up,
   trigger flag-and-stop + the handoff message instead of stalling.
3. Show the diff. Add unit tests for mode (b) triggering and for the handoff message
   appearing in the reply. Run npx vitest run. STOP for review.

### Step 5 - Full verification
1. Run the full suite (npx vitest run) - confirm green.
2. Write (or describe) a smoke test analogous to the Phase 1.1 approach: exercise the
   real path locally against .env.local (NOT the broken Preview env) with probes
   that reproduce Jacob's three cases:
   - 5w40 oil ("do you have 5w40 oil?") -> should hit mode (a), active handoff,
     no passive "check the chemical page."
   - Spec follow-up ("what's the top speed of the stage 2 M2?" after the bot
     offered specs) -> should hit mode (b), flag-and-stop + handoff, not "moved on."
   - A normal answerable question -> should behave normally, NO escalation
     (guard against over-escalation / false positives).
3. Report raw outputs for Antonio to judge against pass/fail before any merge.

### Step 6 - Land it
Same pattern as Phase 1: commit onto main (or a branch if Antonio prefers), show
git status + git log, wait for explicit go-ahead before pushing (push = prod
deploy).

---

## 4. Open questions for Antonio to answer during the plan (don't guess these)

1. After-hours / no-human-available fallback. An active handoff that goes
   nowhere is worse than the current passive punt. When no agent is online, what
   should the customer see? Options: (i) collect their contact info + "someone will
   reach out," (ii) fall back to a softened version of the passive message, (iii)
   something else. This needs a real answer before Step 4.
2. What clears a mode-(a) pause? A human agent replying? The customer asking a
   totally different, answerable question? A timeout? Define this in Step 1.
3. How aggressive should escalation be? Over-escalation annoys customers and
   buries agents in false flags; under-escalation reproduces the current problem.
   Where's the line? (Lean toward Jacob's stated preference - better to connect than
   to let them leave - but confirm.)

---

## 5. Guardrails / non-goals for this phase

- No BigCommerce work. If a step seems to need catalog data structure, that's a
  sign it belongs in Phase 2c, not here - flag it and move on.
- No routing/classification layer. That's Phase 2b. 2a is escalation behavior
  only. Don't build the classify->dispatch layer here, though note any place where 2a
  and 2b will interface (2b will eventually decide category, and category may
  inform escalation reason - just note the seam, don't build it).
- No agentic tool-use loop. Explicitly deferred to post-launch per prior
  decision.
- Don't touch Phase 1 code unless a genuine bug is found (if so, flag separately).
- Preview env is now fixed (see Known infra gaps in PC2_Jacob_Fixes_Plan.md,
  resolved 7/2/2026) - Preview deployments should work for smoke-testing in
  addition to local .env.local testing.

---

## 6. A design judgment call to surface early (for Step 1 discussion)

Mode (b) has two possible depths:
- Shallow (recommended for 2a): react - when the bot can't deliver a follow-up
  it offered, flag-and-stop + handoff. Doesn't require the bot to know in advance
  what it can/can't answer.
- Deep (may belong in 2b): prevent - stop the bot from offering things it can't
  deliver in the first place. This likely requires knowing what data is actually
  available for a given product/spec, which starts to overlap with the
  routing/classification layer (2b) and possibly catalog data (2c).

Recommendation: implement the shallow version in 2a (it directly fixes Jacob's
observed failure), and note the deep prevention version as a 2b/2c consideration.
Confirm this scoping with Antonio at Step 1 rather than silently picking one.

---

## 7. Definition of done for Phase 2a

- Two escalation modes implemented and distinguishable at runtime.
- Mode (a) genuinely suppresses further AI attempts on the un-answerable question.
- Mode (b) flags-and-stops instead of stalling/moving on.
- Both modes produce an ACTIVE handoff message to the customer, not a passive punt.
- A defined, non-broken after-hours/no-human fallback exists.
- Full test suite green, with new tests covering both modes + a no-over-escalation
  guard.
- Local smoke test reproduces Jacob's 3 cases with correct new behavior.
- Merged + deployed, or staged and awaiting Antonio's push.
