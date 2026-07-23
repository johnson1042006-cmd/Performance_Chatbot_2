/**
 * Phase B generation-freshness + model-year recency. Pure functions — no
 * mocking needed. Product names below are REAL rows from the 7/20/2026
 * catalog audit; the non-pair cases are the concurrent-tier traps that
 * justify the curated (not generic) design.
 */
import { describe, it, expect } from "vitest";
import {
  CURATED_STALE_DEMOTION,
  computeCuratedStalePenalties,
  extractCuratedGenerations,
  extractModelYear,
  yearRecencyBoost,
  YEAR_BOOST_MAX,
} from "../freshness";
import type { BCProduct } from "@/lib/bigcommerce/client";

let nextId = 1;
function p(name: string): BCProduct {
  return { id: nextId++, name } as BCProduct;
}
function penaltyFor(
  products: BCProduct[],
  target: BCProduct,
  query = "helmets"
): number {
  return computeCuratedStalePenalties(products, query).get(target.id) ?? 0;
}

describe("extractCuratedGenerations", () => {
  it("parses Shoei RF lineage incl. unhyphenated shield names", () => {
    expect(extractCuratedGenerations("Shoei RF-1400 Fullface Helmet")).toEqual([
      { key: "shoei-rf", generation: 4 },
    ]);
    expect(extractCuratedGenerations("Shoei RF-1200 Cheek Pads")).toEqual([
      { key: "shoei-rf", generation: 2 },
    ]);
    expect(
      extractCuratedGenerations("Shoei (CW-1) X-12/ RF1100/Qwest Shields")
    ).toEqual(
      expect.arrayContaining([
        { key: "shoei-rf", generation: 1 },
        { key: "shoei-x", generation: 2 },
      ])
    );
  });

  it("parses GT-Air mixed notation: unnumbered=1, II=2, 3", () => {
    expect(
      extractCuratedGenerations("Shoei (CNS-1) GT-Air/Neotec Pinlock Shield")
    ).toEqual(
      expect.arrayContaining([
        { key: "shoei-gt-air", generation: 1 },
        { key: "shoei-neotec", generation: 1 },
      ])
    );
    expect(extractCuratedGenerations("Shoei GT-Air II Qubit Helmet")).toEqual([
      { key: "shoei-gt-air", generation: 2 },
    ]);
    expect(extractCuratedGenerations("Shoei GT-Air 3 Helmet")).toEqual([
      { key: "shoei-gt-air", generation: 3 },
    ]);
    expect(
      extractCuratedGenerations("Sena SRL 3 Bluetooth Headset For GT-Air3/Neotec3")
    ).toEqual(
      expect.arrayContaining([
        { key: "shoei-gt-air", generation: 3 },
        { key: "shoei-neotec", generation: 3 },
      ])
    );
  });

  it("parses Scorpion EXO lineages and ignores unrelated EXO models", () => {
    expect(extractCuratedGenerations("Scorpion EXO-R420 Helmet")).toEqual([
      { key: "scorpion-exo-r4", generation: 2 },
    ]);
    expect(
      extractCuratedGenerations("Scorpion 2025 EXO-R430 Full-Face Helmet")
    ).toEqual([{ key: "scorpion-exo-r4", generation: 3 }]);
    expect(extractCuratedGenerations("Scorpion EXO-AT960 Monk Helmet")).toEqual([
      { key: "scorpion-exo-at9", generation: 6 },
    ]);
    expect(extractCuratedGenerations("Scorpion EXO-R1 Air Carbon Helmet")).toEqual([]);
    expect(extractCuratedGenerations("Scorpion EXO-CT220 Helmet")).toEqual([]);
    expect(extractCuratedGenerations("Scorpion EXO-XT9000 Faceshields")).toEqual([]);
  });

  it("requires the brand hint for generic family words", () => {
    expect(extractCuratedGenerations("REV'IT! Sand 5 H2O Gloves")).toEqual([
      { key: "revit-sand", generation: 5 },
    ]);
    // Same word, no REV'IT — not a family member
    expect(extractCuratedGenerations("USWE Outlander Moto Hydration Pack 4L - Sand")).toEqual([]);
  });

  it("does NOT parse fractions as generations (Sidi Crossfire 1/4 screws)", () => {
    expect(extractCuratedGenerations("Sidi Crossfire 1/4 Turn Screws")).toEqual([]);
    expect(extractCuratedGenerations("Sidi Crossfire 3 SRS Boot")).toEqual([
      { key: "sidi-crossfire", generation: 3 },
    ]);
  });

  it("Arai Quantum-X never collides with the REV'IT Quantum family", () => {
    expect(extractCuratedGenerations("Arai Quantum-X Steel Helmet")).toEqual([]);
  });

  it("parses the Schuberth C-series; Pro is a refresh, not a generation", () => {
    expect(extractCuratedGenerations("Schuberth C5 Eclipse Helmet")).toEqual([
      { key: "schuberth-c", generation: 5 },
    ]);
    expect(extractCuratedGenerations("Schuberth C4 Pro Helmet")).toEqual([
      { key: "schuberth-c", generation: 4 },
    ]);
    expect(extractCuratedGenerations("Schuberth C3 Faceshield")).toEqual([
      { key: "schuberth-c", generation: 3 },
    ]);
  });

  it("Schuberth guards: SC2 intercom, E-series, Shoei TC-x codes never match", () => {
    expect(extractCuratedGenerations("Schuberth SC2 Bluetooth Intercom")).toEqual([]);
    expect(extractCuratedGenerations("Schuberth E2 Helmet")).toEqual([]);
    expect(extractCuratedGenerations("Schuberth E1 Pinlock-Ready Face Shield")).toEqual([]);
    // TC-5 colorway code on a non-Schuberth name: brandHint + \b both block
    expect(extractCuratedGenerations("Shoei GT-Air 3 Realm TC-5 Helmet")).toEqual([
      { key: "shoei-gt-air", generation: 3 },
    ]);
  });

  it("multi-generation combo accessory names parse as the MAX generation", () => {
    // Real: both tokens are gen 4 — one entry, not two
    expect(
      extractCuratedGenerations("Schuberth C4/C4 Pro  Face Shield")
    ).toEqual([{ key: "schuberth-c", generation: 4 }]);
    // A C4/C5 accessory fits the newest gen — must never be demoted for
    // also fitting the older one
    expect(extractCuratedGenerations("Schuberth C4/C5 Face Shield")).toEqual([
      { key: "schuberth-c", generation: 5 },
    ]);
  });

  it("J-Cruise is deliberately NOT a family (gen 1 left the catalog 7/2026)", () => {
    expect(extractCuratedGenerations("Shoei J-Cruise 2 Helmet")).toEqual([]);
  });
});

