#!/usr/bin/env node
// PreToolUse hook: deny Claude edits to .env files — they hold live secrets
// (DATABASE_URL points at production Neon). .env.example stays editable.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let file = "";
  try {
    file = JSON.parse(raw)?.tool_input?.file_path || "";
  } catch {}
  const base = (file.replace(/\\/g, "/").split("/").pop() || "").toLowerCase();
  if (base.startsWith(".env") && base !== ".env.example") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            base +
            " contains live secrets and may not be edited by Claude. " +
            "Edit it manually, or update .env.example if the change is a new variable name.",
        },
      })
    );
  }
});
