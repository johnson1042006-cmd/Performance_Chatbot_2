import { describe, it, expect } from "vitest";
import { detectTechAirServiceIntent } from "../techAirIntent";

describe("detectTechAirServiceIntent", () => {
  // Shopping / comparison — must NOT trigger the service form
  it("shopping: 'show me tech-air airbags' → false", () =>
    expect(detectTechAirServiceIntent("show me tech-air airbags")).toBe(false));

  it("shopping: 'do you have tech air 5' → false", () =>
    expect(detectTechAirServiceIntent("do you have tech air 5")).toBe(false));

  it("comparison: 'tech-air 5 vs tech-air 10' → false", () =>
    expect(detectTechAirServiceIntent("tech-air 5 vs tech-air 10")).toBe(false));

  it("purchase: 'I want to buy a tech-air' → false", () =>
    expect(detectTechAirServiceIntent("I want to buy a tech-air")).toBe(false));

  // Clear service intent — must trigger the service form
  it("service: 'I need to send my tech-air in for service' → true", () =>
    expect(
      detectTechAirServiceIntent("I need to send my tech-air in for service")
    ).toBe(true));

  it("deployed: 'my tech-air deployed, what do I do' → true", () =>
    expect(
      detectTechAirServiceIntent("my tech-air deployed, what do I do")
    ).toBe(true));

  it("recharge: 'tech-air recharge' → true", () =>
    expect(detectTechAirServiceIntent("tech-air recharge")).toBe(true));

  it("expired: 'my tech-air is expired' → true", () =>
    expect(detectTechAirServiceIntent("my tech-air is expired")).toBe(true));

  // Legacy exact phrase — always triggers regardless of surrounding context
  it("legacy: 'airbag service' → true", () =>
    expect(detectTechAirServiceIntent("airbag service")).toBe(true));
});
