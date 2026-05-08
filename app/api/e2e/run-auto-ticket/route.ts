/**
 * Test-only endpoint for Playwright e2e specs. Calls runAutoTicket()
 * synchronously and returns the result so tests don't need to rely on
 * fire-and-forget timing or the TICKET_AUTO_CREATE_TEST_MODE env var.
 *
 * Only available when E2E_EMAIL_MOCK=1.
 *
 * Body: { sessionId: string }
 * Response: { ticket: Ticket | null }
 */
import { NextResponse } from "next/server";
import { runAutoTicket } from "@/lib/tickets/autoCreate";

export async function POST(req: Request) {
  if (process.env.E2E_EMAIL_MOCK !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json()) as { sessionId?: string };
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  // Force test mode for this call regardless of the server's env var state.
  const orig = process.env.TICKET_AUTO_CREATE_TEST_MODE;
  process.env.TICKET_AUTO_CREATE_TEST_MODE = "1";
  try {
    const ticket = await runAutoTicket(body.sessionId);
    return NextResponse.json({ ticket });
  } finally {
    if (orig === undefined) {
      delete process.env.TICKET_AUTO_CREATE_TEST_MODE;
    } else {
      process.env.TICKET_AUTO_CREATE_TEST_MODE = orig;
    }
  }
}
