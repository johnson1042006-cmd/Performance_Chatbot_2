import { Resend } from "resend";
import { db } from "@/lib/db";
import { messages, sessions, knowledgeBase } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

const FROM_DEFAULT = "Performance Cycle Chat <onboarding@resend.dev>";
const STORE_FOOTER_HTML = `
  <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6">
    Performance Cycle of Colorado<br/>
    7375 S. Fulton St., Centennial, CO 80112<br/>
    303-744-2011 &middot; <a href="https://performancecycle.com" style="color:#6b7280">performancecycle.com</a>
  </p>
`;

export interface EmailResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Returns a Resend client, or null if RESEND_API_KEY is unset. Callers
 * should treat null as "email is disabled in this environment" — we surface
 * a 503 to the customer rather than a 500 so they understand the failure
 * mode and the manager can act.
 */
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

async function loadPersonaName(): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_persona"))
      .limit(1);
    if (!row) return "Jake";
    const parsed = JSON.parse(row.content);
    return typeof parsed?.name === "string" ? parsed.name : "Jake";
  } catch {
    return "Jake";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function roleBadge(role: string, personaName: string): string {
  if (role === "customer") return "You";
  if (role === "ai") return personaName;
  return "Performance Cycle Team";
}

interface RenderedTranscript {
  bodyHtml: string;
  plainText: string;
  messageCount: number;
}

async function renderTranscript(
  sessionId: string,
  personaName: string
): Promise<RenderedTranscript> {
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.sentAt));

  // Use the redacted `content` field directly — `redactPII` already stripped
  // any cards / SSNs / emails / phones from customer messages at write time.
  const messageBlocks = rows.map((m) => {
    const who = roleBadge(m.role, personaName);
    const ts = new Date(m.sentAt).toLocaleString("en-US", {
      timeZone: "America/Denver",
    });
    const bodyHtml = escapeHtml(m.content).replace(/\n/g, "<br/>");
    return `
      <div style="margin:0 0 16px 0">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px">
          <strong style="color:#111827">${escapeHtml(who)}</strong> &middot; ${escapeHtml(ts)}
        </div>
        <div style="font-size:14px;color:#111827;line-height:1.5">${bodyHtml}</div>
      </div>
    `;
  });

  const plainText = rows
    .map((m) => {
      const who = roleBadge(m.role, personaName);
      const ts = new Date(m.sentAt).toLocaleString("en-US", {
        timeZone: "America/Denver",
      });
      return `${who} (${ts})\n${m.content}\n`;
    })
    .join("\n");

  return {
    bodyHtml: messageBlocks.join("\n"),
    plainText,
    messageCount: rows.length,
  };
}

function wrapHtml(personaName: string, intro: string, body: string): string {
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <h1 style="margin:0 0 8px 0;font-size:18px;color:#111827">Performance Cycle</h1>
    <p style="margin:0 0 24px 0;font-size:13px;color:#6b7280">A note from ${escapeHtml(personaName)}</p>
    <p style="font-size:14px;color:#111827;line-height:1.6">${intro}</p>
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"/>
    ${body}
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"/>
    ${STORE_FOOTER_HTML}
  </div>
</body></html>`;
}

/**
 * Sends the full chat transcript to a customer-supplied email. Used by
 * POST /api/sessions/[id]/transcript-email.
 */
export async function sendTranscriptEmail(args: {
  to: string;
  sessionId: string;
}): Promise<EmailResult> {
  const resend = getResend();
  if (!resend) {
    log.warn("email.disabled_no_api_key", { feature: "transcript" });
    return {
      ok: false,
      status: 503,
      error:
        "Email is not configured on this site. Please contact the team at 303-744-2011.",
    };
  }

  const personaName = await loadPersonaName();
  const transcript = await renderTranscript(args.sessionId, personaName);

  if (transcript.messageCount === 0) {
    return {
      ok: false,
      status: 400,
      error: "There's no transcript to send for this session yet.",
    };
  }

  const html = wrapHtml(
    personaName,
    `Here's a copy of our conversation, as requested. If you have follow-up questions, just hit reply or give the team a call.`,
    transcript.bodyHtml
  );

  const from = process.env.RESEND_FROM_EMAIL || FROM_DEFAULT;
  try {
    const { error: sendError } = await resend.emails.send({
      from,
      to: args.to,
      subject: "Your Performance Cycle chat transcript",
      html,
      text: transcript.plainText,
    });
    if (sendError) {
      log.error("email.transcript_send_rejected", {
        sessionId: args.sessionId,
        resendError: sendError,
      });
      return {
        ok: false,
        status: 502,
        error: "Email delivery failed — see server logs.",
      };
    }
    return { ok: true, status: 200 };
  } catch (error) {
    log.error("email.transcript_send_failed", {
      sessionId: args.sessionId,
      error: serializeError(error),
    });
    return {
      ok: false,
      status: 502,
      error: "Email delivery failed — see server logs.",
    };
  }
}

/**
 * Notifies SUPPORT_INBOX that a customer has requested a callback while no
 * agents were online. Used by POST /api/sessions/[id]/notify-support.
 */
export async function sendSupportNotification(args: {
  sessionId: string;
  customerEmail: string;
  customerName?: string | null;
}): Promise<EmailResult> {
  const resend = getResend();
  const supportInbox = process.env.SUPPORT_INBOX;
  if (!resend || !supportInbox) {
    log.warn("email.disabled_no_api_key_or_inbox", {
      feature: "support_notification",
      hasResend: !!resend,
      hasInbox: !!supportInbox,
    });
    return {
      ok: false,
      status: 503,
      error: "Email is not configured on this site.",
    };
  }

  const personaName = await loadPersonaName();
  const transcript = await renderTranscript(args.sessionId, personaName);

  // Pull session metadata for context in the support email.
  const [sessionRow] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, args.sessionId))
    .limit(1);

  const intro = `
    A customer asked to speak with a teammate while no one was online. Their contact info is below — please follow up.<br/><br/>
    <strong>Email:</strong> ${escapeHtml(args.customerEmail)}<br/>
    ${args.customerName ? `<strong>Name:</strong> ${escapeHtml(args.customerName)}<br/>` : ""}
    <strong>Session:</strong> <code>${escapeHtml(args.sessionId)}</code><br/>
    <strong>Started:</strong> ${escapeHtml(
      sessionRow?.startedAt
        ? new Date(sessionRow.startedAt).toLocaleString("en-US", {
            timeZone: "America/Denver",
          })
        : "unknown"
    )}
  `;

  const html = wrapHtml(personaName, intro, transcript.bodyHtml);
  const from = process.env.RESEND_FROM_EMAIL || FROM_DEFAULT;

  try {
    const { error: sendError } = await resend.emails.send({
      from,
      to: supportInbox,
      replyTo: args.customerEmail,
      subject: `[Chat] Callback requested — ${args.customerEmail}`,
      html,
      text: `Callback requested by ${args.customerEmail}\nSession: ${args.sessionId}\n\n${transcript.plainText}`,
    });
    if (sendError) {
      log.error("email.support_notification_rejected", {
        sessionId: args.sessionId,
        resendError: sendError,
      });
      return {
        ok: false,
        status: 502,
        error: "We couldn't notify the team. Please call us at 303-744-2011.",
      };
    }
    return { ok: true, status: 200 };
  } catch (error) {
    log.error("email.support_notification_failed", {
      sessionId: args.sessionId,
      error: serializeError(error),
    });
    return {
      ok: false,
      status: 502,
      error: "We couldn't notify the team. Please call us at 303-744-2011.",
    };
  }
}
