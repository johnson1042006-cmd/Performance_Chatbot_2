"use client";

import { createContext, useContext } from "react";

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: "store_manager" | "support_agent";
}

export interface StaffSessionValue {
  user: StaffUser;
}

const StaffSessionContext = createContext<StaffSessionValue | null>(null);

/**
 * Provides the staff identity (id/name/role) to dashboard client components.
 * Seeded server-side from getStaffSession() in app/dashboard/layout.tsx — no
 * client-side Supabase round-trip needed. Returns the same `{ user }` shape
 * NextAuth's useSession().data returned, so consumers are a one-line swap.
 */
export function StaffSessionProvider({
  value,
  children,
}: {
  value: StaffSessionValue | null;
  children: React.ReactNode;
}) {
  return (
    <StaffSessionContext.Provider value={value}>
      {children}
    </StaffSessionContext.Provider>
  );
}

export function useStaffUser(): StaffSessionValue | null {
  return useContext(StaffSessionContext);
}
