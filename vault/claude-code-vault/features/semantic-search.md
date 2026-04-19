---
id: semantic-search
title: Semantic search
description: How to call semantic search from the CLI and MCP, common filter recipes, and when to enable HyDE
type: feature
tags: [search, embeddings, mcp, cli]
---

# Semantic search

Semantic search returns notes (or chunks) ranked by cosine similarity between the query embedding and the indexed embeddings. Filters are applied **before** ranking — see [[claude-code-vault/architecture/embeddings-pipeline]] for the SQL.

## From the CLI

```bash
claude-code-vault semantic-search "why did we choose local embeddings"
claude-code-vault search-chunks "filter before rank" --tag embeddings
claude-code-vault search-with-context "cache filename bump" --type adr
```

`semantic-search` collapses to the note level (best for "find me the doc"). `search-chunks` returns individual chunks (best for "find me the paragraph"). `search-with-context` returns chunks plus their neighbors (best for feeding into an LLM context window).

## From MCP

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

## Common filter recipes

- **"Only ADRs":** `--type adr` (or `"type": "adr"` over MCP).
- **"Only the auth subsystem":** `--id-prefix auth/` if your notes are organized by folder-as-prefix.
- **"What changed this quarter":** `--since 2026-01-01`.
- **"Only embeddings notes":** `--tag embeddings`.

Filters compose — `--type adr --tag embeddings` returns ADRs tagged `embeddings`.

## When to turn on HyDE

HyDE expands the query through a small Anthropic model before embedding it. Add `--hyde` (CLI) or `"hyde": true` (MCP) when:

- The query uses generic vocabulary but the target docs use jargon (`"how do we handle login"` vs docs that talk about `"JWT rotation"`).
- Recall feels low and you have an `ANTHROPIC_API_KEY` set.

Skip HyDE for keyword-shaped queries (`"adr-001"`, exact tag names) — the raw query already wins, HyDE just adds latency. Missing API key is a soft fallback to the raw query, never a hard failure.
