/**
 * Phase A5 reply link/bold audit. Pure functions — no mocking needed.
 */
import { describe, it, expect } from "vitest";
import { auditReplyLinks, productKeyPhrase } from "../replyAudit";

const NAMES = [
  "Michelin Road 6 Sport Touring Tires",
  "2023 Klim Marrakesh Jacket",
  "Shoei RF-1400 Helmet",
];

describe("productKeyPhrase", () => {
  it("lowercases and takes the first three words", () => {
    expect(productKeyPhrase("Michelin Road 6 Sport Touring Tires")).toBe(
      "michelin road 6"
    );
  });

  it("strips a leading model-year token and trailing generic noun", () => {
    expect(productKeyPhrase("2023 Klim Marrakesh Jacket")).toBe(
      "klim marrakesh"
    );
    expect(productKeyPhrase("Shoei RF-1400 Helmet")).toBe("shoei rf-1400");
  });

  it("keeps short names whole", () => {
    expect(productKeyPhrase("EBC Brakes")).toBe("ebc brakes");
  });
});

describe("auditReplyLinks", () => {
  it("counts a fully linked bold product as linked, not unlinked", () => {
    const reply =
      "I'd go with the [**Michelin Road 6 Sport Touring Tires**](https://performancecycle.com/road-6/) — $214.99, in stock.";
    const audit = auditReplyLinks(reply, NAMES);
    expect(audit.linkCount).toBe(1);
    expect(audit.boldCount).toBe(1);
    expect(audit.unlinkedBoldCount).toBe(0);
    expect(audit.productsMentioned).toBe(1);
    expect(audit.productsLinked).toBe(1);
    expect(audit.unlinkedProducts).toEqual([]);
  });

  it("flags the observed failure mode: bold kept, link dropped", () => {
    const reply =
      "The **Michelin Road 6 Sport Touring Tires** are a great pick at $214.99.";
    const audit = auditReplyLinks(reply, NAMES);
    expect(audit.linkCount).toBe(0);
    expect(audit.boldCount).toBe(1);
    expect(audit.unlinkedBoldCount).toBe(1);
    expect(audit.productsMentioned).toBe(1);
    expect(audit.productsLinked).toBe(0);
    expect(audit.unlinkedProducts).toEqual(["michelin road 6"]);
  });

  it("catches shortened product mentions via the key phrase", () => {
    const reply =
      "The [**Klim Marrakesh Jacket**](https://performancecycle.com/marrakesh/) breathes well; the **Shoei RF-1400** pairs nicely.";
    const audit = auditReplyLinks(reply, NAMES);
    expect(audit.productsMentioned).toBe(2);
    expect(audit.productsLinked).toBe(1);
    expect(audit.unlinkedProducts).toEqual(["shoei rf-1400"]);
  });

  it("treats bold WRAPPING a link as linked (observed live format)", () => {
    // First live telemetry sample (7/20): "**[Icon Airform MIPS Kryola Kreep
    // Helmet](https://...)** — $250" — link works, must not count as unlinked.
    const reply =
      "**[Icon Airform MIPS Kryola Kreep Helmet](https://performancecycle.com/icon-airform/)** — $250";
    const audit = auditReplyLinks(reply, ["Icon Airform MIPS Kryola Kreep Helmet"]);
    expect(audit.boldCount).toBe(1);
    expect(audit.unlinkedBoldCount).toBe(0);
    expect(audit.productsLinked).toBe(1);
  });

  it("treats bold with trailing text inside one link as linked", () => {
    const reply =
      "Check the [**Road 6** — our top tire](https://performancecycle.com/road-6/) today.";
    const audit = auditReplyLinks(reply, []);
    expect(audit.boldCount).toBe(1);
    expect(audit.unlinkedBoldCount).toBe(0);
  });

  it("handles replies with no products and no markdown", () => {
    const audit = auditReplyLinks("We're open 9-6 Monday through Saturday.", NAMES);
    expect(audit).toEqual({
      linkCount: 0,
      boldCount: 0,
      unlinkedBoldCount: 0,
      productsMentioned: 0,
      productsLinked: 0,
      unlinkedProducts: [],
    });
  });

  it("dedupes products sharing a key phrase", () => {
    const names = [
      "Michelin Road 6 Front Tire",
      "Michelin Road 6 Rear Tire",
    ];
    const reply = "The **Michelin Road 6** comes in front and rear fitments.";
    const audit = auditReplyLinks(reply, names);
    expect(audit.productsMentioned).toBe(1);
  });
});
