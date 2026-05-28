import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/utils/renderMarkdown";

describe("renderMarkdown – bold-wrapped links", () => {
  it("produces a clean href when a [text](url) link is wrapped in **bold**", () => {
    const html = renderMarkdown(
      "**[Helmets](https://performancecycle.com/helmets/)**"
    );
    const href = html.match(/href="([^"]+)"/)?.[1];
    expect(href).toBe("https://performancecycle.com/helmets/");
    expect(href).not.toContain("</strong>");
    expect(href).not.toContain("%3C/strong%3E");
  });

  it("produces a clean href for a bare URL inside **bold**", () => {
    const html = renderMarkdown("**https://performancecycle.com/helmets/**");
    const href = html.match(/href="([^"]+)"/)?.[1];
    expect(href).toBe("https://performancecycle.com/helmets/");
    expect(href).not.toContain("**");
    expect(href).not.toContain("</strong>");
  });

  it("preserves bold text inside link text [**bold**](url)", () => {
    const html = renderMarkdown(
      "[**Helmets**](https://performancecycle.com/helmets/)"
    );
    expect(html).toContain('href="https://performancecycle.com/helmets/"');
    expect(html).toContain("<strong>Helmets</strong>");
  });
});
