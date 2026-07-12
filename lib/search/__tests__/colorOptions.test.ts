import { describe, it, expect } from "vitest";
import {
  identifyColorOptionNames,
  collectColorLabels,
  variantsHaveColor,
  matchingColorLabels,
  colorLabelForVariant,
  labelIsColorLike,
  labelIsSizeLike,
  type VariantLike,
} from "../colorOptions";
import { expandColorQuery } from "../colorSynonyms";

const expand = (c: string) =>
  new Set(expandColorQuery(c).map((x) => x.toLowerCase()));

// Helper: build a variant list from (colorLabel, sizeLabel) pairs under given
// option display names.
function variants(
  pairs: Array<{ color?: string; size?: string }>,
  names = { color: "Click Color for Availability", size: "Click Size for Availability" }
): VariantLike[] {
  return pairs.map((p) => ({
    option_values: [
      ...(p.color ? [{ label: p.color, option_display_name: names.color }] : []),
      ...(p.size ? [{ label: p.size, option_display_name: names.size }] : []),
    ],
  }));
}

describe("colorOptions — label classifiers", () => {
  it("recognizes color-like labels incl. multi-word and separators", () => {
    for (const l of ["Matte Blue", "Gloss Black", "Blue/Black", "Red-White", "Basalt Grey", "Flo Red"]) {
      expect(labelIsColorLike(l)).toBe(true);
    }
    expect(labelIsColorLike("Anthracite Metallic")).toBe(false); // no known token
    expect(labelIsColorLike("Vented")).toBe(false);
  });

  it("recognizes size-like labels", () => {
    for (const s of ["XS", "S", "M", "L", "XL", "2XL", "One Size", "42", "10.5"]) {
      expect(labelIsSizeLike(s)).toBe(true);
    }
    expect(labelIsSizeLike("Matte Blue")).toBe(false);
  });
});

describe("colorOptions — value-based option identification", () => {
  it("identifies the color option by its LABELS even when the display name contains no color word", () => {
    // Synthetic: color option display name has none of color/style/graphics, and
    // the size option is likewise generically named.
    const v = variants(
      [
        { color: "Matte Blue", size: "S" },
        { color: "Gloss Black", size: "M" },
        { color: "Gloss White", size: "L" },
      ],
      { color: "Available Options", size: "Pick One" }
    );
    const names = identifyColorOptionNames(v);
    expect(names.has("available options")).toBe(true);
    expect(names.has("pick one")).toBe(false);
    expect(collectColorLabels(v).sort()).toEqual(["Gloss Black", "Gloss White", "Matte Blue"]);
    expect(variantsHaveColor(v, expand("blue"))).toBe(true);
  });

  it("does NOT treat a non-color 'Style' option as a color option (false-positive guard)", () => {
    const v: VariantLike[] = [
      { option_values: [{ label: "Vented", option_display_name: "Style" }] },
      { option_values: [{ label: "Non-Vented", option_display_name: "Style" }] },
    ];
    const names = identifyColorOptionNames(v);
    expect(names.has("style")).toBe(false);
    expect(collectColorLabels(v)).toEqual([]);
    expect(variantsHaveColor(v, expand("black"))).toBe(false);
  });

  it("uses a strong-color-word display name as backup for exotic colorway labels", () => {
    // Labels aren't recognizable color tokens, but the option is literally named
    // "Color" — the backup path keeps it classified so the colorway is captured.
    const v: VariantLike[] = [
      { option_values: [{ label: "Sunburst", option_display_name: "Color" }] },
      { option_values: [{ label: "Nardo", option_display_name: "Color" }] },
    ];
    const names = identifyColorOptionNames(v);
    expect(names.has("color")).toBe(true);
    expect(collectColorLabels(v).sort()).toEqual(["Nardo", "Sunburst"]);
    // No recognized color, so a blue query does not match.
    expect(variantsHaveColor(v, expand("blue"))).toBe(false);
  });
});

describe("colorOptions — matching against real BC shape", () => {
  const shoei = variants([
    { color: "Gloss Black", size: "S" },
    { color: "Matte Blue", size: "M" },
    { color: "Basalt Grey", size: "L" },
  ]);

  it("matches a requested color present in a variant label", () => {
    expect(variantsHaveColor(shoei, expand("blue"))).toBe(true);
    expect(matchingColorLabels(shoei, expand("blue"))).toEqual(["Matte Blue"]);
  });

  it("matches via synonym expansion (grey ⇒ basalt grey label)", () => {
    expect(matchingColorLabels(shoei, expand("grey"))).toEqual(["Basalt Grey"]);
  });

  it("returns false for a color the product does not offer", () => {
    expect(variantsHaveColor(shoei, expand("green"))).toBe(false);
    expect(matchingColorLabels(shoei, expand("green"))).toEqual([]);
  });

  it("returns empty for no variants / empty expansion", () => {
    expect(variantsHaveColor([], expand("blue"))).toBe(false);
    expect(matchingColorLabels(shoei, new Set())).toEqual([]);
  });
});

describe("colorOptions — colorLabelForVariant (seed helper)", () => {
  it("returns the color label for a variant given identified color option names", () => {
    const ov = [
      { label: "Matte Blue", option_display_name: "Click Color for Availability" },
      { label: "M", option_display_name: "Click Size for Availability" },
    ];
    const names = identifyColorOptionNames([{ option_values: ov }]);
    expect(colorLabelForVariant(ov, names)).toBe("Matte Blue");
  });

  it("returns null when the variant has no color option", () => {
    const ov = [{ label: "M", option_display_name: "Click Size for Availability" }];
    const names = new Set<string>();
    expect(colorLabelForVariant(ov, names)).toBeNull();
  });
});