describe("computeCuratedStalePenalties — real catalog pairs", () => {
  it("demotes RF-1200 accessories when an RF-1400 is in the pool", () => {
    const old = p("Shoei RF-1200 Cheek Pads");
    const pool = [old, p("Shoei RF-1400 Fullface Helmet")];
    expect(penaltyFor(pool, old)).toBe(CURATED_STALE_DEMOTION);
    expect(penaltyFor(pool, pool[1])).toBe(0);
  });

  it("demotes GT-Air II (roman) when GT-Air 3 (digit) is present", () => {
    const old = p("Shoei GT-Air II Helmet");
    const pool = [old, p("Shoei GT-Air 3 Realm TC-5 Helmet")];
    expect(penaltyFor(pool, old)).toBe(CURATED_STALE_DEMOTION);
  });

  it("demotes the unnumbered gen-1 Neotec shield below Neotec 3", () => {
    const gen1 = p("Shoei (CNS-1) GT-Air/Neotec Pinlock Shield");
    const gen2 = p("Shoei Neotec 2 Cheek Pads");
    const pool = [gen1, gen2, p("Shoei Neotec 3 Modular Helmet")];
    expect(penaltyFor(pool, gen1)).toBe(CURATED_STALE_DEMOTION);
    expect(penaltyFor(pool, gen2)).toBe(CURATED_STALE_DEMOTION);
    expect(penaltyFor(pool, pool[2])).toBe(0);
  });

  it("demotes EXO-R420 vs EXO-R430 and EXO-AT950 vs EXO-AT960", () => {
    const r420 = p("Scorpion EXO-R420 Helmet");
    const at950 = p("Scorpion EXO-AT950 Helmet");
    const pool = [
      r420,
      at950,
      p("Scorpion 2025 EXO-R430 Full-Face Helmet"),
      p("Scorpion EXO-AT960 Helmet"),
    ];
    expect(penaltyFor(pool, r420)).toBe(CURATED_STALE_DEMOTION);
    expect(penaltyFor(pool, at950)).toBe(CURATED_STALE_DEMOTION);
  });

  it("demotes REV'IT Sand 4 when Sand 5 is present", () => {
    const old = p("REV'IT!  Women's Sand 4 Gloves");
    const pool = [old, p("REV'IT! Sand 5 Gloves")];
    expect(penaltyFor(pool, old, "adventure gloves")).toBe(CURATED_STALE_DEMOTION);
  });

  it("demotes Crossfire 2 soles when a Crossfire 3 boot is present", () => {
    const old = p("Sidi Crossfire 2 SRS Soles");
    const pool = [old, p("Sidi Crossfire 3 SRS Boot")];
    expect(penaltyFor(pool, old, "mx boots")).toBe(CURATED_STALE_DEMOTION);
  });

  it("demotes Schuberth C4 Pro and C3 shields when a C5 is present", () => {
    const c4pro = p("Schuberth C4 Pro Helmet");
    const c3 = p("Schuberth C3 Faceshield");
    const pool = [c4pro, c3, p("Schuberth C5 Helmet")];
    expect(penaltyFor(pool, c4pro, "modular helmet")).toBe(CURATED_STALE_DEMOTION);
    expect(penaltyFor(pool, c3, "modular helmet")).toBe(CURATED_STALE_DEMOTION);
    expect(penaltyFor(pool, pool[2], "modular helmet")).toBe(0);
  });

  it("Schuberth escape hatch: naming c4 (or c4 pro) suppresses demotion", () => {
    const c4pro = p("Schuberth C4 Pro Helmet");
    const pool = [c4pro, p("Schuberth C5 Helmet")];
    expect(penaltyFor(pool, c4pro, "schuberth c4 pro helmet")).toBe(0);
    expect(penaltyFor(pool, c4pro, "c4 helmet")).toBe(0);
  });

  it("a C4/C5 combo shield is never demoted (max-gen parsing)", () => {
    const combo = p("Schuberth C4/C5 Face Shield");
    const pool = [combo, p("Schuberth C5 Helmet"), p("Schuberth C4 Pro Helmet")];
    expect(penaltyFor(pool, combo, "modular helmet")).toBe(0);
  });
});

