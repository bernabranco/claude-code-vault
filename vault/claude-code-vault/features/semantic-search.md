---
id: semantic-search
title: Semantic search
description: How to call semantic search from the CLI and MCP, common filter recipes, and when to enable HyDE
summary: Concrete CLI and MCP examples for semantic search, the filter recipes you'll actually reach for, and the rule of thumb for when HyDE is worth its latency.
type: feature
status: current
lastVerified: 2026-04-20
tags: [search, embeddings, mcp, cli]
---

# Semantic search

## What

Semantic search returns notes (or chunks) ranked by cosine similarity between the query embedding and the indexed embeddings. Three tools ship today: `semantic-search` (note-level), `search-chunks` (paragraph-level), and `search-with-context` (chunks plus graph neighbors). All three support the same filter set — tag, type, id-prefix, date range.

## Why

Keyword search misses queries that don't share lexical tokens with the target note ("why is install slow" vs. "NODE_MODULE_VERSION mismatch"). Embeddings close that gap without requiring a remote API — the decision to keep embeddings local is recorded in [[claude-code-vault/adrs/adr-001-local-first-embeddings]].

Filters are applied **before** ranking — see [[claude-code-vault/architecture/embeddings-pipeline]] for the SQL — so `--type adr --tag embeddings` is precise, not a best-effort post-filter.

## How

Three entry points, same filter set:

### From the CLI

```bash
claude-code-vault semantic-search "why did we choose local embeddings"
claude-code-vault search-chunks "filter before rank" --tag embeddings
claude-code-vault search-with-context "cache filename bump" --type adr
```

`semantic-search` collapses to the note level (best for "find me the doc"). `search-chunks` returns individual chunks (best for "find me the paragraph"). `search-with-context` returns chunks plus their neighbors (best for feeding into an LLM context window).

### From MCP

```json
{
  "name": "vault_semantic_search",
  "arguments": {
    "query": "why did we choose local embeddings",
    "tag": "embeddings",
    "limit": 5
  }
}
```

The same three tools (`vault_semantic_search`, `vault_search_chunks`, `vault_search_chunks_with_context`) all accept the same filter set documented in [[claude-code-vault/architecture/cli]].

### Common filter recipes

- **"Only ADRs":** `--type adr` (or `"type": "adr"` over MCP).
- **"Only the auth subsystem":** `--id-prefix auth/` if your notes are organized by folder-as-prefix.
- **"What changed this quarter":** `--since 2026-01-01`.
- **"Only embeddings notes":** `--tag embeddings`.

Filters compose — `--type adr --tag embeddings` returns ADRs tagged `embeddings`.

### When to turn on HyDE

HyDE expands the query through a small Anthropic model before embedding it. Add `--hyde` (CLI) or `"hyde": true` (MCP) when:

- The query uses generic vocabulary but the target docs use jargon (`"how do we handle login"` vs docs that talk about `"JWT rotation"`).
- Recall feels low and you have an `ANTHROPIC_API_KEY` set.

Skip HyDE for keyword-shaped queries (`"adr-001"`, exact tag names) — the raw query already wins, HyDE just adds latency. Missing API key is a soft fallback to the raw query, never a hard failure.
