"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

const MIN_LEN = 12;

function validate(newPassword: string, confirm: string): string | null {
  if (newPassword.length < MIN_LEN) return "Password must be at least 12 characters.";
  if (!/\d/.test(newPassword)) return "Password must include at least one number.";
  if (!/[A-Za-z]/.test(newPassword)) return "Password must include at least one letter.";
  if (newPassword !== confirm) return "New passwords do not match.";
  return null;
}

export default function PasswordResetPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const localError = validate(newPassword, confirm);
    if (localError) {
      setError(localError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Reset failed (${res.status}).`);
        setLoading(false);
        return;
      }

      // Sign the user out so the JWT is regenerated on next login with the
      // fresh `mustResetPassword=false` flag and the new password.
      await signOut({ callbackUrl: "/login" });
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md">
        <div className="bg-surface rounded-card shadow-card p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-semibold text-text-primary">
              Set a new password
            </h1>
            <p className="text-text-secondary mt-1 text-sm">
              You must change the seeded password before continuing.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-accent text-sm rounded-button px-4 py-3 border border-red-200">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="current-password"
                className="block text-sm font-medium text-text-primary mb-1.5"
              >
                Current password
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2.5 border border-border rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
              />
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="block text-sm font-medium text-text-primary mb-1.5"
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={MIN_LEN}
                autoComplete="new-password"
                className="w-full px-3 py-2.5 border border-border rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
              />
              <p className="text-xs text-text-secondary mt-1">
                At least 12 characters, with at least one letter and one number.
              </p>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-sm font-medium text-text-primary mb-1.5"
              >
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={MIN_LEN}
                autoComplete="new-password"
                className="w-full px-3 py-2.5 border border-border rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent-solid text-white font-medium py-2.5 px-4 rounded-button hover:brightness-[0.95] transition-[filter] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