describe("computeCuratedStalePenalties — non-pairs (concurrent tiers, never demoted)", () => {
  it.each([
    [["Alpinestars Tech 3 Boots", "Alpinestars Tech 5 Boots", "Alpinestars Tech 7 Boots 2025"]],
    [["Alpinestars Tech-Air 3 Airbag Vest", "Alpinestars Tech-Air 5 Plasma System"]],
    [["Leatt 3.5 Chest Protector", "Leatt 5.5 FlexLock Moto Boots", "Leatt 6.5 Carbon Neck Brace"]],
    [["Alpinestars Vision 3 Wordmark Goggles", "Alpinestars Vision 5 Goggles", "Alpinestars Vision 8 Corp Goggle"]],
    [["Klim Aggressor 1.0 Shirt", "Klim Aggressor 2.0 Shirt"]],
    [["Cardo Freecom 2X JBL (Single Unit)", "Cardo Freecom 4X JBL (Single Unit)"]],
    [["Shoei X-15 Marquez 7 Helmet", "Shoei X-15 Marquez 8 TC-1 Helmet"]],
  ])("never demotes within %j", (names: string[]) => {
    const pool = names.map(p);
    const penalties = computeCuratedStalePenalties(pool, "gear");
    expect(Array.from(penalties.values())).toEqual([]);
  });
});

