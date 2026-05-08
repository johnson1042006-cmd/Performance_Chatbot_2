export type RidingType =
  | "Street"
  | "Sport"
  | "Adventure"
  | "Cruiser"
  | "Off-road"
  | "Dual sport"
  | "Track";

export function tireCatalogPathForRidingType(type: RidingType): string {
  switch (type) {
    case "Adventure":
      return "/tires/adventure/";
    case "Cruiser":
      return "/tires/cruiser/";
    case "Off-road":
      return "/tires/offroad/";
    case "Dual sport":
      // Matches the store_catalog KB entry (note: not under /tires/ in that entry).
      return "/dual-sport/";
    case "Track":
      // Closest match is sportbike category.
      return "/tires/sportbike/";
    case "Sport":
      return "/tires/sportbike/";
    case "Street":
    default:
      // Street riders most often shop sportbike/sport-touring; the KB has both.
      // We bias to sportbike per phase requirement.
      return "/tires/sportbike/";
  }
}

export function tireCatalogUrlForRidingType(type: RidingType): string {
  return `https://performancecycle.com${tireCatalogPathForRidingType(type)}`;
}

