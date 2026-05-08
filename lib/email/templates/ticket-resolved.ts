/**
 * "Your ticket has been resolved" customer email. Sent by PATCH
 * /api/tickets/[id] when a staff member flips status to `resolved`.
 *
 * Same shape and best-effort semantics as ticket-created.ts.
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

export interface TicketResolvedArgs {
  ticket: Ticket;
  resolutionNote?: string | null;
}

export function renderTicketResolved(args: TicketResolvedArgs): RenderedEmail {
  const { ticket, resolutionNote } = args;
  const subject = `Ticket #${ticket.ticketNumber} resolved`;
  const friendlyName = (ticket.customerName ?? "").trim() || "there";
  const subjectLine = ticket.subject?.trim() || "Your recent chat";

  const noteBlock = resolutionNote
    ? `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #d1fae5;color:#374151;font-size:14px;line-height:1.5;background:#f0fdf4">
        ${escapeHtml(resolutionNote)}
      </blockquote>`
    : "";

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <h1 style="margin:0 0 8px 0;font-size:18px;color:#111827">Performance Cycle</h1>
    <p style="margin:0 0 24px 0;font-size:13px;color:#6b7280">Ticket #${ticket.ticketNumber} — Resolved</p>
    <p style="font-size:14px;color:#111827;line-height:1.6">
      Hi ${escapeHtml(friendlyName)},
    </p>
    <p style="font-size:14px;color:#111827;line-height:1.6">
      We've marked your ticket
      <strong>#${ticket.ticketNumber}</strong> as resolved:
    </p>
    <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #e5e7eb;color:#374151;font-size:14px;line-height:1.5">
      ${escapeHtml(subjectLine)}
    </blockquote>
    ${noteBlock}
    <p style="font-size:14px;color:#111827;line-height:1.6">
      If anything is still off, just hit reply or give us a call — the
      ticket can be reopened.
    </p>
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"/>
    ${STORE_FOOTER_HTML}
  </div>
</body></html>`;

  const text = [
    `Hi ${friendlyName},`,
    "",
    `We've marked your ticket #${ticket.ticketNumber} as resolved:`,
    "",
    `> ${subjectLine}`,
    "",
    ...(resolutionNote ? [`> ${resolutionNote}`, ""] : []),
    "If anything is still off, just hit reply or give us a call — the ticket can be reopened.",
    "",
    "Performance Cycle of Colorado",
    "7375 S. Fulton St., Centennial, CO 80112",
    "303-744-2011 · https://performancecycle.com",
  ].join("\n");

  return { subject, html, text };
}

export async function sendTicketResolvedEmail(
  args: TicketResolvedArgs
): Promise<EmailResult> {
  const { ticket } = args;
  if (!ticket.customerEmail) {
    return { ok: false, status: 400, error: "No customer email on ticket" };
  }
  try {
    const rendered = renderTicketResolved(args);
    return await sendEmail({
      to: ticket.customerEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: process.env.SUPPORT_INBOX || undefined,
    });
  } catch (error) {
    log.warn("email.ticket_resolved_failed", {
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
