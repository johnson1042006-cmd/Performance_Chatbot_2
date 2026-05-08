import { describe, it, expect } from "vitest";
import { slugify, dedupSlug } from "@/lib/utils/slugify";

describe("slugify", () => {
  it("kebab-cases simple titles", () => {
    expect(slugify("Order status help")).toBe("order-status-help");
  });

  it("strips punctuation and emoji", () => {
    expect(slugify("Where's my order?!")).toBe("wheres-my-order");
  });

  it("falls back to untitled-faq on noise", () => {
    expect(slugify("?? !! ##")).toBe("untitled-faq");
    expect(slugify("")).toBe("untitled-faq");
  });

  it("caps at 60 chars", () => {
    const long = "a".repeat(120);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
});

describe("dedupSlug", () => {
  it("returns the slug when not taken", () => {
    expect(dedupSlug("foo", new Set())).toBe("foo");
  });

  it("appends -2 on first collision", () => {
    expect(dedupSlug("foo", new Set(["foo"]))).toBe("foo-2");
  });

  it("walks past multiple collisions", () => {
    expect(dedupSlug("foo", new Set(["foo", "foo-2", "foo-3"]))).toBe("foo-4");
  });
});