describe("computeCuratedStalePenalties — isolation + escape hatch", () => {
  it("never demotes an older generation in isolation", () => {
    const old = p("Shoei GT-Air II Helmet");
    expect(penaltyFor([old, p("Shoei RF-1400 Fullface Helmet")], old)).toBe(0);
  });

  it("query naming the older generation suppresses demotion (rf-1200)", () => {
    const old = p("Shoei RF-1200 Cheek Pads");
    const pool = [old, p("Shoei RF-1400 Fullface Helmet")];
    expect(penaltyFor(pool, old, "rf-1200 cheek pads")).toBe(0);
    expect(penaltyFor(pool, old, "shoei rf1200")).toBe(0);
  });

  it("roman-numeral query suppresses too (gt-air ii)", () => {
    const old = p("Shoei GT-Air II Helmet");
    const pool = [old, p("Shoei GT-Air 3 Helmet")];
    expect(penaltyFor(pool, old, "gt-air ii helmet")).toBe(0);
    expect(penaltyFor(pool, old, "gt air 2")).toBe(0);
  });

  it("a BARE family name is not an explicit generation request", () => {
    const old = p("Shoei GT-Air II Helmet");
    const pool = [old, p("Shoei GT-Air 3 Helmet")];
    expect(penaltyFor(pool, old, "gt-air helmet")).toBe(CURATED_STALE_DEMOTION);
  });
});

describe("extractModelYear / yearRecencyBoost", () => {
  const NOW = 2026;

  it("reads leading and embedded model years", () => {
    expect(extractModelYear("2023 Klim Marrakesh Jacket", NOW)).toBe(2023);
    expect(extractModelYear("Scorpion 2025 EXO-R430 Full-Face Helmet", NOW)).toBe(2025);
    expect(extractModelYear("Leatt 9.5 ADV V25 Carbon Helmet Kit 2025", NOW)).toBe(2025);
  });

  it("ignores fitment ranges — bike years, not product years", () => {
    expect(extractModelYear("Rizoma Stealth Mirror Kawasaki ZX-10R  2020-2025", NOW)).toBeNull();
    expect(
      extractModelYear("New Rage Cycles - Kawasaki ZX-10R Fender Eliminator (2020-Present)", NOW)
    ).toBeNull();
    expect(
      extractModelYear("Denali Auxiliary Light Mount for Honda Africa Twin CRF1000L '16-'19", NOW)
    ).toBeNull();
  });

  it("ignores non-year numbers and out-of-range years", () => {
    expect(extractModelYear("DID 520MX-120 Gold Non O-Ring Chain", NOW)).toBeNull();
    expect(extractModelYear("Denali CANsmart Controller For CRF1100 Africa Twin", NOW)).toBeNull();
    expect(extractModelYear("Motion Pro 1/4\" Spinner T-Handle", NOW)).toBeNull();
    expect(extractModelYear("Vintage 2010 Commemorative Tee", NOW)).toBeNull();
  });

  it("boost scales with recency, capped, and no-year is neutral", () => {
    expect(yearRecencyBoost("2026 Alpinestars Jacket", NOW)).toBe(YEAR_BOOST_MAX);
    expect(yearRecencyBoost("2024 Alpinestars Jacket", NOW)).toBe(3);
    expect(yearRecencyBoost("2021 Alpinestars Jacket", NOW)).toBe(0);
    expect(yearRecencyBoost("Alpinestars Jacket", NOW)).toBe(0);
  });

  it("year boost can never outweigh the in-stock bonus (+30)", () => {
    expect(YEAR_BOOST_MAX).toBeLessThan(30);
  });
});
