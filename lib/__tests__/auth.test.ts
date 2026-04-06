/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock bcrypt and database
// ---------------------------------------------------------------------------
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
  },
}));

const mockDbResult: any[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockDbResult),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { email: "email" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

// ---------------------------------------------------------------------------
// authOptions tests
// ---------------------------------------------------------------------------
describe("authOptions", () => {
  let authOptions: any;
  let bcrypt: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbResult.length = 0;

    const authModule = await import("@/lib/auth");
    authOptions = authModule.authOptions;

    bcrypt = (await import("bcryptjs")).default;
  });

  it("uses JWT strategy", () => {
    expect(authOptions.session.strategy).toBe("jwt");
  });

  it("uses /login as sign-in page", () => {
    expect(authOptions.pages.signIn).toBe("/login");
  });

  it("has a credentials provider", () => {
    expect(authOptions.providers).toHaveLength(1);
    expect(authOptions.providers[0].name).toBe("Credentials");
  });

  describe("authorize", () => {
    function getAuthorize() {
      return authOptions.providers[0].options.authorize;
    }

    it("returns null when credentials are missing", async () => {
      const authorize = getAuthorize();
      expect(await authorize(null)).toBeNull();
      expect(await authorize({})).toBeNull();
      expect(await authorize({ email: "a@test.com" })).toBeNull();
      expect(await authorize({ password: "pass" })).toBeNull();
    });

    it("returns null when user is not found", async () => {
      mockDbResult.length = 0; // empty result

      const authorize = getAuthorize();
      const result = await authorize({
        email: "missing@test.com",
        password: "pass123",
      });
      expect(result).toBeNull();
    });

    it("returns null when user is inactive", async () => {
      mockDbResult.push({
        id: "u1",
        email: "inactive@test.com",
        name: "Inactive",
        passwordHash: "hashed",
        role: "support_agent",
        isActive: false,
      });

      const authorize = getAuthorize();
      const result = await authorize({
        email: "inactive@test.com",
        password: "pass123",
      });
      expect(result).toBeNull();
      // bcrypt.compare should NOT be called for inactive users
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it("returns null when password is wrong", async () => {
      mockDbResult.push({
        id: "u2",
        email: "agent@test.com",
        name: "Agent",
        passwordHash: "hashed",
        role: "support_agent",
        isActive: true,
      });

      bcrypt.compare.mockResolvedValueOnce(false);

      const authorize = getAuthorize();
      const result = await authorize({
        email: "agent@test.com",
        password: "wrongpass",
      });
      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledWith("wrongpass", "hashed");
    });

    it("returns user object for valid credentials", async () => {
      mockDbResult.push({
        id: "u3",
        email: "manager@test.com",
        name: "Manager",
        passwordHash: "hashed",
        role: "store_manager",
        isActive: true,
      });

      bcrypt.compare.mockResolvedValueOnce(true);

      const authorize = getAuthorize();
      const result = await authorize({
        email: "manager@test.com",
        password: "correct",
      });

      expect(result).toEqual({
        id: "u3",
        email: "manager@test.com",
        name: "Manager",
        role: "store_manager",
      });
    });
  });

  describe("callbacks", () => {
    it("jwt callback stores user id and role in token", async () => {
      const { jwt } = authOptions.callbacks;
      const token = await jwt({
        token: {},
        user: { id: "u1", role: "store_manager" },
      });
      expect(token.id).toBe("u1");
      expect(token.role).toBe("store_manager");
    });

    it("jwt callback preserves token when no user", async () => {
      const { jwt } = authOptions.callbacks;
      const token = await jwt({
        token: { id: "existing", role: "support_agent" },
        user: undefined,
      });
      expect(token.id).toBe("existing");
      expect(token.role).toBe("support_agent");
    });

    it("session callback copies token to session.user", async () => {
      const { session: sessionCb } = authOptions.callbacks;
      const session = { user: { id: "", role: "" } };
      const result = await sessionCb({
        session,
        token: { id: "u1", role: "store_manager" },
      });
      expect(result.user.id).toBe("u1");
      expect(result.user.role).toBe("store_manager");
    });
  });
});
