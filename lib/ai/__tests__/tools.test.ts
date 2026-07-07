/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock external dependencies BEFORE the SUT is imported
// ---------------------------------------------------------------------------

const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();

const chain = (terminal: (...a: any[]) => any) => {
  const p: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") {
          return (
            resolve: (v: unknown) => void,
            reject: (e: unknown) => void
          ) => {
            try {
              Promise.resolve(terminal()).then(resolve, reject);
            } catch (err) {
              reject(err);
            }
          };
        }
        return (...args: any[]) => {
          if (["limit", "returning", "offset"].includes(prop)) return terminal(...args);
          return p;
        };
      },
    }
  );
  return () => p;
};

vi.mock("@/lib/db", () => ({
  db: {
    select: chain(() => Promise.resolve([])),
    insert: chain(mockDbInsert),
    update: chain(mockDbUpdate),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: { id: "id", aiClaimDueAt: "ai_claim_due_at" },
  messages: { sessionId: "session_id", role: "role", sentAt: "sent_at" },
  chatEvents: { sessionId: "session_id", type: "type" },
  productPairings: { primarySku: "primary_sku", pairedSku: "paired_sku" },
}));

const mockTrigger = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: mockTrigger }),
}));

const mockSearchProducts = vi.fn();
const mockExtractSKU = vi.fn().mockReturnValue(null);
vi.mock("@/lib/search/productSearch", () => ({
  searchProducts: mockSearchProducts,
  extractSKUFromText: mockExtractSKU,
}));

const mockGetProductBySKU = vi.fn();
const mockGetProductById = vi.fn();
vi.mock("@/lib/bigcommerce/client", () => ({
  getProductBySKU: mockGetProductBySKU,
  getProductById: mockGetProductById,
  formatProductForPrompt: (p: any) => `**${p.name}** (${p.sku})`,
}));

