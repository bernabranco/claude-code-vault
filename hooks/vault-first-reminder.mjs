#!/usr/bin/env node
// PreToolUse hook for Grep / Glob — reminds Claude to try the vault first.
//
// Wire into .claude/settings.json:
//   {
//     "hooks": {
//       "PreToolUse": [
//         {
//           "matcher": "Grep|Glob",
//           "hooks": [{
//             "type": "command",
//             "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-first-reminder.mjs"
//           }]
//         }
//       ]
//     }
//   }
//
// Behavior: on the FIRST Grep or Glob call per session, emits additionalContext
// suggesting `vault_semantic_search` with the pattern pre-formulated. Silent on
// every subsequent call. Never emits a "block" decision — this hook is a nudge,
// not a gate. Future edits must preserve that invariant.
//
// Disable: export CLAUDE_VAULT_HOOK_DISABLE=1 in the shell Claude Code inherits.
// State: <os.tmpdir()>/claude-code-vault-hook-state/<sanitized-session-id>.seen

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function main() {
  if (process.env.CLAUDE_VAULT_HOOK_DISABLE === "1") process.exit(0);

  let payload;
  try {
    payload = JSON.parse(readStdinSync() || "{}");
  } catch {
    process.exit(0);
  }

  const rawSessionId = payload.session_id;
  const toolName = payload.tool_name || "";
  const toolInput = payload.tool_input || {};

  if (toolName !== "Grep" && toolName !== "Glob") process.exit(0);

  // Missing session id → exit silently rather than collide on a shared flag.
  if (!rawSessionId || typeof rawSessionId !== "string") process.exit(0);

  // Sanitize session id before using it as a filename (avoid path traversal).
  const sessionId = rawSessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
  if (!sessionId) process.exit(0);

  const stateDir = join(tmpdir(), "claude-code-vault-hook-state");
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {
    process.exit(0);
  }

  const flag = join(stateDir, `${sessionId}.seen`);
  // Exclusive create — if another concurrent first-call already wrote it, we bail.
  try {
    writeFileSync(flag, new Date().toISOString(), { flag: "wx" });
  } catch {
    process.exit(0);
  }

  // Sanitize the pattern before echoing: strip control chars and backticks so
  // an attacker-controlled Grep pattern can't inject instructions into the
  // additionalContext payload Claude reads. JSON.stringify handles wire-safety.
  const rawQuery = String(toolInput.pattern || toolInput.query || toolInput.path || "");
  const query = rawQuery.replaceAll(/[`\u0000-\u001f]/g, " ").slice(0, 200).trim();
  const suggestion = query
    ? `vault_semantic_search with query: "${query}"`
    : "vault_semantic_search";

  const message = [
    "Vault-first reminder (fires once per session).",
    "",
    `Before searching the filesystem with ${toolName}, consider the vault — it indexes this project's ADRs, design docs, runbooks, and gotchas. Question-shaped intent? Try ${suggestion}. Known term? Try vault_search.`,
    "",
    `If the vault has no relevant note, the ${toolName} will still proceed — this message does not block.`,
  ].join("\n");

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message,
      },
    })
  );
  process.exit(0);
}

main();
