"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { UserPlus } from "lucide-react";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface TeamTableProps {
  onInvite: () => void;
}

export default function TeamTable({ onInvite }: TeamTableProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const toggleActive = async (userId: string, currentActive: boolean) => {
    try {
      await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, isActive: !currentActive }),
      });
      fetchUsers();
    } catch (error) {
      console.error("Failed to toggle user:", error);
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
                Joined
              </th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-text-secondary">
                  Loading...
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
                  <td className="px-6 py-3 text-text-secondary">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Button
                      variant={user.isActive ? "ghost" : "secondary"}
                      size="sm"
                      onClick={() => toggleActive(user.id, user.isActive)}
                    >
                      {user.isActive ? "Deactivate" : "Activate"}
                    </Button>
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
