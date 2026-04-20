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
//             "command": "node /absolute/path/to/hooks/vault-first-reminder.mjs"
//           }]
//         }
//       ]
//     }
//   }
//
// Behavior: on the FIRST Grep or Glob call per session, emits additionalContext
// suggesting `vault_semantic_search` with the pattern pre-formulated. Silent on
// every subsequent call. Never blocks — this is a nudge, not a gate.
//
// Disable per-session: set env CLAUDE_VAULT_HOOK_DISABLE=1
// Reset state: delete the state dir (printed below on first run).

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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

  const sessionId = payload.session_id || "unknown";
  const toolName = payload.tool_name || "";
  const toolInput = payload.tool_input || {};

  if (toolName !== "Grep" && toolName !== "Glob") process.exit(0);

  const stateDir = join(tmpdir(), "claude-code-vault-hook-state");
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {
    process.exit(0);
  }

  const flag = join(stateDir, `${sessionId}.seen`);
  if (existsSync(flag)) process.exit(0);

  try {
    writeFileSync(flag, new Date().toISOString());
  } catch {
    process.exit(0);
  }

  const query = String(toolInput.pattern || toolInput.query || toolInput.path || "").slice(0, 200);
  const suggestion = query
    ? `\`vault_semantic_search({ query: "${query.replace(/"/g, '\\"')}" })\``
    : "`vault_semantic_search`";

  const message = [
    "Vault-first reminder (fires once per session).",
    "",
    `Before searching the filesystem with ${toolName}, consider the vault — it indexes this project's ADRs, design docs, runbooks, and gotchas. Question-shaped intent? Try ${suggestion}. Known term? Try \`vault_search\`.`,
    "",
    "If the vault has no relevant note, the Grep will still proceed — this message does not block.",
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
