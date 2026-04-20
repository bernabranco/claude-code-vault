---
id: adr-007-hook-based-vault-enforcement
title: ADR-007 — hook-based vault enforcement (nudge → gate → report)
description: Why three Claude Code hooks escalate from nudge to block to post-session report, and why they ship as opt-in rather than auto-install
summary: Decision (accepted 2026-04-20) to close the "orchestrator forgets the vault" gap with three escalating hooks — a once-per-session Grep/Glob nudge, an Agent-spawn gate that blocks cold subagents, and a SessionEnd gap report. All ship opt-in under `hooks/` in the npm tarball and share a fail-open invariant.
type: adr
status: current
date: 2026-04-20
lastVerified: 2026-04-20
tags: [decision, hooks, enforcement]
---

# ADR-007 — hook-based vault enforcement

## Context

Tool descriptions (see [[claude-code-vault/adrs/adr-006-llm-routing-via-tool-descriptions]]) handle the happy path but not three failure modes observed in real sessions:

1. **Filesystem reflex.** The orchestrator reaches for `Grep`/`Glob` on a question-shaped prompt before considering the vault.
2. **Cold subagents.** Spawned agents do not inherit CLAUDE.md and start without any vault context, re-deriving patterns that are already documented. See [[claude-code-vault/gotchas/subagent-context-isolation]].
3. **Write-loop asymmetry.** Sessions that learn something non-obvious still end without a `vault_create_note`, so the next session re-derives it.

Descriptions cannot solve any of these — they load too late (after tool selection) or not at all (subagents).

## Decision

Three hooks, escalating in firmness, each shipped opt-in:

| Hook | Event | Strength | Purpose |
| --- | --- | --- | --- |
| `vault-first-reminder.mjs` | `PreToolUse` on `Grep`/`Glob` | **Nudge** (additionalContext) | Once-per-session reminder suggesting `vault_semantic_search` with the pattern pre-formulated |
| `vault-first-subagent.mjs` | `PreToolUse` on `Agent`/`Task` | **Gate** (permissionDecision: deny) | Blocks subagent spawn if no `vault_*` call appears in the last 20 tool uses |
| `vault-gap-report.mjs` | `SessionEnd` or `Stop` | **Report** (stderr) | Prints a gap notice if ≥3 distinct files were edited with zero `vault_*` calls |

Shared invariants every hook must honor:

- **Fail-open.** Any error path exits 0 (allow). Malformed stdin, missing transcript, parse failure, read error — none block the user.
- **Bounded transcript read.** `openSync` + `readSync` at a tail offset. Never `readFileSync` of the whole JSONL.
- **Path-traversal guard.** `transcript_path` must be absolute and end in `.jsonl` before we open it.
- **Role check.** Only count `tool_use` blocks in `assistant` messages; user messages carry `tool_result` replies that can embed tool_use references which must not be counted as fresh invocations.
- **No context injection.** The gap report writes to stderr only — it is feedback for the human, not a self-referential instruction to the model. Only the subagent gate injects text, and it does so via the documented `permissionDecisionReason` field.
- **Single escape hatch.** `CLAUDE_VAULT_HOOK_DISABLE=1` silences all three.

## Why opt-in

Hooks require consumer action (`.claude/settings.json` wiring) rather than auto-activating. Reasons:

- Auto-installing hooks on `npm install` is hostile — hooks run arbitrary code on every tool use.
- Projects differ on tolerance for a hard gate (the subagent hook denies spawns). Opt-in lets consumers pick nudge-only, gate-only, or all three.
- Wiring lives in the consumer's repo and shows up in diffs, so enforcement is auditable.

See [[claude-code-vault/features/enforcement-hooks]] for wiring and tunables.

## Consequences

- **Good:** the three failure modes above now have a durable, testable answer. Every hook has a smoke test matrix covering disabled / silent / triggered branches.
- **Good:** adding a fourth hook later (e.g. a Write-time "did you vault this?" nudge) slots into the same shape — shared utilities, same invariants.
- **Watch:** the subagent gate is the only *blocking* hook. If a consumer finds it too strict, the escape valve is `CLAUDE_VAULT_HOOK_DISABLE=1` — not softening the hook, which would reopen the cold-subagent hole.
- **Accepted cost:** three separate files with some duplicated parsing. Extracting a shared `lib/hook-utils.mjs` is tempting but would break the "each hook is a single-file copy-pasteable unit" property that makes them easy to audit.

## Related

- [[claude-code-vault/adrs/adr-006-llm-routing-via-tool-descriptions]] — the lighter-weight routing layer these hooks backstop
- [[claude-code-vault/features/enforcement-hooks]] — consumer-facing wiring and tunables
- [[claude-code-vault/gotchas/subagent-context-isolation]] — the specific problem the subagent gate solves
