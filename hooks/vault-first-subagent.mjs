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
//           "matcher": "Agent|Task",
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

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

const DEFAULT_LOOKBACK = 20;
const MAX_TAIL_BYTES = 256 * 1024; // Cap transcript read to keep work bounded.

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function isSafeTranscriptPath(p) {
  // Accept only absolute paths to a .jsonl file. transcript_path comes from
  // Claude Code; a malformed value must not cause us to read arbitrary files.
  return typeof p === "string" && isAbsolute(p) && p.endsWith(".jsonl");
}

function readTranscriptTail(transcriptPath) {
  // Truly bounded read: open the file, seek to (size - MAX_TAIL_BYTES), read
  // at most MAX_TAIL_BYTES. Never load the whole transcript into memory even
  // if it grows into the megabytes.
  let fd = -1;
  try {
    const size = statSync(transcriptPath).size;
    const start = Math.max(0, size - MAX_TAIL_BYTES);
    const len = size - start;
    if (len <= 0) return "";
    fd = openSync(transcriptPath, "r");
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf.toString("utf-8");
  } catch {
    return "";
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
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
    // object. We only count tool_use blocks from assistant messages — user
    // messages carry tool_result replies which can embed tool_use references
    // that must not be counted as fresh invocations.
    const message = entry?.message ?? entry;
    if (message?.role && message.role !== "assistant") continue;
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type !== "tool_use") continue;
      toolUses++;
      // MCP-namespaced form: mcp__<server>__vault_<name>. The startsWith
      // branch covers direct (non-MCP) invocation used in tests.
      const name = String(block.name || "");
      if (name.includes("__vault_") || name.startsWith("vault_")) {
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
  // emitAllow/emitBlock below both call process.exit(0) — these guards rely on
  // that to short-circuit. Any future refactor must preserve that invariant.
  if (process.env.CLAUDE_VAULT_HOOK_DISABLE === "1") return emitAllow();

  let payload;
  try {
    payload = JSON.parse(readStdinSync() || "{}");
  } catch {
    return emitAllow();
  }

  if (payload.tool_name !== "Agent" && payload.tool_name !== "Task") return emitAllow();

  const transcriptPath = payload.transcript_path;
  if (!isSafeTranscriptPath(transcriptPath)) return emitAllow();

  const lookback = Math.max(
    1,
    Math.min(
      200,
      parseInt(process.env.CLAUDE_VAULT_SUBAGENT_LOOKBACK || "", 10) || DEFAULT_LOOKBACK
    )
  );

  const tail = readTranscriptTail(transcriptPath);
  if (!tail) return emitAllow(); // Fail-open: no transcript, no evidence, allow.

  const { vaultUses } = countRecentVaultCalls(tail, lookback);
  if (vaultUses > 0) return emitAllow();

  const taskDescription = String(payload?.tool_input?.description || payload?.tool_input?.prompt || "")
    .replaceAll(/[`"\u0000-\u001f]/g, " ")
    .slice(0, 200)
    .trim();

  const reasonLines = [
    "Subagent spawn blocked: no vault_* tool has been called in the last",
    `${lookback} tool uses. Subagents start cold — they do NOT read CLAUDE.md`,
    "and will re-derive patterns already documented in the vault.",
    "",
    "Before spawning, call vault_semantic_search on the task statement",
    taskDescription ? `(e.g. query: ${JSON.stringify(taskDescription)}) ` : "",
    "and pass the top 2-3 hits into the subagent's prompt as ground truth.",
    "",
    "To bypass for this session: export CLAUDE_VAULT_HOOK_DISABLE=1",
  ].filter(Boolean);

  emitBlock(reasonLines.join("\n"));
}

main();
