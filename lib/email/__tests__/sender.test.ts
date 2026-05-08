/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const harness = vi.hoisted(() => ({
  resendSendSpy: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) },
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: harness.resendSendSpy };
  },
}));

import { sendEmail } from "@/lib/email/sender";

describe("sendEmail", () => {
  beforeEach(() => {
    harness.resendSendSpy.mockReset();
    delete process.env.E2E_EMAIL_MOCK;
    delete process.env.RESEND_API_KEY;
  });

  it("returns 503 when RESEND_API_KEY is unset and never throws", async () => {
    const result = await sendEmail({
      to: "x@y.z",
      subject: "Hi",
      html: "<p>Hello</p>",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(harness.resendSendSpy).not.toHaveBeenCalled();
  });

  it("invokes resend.emails.send when configured", async () => {
    process.env.RESEND_API_KEY = "test-key";
    harness.resendSendSpy.mockResolvedValue({
      data: { id: "abc" },
      error: null,
    });
    const result = await sendEmail({
      to: "x@y.z",
      subject: "Hi",
      html: "<p>Hello</p>",
      text: "Hello",
      replyTo: "support@y.z",
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(harness.resendSendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "x@y.z",
        subject: "Hi",
        html: "<p>Hello</p>",
        text: "Hello",
        replyTo: "support@y.z",
      })
    );
  });

  it("returns 502 when Resend reports an error", async () => {
    process.env.RESEND_API_KEY = "test-key";
    harness.resendSendSpy.mockResolvedValue({
      data: null,
      error: { name: "RateLimitError", message: "too many" },
    });
    const result = await sendEmail({
      to: "x@y.z",
      subject: "Hi",
      html: "<p>Hello</p>",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });

  it("calls __emailMock when E2E_EMAIL_MOCK=1 and never hits resend", async () => {
    process.env.E2E_EMAIL_MOCK = "1";
    process.env.RESEND_API_KEY = "test-key";
    const mock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    (globalThis as any).__emailMock = mock;
    const result = await sendEmail({
      to: "x@y.z",
      subject: "Hi",
      html: "<p>Hello</p>",
    });
    expect(result.ok).toBe(true);
    expect(mock).toHaveBeenCalled();
    expect(harness.resendSendSpy).not.toHaveBeenCalled();
    delete (globalThis as any).__emailMock;
  });
});
