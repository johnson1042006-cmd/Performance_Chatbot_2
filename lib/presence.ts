/**
 * Agent presence helpers.
 * An agent is considered "online" if their last_heartbeat_at is within
 * the last ONLINE_THRESHOLD_SECONDS seconds and their account is active.
 */
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { and, eq, gt, isNotNull } from "drizzle-orm";

export const ONLINE_THRESHOLD_SECONDS = 60;

export async function recordAgentHeartbeat(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ lastHeartbeatAt: new Date() })
    .where(eq(users.id, userId));
}

export async function markAgentOffline(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ lastHeartbeatAt: null })
    .where(eq(users.id, userId));
}

export async function anyAgentsOnline(): Promise<boolean> {
  const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_SECONDS * 1000);
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        isNotNull(users.lastHeartbeatAt),
        gt(users.lastHeartbeatAt, cutoff)
      )
    )
    .limit(1);
  return !!row;
}

export interface OnlineAgent {
  id: string;
  name: string;
  email: string;
  role: string;
  lastHeartbeatAt: Date | null;
}

export async function getOnlineAgents(): Promise<OnlineAgent[]> {
  const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_SECONDS * 1000);
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      lastHeartbeatAt: users.lastHeartbeatAt,
    })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        isNotNull(users.lastHeartbeatAt),
        gt(users.lastHeartbeatAt, cutoff)
      )
    );
}

export interface AgentPresence extends OnlineAgent {
  isOnline: boolean;
}

export async function getAllAgentsWithPresence(): Promise<AgentPresence[]> {
  const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_SECONDS * 1000);
  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      lastHeartbeatAt: users.lastHeartbeatAt,
    })
    .from(users)
    .where(eq(users.isActive, true));

  return allUsers.map((u) => ({
    ...u,
    isOnline:
      u.lastHeartbeatAt != null &&
      new Date(u.lastHeartbeatAt) > cutoff,
  }));
}
