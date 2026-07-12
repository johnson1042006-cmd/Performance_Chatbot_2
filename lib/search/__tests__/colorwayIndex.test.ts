/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("@/lib/db", () => ({ db: { execute: (q: unknown) => execute(q) } }));

import { colorQueryTokens, findColorwayProductIds } from "../colorwayIndex";

describe("colorQueryTokens", () => {
  it("expands a color to clean single-word tsquery tokens", () => {
    const green = colorQueryTokens("green");
    expect(green).toContain("green");
    expect(green).toContain("olive");
    expect(green).toContain("forest");
    // Multi-word synonyms are split, never kept as a phrase.
    expect(green).toContain("military");
    expect(green.every((t) => !t.includes(" "))).toBe(true);
  });

  it("splits separator/compound synonyms (steel blue ⇒ steel, blue)", () => {
    const blue = colorQueryTokens("blue");
    expect(blue).toContain("blue");
    expect(blue).toContain("steel");
    expect(blue).toContain("navy");
  });

  it("returns [] for an unknown color with no tokens", () => {
    // A non-color string still yields itself if >=2 chars, so use empty.
    expect(colorQueryTokens("")).toEqual([]);
  });
});

describe("findColorwayProductIds", () => {
  beforeEach(() => execute.mockReset());

  it("short-circuits without querying when the color yields no tokens", async () => {
    const ids = await findColorwayProductIds("");
    expect(ids).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("parses distinct product ids from the result rows", async () => {
    execute.mockResolvedValue({ rows: [{ bc_product_id: 12280 }, { bc_product_id: 13544 }] });
    const ids = await findColorwayProductIds("green", { typeTerms: ["jacket"] });
    expect(ids).toEqual([12280, 13544]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("handles array-shaped results and coerces numeric ids", async () => {
    execute.mockResolvedValue([{ bc_product_id: "42" }, { bc_product_id: "7" }]);
    const ids = await findColorwayProductIds("blue");
    expect(ids).toEqual([42, 7]);
  });
});
