import { describe, it, expect } from "vitest";
import { assessConfidence, assessSentiment } from "@/lib/ai/quality";

describe("assessConfidence", () => {
  it("returns high for clean responses with product data", () => {
    const result = assessConfidence(
      "[**Bell MX-9 MIPS**](https://performancecycle.com/products/bell-mx-9) — $239.99. In stock."
    );
    expect(result.confidence).toBe("high");
    expect(result.reasons).toEqual([]);
  });

  it("returns high for an empty/whitespace response", () => {
    expect(assessConfidence("").confidence).toBe("high");
    expect(assessConfidence("   ").confidence).toBe("high");
  });

  it.each([
    ["I don't have that color", /I don't have/],
    ["I'm not sure if that fits", /I'm not sure/],
    ["I couldn't find a match", /couldn't find/],
    ["You might want to call the shop", /you might want to call/],
  ])("flags low confidence on phrase %j", (text, expectedPattern) => {
    const result = assessConfidence(text);
    expect(result.confidence).toBe("low");
    expect(result.reasons.some((r) => expectedPattern.test(r))).toBe(true);
  });

  it("returns medium when (based on) appears without a product link", () => {
    const result = assessConfidence(
      "Hmm — (based on) what you've described, you might want a touring helmet."
    );
    expect(result.confidence).toBe("medium");
  });

  it("returns medium when 'approximately' appears without a product link", () => {
    const result = assessConfidence("That's approximately the right size for you.");
    expect(result.confidence).toBe("medium");
  });

  it("upgrades medium to high when a product link is present", () => {
    const result = assessConfidence(
      "Approximately matches: [**Bell**](https://performancecycle.com/products/bell-helmet)."
    );
    expect(result.confidence).toBe("high");
  });

  it("low takes precedence over medium markers", () => {
    const result = assessConfidence(
      "I don't have stock data, but it's approximately $200."
    );
    expect(result.confidence).toBe("low");
  });

  it("matches markers case-insensitively", () => {
    expect(assessConfidence("I DON'T HAVE that").confidence).toBe("low");
    expect(assessConfidence("i'm Not Sure here").confidence).toBe("low");
  });
});

describe("assessSentiment", () => {
  it("returns 0 for an empty list", () => {
    expect(assessSentiment([]).score).toBe(0);
  });

  it("returns 0 for neutral messages", () => {
    expect(assessSentiment(["hi", "do you sell helmets", "what about jackets"]).score).toBe(0);
  });

  it("returns +1 for thanks/great/that helps", () => {
    expect(assessSentiment(["thanks!"]).score).toBe(1);
    expect(assessSentiment(["that helps a lot"]).score).toBe(1);
    expect(assessSentiment(["awesome", "great"]).score).toBe(1);
  });

  it("returns -1 when 2+ of last 4 messages have frustration markers", () => {
    const result = assessSentiment([
      "this is ridiculous",
      "where is my order",
      "no one is responding",
      "speak to a manager",
    ]);
    expect(result.score).toBe(-1);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("returns 0 when only one message has frustration", () => {
    expect(
      assessSentiment(["hi", "this is ridiculous", "ok thanks"]).score
    ).toBe(1);
  });

  it("ignores frustration messages older than the last 4", () => {
    const result = assessSentiment([
      "this is ridiculous",
      "useless",
      "stop sending me emails",
      "ok cool",
      "anything else?",
      "where do I park",
      "what time do you open",
      "got it",
    ]);
    expect(result.score).toBe(0);
  });

  it("does NOT treat benign 'stop'/'fine' usage as frustration", () => {
    // FIX-3: these used to false-positive and pop the email form mid-chat.
    expect(
      assessSentiment(["can I stop by the store?", "can I stop by the store?"]).score
    ).not.toBe(-1);
    expect(
      assessSentiment([
        "is this fine for summer riding?",
        "is this fine for summer riding?",
      ]).score
    ).not.toBe(-1);
  });

  it("still treats sarcastic/terminal 'stop'/'fine' as frustration", () => {
    expect(assessSentiment(["just stop", "just stop"]).score).toBe(-1);
    expect(assessSentiment(["fine.", "fine."]).score).toBe(-1);
    expect(assessSentiment(["fine whatever", "fine whatever"]).score).toBe(-1);
  });

  it("matches double exclamation as frustration", () => {
    const result = assessSentiment(["wait what!!", "are you serious!!"]);
    expect(result.score).toBe(-1);
  });

  it("matches ALL CAPS run >=8 chars as frustration", () => {
    const result = assessSentiment(["WHAT THE HELL", "THIS IS BAD"]);
    expect(result.score).toBe(-1);
  });

  it("does NOT match short caps runs (<8 chars)", () => {
    expect(assessSentiment(["I want MIPS", "OK TY", "K"]).score).toBe(0);
  });

  it("matches third time / still haven't received", () => {
    const result = assessSentiment([
      "this is the third time",
      "I still haven't received it",
    ]);
    expect(result.score).toBe(-1);
  });

  it("only considers the last 4 messages for negative-count threshold", () => {
    const result = assessSentiment([
      "this is ridiculous",
      "useless",
      "ok",
      "what now",
      "thanks",
      "that helps",
    ]);
    expect(result.score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 2a: DIRECT frustration tier — one explicit "you are failing me"
// message scores -1 immediately, no 2-of-4 threshold. Keyed to Antonio's
// 7/2/2026 live-test miss verbatim.
// ---------------------------------------------------------------------------
describe("assessSentiment — direct frustration (single message)", () => {
  it("live case 3 verbatim: 'this isn't helping, I just need a real answer' scores -1 alone", () => {
    const result = assessSentiment(["this isn't helping, I just need a real answer"]);
    expect(result.score).toBe(-1);
    expect(result.reasons.some((r) => r.startsWith("direct:"))).toBe(true);
  });

  const directPhrases = [
    "you're not helping",
    "this is not helping at all",
    "that's not what I asked",
    "you're not listening to me",
    "we're getting nowhere",
    "can I get an actual answer?",
  ];
  for (const phrase of directPhrases) {
    it(`scores -1 on a single message: "${phrase}"`, () => {
      expect(assessSentiment([phrase]).score).toBe(-1);
    });
  }

  it("ambient markers still require 2 of the last 4 (single '!!' message stays 0)", () => {
    expect(assessSentiment(["where did my order go!!"]).score).toBe(0);
  });

  it("normal questions stay at 0", () => {
    expect(assessSentiment(["do you have 5w40 oil?"]).score).toBe(0);
    expect(assessSentiment(["what helps with fogging on this visor?"]).score).toBe(0);
  });
});
