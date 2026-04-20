#!/usr/bin/env node
// SessionEnd / Stop hook — reports a "gap" when the session edited files
// but never queried the vault. Closes the write-loop: makes forgetting to
// document a learning the default-visible failure mode instead of silent.
//
// Wire into .claude/settings.json (choose ONE trigger event):
//
//   {
//     "hooks": {
//       "SessionEnd": [{
//         "hooks": [{
//           "type": "command",
//           "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-gap-report.mjs"
//         }]
//       }]
//     }
//   }
//
// Or use `Stop` if you want the report to appear mid-session when Claude
// finishes a turn. SessionEnd is less noisy.
//
// Behavior: scans the full transcript tail (last 1 MB), collects:
//   - distinct file paths written by Edit/Write/NotebookEdit
//   - vault_* tool uses
// If at least CLAUDE_VAULT_GAP_THRESHOLD (default 3) distinct files were
// edited AND zero vault tools were called, prints a concise reminder to
// stderr (visible to the user, NOT injected into the model context).
// Silent otherwise. Never blocks — always exit 0.
//
// Tunables:
//   CLAUDE_VAULT_HOOK_DISABLE=1       — disable entirely
//   CLAUDE_VAULT_GAP_THRESHOLD=N      — minimum distinct edits to trigger (default 3)

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

const DEFAULT_THRESHOLD = 3;
const MAX_TAIL_BYTES = 1024 * 1024;
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function isSafeTranscriptPath(p) {
  return typeof p === "string" && isAbsolute(p) && p.endsWith(".jsonl");
}

function readTranscriptTail(transcriptPath) {
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

function collectToolUses(transcriptTail) {
  const editedFiles = new Set();
  let vaultUses = 0;

  if (!transcriptTail) return { editedFiles, vaultUses };

  const lines = transcriptTail.split("\n").filter(Boolean);
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry?.message ?? entry;
    if (message?.role && message.role !== "assistant") continue;
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type !== "tool_use") continue;
      const name = String(block.name || "");
      if (name.includes("__vault_") || name.startsWith("vault_")) {
        vaultUses++;
        continue;
      }
      const bare = name.includes("__") ? name.split("__").pop() : name;
      if (EDIT_TOOLS.has(bare)) {
        const fp = block?.input?.file_path || block?.input?.notebook_path;
        if (typeof fp === "string" && fp.length > 0) editedFiles.add(fp);
      }
    }
  }

  return { editedFiles, vaultUses };
}

function main() {
  if (process.env.CLAUDE_VAULT_HOOK_DISABLE === "1") process.exit(0);

  let payload;
  try {
    payload = JSON.parse(readStdinSync() || "{}");
  } catch {
    process.exit(0);
  }

  const transcriptPath = payload.transcript_path;
  if (!isSafeTranscriptPath(transcriptPath)) process.exit(0);

  const threshold = Math.max(
    1,
    Math.min(
      100,
      parseInt(process.env.CLAUDE_VAULT_GAP_THRESHOLD || "", 10) || DEFAULT_THRESHOLD
    )
  );

  const tail = readTranscriptTail(transcriptPath);
  if (!tail) process.exit(0);

  const { editedFiles, vaultUses } = collectToolUses(tail);

  // Trigger condition: meaningful edits AND zero vault engagement.
  if (editedFiles.size < threshold || vaultUses > 0) process.exit(0);

  const sampleFiles = [...editedFiles].slice(0, 5);
  const more = editedFiles.size - sampleFiles.length;

  const message = [
    "",
    "─── vault-gap-report ───────────────────────────────────",
    `This session edited ${editedFiles.size} distinct file${editedFiles.size === 1 ? "" : "s"} but called no vault_* tools.`,
    "",
    "Edited:",
    ...sampleFiles.map((f) => `  • ${f}`),
    more > 0 ? `  … +${more} more` : "",
    "",
    "If you learned something non-obvious (a gotcha, a decision, a fix pattern),",
    "consider vault_create_note so the next session lands on it instead of",
    "re-deriving. Disable with CLAUDE_VAULT_HOOK_DISABLE=1.",
    "────────────────────────────────────────────────────────",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  // SessionEnd/Stop hooks surface stderr to the user. No injection into
  // Claude's context — this is an end-of-session report for the human.
  process.stderr.write(message + "\n");
  process.exit(0);
}

main();
