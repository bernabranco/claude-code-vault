---
id: adr-006-llm-routing-via-tool-descriptions
title: ADR-006 — MCP tool descriptions are LLM routing contracts
description: Why vault_* descriptions lead with "REACH FOR THIS BEFORE Grep/Read/Glob/subagent" framing and stay under the 1024-char MCP client truncation threshold
summary: Decision (accepted 2026-04-20) to treat MCP tool descriptions as routing contracts that explicitly redirect the orchestrator from Grep/Read/Glob/subagent to the vault. Each description leads with the "use this instead of X" framing, stays under ~1024 chars to survive client truncation, and drops cross-tool tails and duplicate sentences that bloat the payload without helping routing.
type: adr
status: current
date: 2026-04-20
lastVerified: 2026-04-20
tags: [decision, mcp, llm-ergonomics]
---

# ADR-006 — MCP tool descriptions are LLM routing contracts

## Context

The vault is only useful if Claude Code reaches for it before `Grep`, `Read`, `Glob`, or spawning a subagent. In practice, well-named tools with accurate but neutral descriptions ("search the vault by keyword") lost the routing fight: Grep was faster to think of, and the model had no signal that the vault was the *preferred* path.

The gap is a routing problem, not a capability problem. Descriptions are the only channel the orchestrator reliably reads before tool selection — CLAUDE.md is not loaded into subagents, and hooks only fire on specific events.

MCP clients also truncate tool descriptions around ~1024 characters. Descriptions that ran past that threshold lost their tail silently, which is exactly where prior versions had stashed the "prefer this over Grep" hint.

## Decision

Every `vault_*` tool description must:

1. **Lead with a routing directive** — "REACH FOR THIS BEFORE Grep/Read/Glob/subagent" (or the narrower equivalent for chunk/related tools), not a neutral capability statement.
2. **Stay under 1024 characters** so the routing hint survives client truncation. Measured on publish; median is ~720 chars, max ~960.
3. **Drop cross-tool tails** ("see also vault_related…") that duplicate information the orchestrator will discover from the sibling tool's own description.
4. **Keep one concrete example** of the query shape the tool is best at. Remove rationale, motivation, and "why this exists" prose — the orchestrator does not need to justify calling a tool, only know when to call it.

See the post-trim payloads in [lib/mcp.js](../../../lib/mcp.js).

## Consequences

- **Good:** the orchestrator routes vault-first on question-shaped intent without hooks firing. Descriptions stay legible to a human reading the MCP tool list.
- **Good:** bounded budget means new tools can't silently push existing routing hints past the truncation cliff.
- **Watch:** future tool additions must re-measure total surface — 13 tools × ~800 chars is already ~10 KB, which pressures clients that paginate the tool list.
- **Accepted cost:** rationale that used to live in descriptions now lives here and in [[claude-code-vault/features/enforcement-hooks]]. The tool list is smaller and more ruthless.

## Related

- [[claude-code-vault/adrs/adr-007-hook-based-vault-enforcement]] — the escalation layer for cases where descriptions alone are insufficient
- [[claude-code-vault/features/enforcement-hooks]] — the three hooks that enforce the routing contract at runtime
- [[claude-code-vault/gotchas/subagent-context-isolation]] — why descriptions matter more than CLAUDE.md for subagents
