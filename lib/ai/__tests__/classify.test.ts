import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (e: unknown) => e,
}));

import {
  classifyRouting,
  routingDirective,
  routingClassifierEnabled,
  shouldClassifyTurn,
  type RoutingClassification,
} from "../classify";

function toolUseResponse(input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use", id: "tu_1", name: "classify", input }],
    stop_reason: "tool_use",
  };
}

describe("classifyRouting", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the classification on high confidence", async () => {
    mockCreate.mockResolvedValue(
      toolUseResponse({
        category: "tire_fitment",
        confidence: "high",
        missing_fields: ["bike_year", "bike_make", "bike_model"],
      })
    );
    const result = await classifyRouting("what tires should I get?");
    expect(result).toEqual({
      category: "tire_fitment",
      confidence: "high",
      missingFields: ["bike_year", "bike_make", "bike_model"],
    });
  });

  it("returns the classification on medium confidence", async () => {
    mockCreate.mockResolvedValue(
      toolUseResponse({ category: "product_browse", confidence: "medium" })
    );
    const result = await classifyRouting("looking for something warm");
    expect(result).toEqual({
      category: "product_browse",
      confidence: "medium",
      missingFields: [],
    });
  });

  it("FALLBACK: low confidence returns null (Haiku-only path, no escalation)", async () => {
    mockCreate.mockResolvedValue(
      toolUseResponse({ category: "other", confidence: "low" })
    );
    expect(await classifyRouting("hmm")).toBeNull();
  });

  it("FALLBACK: classification API error returns null (Haiku-only path, no escalation)", async () => {
    mockCreate.mockRejectedValue(new Error("api down"));
    expect(await classifyRouting("do you carry helmets?")).toBeNull();
  });

  it("returns null when the response has no tool_use block", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "tire_fitment" }],
      stop_reason: "end_turn",
    });
    expect(await classifyRouting("what tires fit my bike")).toBeNull();
  });

  it("returns null on an unknown category", async () => {
    mockCreate.mockResolvedValue(
      toolUseResponse({ category: "banana", confidence: "high" })
    );
    expect(await classifyRouting("banana")).toBeNull();
  });

  it("returns null for an empty message without calling the API", async () => {
    expect(await classifyRouting("   ")).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("filters unknown missing_fields values", async () => {
    mockCreate.mockResolvedValue(
      toolUseResponse({
        category: "order_support",
        confidence: "high",
        missing_fields: ["order_number", "shoe_size"],
      })
    );
    const result = await classifyRouting("where is my order?");
    expect(result?.missingFields).toEqual(["order_number"]);
  });
});

describe("routingDirective", () => {
  const make = (
    category: RoutingClassification["category"],
    missingFields: RoutingClassification["missingFields"] = []
  ): RoutingClassification => ({ category, confidence: "high", missingFields });

  it("tire_fitment with missing fields instructs show-and-ask in one message", () => {
    const d = routingDirective(
      make("tire_fitment", ["bike_year", "bike_make", "bike_model"])
    );
    expect(d).toMatch(/bike year, bike make, bike model/);
    // Both halves required: products with prices AND the one collecting
    // question — a clarify-only reply and a products-only reply both violate
    // the directive.
    expect(d).toMatch(/prices and links/i);
    expect(d).toMatch(/ask ONE friendly question/i);
    expect(d).toMatch(/Never guess sizes/i);
  });

  it("parts_fitment with fields already provided routes to service-team confirmation", () => {
    const d = routingDirective(make("parts_fitment"));
    expect(d).toMatch(/already stated their bike/i);
    expect(d).toMatch(/service team/i);
  });

  it("order_support with missing lookup fields asks for them", () => {
    const d = routingDirective(make("order_support", ["order_email"]));
    expect(d).toMatch(/email used on the order/);
    expect(d).toMatch(/Do not speculate/i);
  });

  it("policy_info answers from the knowledge base", () => {
    expect(routingDirective(make("policy_info"))).toMatch(/KNOWLEDGE BASE/);
  });

  it("categories needing no directive return null", () => {
    expect(routingDirective(make("product_browse"))).toBeNull();
    expect(routingDirective(make("other"))).toBeNull();
    expect(routingDirective(make("human_request"))).toBeNull();
  });
});

describe("gating", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless USE_ROUTING_CLASSIFIER=true", () => {
    expect(routingClassifierEnabled()).toBe(false);
    expect(shouldClassifyTurn(false)).toBe(false);
  });

  it("classifies only the first AI turn when enabled", () => {
    vi.stubEnv("USE_ROUTING_CLASSIFIER", "true");
    expect(shouldClassifyTurn(false)).toBe(true);
    expect(shouldClassifyTurn(true)).toBe(false);
  });
});
