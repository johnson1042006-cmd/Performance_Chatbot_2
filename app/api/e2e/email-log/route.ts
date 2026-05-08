import { NextResponse } from "next/server";
import type { SendEmailArgs } from "@/lib/email/sender";

interface EmailLogGlobal {
  __sentEmails?: Array<SendEmailArgs & { at: string }>;
}

/**
 * Test-only endpoint for Playwright. Enabled only when E2E_EMAIL_MOCK=1.
 * Returns captured sendEmail() args from the server process.
 */
export async function GET() {
  if (process.env.E2E_EMAIL_MOCK !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const g = globalThis as EmailLogGlobal;
  return NextResponse.json({ emails: g.__sentEmails ?? [] });
}

export async function DELETE() {
  if (process.env.E2E_EMAIL_MOCK !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const g = globalThis as EmailLogGlobal;
  g.__sentEmails = [];
  return NextResponse.json({ ok: true });
}

