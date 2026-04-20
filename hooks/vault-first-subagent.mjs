#!/usr/bin/env node
// PreToolUse hook for Agent — blocks subagent spawn if no vault_* tool has
// been used in the recent conversation. Subagents don't inherit CLAUDE.md
// and start cold, so spawning without vault context wastes tokens
// re-deriving what's already documented.
//
// Wire into .claude/settings.json:
//   {
//     "hooks": {
//       "PreToolUse": [
//         {
//           "matcher": "Agent",
//           "hooks": [{
//             "type": "command",
//             "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-first-subagent.mjs"
//           }]
//         }
//       ]
//     }
//   }
//
// Behavior: scans the tail of the Claude Code transcript for recent vault_*
// tool_use entries. If any are found within the last N assistant tool-use
// entries (default 20), the spawn is allowed. Otherwise the hook returns
// permissionDecision: "deny" with a reason telling the orchestrator to
// query the vault first.
//
// Fail-open on any error (missing transcript, parse failure, missing
// input) — we never want to brick the user's workflow.
//
// Tunables:
//   CLAUDE_VAULT_HOOK_DISABLE=1   — disable entirely
//   CLAUDE_VAULT_SUBAGENT_LOOKBACK=N — override the 20-tool-use lookback window

import { readFileSync, statSync } from "node:fs";

const DEFAULT_LOOKBACK = 20;
const MAX_TAIL_BYTES = 256 * 1024; // Cap transcript read to keep work bounded.

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function readTranscriptTail(transcriptPath) {
  try {
    const stat = statSync(transcriptPath);
    const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
    const raw = readFileSync(transcriptPath, { encoding: "utf-8", flag: "r" });
    return start === 0 ? raw : raw.slice(start);
  } catch {
    return "";
  }
}

function countRecentVaultCalls(transcriptTail, lookback) {
  if (!transcriptTail) return { toolUses: 0, vaultUses: 0 };

  const lines = transcriptTail.split("\n").filter(Boolean);
  let toolUses = 0;
  let vaultUses = 0;

  // Walk the tail in reverse; stop once we've seen `lookback` tool uses.
  for (let i = lines.length - 1; i >= 0 && toolUses < lookback; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    // Claude Code transcripts are JSONL. Each line is typically a message
    // object. We look for tool_use content blocks in assistant messages.
    const message = entry?.message ?? entry;
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type !== "tool_use") continue;
      toolUses++;
      const name = String(block.name || "");
      if (name.startsWith("vault_") || name.includes("__vault_")) {
        vaultUses++;
      }
      if (toolUses >= lookback) break;
    }
  }

  return { toolUses, vaultUses };
}

function emitAllow() {
  // No output = allow; simplest possible path.
  process.exit(0);
}

function emitBlock(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

function main() {
  if (process.env.CLAUDE_VAULT_HOOK_DISABLE === "1") emitAllow();

  let payload;
  try {
    payload = JSON.parse(readStdinSync() || "{}");
  } catch {
    emitAllow();
  }

  if (payload.tool_name !== "Agent" && payload.tool_name !== "Task") emitAllow();

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || typeof transcriptPath !== "string") emitAllow();

  const lookback = Math.max(
    1,
    Math.min(
      200,
      parseInt(process.env.CLAUDE_VAULT_SUBAGENT_LOOKBACK || "", 10) || DEFAULT_LOOKBACK
    )
  );

  const tail = readTranscriptTail(transcriptPath);
  if (!tail) emitAllow(); // Fail-open: no transcript, no evidence, allow.

  const { vaultUses } = countRecentVaultCalls(tail, lookback);
  if (vaultUses > 0) emitAllow();

  const taskDescription = String(payload?.tool_input?.description || payload?.tool_input?.prompt || "")
    .replaceAll(/[`\u0000-\u001f]/g, " ")
    .slice(0, 200)
    .trim();

  const reasonLines = [
    "Subagent spawn blocked: no vault_* tool has been called in the last",
    `${lookback} tool uses. Subagents start cold — they do NOT read CLAUDE.md`,
    "and will re-derive patterns already documented in the vault.",
    "",
    "Before spawning, call vault_semantic_search on the task statement",
    taskDescription ? `(e.g. query: "${taskDescription}") ` : "",
    "and pass the top 2-3 hits into the subagent's prompt as ground truth.",
    "",
    "To bypass for this session: export CLAUDE_VAULT_HOOK_DISABLE=1",
  ].filter(Boolean);

  emitBlock(reasonLines.join("\n"));
}

main();
