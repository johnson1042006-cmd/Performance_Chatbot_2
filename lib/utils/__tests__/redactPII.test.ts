import { describe, it, expect } from "vitest";
import { redactPII } from "../redactPII";

describe("redactPII", () => {
  it("returns no hits for empty / non-PII input", () => {
    expect(redactPII("")).toEqual({ redacted: "", hits: [] });
    expect(redactPII("hello there, just a normal message"))
      .toEqual({ redacted: "hello there, just a normal message", hits: [] });
  });

  it("redacts a credit-card-shaped run with no separators", () => {
    const { redacted, hits } = redactPII("my card is 4111111111111111 thanks");
    expect(redacted).toBe("my card is [CARD] thanks");
    expect(hits).toContain("card");
  });

  it("redacts a credit-card-shaped run with spaces", () => {
    const { redacted, hits } = redactPII("card 4111 1111 1111 1111 ok");
    expect(redacted).toBe("card [CARD] ok");
    expect(hits).toContain("card");
  });

  it("redacts a credit-card-shaped run with dashes", () => {
    const { redacted, hits } = redactPII("4111-1111-1111-1111");
    expect(redacted).toBe("[CARD]");
    expect(hits).toContain("card");
  });

  it("redacts an SSN", () => {
    const { redacted, hits } = redactPII("ssn 123-45-6789 here");
    expect(redacted).toBe("ssn [SSN] here");
    expect(hits).toContain("ssn");
  });

  it("redacts emails and dedupes the hit category", () => {
    const { redacted, hits } = redactPII(
      "contact me at one@a.com or two@b.co for help"
    );
    expect(redacted).toBe("contact me at [EMAIL] or [EMAIL] for help");
    expect(hits).toEqual(["email"]);
  });

  it("preserves the store number in 5 common formats", () => {
    const formats = [
      "303-744-2011",
      "(303) 744-2011",
      "303.744.2011",
      "+1 303 744 2011",
      "3037442011",
    ];
    for (const f of formats) {
      const { redacted, hits } = redactPII(`call us at ${f} please`);
      expect(redacted).toBe(`call us at ${f} please`);
      expect(hits).not.toContain("phone");
    }
  });

  it("redacts a customer phone in (303) 555-1212 form", () => {
    const { redacted, hits } = redactPII("reach me at (303) 555-1212 anytime");
    expect(redacted).toBe("reach me at [PHONE] anytime");
    expect(hits).toContain("phone");
  });

  it("redacts a customer phone in 720-555-1212 form", () => {
    const { redacted, hits } = redactPII("call 720-555-1212");
    expect(redacted).toBe("call [PHONE]");
    expect(hits).toContain("phone");
  });

  it("returns sorted, unique hits across multiple categories", () => {
    const { hits } = redactPII(
      "card 4111111111111111, ssn 123-45-6789, email me@x.com, phone 720-555-1212"
    );
    expect(hits).toEqual(["card", "email", "phone", "ssn"]);
  });
});
