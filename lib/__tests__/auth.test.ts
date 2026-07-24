/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks: Supabase server client (identity) + db (public.users profile)
// ---------------------------------------------------------------------------
const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}));

const limitSpy = vi.fn();
let mockProfileRows: any[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => {
            limitSpy(...args);
            return Promise.resolve(mockProfileRows);
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: {
    id: "id",
    role: "role",
    name: "name",
    isActive: "is_active",
    mustResetPassword: "must_reset_password",
  },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

async function loadModule() {
  vi.resetModules();
  return import("@/lib/auth");
}

describe("getStaffSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileRows = [];
  });

  it("returns null when there is no Supabase user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { getStaffSession } = await loadModule();
    expect(await getStaffSession()).toBeNull();
  });

  it("returns null when the user has no profile row", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "a@x.com" } } });
    mockProfileRows = [];
    const { getStaffSession } = await loadModule();
    expect(await getStaffSession()).toBeNull();
  });

  it("returns null when the profile is deactivated", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u2", email: "b@x.com" } } });
    mockProfileRows = [
      { role: "support_agent", name: "Agent", isActive: false, mustReset: false },
    ];
    const { getStaffSession } = await loadModule();
    expect(await getStaffSession()).toBeNull();
  });

  it("returns the staff session for an active user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u3", email: "mgr@x.com" } } });
    mockProfileRows = [
      { role: "store_manager", name: "Manager", isActive: true, mustReset: false },
    ];
    const { getStaffSession } = await loadModule();
    expect(await getStaffSession()).toEqual({
      user: {
        id: "u3",
        email: "mgr@x.com",
        name: "Manager",
        role: "store_manager",
        mustResetPassword: false,
      },
    });
  });

  it("surfaces mustResetPassword from the profile", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u4", email: "c@x.com" } } });
    mockProfileRows = [
      { role: "support_agent", name: "Agent", isActive: true, mustReset: true },
    ];
    const { getStaffSession } = await loadModule();
    const session = await getStaffSession();
    expect(session?.user.mustResetPassword).toBe(true);
  });

  it("caches the profile for 60s and bustUserFlagCache clears it", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u5", email: "d@x.com" } } });
    mockProfileRows = [
      { role: "support_agent", name: "Agent", isActive: true, mustReset: false },
    ];
    const { getStaffSession, bustUserFlagCache } = await loadModule();

    await getStaffSession();
    await getStaffSession();
    // Second call served from cache — the DB terminal ran only once.
    expect(limitSpy).toHaveBeenCalledTimes(1);

    bustUserFlagCache("u5");
    await getStaffSession();
    expect(limitSpy).toHaveBeenCalledTimes(2);
  });
});
