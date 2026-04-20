---
id: subagent-context-isolation
title: Subagents do NOT inherit CLAUDE.md
description: Why spawning an Agent/Task cold wastes tokens re-deriving documented patterns, and how claude-code-vault closes the gap
summary: Claude Code subagents spawn with a fresh context and do not receive the parent's CLAUDE.md, memory, or prior tool results. Patterns documented in the parent's vault or instructions are invisible to the subagent unless explicitly passed in the prompt. This is the motivation for the Agent-spawn gate hook.
type: gotcha
status: current
lastVerified: 2026-04-20
tags: [subagents, context, hooks]
---

# Subagents do NOT inherit CLAUDE.md

## Symptom

A subagent spawned via `Agent`/`Task` produces work that contradicts project conventions documented in CLAUDE.md or the vault. It re-derives patterns ("let me first understand the project structure…") that the parent session already has in context. Token usage balloons because the subagent repeats exploration work the parent already did.

## Cause

Subagents start with a **cold context**. They receive:

- The prompt the orchestrator passes in the `Agent` call
- The system prompt for their assigned agent type (if any)
- Access to the tools their agent type declares

They do NOT receive:

- The parent's CLAUDE.md
- The parent's prior tool results
- The parent's memory files
- Any MCP tool descriptions beyond what their agent type explicitly enables

If your vault-first behavior depends on CLAUDE.md routing rules, those rules evaporate the moment you spawn a subagent. The subagent will default to `Grep`/`Glob`/`Read` because nothing in its context says otherwise.

## Fix

Two layers, both necessary:

1. **Write the relevant vault hits into the subagent's prompt.** Do a `vault_semantic_search` on the task statement *before* spawning, and pass the top 2–3 hits inline in the Agent prompt. The subagent will use them as ground truth.
2. **Install the subagent gate hook** ([[claude-code-vault/features/enforcement-hooks]]). It blocks spawns when no `vault_*` call appears in the last 20 tool uses, forcing the orchestrator to query the vault first.

Neither alone is sufficient: without (1), the subagent has no vault context even after the hook passes. Without (2), it's easy to forget.

## Non-fix

Do NOT try to "inject CLAUDE.md into the subagent" by pasting it into the prompt. That defeats the purpose of subagents (fresh context, small surface area) and still doesn't help if the relevant knowledge is in the vault rather than CLAUDE.md. The right primitive is targeted vault search → pass hits into the prompt.

## Related

- [[claude-code-vault/adrs/adr-007-hook-based-vault-enforcement]] — the hook that enforces this at runtime
- [[claude-code-vault/features/enforcement-hooks]] — wiring and tunables
- [[claude-code-vault/adrs/adr-006-llm-routing-via-tool-descriptions]] — why the parent-side routing depends on MCP descriptions, which *are* visible to subagents
