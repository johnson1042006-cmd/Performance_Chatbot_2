/**
 * Phase 2a mode-split decision logic. Pure functions — no mocking needed.
 */
import { describe, it, expect } from "vitest";
import {
  assessToolDataOutcome,
  containsOffer,
  decideEscalationReason,
  detectPuntSentences,
  scrubReply,
  shouldPauseForEscalation,
  replyAlreadyReadsAsHandoff,
  PAUSE_REASONS,
} from "../escalationMode";

describe("assessToolDataOutcome", () => {
  it("returns no_tools_ran when no tool calls happened", () => {
    expect(assessToolDataOutcome([])).toBe("no_tools_ran");
  });

  it("ignores non-data tools (escalate_to_human, sizing lookups)", () => {
    expect(
      assessToolDataOutcome([
        { name: "escalate_to_human", output: { ok: true } },
        { name: "lookup_helmet_sizing", output: { url: "https://x" } },
      ])
    ).toBe("no_tools_ran");
  });

  it("returns no_data when search_products came back empty", () => {
    expect(
      assessToolDataOutcome([
        { name: "search_products", output: { count: 0, products: [] } },
      ])
    ).toBe("no_data");
  });

  it("returns got_data when search_products found products", () => {
    expect(
      assessToolDataOutcome([
        { name: "search_products", output: { count: 3, products: [{}, {}, {}] } },
      ])
    ).toBe("got_data");
  });

  it("returns no_data when get_product_details found nothing", () => {
    expect(
      assessToolDataOutcome([
        { name: "get_product_details", output: { found: false } },
      ])
    ).toBe("no_data");
  });

  it("returns got_data when get_product_details found the product", () => {
    expect(
      assessToolDataOutcome([
        { name: "get_product_details", output: { found: true, product: {} } },
      ])
    ).toBe("got_data");
  });

  it("treats errored data-tool calls as not-data", () => {
    expect(
      assessToolDataOutcome([
        { name: "search_products", output: { count: 5 }, isError: true },
      ])
    ).toBe("no_data");
  });

  it("one successful data call outweighs empty ones", () => {
    expect(
      assessToolDataOutcome([
        { name: "search_products", output: { count: 0 } },
        { name: "get_product_details", output: { found: true } },
      ])
    ).toBe("got_data");
  });
});

describe("containsOffer", () => {
  const offers = [
    "Would you like to know the specs on the Stage 2 M2?",
    "Want me to pull up the details?",
    "I can also look up sizing for that helmet if you want.",
    "Happy to share more details on the battery.",
    "Let me know if you'd like the full spec sheet.",
  ];
  for (const text of offers) {
    it(`detects an offer in: "${text}"`, () => {
      expect(containsOffer(text)).toBe(true);
    });
  }

  const nonOffers = [
    "Here are three street helmets I'd recommend.",
    "The Shoei RF-1400 runs $599.99 and is in stock.",
    "We're open Monday through Saturday, 9 AM to 6 PM.",
  ];
  for (const text of nonOffers) {
    it(`does NOT flag a plain answer: "${text}"`, () => {
      expect(containsOffer(text)).toBe(false);
    });
  }

  it("handles null/undefined/empty safely", () => {
    expect(containsOffer(null)).toBe(false);
    expect(containsOffer(undefined)).toBe(false);
    expect(containsOffer("")).toBe(false);
  });
});

