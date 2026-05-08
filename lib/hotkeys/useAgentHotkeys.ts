/**
 * Phase 4 agent hotkeys hook. Bound at the chats-page level since it needs
 * access to the queue + active session + handlers. Manager-toggleable via
 * `botSettings.hotkeysEnabled`.
 *
 * Bindings:
 *   J/K — navigate queue (down/up)
 *   C   — claim selected
 *   R   — release current
 *   X   — close current
 *   /   — focus reply textarea
 *   Cmd/Ctrl+Enter — send current
 *
 * The first four are suppressed when an input/textarea/contenteditable is
 * focused. `/` and Cmd/Ctrl+Enter still fire so the agent can quickly jump
 * back to the reply box and send.
 */
"use client";

import { useEffect } from "react";

interface UseAgentHotkeysOptions {
  enabled: boolean;
  queueIds: string[];
  selectedQueueId: string | null;
  activeSessionId: string | null;
  setSelectedQueueId: (id: string | null) => void;
  onClaim: (sessionId: string) => void;
  onRelease: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onFocusReply: () => void;
  onSend: () => void;
}

function isTextEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useAgentHotkeys({
  enabled,
  queueIds,
  selectedQueueId,
  activeSessionId,
  setSelectedQueueId,
  onClaim,
  onRelease,
  onClose,
  onFocusReply,
  onSend,
}: UseAgentHotkeysOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const editable = isTextEditable(e.target);

      // Always-on bindings, even while typing.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSend();
        return;
      }
      if (e.key === "/" && !editable) {
        e.preventDefault();
        onFocusReply();
        return;
      }

      if (editable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case "j": {
          e.preventDefault();
          if (queueIds.length === 0) return;
          const idx =
            selectedQueueId !== null ? queueIds.indexOf(selectedQueueId) : -1;
          const next = Math.min(queueIds.length - 1, idx + 1);
          setSelectedQueueId(queueIds[next] ?? null);
          break;
        }
        case "k": {
          e.preventDefault();
          if (queueIds.length === 0) return;
          const idx =
            selectedQueueId !== null ? queueIds.indexOf(selectedQueueId) : 0;
          const prev = Math.max(0, idx - 1);
          setSelectedQueueId(queueIds[prev] ?? null);
          break;
        }
        case "c": {
          if (!selectedQueueId) return;
          e.preventDefault();
          onClaim(selectedQueueId);
          break;
        }
        case "r": {
          if (!activeSessionId) return;
          e.preventDefault();
          onRelease(activeSessionId);
          break;
        }
        case "x": {
          if (!activeSessionId) return;
          e.preventDefault();
          onClose(activeSessionId);
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    enabled,
    queueIds,
    selectedQueueId,
    activeSessionId,
    setSelectedQueueId,
    onClaim,
    onRelease,
    onClose,
    onFocusReply,
    onSend,
  ]);
}
