import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { enforce } from "@/lib/rateLimit";
import bcrypt from "bcryptjs";

declare module "next-auth" {
  interface User {
    id: string;
    role: "store_manager" | "support_agent";
    name: string;
    email: string;
  }
  interface Session {
    user: {
      id: string;
      role: "store_manager" | "support_agent";
      name: string;
      email: string;
      mustResetPassword?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "store_manager" | "support_agent";
    mustResetPassword?: boolean;
  }
}

// In-memory cache so the JWT callback isn't a DB hit on every request. 60s
// is short enough that an admin clearing a user's reset flag is reflected
// quickly, but long enough that hot pages don't hammer the users table.
// Bust explicitly via `bustUserFlagCache(userId)` after a successful reset.
type CacheEntry = { mustReset: boolean; expiresAt: number };
const userFlagCache = new Map<string, CacheEntry>();

async function loadMustReset(userId: string): Promise<boolean> {
  const hit = userFlagCache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.mustReset;

  try {
    const [row] = await db
      .select({ m: users.mustResetPassword })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const mustReset = !!row?.m;
    userFlagCache.set(userId, {
      mustReset,
      expiresAt: Date.now() + 60_000,
    });
    return mustReset;
  } catch {
    return false;
  }
}

export function bustUserFlagCache(userId: string): void {
  userFlagCache.delete(userId);
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        // Rate limit by IP before doing any DB or bcrypt work.
        // 10 attempts / 60 seconds / IP. Returns null on limit, which NextAuth
        // surfaces to the user as a generic "Invalid credentials" — we don't
        // telegraph that they've been rate limited.
        const ip =
          (req?.headers?.["x-forwarded-for"] as string | undefined)
            ?.split(",")[0]
            ?.trim() || "unknown";
        const rl = await enforce(`login:${ip}`, 10, 60);
        if (!rl.ok) return null;

        if (!credentials?.email || !credentials?.password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(sql`lower(${users.email}) = ${credentials.email.toLowerCase()}`)
          .limit(1);

        if (!user || !user.isActive) return null;

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      if (token.id) {
        token.mustResetPassword = await loadMustReset(token.id);
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.mustResetPassword = !!token.mustResetPassword;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