describe("decideEscalationReason", () => {
  const base = {
    sentimentScore: 0,
    confidence: "high",
    isExplicitHumanRequest: false,
    isTechAirServiceRequest: false,
    toolDataOutcome: "no_tools_ran" as const,
    priorAiOffer: false,
    replyIsPunt: false,
  };

  it("frustrated customer wins over everything", () => {
    expect(
      decideEscalationReason({
        ...base,
        sentimentScore: -1,
        confidence: "low",
        isExplicitHumanRequest: true,
      })
    ).toBe("frustrated_customer");
  });

  it("explicit request beats the low-confidence branch", () => {
    expect(
      decideEscalationReason({
        ...base,
        isExplicitHumanRequest: true,
        confidence: "low",
      })
    ).toBe("explicit_request");
  });

  it("mode (a): low confidence + no data + no prior offer => no_data", () => {
    expect(
      decideEscalationReason({
        ...base,
        confidence: "low",
        toolDataOutcome: "no_data",
      })
    ).toBe("no_data");
  });

  it("mode (a): low confidence with no tools ran also => no_data", () => {
    expect(
      decideEscalationReason({
        ...base,
        confidence: "low",
        toolDataOutcome: "no_tools_ran",
      })
    ).toBe("no_data");
  });

  it("mode (b): low confidence + no data + prior offer => undeliverable_offer", () => {
    expect(
      decideEscalationReason({
        ...base,
        confidence: "low",
        toolDataOutcome: "no_data",
        priorAiOffer: true,
      })
    ).toBe("undeliverable_offer");
  });

  it("bare low confidence WITH retrieved data stays unsupported (notify-only)", () => {
    expect(
      decideEscalationReason({
        ...base,
        confidence: "low",
        toolDataOutcome: "got_data",
        priorAiOffer: true,
      })
    ).toBe("unsupported");
  });

  it("a passive punt forces no_data even when tools returned (irrelevant) data", () => {
    expect(
      decideEscalationReason({
        ...base,
        confidence: "high",
        toolDataOutcome: "got_data",
        replyIsPunt: true,
      })
    ).toBe("no_data");
  });
});

