/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AI_BEHAVIOR_RULES } from "../rules";

// ---------------------------------------------------------------------------
// AI_BEHAVIOR_RULES integrity
// ---------------------------------------------------------------------------
// Single source of truth for which rule IDs the prompt is expected to ship
// with. New rules should be added here AND in `lib/ai/rules.ts` together —
// the bidirectional guard test below makes either-side drift a hard failure.
const EXPECTED_RULE_IDS = [
  "color_availability_redirect",
  "multiple_recommendations",
  "no_discontinued",
  "no_call_store",
  "color_fuzzy_matching",
  "full_text_search",
  "parse_descriptions",
  "return_policy",
  "ebikes",
  "service_policy",
  "service_handoff",
  "product_pairings",
  "conversation_memory",
  "qualifying_questions",
  "no_pre_tool_narration",
  "no_hallucinate_contact",
  "no_hallucinate_features",
  "no_hallucinate_products",
  "color_strict_recommendations",
  "inventory_preference",
  "product_type_accuracy",
  "airbag_categorization",
  "brand_preference",
  "size_in_variant_data_only",
  "variant_level_stock_accuracy",
  "brand_diversity",
  "respect_budget",
  "no_invented_products",
  "we_sell_gear_not_vehicles",
  "no_invented_brands",
  "verbatim_product_data",
  "street_default",
  "helmet_discipline_guardrails",
  "brand_discipline_routing",
  "accessory_pairings",
  "kit_building_flow",
  "follow_up_product_block",
  "product_discipline_accuracy",
];

describe("AI_BEHAVIOR_RULES", () => {
  it("contains all expected rule IDs", () => {
    const ruleIds = AI_BEHAVIOR_RULES.map((r) => r.id);
    for (const id of EXPECTED_RULE_IDS) {
      expect(ruleIds).toContain(id);
    }
  });

  it("AI_BEHAVIOR_RULES matches expected list exactly (no missing, no extras)", () => {
    // Bidirectional guard: missing IDs AND extra IDs both fail. If you add a
    // new rule to lib/ai/rules.ts, you MUST add its id to EXPECTED_RULE_IDS
    // above. Likewise, removing a rule requires removing it from the list.
    const ruleIds = [...AI_BEHAVIOR_RULES.map((r) => r.id)].sort();
    const expected = [...EXPECTED_RULE_IDS].sort();
    expect(ruleIds).toEqual(expected);
  });

  it("every rule has a non-empty label and rule text", () => {
    for (const rule of AI_BEHAVIOR_RULES) {
      expect(rule.label.length).toBeGreaterThan(0);
      expect(rule.rule.length).toBeGreaterThan(10);
    }
  });

  it("no_call_store rule contains key prohibitions", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "no_call_store");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("call the store");
    expect(rule!.rule).toContain("visit in person");
  });

  it("return_policy rule references the returns URL", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "return_policy");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("performancecycle.com/returns-exchanges");
  });

  it("no_hallucinate_features rule warns about specific features", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "no_hallucinate_features");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("MIPS");
    expect(rule!.rule).toContain("waterproof");
  });
});

