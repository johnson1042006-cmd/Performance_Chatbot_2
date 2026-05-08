/**
 * "Your ticket has been received" customer email. Sent by the auto-create
 * pipeline (and the manual POST /api/tickets) when a ticket has a
 * customer email and the manager hasn't disabled `autoTicketEmailEnabled`.
 *
 * Public surface:
 *   - `renderTicketCreated({ ticket, slaWindowHours })` → `{ subject, html, text }`
 *   - `sendTicketCreatedEmail({ ticket, slaWindowHours })` → `EmailResult`
 *     (best-effort wrapper; errors are logged but never thrown).
 */
import { log, serializeError } from "@/lib/log";
import {
  STORE_FOOTER_HTML,
  escapeHtml,
  sendEmail,
  type EmailResult,
} from "@/lib/email/sender";
import type { Ticket } from "@/lib/db/schema";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TicketCreatedArgs {
  ticket: Ticket;
  slaWindowHours: number;
}

export function renderTicketCreated(args: TicketCreatedArgs): RenderedEmail {
  const { ticket, slaWindowHours } = args;
  const subject = `Your request has been received — ticket #${ticket.ticketNumber}`;
  const friendlyName = (ticket.customerName ?? "").trim() || "there";
  const subjectLine = ticket.subject?.trim() || "Your recent chat";

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <h1 style="margin:0 0 8px 0;font-size:18px;color:#111827">Performance Cycle</h1>
    <p style="margin:0 0 24px 0;font-size:13px;color:#6b7280">Ticket #${ticket.ticketNumber}</p>
    <p style="font-size:14px;color:#111827;line-height:1.6">
      Hi ${escapeHtml(friendlyName)},
    </p>
    <p style="font-size:14px;color:#111827;line-height:1.6">
      Thanks for reaching out. We've opened ticket
      <strong>#${ticket.ticketNumber}</strong> for the following request and
      our team will get back to you within
      <strong>${escapeHtml(String(slaWindowHours))} hours</strong>:
    </p>
    <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #e5e7eb;color:#374151;font-size:14px;line-height:1.5">
      ${escapeHtml(subjectLine)}
    </blockquote>
    <p style="font-size:14px;color:#111827;line-height:1.6">
      You don't need to do anything — we'll reply by email as soon as we have
      an update. If you have more details to add, just hit reply.
    </p>
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"/>
    ${STORE_FOOTER_HTML}
  </div>
</body></html>`;

  const text = [
    `Hi ${friendlyName},`,
    "",
    `Thanks for reaching out. We've opened ticket #${ticket.ticketNumber} for the following request and our team will get back to you within ${slaWindowHours} hours:`,
    "",
    `> ${subjectLine}`,
    "",
    "You don't need to do anything — we'll reply by email as soon as we have an update. If you have more details to add, just hit reply.",
    "",
    "Performance Cycle of Colorado",
    "7375 S. Fulton St., Centennial, CO 80112",
    "303-744-2011 · https://performancecycle.com",
  ].join("\n");

  return { subject, html, text };
}

export async function sendTicketCreatedEmail(
  args: TicketCreatedArgs
): Promise<EmailResult> {
  const { ticket } = args;
  if (!ticket.customerEmail) {
    return { ok: false, status: 400, error: "No customer email on ticket" };
  }
  try {
    const rendered = renderTicketCreated(args);
    return await sendEmail({
      to: ticket.customerEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: process.env.SUPPORT_INBOX || undefined,
    });
  } catch (error) {
    log.warn("email.ticket_created_failed", {
      ticketId: ticket.id,
      error: serializeError(error),
    });
    return {
      ok: false,
      status: 502,
      error: "Email delivery failed — see server logs.",
    };
  }
}