describe("detectPuntSentences / scrubReply — Antonio's 7/2/2026 live-test replies verbatim", () => {
  // ── Live miss #1: the 5w40 punt that slipped through ──────────────────────
  const LIVE_5W40_PUNT =
    "I can also suggest you call the shop at 303-744-2011 or check our Parts section.";

  it("live case 1: detects the 5w40 punt (deflection verb, no inability admission)", () => {
    expect(detectPuntSentences(LIVE_5W40_PUNT, "Do you have 5w40 oil?")).toHaveLength(1);
  });

  it("live case 1: detects it even without the availability-question context", () => {
    // "suggest you call" + "or check our" are in-sentence deflection cues
    expect(detectPuntSentences(LIVE_5W40_PUNT, "something unrelated")).toHaveLength(1);
  });

  it("live case 1: scrubs the punt sentence but keeps the rest of the reply", () => {
    const reply =
      "We carry a range of motorcycle oils from Motorex, Bel-Ray, and Maxima.\n\n" +
      LIVE_5W40_PUNT;
    const { cleaned, puntSentences } = scrubReply(reply, "Do you have 5w40 oil?");
    expect(puntSentences).toHaveLength(1);
    expect(cleaned).toContain("Motorex, Bel-Ray, and Maxima");
    expect(cleaned).not.toContain("303-744-2011");
    expect(cleaned).not.toContain("suggest you call");
  });

  // ── Live miss #2: punt language stacked with the handoff ─────────────────
  const LIVE_M2_PUNT =
    "If you want the full performance details, give the team a call at 303-744-2011 and they can walk you through it.";

  it("live case 2: detects the M2 punt ('give the team a call … walk you through')", () => {
    expect(detectPuntSentences(LIVE_M2_PUNT, "what's the top speed")).toHaveLength(1);
  });

  it("live case 2: scrub removes the punt so only the hedge + handoff remain visible", () => {
    const reply = "I don't have the top speed specs pulled up here right now. " + LIVE_M2_PUNT;
    const { cleaned } = scrubReply(reply, "what's the top speed");
    expect(cleaned).toBe("I don't have the top speed specs pulled up here right now.");
  });

  // ── Live miss #3: search narration (no_search_narration violation) ───────
  const LIVE_NARRATION =
    "That search didn't return helmets - it grabbed race gear instead.";

  it("live case 3: scrubs the search-narration sentence", () => {
    const reply =
      LIVE_NARRATION + " Here are some street options I'd recommend instead.";
    const { cleaned, narrationSentences } = scrubReply(reply, "show me helmets");
    expect(narrationSentences).toHaveLength(1);
    expect(cleaned).toBe("Here are some street options I'd recommend instead.");
  });

  it("scrubs other observed narration phrasings", () => {
    for (const s of [
      "The search is picking up motorcycle oils instead of truck diesel oil.",
      "The search didn't find Shell Rotella T6 diesel oil in our catalog.",
      "That's because our catalog search leans toward riding gear and accessories.",
    ]) {
      expect(scrubReply(s + " We do carry motorcycle oils.", null).narrationSentences.length).toBe(1);
    }
  });

  // ── Safety: legitimate phone mentions survive ─────────────────────────────
  it("does NOT flag the hours answer (phone number is the answer, not a punt)", () => {
    const reply =
      "Monday–Saturday: 9 AM–6 PM · Sunday: Closed\n\n" +
      "We're located at 7375 S Fulton St., Centennial, CO 80112. If you need to reach us, " +
      "you can call 303-744-2011 during business hours.";
    const { cleaned, puntSentences } = scrubReply(reply, "what are your store hours?");
    expect(puntSentences).toHaveLength(0);
    expect(cleaned).toBe(reply);
  });

  it("'do you have weekend hours?' is an hours question, not an availability question", () => {
    const reply = "We're closed Sundays. You can call 303-744-2011 during business hours.";
    expect(detectPuntSentences(reply, "do you have weekend hours?")).toHaveLength(0);
  });

  it("keeps the sanctioned secondary-phone service-handoff sentence", () => {
    const reply =
      "Our service team monitors this chat and will jump in to confirm what'll fit your specific bike. " +
      "If you'd rather not wait, you can also call 303-744-2011.";
    expect(detectPuntSentences(reply, "will this sprocket fit my bike?")).toHaveLength(0);
  });

  it("does NOT flag a normal product answer", () => {
    const reply =
      "Yes! We carry 5w40 oil — the Motorex Power 4T Full Synthetic runs $22.99 per quart and it's in stock.";
    expect(detectPuntSentences(reply, "Do you have 5w40 oil?")).toHaveLength(0);
    expect(scrubReply(reply, "Do you have 5w40 oil?").cleaned).toBe(reply);
  });

  it("returns cleaned='' when the entire reply is one punt sentence (caller substitutes handoff)", () => {
    const { cleaned, puntSentences } = scrubReply(LIVE_5W40_PUNT, "Do you have 5w40 oil?");
    expect(puntSentences).toHaveLength(1);
    expect(cleaned).toBe("");
  });
});

