export const colorSynonymMap: Record<string, string[]> = {
  black: [
    "matte black", "gloss black", "stealth", "blackout", "carbon",
    "onyx", "jet", "midnight", "charcoal", "ebony", "obsidian", "noir", "dark",
  ],
  white: [
    "pearl", "ivory", "cream", "gloss white", "matte white",
    "arctic", "ghost", "snow", "frost", "alabaster",
  ],
  blue: [
    "navy", "cobalt", "royal", "royal blue", "azure", "sapphire", "midnight",
    "steel blue", "slate blue", "ocean", "sky blue", "cerulean", "indigo", "dark blue",
  ],
  red: [
    "crimson", "scarlet", "burgundy", "maroon", "cherry", "cardinal",
    "wine", "vermillion", "ruby", "garnet",
  ],
  green: [
    "olive", "forest", "lime", "sage", "emerald", "hunter", "military",
    "military green", "army green", "moss", "jade",
  ],
  orange: [
    "burnt orange", "amber", "copper", "rust", "tangerine",
    "coral", "terracotta",
  ],
  yellow: [
    "gold", "mustard", "hi-viz", "hi-vis", "neon yellow", "fluorescent",
    "honey", "lemon", "sunshine", "canary",
  ],
  grey: [
    "gray", "charcoal", "gunmetal", "silver", "slate",
    "graphite", "ash", "pewter", "titanium", "aluminum",
  ],
  pink: [
    "rose", "blush", "fuchsia", "magenta", "salmon", "hot pink", "bubblegum",
  ],
  purple: [
    "violet", "plum", "lavender", "lilac", "amethyst", "grape", "mauve",
  ],
  brown: [
    "tan", "chocolate", "espresso", "mocha", "camel", "khaki", "bronze",
    "coffee", "chestnut",
  ],
};

export function expandColorQuery(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const expanded = new Set<string>();
  expanded.add(lowerQuery);

  for (const [primary, synonyms] of Object.entries(colorSynonymMap)) {
    if (
      primary === lowerQuery ||
      synonyms.some((s) => s === lowerQuery || lowerQuery.includes(s) || s.includes(lowerQuery))
    ) {
      expanded.add(primary);
      synonyms.forEach((s) => expanded.add(s));
    }
  }

  return Array.from(expanded);
}

export function extractColorFromQuery(query: string): string | null {
  const words = query.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (colorSynonymMap[word]) return word;
    for (const [primary, synonyms] of Object.entries(colorSynonymMap)) {
      if (synonyms.includes(word)) return primary;
    }
  }

  for (const [primary, synonyms] of Object.entries(colorSynonymMap)) {
    const lq = query.toLowerCase();
    if (lq.includes(primary)) return primary;
    for (const syn of synonyms) {
      if (lq.includes(syn)) return primary;
    }
  }

  return null;
}
