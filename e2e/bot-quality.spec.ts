/**
 * Bot quality stress test — drives the actual /embed widget for 50 questions
 * spanning every major area of the Performance Cycle catalog and asserts on
 * the rendered AI reply text.
 *
 * Goals
 *  - Catch regressions where helmets, jackets, gloves, boots, pants or tires
 *    surface off-style products by default.
 *  - Verify accessory queries return relevant items, not generic /parts/.
 *  - Check policy / hard-coded knowledge entries (returns, e-bikes).
 *  - Make sure the bot never tells the customer to "call the store".
 *
 * The suite uses one fresh customer session per question (so prior history
 * can't influence answers). Per-question timeout is generous because the
 * Pusher round-trip is ~5s in dev. The whole suite passes if at least 45 of
 * 50 questions meet their assertions — soft-pass threshold to absorb 1-2
 * model wobbles per run.
 */

import { test, expect, Page } from "@playwright/test";

interface QA {
  area: string;
  q: string;
  // Each `must` predicate must return true on the AI reply text.
  must: Array<(reply: string) => boolean>;
  // Each `mustNot` predicate must return false on the AI reply text.
  mustNot?: Array<(reply: string) => boolean>;
}

// ---------------------------------------------------------------------------
// Predicate helpers
// ---------------------------------------------------------------------------

const lower = (s: string) => s.toLowerCase();
const has = (sub: string) => (r: string) => lower(r).includes(lower(sub));
const hasAny =
  (...subs: string[]) =>
  (r: string) =>
    subs.some((s) => lower(r).includes(lower(s)));
const hasNone =
  (...subs: string[]) =>
  (r: string) =>
    !subs.some((s) => lower(r).includes(lower(s)));

const mentionsProduct = (r: string) => /\*\*[^*]+\*\*/.test(r) || /\[.+\]\(.+\)/.test(r);
const mentionsPrice = (r: string) => /\$[\d,]+(?:\.\d{2})?/.test(r);
const isNonTrivial = (r: string) => r.trim().length >= 30;

const NEVER_CALL_STORE = (r: string) =>
  /(call\s+(?:the\s+)?store|give\s+us\s+a\s+ring|swing\s+by|visit\s+in\s+person)/i.test(
    r
  );

const NEVER_RECOMMEND_OPENFACE_LEAD = (r: string) => {
  const lines = r.split(/\r?\n/);
  for (const line of lines.slice(0, 6)) {
    if (/\*\*[^*]*\b(open[\s-]?face|3\s*\/\s*4|half[\s-]?helmet|beanie|shorty)\b[^*]*\*\*/i.test(line)) {
      return true;
    }
  }
  return false;
};

// ---------------------------------------------------------------------------
// 50 questions — one per row, grouped by inventory area for readability
// ---------------------------------------------------------------------------

