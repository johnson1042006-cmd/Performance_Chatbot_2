"use client";

import { useEffect, useState, useCallback } from "react";
import {
  X,
  Save,
  Loader2,
  CheckCircle2,
  Lock,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import TicketSlaPill from "./TicketSlaPill";
import TranscriptList from "@/components/dashboard/TranscriptList";
import { useSession } from "next-auth/react";

export interface TicketDetail {
  id: string;
  ticketNumber: number;
  sessionId: string | null;
  subject: string;
  description: string | null;
  status: "open" | "pending" | "resolved" | "closed";
  priority: "urgent" | "high" | "normal" | "low";
  category: string | null;
  source: string;
  customerEmail: string | null;
  customerName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  dueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  slaBreached: boolean;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

interface Comment {
  id: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

interface AgentOption {
  id: string;
  name: string;
}

interface TicketDetailModalProps {
  ticketId: string;
  onClose: () => void;
  onUpdated?: (t: TicketDetail) => void;
}

const STATUSES: TicketDetail["status"][] = [
  "open",
  "pending",
  "resolved",
  "closed",
];
const PRIORITIES: TicketDetail["priority"][] = [
  "urgent",
  "high",
  "normal",
  "low",
];

const STATUS_VARIANT: Record<
  TicketDetail["status"],
  "info" | "warning" | "success" | "default"
> = {
  open: "info",
  pending: "warning",
  resolved: "success",
  closed: "default",
};

const PRIORITY_VARIANT: Record<
  TicketDetail["priority"],
  "danger" | "warning" | "info" | "default"
> = {
  urgent: "danger",
  high: "warning",
  normal: "info",
  low: "default",
};

export default function TicketDetailModal({
  ticketId,
  onClose,
  onUpdated,
}: TicketDetailModalProps) {
  const { data: session } = useSession();
  const isManager = session?.user?.role === "store_manager";

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [editingSubject, setEditingSubject] = useState(false);
  const [draftSubject, setDraftSubject] = useState("");

  const [commentDraft, setCommentDraft] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [tagDraft, setTagDraft] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTicket(data.ticket);
      setComments(data.comments ?? []);
      setTags(data.tags ?? []);
      setDraftSubject(data.ticket?.subject ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isManager) return;
    fetch("/api/admin/users", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data: { users?: { id: string; name: string; role: string }[] }) =>
        setAgents(
          (data.users ?? [])
            .filter(
              (u) =>
                u.role === "support_agent" || u.role === "store_manager"
            )
            .map((u) => ({ id: u.id, name: u.name }))
        )
      )
      .catch(() => setAgents([]));
  }, [isManager]);

  const patch = async (
    field: string,
    body: Record<string, unknown>
  ): Promise<boolean> => {
    setSavingField(field);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ticket) {
        setTicket(data.ticket);
        onUpdated?.(data.ticket);
      } else {
        await refresh();
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      return false;
    } finally {
      setSavingField(null);
    }
  };

  const handleAddComment = async () => {
    if (!commentDraft.trim()) return;
    setPostingComment(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: commentDraft.trim(),
          isInternal: commentInternal,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCommentDraft("");
      setCommentInternal(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await fetch(`/api/tickets/${ticketId}/comments/${commentId}`, {
        method: "DELETE",
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete comment");
    }
  };

  const handleAddTag = async () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t) return;
    const next = Array.from(new Set([...tags, t]));
    const ok = await patch("tags", { tags: next });
    if (ok) {
      setTags(next);
      setTagDraft("");
    }
  };

  const handleRemoveTag = async (t: string) => {
    const next = tags.filter((x) => x !== t);
    const ok = await patch("tags", { tags: next });
    if (ok) setTags(next);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
      data-testid="ticket-detail-modal"
    >
      <div
        className="bg-surface rounded-card shadow-card-md max-w-4xl w-full my-8 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {ticket ? (
              <>
                <span className="text-xs font-semibold text-text-secondary">
                  Ticket #{ticket.ticketNumber}
                </span>
                <Badge variant={STATUS_VARIANT[ticket.status]}>
                  {ticket.status}
                </Badge>
                <Badge variant={PRIORITY_VARIANT[ticket.priority]}>
                  {ticket.priority}
                </Badge>
                <TicketSlaPill
                  dueAt={ticket.dueAt}
                  breached={ticket.slaBreached}
                  freeze={
                    ticket.status === "resolved" || ticket.status === "closed"
                  }
                  compact
                />
              </>
            ) : (
              <span className="text-xs text-text-secondary">Loading…</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200">
            {error}
          </div>
        )}

        {loading || !ticket ? (
          <div className="px-5 py-8 text-center text-sm text-text-secondary">
            <Loader2 size={16} className="inline animate-spin mr-2" />
            Loading ticket…
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-0">
            <div className="md:col-span-2 px-5 py-4 space-y-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  {editingSubject && isManager ? (
                    <div className="flex-1 flex gap-2">
                      <input
                        autoFocus
                        value={draftSubject}
                        onChange={(e) => setDraftSubject(e.target.value)}
                        className="flex-1 text-base border border-border rounded px-2 py-1"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={async () => {
                          const ok = await patch("subject", {
                            subject: draftSubject,
                          });
                          if (ok) setEditingSubject(false);
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setDraftSubject(ticket.subject);
                          setEditingSubject(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <h2
                      className={`text-base font-semibold text-text-primary flex-1 ${
                        isManager ? "cursor-pointer hover:underline" : ""
                      }`}
                      onClick={() => isManager && setEditingSubject(true)}
                      data-testid="ticket-subject"
                    >
                      {ticket.subject}
                    </h2>
                  )}
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  Customer:{" "}
                  {ticket.customerName ||
                    ticket.customerEmail ||
                    "(unknown)"}
                  {ticket.customerEmail && ticket.customerName && (
                    <> · {ticket.customerEmail}</>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">
                  Tags:
                </span>
                {tags.length === 0 && (
                  <span className="text-xs text-text-secondary">none</span>
                )}
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-xs bg-background border border-border rounded-full px-2 py-0.5"
                  >
                    <TagIcon size={10} />
                    {t}
                    <button
                      onClick={() => handleRemoveTag(t)}
                      aria-label="Remove tag"
                      className="text-text-secondary hover:text-red-600"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddTag();
                    }
                  }}
                  placeholder="Add tag"
                  className="text-xs border border-border rounded px-2 py-0.5 w-28"
                />
              </div>

              {ticket.sessionId && (
                <div>
                  <h3 className="text-xs font-semibold text-text-secondary mb-2">
                    Linked session
                  </h3>
                  <div className="border border-border rounded-card p-3 bg-background max-h-72 overflow-y-auto">
                    <TranscriptList sessionId={ticket.sessionId} />
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-text-secondary mb-2">
                  Comments
                </h3>
                {comments.length === 0 ? (
                  <p className="text-xs text-text-secondary">
                    No comments yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {comments.map((c) => (
                      <li
                        key={c.id}
                        className={`text-xs p-2 rounded-card border ${
                          c.isInternal
                            ? "bg-amber-50 border-amber-200"
                            : "bg-background border-border"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-text-primary">
                            {c.authorName ?? "—"}
                          </span>
                          {c.isInternal && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-semibold text-amber-700">
                              <Lock size={9} /> Internal
                            </span>
                          )}
                          <span className="text-text-secondary">
                            {new Date(c.createdAt).toLocaleString()}
                          </span>
                          {(c.authorId === session?.user?.id ||
                            isManager) && (
                            <button
                              onClick={() => handleDeleteComment(c.id)}
                              className="ml-auto text-text-secondary hover:text-red-600"
                              aria-label="Delete comment"
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-text-primary">
                          {c.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 border-t border-border pt-3">
                  <textarea
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="Add a comment…"
                    className="w-full text-sm border border-border rounded p-2 min-h-[72px]"
                  />
                  <div className="flex items-center justify-between mt-2">
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={commentInternal}
                        onChange={(e) => setCommentInternal(e.target.checked)}
                      />
                      Internal note (staff only)
                    </label>
                    <Button
                      size="sm"
                      onClick={handleAddComment}
                      disabled={postingComment || !commentDraft.trim()}
                    >
                      {postingComment ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Save size={12} className="mr-1" />
                      )}
                      Post comment
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <aside className="px-5 py-4 border-l border-border bg-background space-y-3 text-xs">
              <Field label="Status">
                <select
                  value={ticket.status}
                  onChange={(e) =>
                    void patch("status", { status: e.target.value })
                  }
                  className="w-full text-xs border border-border rounded px-2 py-1 bg-surface"
                  disabled={savingField === "status"}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Priority">
                <select
                  value={ticket.priority}
                  onChange={(e) =>
                    void patch("priority", { priority: e.target.value })
                  }
                  className="w-full text-xs border border-border rounded px-2 py-1 bg-surface"
                  disabled={savingField === "priority"}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Assignee">
                {isManager ? (
                  <select
                    value={ticket.assignedTo ?? ""}
                    onChange={(e) =>
                      void patch("assignedTo", {
                        assignedTo: e.target.value || null,
                      })
                    }
                    className="w-full text-xs border border-border rounded px-2 py-1 bg-surface"
                    disabled={savingField === "assignedTo"}
                  >
                    <option value="">Unassigned</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-text-primary">
                    {ticket.assignedToName ?? "Unassigned"}
                  </span>
                )}
              </Field>

              <Field label="Category">
                <input
                  defaultValue={ticket.category ?? ""}
                  onBlur={(e) =>
                    e.target.value !== (ticket.category ?? "") &&
                    void patch("category", { category: e.target.value || null })
                  }
                  className="w-full text-xs border border-border rounded px-2 py-1 bg-surface"
                />
              </Field>

              <Field label="Created">
                <span className="text-text-primary">
                  {new Date(ticket.createdAt).toLocaleString()}
                </span>
              </Field>
              {ticket.firstResponseAt && (
                <Field label="First response">
                  <span className="text-text-primary">
                    {new Date(ticket.firstResponseAt).toLocaleString()}
                  </span>
                </Field>
              )}
              {ticket.resolvedAt && (
                <Field label="Resolved">
                  <span className="text-text-primary">
                    {new Date(ticket.resolvedAt).toLocaleString()}
                  </span>
                </Field>
              )}

              <div className="border-t border-border pt-3 space-y-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  disabled={
                    ticket.status === "resolved" || ticket.status === "closed"
                  }
                  onClick={() =>
                    void patch("status", { status: "resolved" })
                  }
                >
                  <CheckCircle2 size={12} className="mr-1" />
                  Mark resolved
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  disabled={ticket.status === "closed"}
                  onClick={() =>
                    void patch("status", { status: "closed" })
                  }
                >
                  Close ticket
                </Button>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase font-semibold text-text-secondary mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
