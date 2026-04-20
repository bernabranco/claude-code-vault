---
id: enforcement-hooks
title: Enforcement hooks — wiring and tunables
description: Three opt-in Claude Code hooks that enforce vault-first behavior — the Grep/Glob nudge, the Agent spawn gate, and the SessionEnd gap report
summary: Ship from `hooks/` in the npm tarball. Consumers wire them into `.claude/settings.json`. All share `CLAUDE_VAULT_HOOK_DISABLE=1` as the escape hatch and fail-open on every error path. Each hook is a single self-contained .mjs file with no runtime dependencies beyond Node 20 stdlib.
type: feature
status: current
lastVerified: 2026-04-20
tags: [hooks, enforcement, configuration]
---

# Enforcement hooks

Three hooks that backstop the [[claude-code-vault/adrs/adr-006-llm-routing-via-tool-descriptions|MCP description routing]] when the orchestrator forgets the vault exists.

## 1. `vault-first-reminder.mjs` — Grep/Glob nudge

Fires once per session on the first `Grep` or `Glob`. Emits `additionalContext` suggesting `vault_semantic_search` with the pattern pre-formulated. Never blocks.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Grep|Glob",
        "hooks": [{
          "type": "command",
          "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-first-reminder.mjs"
        }]
      }
    ]
  }
}
```

State lives in `<os.tmpdir()>/claude-code-vault-hook-state/<sanitized-session-id>.seen`. Exclusive create (`wx`) guards against races.

## 2. `vault-first-subagent.mjs` — Agent spawn gate

Fires on `PreToolUse` for `Agent`/`Task`. Scans the transcript tail for recent `vault_*` calls. If none in the last 20 tool uses, returns `permissionDecision: "deny"` with a reason telling the orchestrator to query the vault first.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent|Task",
        "hooks": [{
          "type": "command",
          "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-first-subagent.mjs"
        }]
      }
    ]
  }
}
```

This is the only *blocking* hook. Rationale in [[claude-code-vault/adrs/adr-007-hook-based-vault-enforcement]] and [[claude-code-vault/gotchas/subagent-context-isolation]].

## 3. `vault-gap-report.mjs` — SessionEnd gap report

Fires on `SessionEnd` (or `Stop` for per-turn reports). Collects distinct file paths written by `Edit`/`Write`/`NotebookEdit`/`MultiEdit` and counts `vault_*` calls. If edits ≥ threshold (default 3) and vault calls == 0, prints a reminder to stderr. Stderr is visible to the user but NOT injected into Claude's context.

```json
{
  "hooks": {
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-gap-report.mjs"
      }]
    }]
  }
}
```

## Tunables (shared)

| Env var | Effect | Default |
| --- | --- | --- |
| `CLAUDE_VAULT_HOOK_DISABLE=1` | Silences all three hooks for the current shell | unset |
| `CLAUDE_VAULT_SUBAGENT_LOOKBACK=N` | How many recent tool uses the subagent gate scans | 20 |
| `CLAUDE_VAULT_GAP_THRESHOLD=N` | Minimum distinct edited files to trigger the gap report | 3 |

## Invariants

Every hook must:

- Exit 0 on any error path (fail-open). Never brick the user's workflow.
- Read the transcript with a bounded `openSync` + `readSync` tail (256 KB for the subagent gate, 1 MB for the gap report). Never `readFileSync` the whole JSONL.
- Guard `transcript_path` with an absolute-path + `.jsonl`-suffix check before opening.
- Only count `tool_use` blocks from `assistant` messages. User messages carry `tool_result` replies which embed tool_use references that must not be counted as fresh invocations.
- Sanitize any user-controlled string (session id, query pattern) before echoing it into hook output — strip control chars and backticks to prevent prompt injection.

## Testing

Each hook has an adversarial smoke-test matrix covering: disabled env var, missing stdin, malformed JSON, path traversal, non-`.jsonl` transcript, zero-tool transcript, vault-present transcript, and user-message tool_use-embedded transcripts. See commit history under `feat/hook-*` branches for the exact cases.

## Related

- [[claude-code-vault/adrs/adr-006-llm-routing-via-tool-descriptions]]
- [[claude-code-vault/adrs/adr-007-hook-based-vault-enforcement]]
- [[claude-code-vault/gotchas/subagent-context-isolation]]