const mockLookupOrder = vi.fn();
vi.mock("@/lib/orders/lookup", () => ({
  lookupOrder: mockLookupOrder,
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SAMPLE_PRODUCT = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Sample Helmet",
  sku: "HELM-1",
  description: "A great helmet for testing.",
  price: 199,
  sale_price: 0,
  retail_price: 0,
  calculated_price: 179,
  inventory_level: 5,
  inventory_tracking: "product",
  availability: "available",
  is_visible: true,
  categories: [1],
  brand_id: 2,
  custom_url: { url: "/products/sample-helmet" },
  variants: [],
  ...overrides,
});

describe("toolHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbUpdate.mockResolvedValue([]);
    mockDbInsert.mockResolvedValue([]);
  });

  it("search_products applies budgetMax and inStockOnly filters and returns top 8", async () => {
    mockSearchProducts.mockResolvedValueOnce({
      products: [
        SAMPLE_PRODUCT({ id: 1, name: "Cheap", calculated_price: 50, inventory_level: 5 }),
        SAMPLE_PRODUCT({ id: 2, name: "Mid", calculated_price: 150, inventory_level: 0 }),
        SAMPLE_PRODUCT({ id: 3, name: "Expensive", calculated_price: 1000, inventory_level: 5 }),
      ],
      detectedColor: null,
    });
    const { toolHandlers } = await import("@/lib/ai/tools");
    const out = (await toolHandlers.search_products(
      { query: "helmet", budgetMax: 200, inStockOnly: true },
      { sessionId: "s1" }
    )) as { count: number; products: Array<{ name: string }> };
    expect(out.count).toBeGreaterThanOrEqual(1);
    expect(out.products.every((p) => p.name !== "Expensive")).toBe(true);
    expect(out.products.every((p) => p.name !== "Mid")).toBe(true);
  });

  it("get_product_details returns variants for a found product", async () => {
    mockGetProductBySKU.mockResolvedValueOnce(
      SAMPLE_PRODUCT({
        variants: [
          {
            id: 11,
            product_id: 1,
            sku: "HELM-1-S",
            price: 179,
            inventory_level: 3,
            option_values: [{ option_display_name: "Size", label: "S" }],
          },
        ],
      })
    );
    const { toolHandlers } = await import("@/lib/ai/tools");
    const out = (await toolHandlers.get_product_details(
      { sku: "HELM-1" },
      { sessionId: "s1" }
    )) as { found: boolean; variants: unknown[] };
    expect(out.found).toBe(true);
    expect(out.variants).toHaveLength(1);
  });

  it("get_product_details returns found=false when missing", async () => {
    mockGetProductBySKU.mockResolvedValueOnce(null);
    const { toolHandlers } = await import("@/lib/ai/tools");
    const out = (await toolHandlers.get_product_details(
      { sku: "MISSING" },
      { sessionId: "s1" }
    )) as { found: boolean };
    expect(out.found).toBe(false);
  });

  it("lookup_order forwards to the orders helper", async () => {
    mockLookupOrder.mockResolvedValueOnce({
      found: true,
      order: { id: 99, status: "Shipped", status_id: 2, items_shipped: 1, items_total: 1 },
      summary: "**Order #99** — *Shipped*",
    });
    const { toolHandlers } = await import("@/lib/ai/tools");
    const out = (await toolHandlers.lookup_order(
      { email: "x@y.com", orderId: 99 },
      { sessionId: "s1" }
    )) as { found: boolean; order: { id: number } };
    expect(out.found).toBe(true);
    expect(out.order.id).toBe(99);
    expect(mockLookupOrder).toHaveBeenCalledWith("x@y.com", 99);
  });

  it("lookup_helmet_sizing returns the canonical URL", async () => {
    const { toolHandlers } = await import("@/lib/ai/tools");
    const out = (await toolHandlers.lookup_helmet_sizing({}, { sessionId: "s1" })) as {
      url: string;
    };
    expect(out.url).toMatch(/helmet-sizing-guide/);
  });

  it("lookup_tire_services returns the canonical URL", async () => {
    const { toolHandlers } = await import("@/lib/ai/tools");
    const out = (await toolHandlers.lookup_tire_services({}, { sessionId: "s1" })) as {
      url: string;
    };
    expect(out.url).toMatch(/tire-and-wheel-services/);
  });

  it("escalate_to_human clears aiClaimDueAt and triggers Pusher", async () => {
    const { toolHandlers } = await import("@/lib/ai/tools");
    const out = (await toolHandlers.escalate_to_human(
      { reason: "frustrated_customer", urgency: "high" },
      { sessionId: "s1" }
    )) as { ok: boolean; reason: string; urgency: string };

    expect(out.ok).toBe(true);
    expect(out.reason).toBe("frustrated_customer");
    expect(out.urgency).toBe("high");
    // mockDbUpdate is the terminal in our chain; called by db.update().set().where()
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockTrigger).toHaveBeenCalledWith(
      "private-dashboard",
      "escalation-requested",
      expect.objectContaining({ sessionId: "s1", reason: "frustrated_customer", urgency: "high" })
    );
  });

  it("escalate_to_human falls back to 'unsupported' for unknown reasons", async () => {
    const { toolHandlers } = await import("@/lib/ai/tools");
    const out = (await toolHandlers.escalate_to_human(
      { reason: "garbage", urgency: "weird" },
      { sessionId: "s2" }
    )) as { reason: string; urgency: string };
    expect(out.reason).toBe("unsupported");
    expect(out.urgency).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// callClaude tool loop integration test
// ---------------------------------------------------------------------------
//
// We mock the Anthropic SDK to feed a deterministic sequence of responses
// (tool_use → tool_use → end_turn) and verify that:
//   - the loop runs the handlers in order
//   - the loop terminates when stop_reason === "end_turn"
//   - the onToolCall hook fires for each tool execution
//   - the returned text equals the final assistant text

const mockAnthropicCreate = vi.fn();
const mockAnthropicStream = vi.fn((...args: any[]): any => {
  throw new Error(`stream() not exercised in this test (got ${args.length} args)`);
});

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = {
        create: (...args: any[]) => mockAnthropicCreate(...args),
        stream: (...args: any[]) => mockAnthropicStream(...args),
      };
    },
  };
});

/**
 * Builds a fake Anthropic streaming handle. `textDeltas` are emitted on the
 * "text" event; `final` is returned from finalMessage().
 */
function makeFakeStream(
  textDeltas: string[],
  final: { stop_reason: string; content: any[] }
) {
  const listeners: Record<string, (arg: any) => void> = {};
  return {
    on(event: string, cb: (arg: any) => void) {
      listeners[event] = cb;
      return this;
    },
    async finalMessage() {
      for (const d of textDeltas) listeners["text"]?.(d);
      for (const block of final.content) listeners["contentBlock"]?.(block);
      return final;
    },
  };
}

