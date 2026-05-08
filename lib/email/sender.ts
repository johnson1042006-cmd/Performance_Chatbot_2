/**
 * Generic email sender. Used by the Phase 5.5 ticket templates and any
 * future transactional emails. The existing transcript-specific helpers
 * in [lib/email/transcript.ts](lib/email/transcript.ts) keep their direct
 * usage of Resend so this layer can stay schema-free.
 *
 * Failure mode: when `RESEND_API_KEY` is unset, returns
 * `{ ok: false, status: 503 }` and logs once. Never throws — callers
 * (including auto-ticket creation) can `void sendEmail(...)` without
 * worrying about a Resend outage breaking the request.
 *
 * Test hook: when `E2E_EMAIL_MOCK=1`, the global function
 * `globalThis.__emailMock` (if set) is invoked instead of Resend so the
 * Playwright suite can assert "send was called with these args" without
 * touching the network.
 */
import { Resend } from "resend";
import { log, serializeError } from "@/lib/log";

export interface EmailResult {
  ok: boolean;
  status: number;
  error?: string;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
}

const FROM_DEFAULT = "Performance Cycle Chat <onboarding@resend.dev>";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

interface EmailMockGlobal {
  __emailMock?: (args: SendEmailArgs) => Promise<EmailResult> | EmailResult;
}

export async function sendEmail(args: SendEmailArgs): Promise<EmailResult> {
  if (process.env.E2E_EMAIL_MOCK === "1") {
    const mock = (globalThis as EmailMockGlobal).__emailMock;
    if (mock) {
      try {
        return await mock(args);
      } catch (error) {
        log.warn("email.mock_threw", { error: serializeError(error) });
      }
    }
    // Default mock behavior: succeed silently with status 200 so e2e
    // assertions can rely on "no email was sent unless mocked".
    return { ok: true, status: 200 };
  }

  const resend = getResend();
  if (!resend) {
    log.warn("email.disabled_no_api_key", { feature: "generic_sender" });
    return {
      ok: false,
      status: 503,
      error: "Email is not configured on this site.",
    };
  }

  const from = args.from || process.env.RESEND_FROM_EMAIL || FROM_DEFAULT;
  try {
    const { error: sendError } = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
    });
    if (sendError) {
      log.error("email.send_rejected", { resendError: sendError });
      return {
        ok: false,
        status: 502,
        error: "Email delivery failed — see server logs.",
      };
    }
    return { ok: true, status: 200 };
  } catch (error) {
    log.error("email.send_failed", { error: serializeError(error) });
    return {
      ok: false,
      status: 502,
      error: "Email delivery failed — see server logs.",
    };
  }
}

export const STORE_FOOTER_HTML = `
  <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6">
    Performance Cycle of Colorado<br/>
    7375 S. Fulton St., Centennial, CO 80112<br/>
    303-744-2011 &middot; <a href="https://performancecycle.com" style="color:#6b7280">performancecycle.com</a>
  </p>
`;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
