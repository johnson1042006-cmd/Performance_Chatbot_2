/**
 * Phase 2a mode-split decision logic. Pure functions — no mocking needed.
 */
import { describe, it, expect } from "vitest";
import {
  assessToolDataOutcome,
  containsOffer,
  decideEscalationReason,
  shouldPauseForEscalation,
  replyAlreadyReadsAsHandoff,
  replyIsPassivePunt,
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

describe("replyIsPassivePunt (real replies observed in 7/2/2026 smoke run)", () => {
  it("flags the Rotella punt (search returned irrelevant hits, bot said call to ask)", () => {
    expect(
      replyIsPassivePunt(
        "I'm not finding Shell Rotella T6 15w40 diesel oil in our current inventory right now. " +
          "That said, it's worth checking the full chemicals category on our website or calling the team at 303-744-2011 " +
          "to ask directly if they have it in stock at the physical store."
      )
    ).toBe(true);
  });

  it("flags the Vespa punt (contact form + 'may be able to point you')", () => {
    expect(
      replyIsPassivePunt(
        "I can't confirm that our chain products are compatible with a vintage Vespa scooter. " +
          "If you want to ask our team directly, you can call 303-744-2011 or use our contact form " +
          "and they may be able to point you in the right direction."
      )
    ).toBe(true);
  });

  it("flags the M2 spec punt ('give them a call … they'll get back to you')", () => {
    expect(
      replyIsPassivePunt(
        "I don't have the top speed specs pulled up here right now. " +
          "Our team can walk you through it — give them a call at 303-744-2011 or use the contact form " +
          "and they'll get back to you with all the details."
      )
    ).toBe(true);
  });

  it("does NOT flag the hours answer (phone number is the answer, not a punt)", () => {
    expect(
      replyIsPassivePunt(
        "Monday–Saturday: 9 AM–6 PM · Sunday: Closed\n\n" +
          "We're located at 7375 S Fulton St., Centennial, CO 80112. If you need to reach us, " +
          "you can call 303-744-2011 during business hours."
      )
    ).toBe(false);
  });

  it("does NOT flag a normal product answer", () => {
    expect(
      replyIsPassivePunt(
        "Yes! We carry 5w40 oil — the Motorex Power 4T Full Synthetic runs $22.99 per quart and it's in stock."
      )
    ).toBe(false);
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