describe("Antonio's 7/3/2026 live re-test misses — pinned verbatim", () => {
  // ── Miss 1: self-serve page-redirect punt after a prior offer ─────────────
  const LIVE_PRIOR_OFFER = "Want more details on specs or color options?";
  const LIVE_PAGE_PUNT =
    "I found the Stage 2 M2 but the product description I'm seeing is cut off. " +
    "You can see the full specs including top speed on the product page: " +
    "[Stage 2 M2](https://performancecycle.com/products/stage-2-m2)";

  it("miss 1: 'Want more details on specs or color options?' registers as an offer", () => {
    expect(containsOffer(LIVE_PRIOR_OFFER)).toBe(true);
  });

  it("miss 1: the page-redirect sentence is a punt (reply admits the data gap)", () => {
    expect(detectPuntSentences(LIVE_PAGE_PUNT, "whats the top speed")).toHaveLength(1);
  });

  it("miss 1: 'description I'm seeing is cut off' is scrubbed as narration; whole reply scrubs empty", () => {
    const { cleaned, puntSentences, narrationSentences } = scrubReply(
      LIVE_PAGE_PUNT,
      "whats the top speed"
    );
    expect(puntSentences).toHaveLength(1);
    expect(narrationSentences).toHaveLength(1);
    expect(cleaned).toBe("");
  });

  it("miss 1: got_data + page punt + prior offer => undeliverable_offer", () => {
    expect(
      decideEscalationReason({
        sentimentScore: 0,
        confidence: "high",
        isExplicitHumanRequest: false,
        isTechAirServiceRequest: false,
        toolDataOutcome: "got_data",
        priorAiOffer: containsOffer(LIVE_PRIOR_OFFER),
        replyIsPunt:
          detectPuntSentences(LIVE_PAGE_PUNT, "whats the top speed").length > 0,
      })
    ).toBe("undeliverable_offer");
  });

  // ── Miss 2: "or you can call … and they'll give you" punt construction ───
  const LIVE_THEYLL_GIVE_PUNT =
    "Our team can give you that answer right away. Want me to have someone follow up with you, " +
    "or you can call 303-744-2011 during business hours and they'll give you all the M2 specs.";

  it("miss 2: detects the 'or you can call … and they'll give you' punt", () => {
    expect(
      detectPuntSentences(LIVE_THEYLL_GIVE_PUNT, "this isn't helping, I just need a real answer")
    ).toHaveLength(1);
  });

  it("miss 2: scrub keeps 'Our team can give you that answer right away.' and drops the phone punt", () => {
    const { cleaned } = scrubReply(
      LIVE_THEYLL_GIVE_PUNT,
      "this isn't helping, I just need a real answer"
    );
    expect(cleaned).toBe("Our team can give you that answer right away.");
  });

  // ── Safety: the healthy answer-plus-link pattern must survive intact ─────
  it("healthy answer + supplementary product-page link (no gap admission) is NOT a punt", () => {
    const reply =
      "The Stage 2 M2 kit runs $4,299 and bumps output to 510 hp. " +
      "You can see the full spec sheet on the product page: " +
      "[Stage 2 M2](https://performancecycle.com/products/stage-2-m2)";
    expect(detectPuntSentences(reply, "whats the top speed")).toHaveLength(0);
    expect(scrubReply(reply, "whats the top speed").cleaned).toBe(reply);
  });

  // Accepted tradeoff (Antonio, 7/3/2026): a COLD page-redirect punt with no
  // gap admission anywhere in the reply still slips through — the admission
  // gate is what keeps healthy answer-plus-link replies from false-positive
  // pausing. This test documents the accepted behavior, not a bug.
  it("accepted tradeoff: unhedged cold page-redirect punt is NOT flagged", () => {
    const reply = "Check out the product page for the top speed and other specs.";
    expect(detectPuntSentences(reply, "whats the top speed")).toHaveLength(0);
  });
});

describe("shouldPauseForEscalation", () => {
  it("pauses for every reason in PAUSE_REASONS", () => {
    for (const reason of Array.from(PAUSE_REASONS)) {
      expect(shouldPauseForEscalation(reason, false)).toBe(true);
    }
  });

  it("does NOT pause for bare unsupported", () => {
    expect(shouldPauseForEscalation("unsupported", false)).toBe(false);
  });

  it("tool-initiated escalation always pauses, even with reason unsupported", () => {
    expect(shouldPauseForEscalation("unsupported", true)).toBe(true);
  });
});

describe("replyAlreadyReadsAsHandoff", () => {
  it("matches typical handoff phrasings", () => {
    expect(
      replyAlreadyReadsAsHandoff("I'm connecting you to a teammate now.")
    ).toBe(true);
    expect(
      replyAlreadyReadsAsHandoff(
        "Our service team monitors this chat and will jump in to confirm."
      )
    ).toBe(true);
  });

  it("does not match a passive punt", () => {
    expect(
      replyAlreadyReadsAsHandoff(
        "I don't have that information — you could check the chemical page on our website."
      )
    ).toBe(false);
  });
});
