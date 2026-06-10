"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { UserPlus, Trash2 } from "lucide-react";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  isOnline?: boolean;
  lastHeartbeatAt?: string | null;
}

interface TeamTableProps {
  onInvite: () => void;
}

export default function TeamTable({ onInvite }: TeamTableProps) {
  const { addToast } = useToast();
  const { data: sessionData } = useSession();
  const sessionUserId = sessionData?.user?.id;
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    try {
      const [usersRes, presenceRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/team-presence"),
      ]);
      if (!usersRes.ok) throw new Error(`HTTP ${usersRes.status}`);
      const usersData = await usersRes.json();
      const presenceData = presenceRes.ok ? await presenceRes.json() : { agents: [] };

      const presenceMap = new Map<string, { isOnline: boolean; lastHeartbeatAt: string | null }>(
        (presenceData.agents ?? []).map((a: User & { isOnline: boolean }) => [
          a.id,
          { isOnline: a.isOnline, lastHeartbeatAt: a.lastHeartbeatAt ?? null },
        ])
      );

      const merged: User[] = (usersData.users ?? []).map((u: User) => ({
        ...u,
        isOnline: presenceMap.get(u.id)?.isOnline ?? false,
        lastHeartbeatAt: presenceMap.get(u.id)?.lastHeartbeatAt ?? null,
      }));

      setUsers(merged);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    const id = setInterval(fetchUsers, 30_000);
    return () => clearInterval(id);
  }, [fetchUsers]);

  const toggleActive = async (userId: string, currentActive: boolean) => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, isActive: !currentActive }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchUsers();
    } catch (error) {
      console.error("Failed to toggle user:", error);
      addToast(
        `Failed to ${currentActive ? "deactivate" : "activate"} user. Please try again.`,
        "error"
      );
    }
  };

  const deleteUser = async (userId: string, userName: string) => {
    if (!window.confirm(`Permanently delete ${userName}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        addToast(data.error ?? "Failed to delete user.", "error");
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      addToast(`${userName} has been removed.`, "success");
    } catch {
      addToast("Failed to delete user. Please try again.", "error");
    }
  };

  return (
    <Card padding={false}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h3 className="font-semibold text-text-primary">Team Members</h3>
        <Button size="sm" onClick={onInvite}>
          <UserPlus size={14} className="mr-1.5" />
          Invite Agent
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Name
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Email
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Role
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Status
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Presence
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Joined
              </th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-text-secondary">
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center">
                  <p className="text-sm font-medium text-text-primary mb-1">
                    No team members yet
                  </p>
                  <p className="text-xs text-text-secondary">
                    Invite your first agent to start handling chats together.
                  </p>
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border hover:bg-background/50 transition-colors"
                >
                  <td className="px-6 py-3 font-medium">{user.name}</td>
                  <td className="px-6 py-3 text-text-secondary">
                    {user.email}
                  </td>
                  <td className="px-6 py-3">
                    <Badge
                      variant={
                        user.role === "store_manager" ? "warning" : "info"
                      }
                    >
                      {user.role === "store_manager" ? "Manager" : "Agent"}
                    </Badge>
                  </td>
                  <td className="px-6 py-3">
                    <Badge
                      variant={user.isActive ? "success" : "default"}
                      dot
                    >
                      {user.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-6 py-3">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          user.isOnline ? "bg-emerald-500" : "bg-gray-300"
                        }`}
                      />
                      <span className="text-xs text-text-secondary">
                        {user.isOnline ? "Online" : "Offline"}
                      </span>
                    </span>
                  </td>
                  <td className="px-6 py-3 text-text-secondary">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant={user.isActive ? "ghost" : "secondary"}
                        size="sm"
                        onClick={() => toggleActive(user.id, user.isActive)}
                      >
                        {user.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      {user.id !== sessionUserId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => deleteUser(user.id, user.name)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