// ---------------------------------------------------------------------------
// formatProductForPrompt — imported from the REAL module, not mocked
// ---------------------------------------------------------------------------
describe("formatProductForPrompt", () => {
  it("formats basic product info correctly", async () => {
    const { formatProductForPrompt } = await vi.importActual<
      typeof import("@/lib/bigcommerce/client")
    >("@/lib/bigcommerce/client");

    const product = {
      id: 1,
      name: "Shoei RF-1400",
      sku: "SH-RF1400",
      description: "Premium full face helmet with advanced ventilation.",
      price: 599.99,
      sale_price: 0,
      retail_price: 699.99,
      calculated_price: 599.99,
      inventory_level: 12,
      inventory_tracking: "product",
      availability: "available",
      is_visible: true,
      categories: [10],
      brand_id: 5,
      custom_url: { url: "/shoei-rf-1400/" },
      variants: [],
      images: [],
    };

    const output = formatProductForPrompt(product);
    expect(output).toContain("**Shoei RF-1400**");
    expect(output).toContain("SKU: SH-RF1400");
    expect(output).toContain("$599.99");
    expect(output).toContain("IN STOCK (12 available)");
    expect(output).toContain("https://performancecycle.com/shoei-rf-1400/");
  });

  it("shows OUT OF STOCK for zero inventory", async () => {
    const { formatProductForPrompt } = await vi.importActual<
      typeof import("@/lib/bigcommerce/client")
    >("@/lib/bigcommerce/client");

    const product = {
      id: 2, name: "Test", sku: "T-1", description: "",
      price: 50, sale_price: 0, retail_price: 0, calculated_price: 50,
      inventory_level: 0, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/test/" }, variants: [], images: [],
    };

    const output = formatProductForPrompt(product);
    expect(output).toContain("OUT OF STOCK");
  });

  it("shows LOW STOCK for 1-5 items", async () => {
    const { formatProductForPrompt } = await vi.importActual<
      typeof import("@/lib/bigcommerce/client")
    >("@/lib/bigcommerce/client");

    const product = {
      id: 3, name: "LowItem", sku: "L-1", description: "",
      price: 30, sale_price: 0, retail_price: 0, calculated_price: 30,
      inventory_level: 3, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/low/" }, variants: [], images: [],
    };

    const output = formatProductForPrompt(product);
    expect(output).toContain("LOW STOCK (3 left)");
  });

  it("shows IN STOCK for no-tracking products", async () => {
    const { formatProductForPrompt } = await vi.importActual<
      typeof import("@/lib/bigcommerce/client")
    >("@/lib/bigcommerce/client");

    const product = {
      id: 4, name: "NoTrack", sku: "NT-1", description: "",
      price: 25, sale_price: 0, retail_price: 0, calculated_price: 25,
      inventory_level: 0, inventory_tracking: "none",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/nt/" }, variants: [], images: [],
    };

    const output = formatProductForPrompt(product);
    expect(output).toContain("IN STOCK");
    expect(output).not.toContain("OUT OF STOCK");
  });

  it("uses sale_price when available", async () => {
    const { formatProductForPrompt } = await vi.importActual<
      typeof import("@/lib/bigcommerce/client")
    >("@/lib/bigcommerce/client");

    const product = {
      id: 5, name: "Sale", sku: "S-1", description: "",
      price: 100, sale_price: 79.99, retail_price: 100, calculated_price: 100,
      inventory_level: 10, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/sale/" }, variants: [], images: [],
    };

    const output = formatProductForPrompt(product);
    expect(output).toContain("$79.99");
  });

  it("truncates long descriptions", async () => {
    const { formatProductForPrompt } = await vi.importActual<
      typeof import("@/lib/bigcommerce/client")
    >("@/lib/bigcommerce/client");

    const longDesc = "A".repeat(500);
    const product = {
      id: 6, name: "Long", sku: "LG-1", description: longDesc,
      price: 10, sale_price: 0, retail_price: 0, calculated_price: 10,
      inventory_level: 1, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/long/" }, variants: [], images: [],
    };

    const output = formatProductForPrompt(product);
    // The description line should contain the truncated version (300 chars max)
    expect(output).toContain("Description:");
    expect(output.length).toBeLessThan(longDesc.length + 500);
  });

  it("strips HTML tags from descriptions", async () => {
    const { formatProductForPrompt } = await vi.importActual<
      typeof import("@/lib/bigcommerce/client")
    >("@/lib/bigcommerce/client");

    const product = {
      id: 7, name: "HTML", sku: "H-1",
      description: "<p>Great <b>helmet</b> with <a href='#'>link</a>.</p>",
      price: 50, sale_price: 0, retail_price: 0, calculated_price: 50,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/html/" }, variants: [], images: [],
    };

    const output = formatProductForPrompt(product);
    expect(output).not.toContain("<p>");
    expect(output).not.toContain("<b>");
    expect(output).toContain("Great helmet");
  });

  it("includes variant details with option labels", async () => {
    const { formatProductForPrompt } = await vi.importActual<
      typeof import("@/lib/bigcommerce/client")
    >("@/lib/bigcommerce/client");

    const product = {
      id: 8, name: "WithVariant", sku: "WV-1", description: "",
      price: 100, sale_price: 0, retail_price: 0, calculated_price: 100,
      inventory_level: 10, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/wv/" }, images: [],
      variants: [
        {
          id: 101, product_id: 8, sku: "WV-1-BLK-M",
          price: null, sale_price: null, inventory_level: 5,
          option_values: [
            { label: "Black", option_display_name: "Color" },
            { label: "Medium", option_display_name: "Size" },
          ],
        },
      ],
    };

    const output = formatProductForPrompt(product);
    expect(output).toContain("Color: Black");
    expect(output).toContain("Size: Medium");
    expect(output).toContain("WV-1-BLK-M");
    expect(output).toContain("5 in stock");
  });
});

