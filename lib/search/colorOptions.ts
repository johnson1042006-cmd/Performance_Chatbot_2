import { colorSynonymMap } from "./colorSynonyms";

/**
 * Shared color-option identification for BigCommerce variant data.
 *
 * BigCommerce variants carry option values as `{ label, option_display_name }`,
 * where `option_display_name` is merchant-authored free text ("Click Color for
 * Availability", "Choose A Color To See Availability", "Color", "Style", …).
 * The old heuristic decided an option was the color option purely by that
 * display name containing one of color/colour/graphic/style/design — which
 * worked only by coincidence on this catalog and false-positived on genuine
 * non-color "Style" options.
 *
 * This module instead identifies the color option by what its LABELS look like
 * (value-based): an option group is a color option when its labels are
 * dominated by recognizable color words and are not a size run. The merchant
 * display name is used only as a weak backup for exotically-named colorways,
 * and only for the strong color words (never "style"/"graphics"), so it can
 * never re-introduce the false positive.
 *
 * The same logic backs both the live search path (productHasColor /
 * getMatchingColorLabels) and the colorway seed/refresh, so the two can never
 * drift.
 */

export interface OptionValueLike {
  label: string;
  option_display_name: string;
}

export interface VariantLike {
  option_values?: OptionValueLike[] | null;
}

// Every single-word color term (primaries + single-word synonyms). Multi-word
// synonyms ("royal blue") are covered because their color-bearing word ("royal",
// "blue") is itself a single-word entry.
const COLOR_WORDS: Set<string> = (() => {
  const s = new Set<string>();
  for (const [primary, synonyms] of Object.entries(colorSynonymMap)) {
    s.add(primary);
    for (const syn of synonyms) {
      for (const tok of syn.split(/\s+/)) {
        if (tok) s.add(tok);
      }
    }
  }
  return s;
})();

// Strong color words allowed as a display-name backup signal. Deliberately
// excludes "style"/"graphics"/"finish"/"design" — those over-matched.
const STRONG_COLOR_DISPLAY = /\b(colou?r|colou?rway)\b/;

// Apparel / gear size tokens. A label made only of these is a size, not a color.
const SIZE_TOKEN = /^(xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl|sm|med|md|lg|one\s?size|osfa|os|youth|yth|toddler|inf|infant)$/i;
// Pure numeric / decimal sizes (waist, EU shoe, chest): "32", "42", "10.5".
const NUMERIC_SIZE = /^\d{1,3}(\.\d{1,2})?$/;

function tokenizeLabel(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A label is "color-like" if any of its tokens is a known color word. */
export function labelIsColorLike(label: string): boolean {
  return tokenizeLabel(label).some((t) => COLOR_WORDS.has(t));
}

/** A label is "size-like" if it is a size token or a bare number. */
export function labelIsSizeLike(label: string): boolean {
  const trimmed = label.trim();
  if (NUMERIC_SIZE.test(trimmed)) return true;
  return SIZE_TOKEN.test(trimmed.replace(/\s+/g, " "));
}

/**
 * Return the set of `option_display_name` values (lowercased) that represent a
 * color option across a product's variants. Value-based, with a strong-color-
 * word display-name backup for groups whose labels are all exotic.
 */
export function identifyColorOptionNames(variants: VariantLike[]): Set<string> {
  // Collect the distinct label set per option display name.
  const groups = new Map<string, Set<string>>();
  for (const v of variants) {
    for (const ov of v.option_values ?? []) {
      if (!ov?.option_display_name || !ov?.label) continue;
      const dn = ov.option_display_name.toLowerCase();
      let set = groups.get(dn);
      if (!set) {
        set = new Set<string>();
        groups.set(dn, set);
      }
      set.add(ov.label);
    }
  }

  const colorNames = new Set<string>();
  for (const [dn, labels] of Array.from(groups)) {
    let colorLike = 0;
    let sizeLike = 0;
    for (const label of Array.from(labels)) {
      if (labelIsColorLike(label)) colorLike++;
      else if (labelIsSizeLike(label)) sizeLike++;
    }
    // Primary (value-based): at least one recognizable color and colors are not
    // outnumbered by sizes.
    const valueBased = colorLike > 0 && colorLike >= sizeLike;
    // Backup: display name explicitly says "color"/"colorway" and the group is
    // not a size run — catches colorways whose labels are all exotic
    // ("Sunburst", "Nardo") and therefore unrecognizable by token.
    const displayBackup = STRONG_COLOR_DISPLAY.test(dn) && sizeLike === 0;
    if (valueBased || displayBackup) colorNames.add(dn);
  }
  return colorNames;
}

/** All distinct color labels for a product (original casing preserved). */
export function collectColorLabels(variants: VariantLike[]): string[] {
  const colorNames = identifyColorOptionNames(variants);
  if (colorNames.size === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of variants) {
    for (const ov of v.option_values ?? []) {
      if (!ov?.option_display_name || !ov?.label) continue;
      if (!colorNames.has(ov.option_display_name.toLowerCase())) continue;
      const key = ov.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ov.label);
    }
  }
  return out;
}

/**
 * Word-boundary match of a color term against a label. Handles multi-word terms
 * ("steel blue") and separators common in colorways ("Blue/Black", "Red-White").
 */
export function colorTermMatchesLabel(label: string, colorTerm: string): boolean {
  const lower = label.toLowerCase();
  if (lower === colorTerm) return true;
  const escaped = colorTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[\\s/\\-_,.(])${escaped}($|[\\s/\\-_,.)])`, "i");
  return re.test(lower);
}

/** True when any color label matches one of the expanded color terms. */
export function variantsHaveColor(
  variants: VariantLike[],
  expandedColors: Set<string>
): boolean {
  if (expandedColors.size === 0) return false;
  const terms = Array.from(expandedColors);
  for (const label of collectColorLabels(variants)) {
    for (const term of terms) {
      if (colorTermMatchesLabel(label, term)) return true;
    }
  }
  return false;
}

/** Color labels (original casing) that match one of the expanded color terms. */
export function matchingColorLabels(
  variants: VariantLike[],
  expandedColors: Set<string>
): string[] {
  if (expandedColors.size === 0) return [];
  const terms = Array.from(expandedColors);
  const out: string[] = [];
  for (const label of collectColorLabels(variants)) {
    for (const term of terms) {
      if (colorTermMatchesLabel(label, term)) {
        out.push(label);
        break;
      }
    }
  }
  return out;
}

/**
 * Seed/refresh helper: given ONE variant's option values plus the color option
 * display names already identified for the product, return that variant's
 * colorway label (or null). Keeps the seed and the live path on identical
 * option-identification logic.
 */
export function colorLabelForVariant(
  optionValues: OptionValueLike[],
  colorOptionNames: Set<string>
): string | null {
  for (const ov of optionValues) {
    if (!ov?.option_display_name || !ov?.label) continue;
    if (colorOptionNames.has(ov.option_display_name.toLowerCase())) return ov.label;
  }
  return null;
}
