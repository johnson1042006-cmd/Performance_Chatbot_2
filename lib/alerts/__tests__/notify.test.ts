import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildSlackPayload, sendSlackAlert } from "@/lib/alerts/notify";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (e: unknown) => ({ message: String(e) }),
}));

const ORIGINAL_FETCH = global.fetch;

describe("buildSlackPayload", () => {
  it("emits the documented Block Kit shape", () => {
    const p = buildSlackPayload({
      kind: "queue_depth",
      comparator: ">=",
      threshold: 5,
      value: 12,
      message: "Queue depth above threshold.",
      dashboardUrl: "https://app.example.com/",
    });
    expect(Array.isArray(p.blocks)).toBe(true);
    expect(p.blocks.length).toBeGreaterThanOrEqual(3);

    const header = p.blocks[0] as Record<string, unknown>;
    expect(header.type).toBe("header");
    expect((header.text as { text: string }).text).toMatch(/Queue depth/);

    const section = p.blocks[1] as Record<string, unknown>;
    expect(section.type).toBe("section");
    expect((section.text as { text: string }).text).toContain("queue_depth");
    expect((section.text as { text: string }).text).toContain(">=");
    expect((section.text as { text: string }).text).toContain("5");
    expect((section.text as { text: string }).text).toContain("12");

    const actions = p.blocks[p.blocks.length - 1] as Record<string, unknown>;
    expect(actions.type).toBe("actions");
    const button = (actions.elements as Array<Record<string, unknown>>)[0];
    expect(button.type).toBe("button");
    expect(String(button.url)).toMatch(/^https:\/\/app\.example\.com\/dashboard$/);
  });

  it("prefers NEXT_PUBLIC_DASHBOARD_URL when no override is given", () => {
    process.env.NEXT_PUBLIC_DASHBOARD_URL = "https://hub.example.com";
    const p = buildSlackPayload({
      kind: "ai_failure_rate_pct",
      comparator: ">",
      threshold: 20,
      value: 33,
      message: "Failure spike",
    });
    const actions = p.blocks[p.blocks.length - 1] as Record<string, unknown>;
    const button = (actions.elements as Array<Record<string, unknown>>)[0];
    expect(String(button.url)).toMatch(/hub\.example\.com\/dashboard/);
    delete process.env.NEXT_PUBLIC_DASHBOARD_URL;
  });
});

describe("sendSlackAlert", () => {
  beforeEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
    global.fetch = ORIGINAL_FETCH;
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("returns false and skips when SLACK_WEBHOOK_URL is unset", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const ok = await sendSlackAlert({
      kind: "queue_depth",
      comparator: ">=",
      threshold: 5,
      value: 9,
      message: "test",
    });
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the Block Kit payload to SLACK_WEBHOOK_URL", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST";
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;
    const ok = await sendSlackAlert({
      kind: "queue_depth",
      comparator: ">=",
      threshold: 5,
      value: 9,
      message: "Queue is climbing.",
    });
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://hooks.slack.com/services/TEST");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    const parsed = JSON.parse(String(init.body));
    expect(Array.isArray(parsed.blocks)).toBe(true);
    expect(parsed.blocks[0].type).toBe("header");
  });

  it("returns false on transport failure without throwing", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST";
    global.fetch = (vi.fn(async () => {
      throw new Error("network down");
    }) as unknown) as typeof fetch;
    const ok = await sendSlackAlert({
      kind: "queue_depth",
      comparator: ">=",
      threshold: 1,
      value: 99,
      message: "x",
    });
    expect(ok).toBe(false);
  });

  it("returns false on non-200 webhook responses", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST";
    global.fetch = (vi.fn(async () => new Response("nope", { status: 500 })) as unknown) as typeof fetch;
    const ok = await sendSlackAlert({
      kind: "queue_depth",
      comparator: ">=",
      threshold: 1,
      value: 99,
      message: "x",
    });
    expect(ok).toBe(false);
  });
});
