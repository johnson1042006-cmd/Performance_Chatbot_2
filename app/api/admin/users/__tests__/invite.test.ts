/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Invite-agent onboarding tests for POST /api/admin/users:
 *  - new users are created with mustResetPassword: true (forced first-login reset)
 *  - the temp password is held to the same policy as /api/auth/reset-password
 *  - duplicate emails return a clear 409 instead of a generic 500
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const valuesSpy = vi.fn();
const insertTerminal = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        valuesSpy(v);
        return { returning: () => insertTerminal() };
      },
    }),
    select: () => ({ from: () => Promise.resolve([]) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: {
    id: "id",
    email: "email",
    name: "name",
    role: "role",
    isActive: "is_active",
    createdAt: "created_at",
  },
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-pw") },
}));
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error ? { message: err.message } : { message: String(err) },
}));

function makeReq(body: object) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NextRequest } = require("next/server");
  return new NextRequest("http://localhost/api/admin/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function asManager() {
  const { getServerSession } = await import("next-auth");
  (getServerSession as any).mockResolvedValue({
    user: { id: "mgr-1", role: "store_manager", name: "Manager", email: "m@pc.com" },
  });
}

const VALID_BODY = {
  email: "newagent@pc.com",
  name: "New Agent",
  password: "temporary-pass-1",
  role: "support_agent",
};

describe("POST /api/admin/users (invite onboarding)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    insertTerminal.mockResolvedValue([
      {
        id: "u-new",
        email: VALID_BODY.email,
        name: VALID_BODY.name,
        role: "support_agent",
        isActive: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    await asManager();
  });

  it("creates the user with mustResetPassword: true", async () => {
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(201);
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ mustResetPassword: true })
    );
  });

  it("rejects a temp password shorter than 12 chars", async () => {
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq({ ...VALID_BODY, password: "short1" }));
    expect(res.status).toBe(400);
    expect(valuesSpy).not.toHaveBeenCalled();
  });

  it("rejects a temp password without a number", async () => {
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq({ ...VALID_BODY, password: "allletterspassword" }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown role", async () => {
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq({ ...VALID_BODY, role: "superadmin" }));
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate email (unique violation)", async () => {
    insertTerminal.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key"), { code: "23505" })
    );
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/already exists/i);
  });
});
