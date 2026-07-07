#!/usr/bin/env node
// PostToolUse hook: after a .ts/.tsx edit, run tsc --noEmit and feed any
// errors back to Claude (exit 2 = blocking feedback it must address).
const { spawnSync } = require("child_process");
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let file = "";
  try {
    const j = JSON.parse(raw);
    file = j?.tool_input?.file_path || j?.tool_response?.filePath || "";
  } catch {}
  if (!/\.(ts|tsx)$/i.test(file) || /node_modules/.test(file)) return;
  const r = spawnSync("npx", ["tsc", "--noEmit"], {
    shell: true,
    encoding: "utf8",
    timeout: 110000,
  });
  if (r.status !== 0) {
    process.stderr.write(
      (
        "Type-check failed after editing " +
        file +
        ":\n" +
        (r.stdout || "") +
        (r.stderr || "")
      ).slice(0, 8000)
    );
    process.exit(2);
  }
});
