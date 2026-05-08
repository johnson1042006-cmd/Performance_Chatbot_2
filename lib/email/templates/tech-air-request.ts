import { log, serializeError } from "@/lib/log";
import {
  STORE_FOOTER_HTML,
  escapeHtml,
  sendEmail,
  type EmailResult,
} from "@/lib/email/sender";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TechAirRequestPayload {
  fullName: string;
  email: string;
  phone?: string;
  airbagModel: string;
  serialNumber: string;
  serviceRequested: string;
  description: string;
  returnShippingAddress: string;
  preferredReturnShipping: string;
  consent: boolean;
}

export function renderTechAirRequest(args: {
  payload: TechAirRequestPayload;
}): RenderedEmail {
  const p = args.payload;
  const subject = `Tech-Air service request — ${p.airbagModel} / SN ${p.serialNumber}`;

  const dlRow = (label: string, value: string) => {
    return `<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #e5e7eb">
      <div style="width:180px;font-size:12px;color:#6b7280">${escapeHtml(
        label
      )}</div>
      <div style="flex:1;font-size:13px;color:#111827;line-height:1.5">${escapeHtml(
        value
      ).replace(/\n/g, "<br/>")}</div>
    </div>`;
  };

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
    <h1 style="margin:0 0 6px 0;font-size:18px;color:#111827">Performance Cycle</h1>
    <p style="margin:0 0 18px 0;font-size:13px;color:#6b7280">Tech-Air service request</p>

    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px">
      ${dlRow("Full name", p.fullName)}
      ${dlRow("Email", p.email)}
      ${dlRow("Phone", p.phone?.trim() ? p.phone : "—")}
      ${dlRow("Airbag model", p.airbagModel)}
      ${dlRow("Serial number", p.serialNumber)}
      ${dlRow("Service requested", p.serviceRequested)}
      ${dlRow("Description", p.description)}
      ${dlRow("Return shipping address", p.returnShippingAddress)}
      ${dlRow("Preferred return shipping", p.preferredReturnShipping)}
    </div>

    <p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;line-height:1.6">
      If anything looks incorrect, reply to this email with an update.
    </p>

    <hr style="border:0;border-top:1px solid #e5e7eb;margin:22px 0"/>
    ${STORE_FOOTER_HTML}
  </div>
</body></html>`;

  const text = [
    "Performance Cycle — Tech-Air service request",
    "",
    `Full name: ${p.fullName}`,
    `Email: ${p.email}`,
    `Phone: ${p.phone?.trim() ? p.phone : "—"}`,
    `Airbag model: ${p.airbagModel}`,
    `Serial number: ${p.serialNumber}`,
    `Service requested: ${p.serviceRequested}`,
    "",
    "Description:",
    p.description,
    "",
    "Return shipping address:",
    p.returnShippingAddress,
    "",
    `Preferred return shipping: ${p.preferredReturnShipping}`,
    "",
    "Performance Cycle of Colorado",
    "7375 S. Fulton St., Centennial, CO 80112",
    "303-744-2011 · https://performancecycle.com",
  ].join("\n");

  return { subject, html, text };
}

export async function sendTechAirRequestEmail(args: {
  to: string | string[];
  payload: TechAirRequestPayload;
  replyTo?: string;
}): Promise<EmailResult> {
  try {
    const rendered = renderTechAirRequest({ payload: args.payload });
    return await sendEmail({
      to: args.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: args.replyTo,
    });
  } catch (error) {
    log.warn("email.tech_air_request_failed", { error: serializeError(error) });
    return {
      ok: false,
      status: 502,
      error: "Email delivery failed — see server logs.",
    };
  }
}

