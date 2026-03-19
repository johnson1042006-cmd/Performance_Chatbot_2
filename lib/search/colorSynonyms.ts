export const colorSynonymMap: Record<string, string[]> = {
  black: ["onyx", "jet", "midnight", "charcoal", "stealth", "dark", "ebony", "obsidian", "noir"],
  white: ["pearl", "ivory", "cream", "arctic", "ghost", "snow", "frost", "alabaster"],
  blue: ["navy", "cobalt", "royal blue", "midnight", "slate blue", "ocean", "sky blue", "cerulean", "azure", "sapphire", "indigo", "dark blue"],
  red: ["crimson", "scarlet", "cherry", "maroon", "burgundy", "wine", "vermillion", "ruby", "garnet", "cardinal"],
  green: ["olive", "forest", "emerald", "sage", "hunter", "lime", "moss", "jade", "military green", "army green"],
  yellow: ["gold", "amber", "honey", "mustard", "lemon", "sunshine", "canary"],
  orange: ["tangerine", "rust", "copper", "coral", "burnt orange", "terracotta"],
  gray: ["grey", "silver", "graphite", "slate", "ash", "pewter", "titanium", "gunmetal", "aluminum"],
  pink: ["rose", "blush", "fuchsia", "magenta", "salmon", "hot pink", "bubblegum"],
  purple: ["violet", "plum", "lavender", "lilac", "amethyst", "grape", "mauve"],
  brown: ["tan", "chocolate", "espresso", "mocha", "camel", "khaki", "bronze", "coffee", "chestnut"],
};

export function expandColorQuery(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const expanded = new Set<string>();
  expanded.add(lowerQuery);

  for (const [primary, synonyms] of Object.entries(colorSynonymMap)) {
    if (primary === lowerQuery || synonyms.includes(lowerQuery)) {
      expanded.add(primary);
      synonyms.forEach((s) => expanded.add(s));
    }
  }

  return Array.from(expanded);
}