describe("callClaude tool loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnthropicCreate.mockReset();
  });

  it("executes tool_use handlers in order, then returns final text", async () => {
    mockAnthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "use_1",
            name: "search_products",
            input: { query: "helmet" },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "use_2",
            name: "get_product_details",
            input: { sku: "HELM-1" },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Here's the helmet you wanted." }],
      });

    const { callClaude } = await import("@/lib/ai/callClaude");
    const calls: Array<{ name: string; output: unknown }> = [];

    const handlers = {
      search_products: async () => ({ count: 1, products: [{ name: "Bell" }] }),
      get_product_details: async () => ({ found: true, sku: "HELM-1" }),
    };

    const out = await callClaude(
      "system",
      [{ role: "user", content: "find me a helmet" }],
      {
        tools: [
          { name: "search_products", description: "", input_schema: { type: "object", properties: {} } },
          { name: "get_product_details", description: "", input_schema: { type: "object", properties: {} } },
        ] as any,
        toolHandlers: handlers as any,
        ctx: { sessionId: "s1" },
        onToolCall: (e) => calls.push({ name: e.name, output: e.output }),
      }
    );

    expect(out).toBe("Here's the helmet you wanted.");
    expect(calls.map((c) => c.name)).toEqual([
      "search_products",
      "get_product_details",
    ]);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(3);
  });

  it("forces a final text answer when iteration cap is hit", async () => {
    // Always returns tool_use, never end_turn
    for (let i = 0; i < 4; i++) {
      mockAnthropicCreate.mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: `use_${i}`,
            name: "search_products",
            input: { query: "x" },
          },
        ],
      });
    }
    // Final non-tool call (tool_choice: 'none')
    mockAnthropicCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Forced final answer." }],
    });

    const { callClaude } = await import("@/lib/ai/callClaude");
    const out = await callClaude(
      "system",
      [{ role: "user", content: "loop" }],
      {
        tools: [
          { name: "search_products", description: "", input_schema: { type: "object", properties: {} } },
        ] as any,
        toolHandlers: {
          search_products: async () => ({ ok: true }),
        } as any,
        ctx: { sessionId: "s1" },
      }
    );
    expect(out).toBe("Forced final answer.");
    // 4 loop iterations + 1 forced final
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(5);
  });

  it("captures unknown-tool errors as is_error tool_results without throwing", async () => {
    mockAnthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "use_x",
            name: "does_not_exist",
            input: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Recovered." }],
      });

    const { callClaude } = await import("@/lib/ai/callClaude");
    const events: Array<{ name: string; isError: boolean }> = [];
    const out = await callClaude(
      "system",
      [{ role: "user", content: "x" }],
      {
        tools: [
          { name: "real", description: "", input_schema: { type: "object", properties: {} } },
        ] as any,
        toolHandlers: {} as any,
        ctx: { sessionId: "s1" },
        onToolCall: (e) => events.push({ name: e.name, isError: e.isError }),
      }
    );
    expect(out).toBe("Recovered.");
    expect(events).toEqual([{ name: "does_not_exist", isError: true }]);
  });

  it("does not leak pre-tool narration into the final reply", async () => {
    // Iteration 1: Claude narrates before calling a tool (the bug scenario).
    // Iteration 2: Claude returns the actual answer with no tool call.
    // The returned text must be exactly the final answer — no concatenation.
    mockAnthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "I'll check that" },
          { type: "tool_use", id: "use_1", name: "search_products", input: { query: "helmet" } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Here are the options" }],
      });

    const { callClaude } = await import("@/lib/ai/callClaude");
    const out = await callClaude(
      "system",
      [{ role: "user", content: "find me a helmet" }],
      {
        tools: [
          { name: "search_products", description: "", input_schema: { type: "object", properties: {} } },
        ] as any,
        toolHandlers: { search_products: async () => ({ count: 0, products: [] }) } as any,
        ctx: { sessionId: "s1" },
      }
    );

    expect(out).toBe("Here are the options");
  });

  it("streams the fallback text when the final iteration produces no text", async () => {
    // Streaming path: the final turn ends with no text blocks (e.g. only a
    // stray tool_use / empty content). Without FIX-1 the SSE client would see
    // a blank bubble while the DB persisted the fallback apology.
    mockAnthropicStream.mockReturnValueOnce(
      makeFakeStream([], { stop_reason: "end_turn", content: [] }) as any
    );

    const { callClaude } = await import("@/lib/ai/callClaude");
    const emitted: string[] = [];
    const out = await callClaude(
      "system",
      [{ role: "user", content: "do you carry tire fitment?" }],
      {
        tools: [
          { name: "search_products", description: "", input_schema: { type: "object", properties: {} } },
        ] as any,
        toolHandlers: { search_products: async () => ({ ok: true }) } as any,
        ctx: { sessionId: "s1" },
        stream: {
          onToken: (t: string) => emitted.push(t),
          onToolUse: () => {},
        },
      }
    );

    // onToken fired exactly once, with the exact string that was returned.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toBe(out);
    expect(out).toContain("flagged this for our team");
  });
});
