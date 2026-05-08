import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email))
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