// ---------------------------------------------------------------------------
// buildPrompt (with mocked DB and external services)
// ---------------------------------------------------------------------------
describe("buildPrompt", () => {
  vi.mock("@/lib/db", () => ({
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    },
  }));

  vi.mock("@/lib/db/schema", () => ({
    messages: {},
    knowledgeBase: {},
    productColorways: {},
  }));

  vi.mock("@/lib/search/productSearch", () => ({
    searchProducts: vi.fn().mockResolvedValue({ products: [], detectedColor: null }),
    extractSKUFromText: vi.fn().mockReturnValue(null),
    extractKeywords: vi.fn().mockReturnValue([]),
    isLikelyProductFollowUp: vi.fn().mockReturnValue(false),
    extractBudget: vi.fn().mockReturnValue(null),
    extractProductType: vi.fn().mockReturnValue(null),
    extractAccessorySubject: vi.fn().mockReturnValue({
      sku: null,
      productName: null,
      isAccessoryQuery: false,
    }),
    extractDiscussedProductSubject: vi.fn().mockReturnValue(null),
    extractSubcategoryRequest: vi.fn().mockReturnValue(null),
    isSupportedProductType: vi.fn().mockReturnValue(false),
  }));

  vi.mock("@/lib/search/pairingSearch", () => ({
    findPairings: vi.fn().mockResolvedValue([]),
  }));

  vi.mock("@/lib/bigcommerce/client", () => ({
    getProductBySKU: vi.fn().mockResolvedValue(null),
    getProductByName: vi.fn().mockResolvedValue([]),
    getProductByNameLike: vi.fn().mockResolvedValue([]),
    formatProductForPrompt: vi.fn().mockReturnValue("**Mock Product**\n  SKU: M-1\n  Price: $99.99"),
  }));

  beforeEach(async () => {
    vi.clearAllMocks();

    const dbModule = await import("@/lib/db");
    const db = dbModule.db as any;
    const selectMock = vi.fn();
    const fromMock = vi.fn();
    db.select = selectMock;
    selectMock.mockReturnValue({ from: fromMock });

    let callCount = 0;
    fromMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      }
      return [];
    });
  });

  it("returns system prompt with Performance Cycle identity", async () => {
    const { buildPrompt } = await import("../buildPrompt");
    const result = await buildPrompt("session-1", "hello");

    expect(result.system).toContain("Performance Cycle");
    expect(result.system).toContain("BEHAVIOR RULES");
    expect(result.conversationMessages).toHaveLength(1);
    expect(result.conversationMessages[0]).toEqual({
      role: "user",
      content: "hello",
    });
  });

  it("includes all AI behavior rules in numbered format", async () => {
    const { buildPrompt } = await import("../buildPrompt");
    const result = await buildPrompt("session-1", "test");

    for (let i = 0; i < AI_BEHAVIOR_RULES.length; i++) {
      expect(result.system).toContain(`${i + 1}. ${AI_BEHAVIOR_RULES[i].rule}`);
    }
  });

  // -------------------------------------------------------------------------
  // Catalog index injection
  // -------------------------------------------------------------------------

  describe("when store_catalog_index row is present", () => {
    beforeEach(async () => {
      // Override the db mock so the knowledgeBase query returns a catalog-index row.
      const dbModule = await import("@/lib/db");
      const db = dbModule.db as any;
      const selectMock = vi.fn();
      const fromMock = vi.fn();
      db.select = selectMock;
      selectMock.mockReturnValue({ from: fromMock });

      let callCount = 0;
      fromMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        return Promise.resolve([
          {
            id: "uuid-catalog",
            topic: "store_catalog_index",
            content: "helmet:\n  Shoei: full_face\ncomm: Cardo, Sena",
            updatedAt: new Date(),
            isFaq: false,
          },
        ]);
      });
    });

    it("injects ## STORE CATALOG block with catalog content", async () => {
      const { buildPrompt } = await import("../buildPrompt");
      const result = await buildPrompt("session-1", "do you carry helmets?");

      expect(result.system).toContain("## STORE CATALOG (current stock)");
      expect(result.system).toContain("helmet:\n  Shoei: full_face\ncomm: Cardo, Sena");
    });

    it("catalog-index entry does NOT appear under ## KNOWLEDGE BASE", async () => {
      const { buildPrompt } = await import("../buildPrompt");
      const result = await buildPrompt("session-1", "test");

      // The formatted heading for store_catalog_index would be "STORE CATALOG INDEX"
      // if it were rendered in the KB loop — verify it is not present there.
      const kbStart = result.system.indexOf("## KNOWLEDGE BASE");
      if (kbStart !== -1) {
        const kbSection = result.system.slice(kbStart);
        expect(kbSection).not.toContain("STORE CATALOG INDEX");
      }
      // Additionally, the raw topic string should not appear in the KB section.
      expect(result.system).not.toMatch(
        /## KNOWLEDGE BASE[\s\S]*### STORE CATALOG INDEX/
      );
    });
  });

  describe("when no catalog-index row is present", () => {
    it("does not render ## STORE CATALOG header", async () => {
      // The outer beforeEach returns [] for the knowledge-base query, so no
      // store_catalog_index row — the block must stay absent.
      const { buildPrompt } = await import("../buildPrompt");
      const result = await buildPrompt("session-1", "test");

      expect(result.system).not.toContain("## STORE CATALOG (current stock)");
    });
  });
});
