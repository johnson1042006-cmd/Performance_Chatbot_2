import { describe, it, expect } from "vitest";
import {
  renderTechAirRequest,
  type TechAirRequestPayload,
} from "@/lib/email/templates/tech-air-request";

const basePayload: TechAirRequestPayload = {
  fullName: "Alex Rider",
  email: "alex@example.com",
  phone: "(303) 555-1212",
  airbagModel: "Tech-Air 5",
  serialNumber: "SN123",
  serviceRequested: "Cartridge replacement",
  description: "Error light E1",
  returnShippingAddress: "Alex Rider\n123 Main St\nCentennial, CO 80112",
  preferredReturnShipping: "Standard ground",
  consent: true,
};

describe("renderTechAirRequest", () => {
  it("subject embeds airbag model and serial number", () => {
    const { subject } = renderTechAirRequest({ payload: basePayload });
    expect(subject).toBe(
      "Tech-Air service request — Tech-Air 5 / SN SN123"
    );
  });

  it("subject reflects different model + serial", () => {
    const { subject } = renderTechAirRequest({
      payload: { ...basePayload, airbagModel: "Tech-Air Race", serialNumber: "X9-42" },
    });
    expect(subject).toBe(
      "Tech-Air service request — Tech-Air Race / SN X9-42"
    );
  });

  it("html and text bodies include core fields and escape user input", () => {
    const { html, text } = renderTechAirRequest({
      payload: {
        ...basePayload,
        fullName: "Alex <script>alert(1)</script> Rider",
        description: "Error <b>light</b>",
      },
    });
    expect(html).toContain("Tech-Air 5");
    expect(html).toContain("SN123");
    expect(html).toContain("alex@example.com");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(text).toContain("Airbag model: Tech-Air 5");
    expect(text).toContain("Serial number: SN123");
    expect(text).toContain("Service requested: Cartridge replacement");
  });

  it("renders an em-dash when phone is empty", () => {
    const { html, text } = renderTechAirRequest({
      payload: { ...basePayload, phone: "" },
    });
    expect(html).toContain("Phone");
    expect(text).toContain("Phone: —");
  });
});