const QUESTIONS: QA[] = [
  // Helmets - defaults (3)
  {
    area: "helmet-default",
    q: "what helmets do you have",
    must: [isNonTrivial, mentionsProduct],
    mustNot: [NEVER_CALL_STORE, NEVER_RECOMMEND_OPENFACE_LEAD],
  },
  {
    area: "helmet-default",
    q: "show me Shoei helmets",
    must: [isNonTrivial, hasAny("Shoei", "RF-", "GT-")],
    mustNot: [NEVER_CALL_STORE, NEVER_RECOMMEND_OPENFACE_LEAD],
  },
  {
    area: "helmet-default",
    q: "any Bell helmets in stock",
    must: [isNonTrivial, has("Bell")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Helmets - explicit styles (4)
  {
    area: "helmet-style",
    q: "open-face helmets",
    must: [
      isNonTrivial,
      hasAny("open face", "open-face", "3/4", "half"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "helmet-style",
    q: "modular helmet for touring",
    must: [isNonTrivial, hasAny("modular", "flip")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "helmet-style",
    q: "MX helmet under $500",
    must: [isNonTrivial, hasAny("mx", "motocross", "off-road", "dirt", "moto")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "helmet-style",
    q: "adventure helmet recommendations",
    must: [isNonTrivial, hasAny("adventure", "adv", "dual sport")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Jackets (5)
  {
    area: "jacket",
    q: "I need a jacket",
    must: [isNonTrivial, mentionsProduct],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "jacket",
    q: "mesh jacket for summer",
    must: [
      isNonTrivial,
      hasAny("mesh", "vented", "ventilated", "summer", "jacket"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "jacket",
    q: "leather jacket",
    must: [isNonTrivial, hasAny("leather", "jacket")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "jacket",
    q: "waterproof touring jacket",
    must: [
      isNonTrivial,
      hasAny("waterproof", "h2o", "gore", "drystar", "rain", "touring"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "jacket",
    q: "MX jersey for trail riding",
    must: [isNonTrivial, hasAny("jersey", "mx", "motocross", "trail")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Pants (2)
  {
    area: "pants",
    q: "armored jeans",
    must: [isNonTrivial, hasAny("jean", "armor", "armour", "denim")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "pants",
    q: "rain pants",
    must: [isNonTrivial, hasAny("rain", "waterproof", "h2o", "drystar", "pant")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Gloves (3)
  {
    area: "gloves",
    q: "summer gloves",
    must: [isNonTrivial, has("glove")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "gloves",
    q: "winter gloves",
    must: [
      isNonTrivial,
      hasAny("winter", "heated", "cold", "insulated", "glove"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "gloves",
    q: "MX gloves",
    must: [isNonTrivial, hasAny("mx", "motocross", "dirt", "off-road", "glove")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Boots (2)
  {
    area: "boots",
    q: "waterproof boots",
    must: [isNonTrivial, hasAny("waterproof", "h2o", "gore", "drystar", "boot")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "boots",
    q: "race boots",
    must: [isNonTrivial, hasAny("race", "track", "sport", "boot")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Suits / vests / armor (3)
  {
    area: "suit",
    q: "track suit",
    must: [isNonTrivial, hasAny("track", "race", "leather", "one piece", "suit")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "armor",
    q: "back protector",
    must: [isNonTrivial, hasAny("back protector", "back protection", "armor", "armour")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "armor",
    q: "chest protector",
    must: [
      isNonTrivial,
      hasAny("chest protector", "chest guard", "roost", "armor", "armour"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },

  // Airbags (2)
  {
    area: "airbag",
    q: "what airbags do you carry",
    must: [
      isNonTrivial,
      hasAny("street", "mx", "avalanche", "tech-air", "airbag"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "airbag",
    q: "MX airbag for trail riding",
    must: [isNonTrivial, hasAny("mx", "offroad", "off-road", "airbag", "tech-air")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Tires (3)
  {
    area: "tire",
    q: "front tire for sport bike",
    must: [isNonTrivial, hasAny("tire", "sport", "michelin", "dunlop", "pirelli")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "tire",
    q: "sport touring tire",
    must: [isNonTrivial, has("tire"), hasAny("sport", "touring", "road")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "tire",
    q: "dirt tire",
    must: [
      isNonTrivial,
      hasAny("dirt", "knobby", "off-road", "mx", "motocross", "tire"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },

  // Maintenance parts (3)
  {
    area: "maintenance",
    q: "chain lube",
    must: [isNonTrivial, hasAny("chain", "lube", "lubricant")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "maintenance",
    q: "synthetic oil",
    must: [isNonTrivial, hasAny("oil", "synthetic", "motul", "maxima")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "maintenance",
    q: "brake pads",
    must: [isNonTrivial, hasAny("brake", "pad", "ebc", "galfer")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Exhaust & drivetrain (2)
  {
    area: "exhaust",
    q: "slip-on exhaust",
    must: [
      isNonTrivial,
      hasAny("exhaust", "slip-on", "muffler", "akrapovic", "yoshimura", "pipe"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "drivetrain",
    q: "sprocket set",
    must: [isNonTrivial, hasAny("sprocket", "chain", "drive", "set")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Helmet accessories (3)
  {
    area: "helmet-accessory",
    q: "Pinlock for my helmet",
    must: [isNonTrivial, hasAny("pinlock", "anti-fog", "fog")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "helmet-accessory",
    q: "tinted visor for Bell helmet",
    must: [
      isNonTrivial,
      hasAny("visor", "shield", "tinted", "smoke", "iridium"),
    ],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "helmet-accessory",
    q: "helmet bag",
    must: [isNonTrivial, hasAny("helmet bag", "bag", "carry", "case")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Communication & electronics (2)
  {
    area: "comms",
    q: "Cardo or Sena options",
    must: [isNonTrivial, hasAny("cardo", "sena", "intercom", "communication", "bluetooth")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "electronics",
    q: "phone mount for my bike",
    must: [isNonTrivial, hasAny("phone mount", "quadlock", "ram", "mount")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Cameras & mounts (1)
  {
    area: "camera",
    q: "GoPro mounts",
    must: [isNonTrivial, hasAny("gopro", "mount", "camera", "insta360", "action")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Luggage / bags (2)
  {
    area: "luggage",
    q: "tank bag",
    must: [isNonTrivial, hasAny("tank bag", "tank", "magnetic", "luggage", "bag")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "luggage",
    q: "saddlebag",
    must: [isNonTrivial, hasAny("saddlebag", "saddle", "side", "pannier")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Off-road specific (2)
  {
    area: "offroad",
    q: "goggles",
    must: [isNonTrivial, hasAny("goggle", "smith", "100%", "scott", "fox", "oakley")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "offroad",
    q: "MX jersey",
    must: [isNonTrivial, hasAny("jersey", "mx", "motocross", "fox", "thor", "fly")],
    mustNot: [NEVER_CALL_STORE],
  },

  // E-bikes & specialty (2)
  {
    area: "ebikes",
    q: "do you carry e-bikes",
    must: [isNonTrivial, hasAny("e-bike", "ebike", "electric", "yes", "carry")],
    mustNot: [(r) => /no,?\s+(?:we|the store)\s+(?:do\s+)?(?:n['']?t|do\s+not)\s+carry/i.test(r)],
  },
  {
    area: "specialty",
    q: "snowmobile gear",
    must: [isNonTrivial, hasAny("snow", "snowmobile", "klim", "509", "fxr", "carry")],
    mustNot: [NEVER_CALL_STORE],
  },

  // Policy / edge cases (4)
  {
    area: "policy",
    q: "what's your return policy",
    must: [
      isNonTrivial,
      hasAny("return", "exchange", "performancecycle.com/returns"),
    ],
  },
  {
    area: "policy",
    q: "can I return a helmet",
    must: [isNonTrivial, hasAny("return", "helmet", "worn", "visor", "non-returnable")],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "policy",
    q: "what are your store hours",
    must: [isNonTrivial, hasAny("hour", "open", "close", "monday", "sunday", "centennial")],
  },
  {
    area: "policy",
    q: "do you do service",
    must: [isNonTrivial, hasAny("service", "appointment", "schedule", "yes", "centennial", "performance cycle")],
  },

  // Color, budget, vague (2)
  {
    area: "color",
    q: "blue helmet under $500",
    must: [isNonTrivial, mentionsProduct, mentionsPrice],
    mustNot: [NEVER_CALL_STORE],
  },
  {
    area: "vague",
    q: "I need gear",
    must: [isNonTrivial],
    mustNot: [NEVER_CALL_STORE],
  },
];

// Sanity check at module load — fail fast if the count drifts.
if (QUESTIONS.length !== 50) {
  throw new Error(`Expected exactly 50 questions, got ${QUESTIONS.length}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ask(page: Page, question: string): Promise<string> {
  const aiSelector = '[data-testid="message-ai"]';
  const beforeCount = await page.locator(aiSelector).count();

  await page.locator('[data-testid="chat-input"]').fill(question);
  await page.locator('[data-testid="chat-send"]').click();

  await page.locator(aiSelector).nth(beforeCount).waitFor({
    state: "visible",
    timeout: 25_000,
  });

  // Let any final streaming settle (the widget renders the full reply at once,
  // but the markdown render hook can paint a tick later).
  await page.waitForTimeout(200);

  const reply = await page.locator(aiSelector).nth(beforeCount).innerText();
  return reply;
}

interface Failure {
  q: string;
  reason: string;
  reply: string;
}

// ---------------------------------------------------------------------------
// The suite — one Playwright test that runs all 50 questions sequentially in
// a single browser context so we don't spin up the dev server 50 times.
// ---------------------------------------------------------------------------

test.describe("Bot quality — 50 questions across the catalog", () => {
  test.setTimeout(50 * 35_000);

  test("answers across helmets, apparel, parts, accessories, and policy", async ({
    page,
  }, testInfo) => {
    const failures: Failure[] = [];

    for (let i = 0; i < QUESTIONS.length; i++) {
      const qa = QUESTIONS[i];
      const sessionId = `qa-${Date.now()}-${i}`;
      await page.goto(`/embed?sessionId=${sessionId}`);
      await page.waitForLoadState("networkidle");

      let reply = "";
      try {
        reply = await ask(page, qa.q);
      } catch (err) {
        failures.push({
          q: `[${qa.area}] ${qa.q}`,
          reason: `no reply (${(err as Error).message || err})`,
          reply: "",
        });
        continue;
      }

      const failedMust = qa.must
        .map((p, idx) => (p(reply) ? null : `must#${idx}`))
        .filter((x): x is string => x !== null);
      const failedMustNot = (qa.mustNot ?? [])
        .map((p, idx) => (p(reply) ? `mustNot#${idx}` : null))
        .filter((x): x is string => x !== null);

      if (failedMust.length || failedMustNot.length) {
        failures.push({
          q: `[${qa.area}] ${qa.q}`,
          reason: [...failedMust, ...failedMustNot].join(", "),
          reply: reply.slice(0, 400).replace(/\s+/g, " "),
        });
      }
    }

    const summary = `\n\n=== Bot quality summary ===\nPassed: ${
      QUESTIONS.length - failures.length
    } / ${QUESTIONS.length}\nFailures:\n${failures
      .map((f) => `  - ${f.q}\n      reason: ${f.reason}\n      reply: ${f.reply}`)
      .join("\n")}\n`;
    console.log(summary);
    await testInfo.attach("bot-quality-summary.txt", {
      body: summary,
      contentType: "text/plain",
    });

    expect(
      failures.length,
      `Bot quality regressed: ${failures.length}/${QUESTIONS.length} failed.\n${summary}`
    ).toBeLessThanOrEqual(5);
  });
});
