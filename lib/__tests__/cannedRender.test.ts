import { describe, it, expect } from "vitest";
import { renderCannedBody, STORE_PHONE } from "@/lib/canned/render";

describe("renderCannedBody", () => {
  it("substitutes {customer_name} with provided name", () => {
    const out = renderCannedBody("Hi {customer_name}!", {
      customerName: "Casey",
    });
    expect(out).toBe("Hi Casey!");
  });

  it("falls back to 'there' when customerName is null/empty", () => {
    expect(
      renderCannedBody("Hi {customer_name}!", { customerName: null })
    ).toBe("Hi there!");
    expect(
      renderCannedBody("Hi {customer_name}!", { customerName: "  " })
    ).toBe("Hi there!");
    expect(
      renderCannedBody("Hi {customer_name}!", {})
    ).toBe("Hi there!");
  });

  it("substitutes {agent_name}", () => {
    expect(
      renderCannedBody("Thanks, — {agent_name}", { agentName: "Alex" })
    ).toBe("Thanks, — Alex");
  });

  it("substitutes {store_phone} with literal store number", () => {
    expect(renderCannedBody("Call {store_phone}", {})).toContain(STORE_PHONE);
  });

  it("replaces all occurrences", () => {
    const out = renderCannedBody(
      "{customer_name}, hi {customer_name}",
      { customerName: "Sam" }
    );
    expect(out).toBe("Sam, hi Sam");
  });
});
