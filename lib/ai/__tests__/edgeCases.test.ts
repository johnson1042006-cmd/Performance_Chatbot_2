import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// callClaude failure modes
// ---------------------------------------------------------------------------
describe("callClaude edge cases", () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset the singleton client
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  it("returns fallback text when API response has no text block", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "tool_use", id: "t1", name: "test", input: {} }],
          }),
        };
      },
    }));

    const { callClaude } = await import("@/lib/ai/callClaude");
    const result = await callClaude("system", [{ role: "user", content: "hi" }]);
    expect(result).toContain("unable to generate");
  });

  it("throws when API key is invalid (simulated)", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockRejectedValue(new Error("401 Unauthorized")),
        };
      },
    }));

    const { callClaude } = await import("@/lib/ai/callClaude");
    await expect(
      callClaude("system", [{ role: "user", content: "test" }])
    ).rejects.toThrow("401");
  });

  it("throws on timeout (simulated)", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockRejectedValue(new Error("Request timed out")),
        };
      },
    }));

    const { callClaude } = await import("@/lib/ai/callClaude");
    await expect(
      callClaude("system", [{ role: "user", content: "test" }])
    ).rejects.toThrow("timed out");
  });
});

// ---------------------------------------------------------------------------
// BigCommerce client failure modes
// ---------------------------------------------------------------------------
describe("BigCommerce client edge cases", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("BIGCOMMERCE_STORE_HASH", "test-hash");
    vi.stubEnv("BIGCOMMERCE_ACCESS_TOKEN", "test-token");
  });

  it("getProductBySKU returns null when API returns 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    const { getProductBySKU } = await import("@/lib/bigcommerce/client");
    const result = await getProductBySKU("TEST-SKU");
    expect(result).toBeNull();
  });

  it("getProductBySKU returns null when fetch throws network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const { getProductBySKU } = await import("@/lib/bigcommerce/client");
    const result = await getProductBySKU("TEST-SKU");
    expect(result).toBeNull();
  });

  it("searchProductsBC returns empty array when API is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const { searchProductsBC } = await import("@/lib/bigcommerce/client");
    const result = await searchProductsBC("helmet");
    expect(result).toEqual([]);
  });

  it("checkInventory returns out_of_stock when product not found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));

    const { checkInventory } = await import("@/lib/bigcommerce/client");
    const result = await checkInventory(99999);
    expect(result.inStock).toBe(false);
    expect(result.status).toBe("out_of_stock");
  });

  it("formatProductForPrompt handles empty custom_url gracefully", async () => {
    const { formatProductForPrompt } = await import("@/lib/bigcommerce/client");

    const product = {
      id: 1, name: "NoURL", sku: "NU-1", description: "",
      price: 50, sale_price: 0, retail_price: 0, calculated_price: 50,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "" }, variants: [], images: [],
    };

    const output = formatProductForPrompt(product);
    expect(output).toContain("N/A");
  });

  it("formatProductForPrompt handles empty description", async () => {
    const { formatProductForPrompt } = await import("@/lib/bigcommerce/client");

    const product = {
      id: 2, name: "NoDesc", sku: "ND-1", description: "",
      price: 50, sale_price: 0, retail_price: 0, calculated_price: 50,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/nd/" }, variants: [], images: [],
    };

    const output = formatProductForPrompt(product);
    expect(output).toContain("No description");
  });
});

// ---------------------------------------------------------------------------
// Chat settings defaults fallback
// ---------------------------------------------------------------------------
describe("Chat settings edge cases", () => {
  it("settings route exports force-dynamic", async () => {
    vi.doMock("@/lib/db", () => ({
      db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }) },
    }));
    vi.doMock("@/lib/db/schema", () => ({ knowledgeBase: { topic: "topic" } }));

    const { dynamic } = await import("@/app/api/chat/settings/route");
    expect(dynamic).toBe("force-dynamic");
  });
});

// ---------------------------------------------------------------------------
// Concurrent request handling patterns
// ---------------------------------------------------------------------------
describe("Concurrent message edge cases", () => {
  it("extractKeywords is deterministic (no side effects)", async () => {
    const { extractKeywords } = await import("@/lib/search/productSearch");

    const results = await Promise.all([
      Promise.resolve(extractKeywords("shoei helmet black")),
      Promise.resolve(extractKeywords("shoei helmet black")),
      Promise.resolve(extractKeywords("shoei helmet black")),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it("extractColorFromQuery is deterministic", async () => {
    const { extractColorFromQuery } = await import("@/lib/search/colorSynonyms");

    const results = [
      extractColorFromQuery("black helmet"),
      extractColorFromQuery("black helmet"),
      extractColorFromQuery("black helmet"),
    ];

    expect(results.every((r) => r === "black")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Large conversation history handling
// ---------------------------------------------------------------------------
describe("Large input edge cases", () => {
  it("extractKeywords handles very long input without crashing", async () => {
    const { extractKeywords } = await import("@/lib/search/productSearch");
    const longInput = "helmet ".repeat(500);
    const result = extractKeywords(longInput);
    expect(Array.isArray(result)).toBe(true);
  });

  it("extractColorFromQuery handles very long input", async () => {
    const { extractColorFromQuery } = await import("@/lib/search/colorSynonyms");
    const longInput = "I need a " + "very ".repeat(200) + "black helmet";
    const result = extractColorFromQuery(longInput);
    expect(result).toBe("black");
  });
});

// ---------------------------------------------------------------------------
// Session status edge cases
// ---------------------------------------------------------------------------
describe("Session status edge cases", () => {
  it("ai-fallback route has maxDuration set to 30", async () => {
    vi.doMock("@/lib/db", () => ({
      db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }) },
    }));
    vi.doMock("@/lib/db/schema", () => ({ sessions: {}, messages: {} }));
    vi.doMock("@/lib/ai/buildPrompt", () => ({ buildPrompt: vi.fn() }));
    vi.doMock("@/lib/ai/callClaude", () => ({ callClaude: vi.fn() }));
    vi.doMock("@/lib/pusher/server", () => ({ getPusher: vi.fn() }));

    const { maxDuration } = await import("@/app/api/chat/ai-fallback/route");
    expect(maxDuration).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Pairings with invalid SKU
// ---------------------------------------------------------------------------
describe("Pairing search edge cases", () => {
  it("findPairings returns empty array for non-existent SKU", async () => {
    vi.doMock("@/lib/db", () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      },
    }));
    vi.doMock("@/lib/db/schema", () => ({
      productPairings: { primarySku: "primary_sku", pairedSku: "paired_sku" },
    }));

    const { findPairings } = await import("@/lib/search/pairingSearch");
    const result = await findPairings("NONEXISTENT-SKU");
    expect(result).toEqual([]);
  });
});
