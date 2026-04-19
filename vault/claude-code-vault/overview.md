---
id: overview
title: claude-code-vault overview
description: What claude-code-vault is, the four surfaces it exposes, and how a query flows through the system
summary: Read first — claude-code-vault is a local-first MCP + CLI for retrieval over a markdown vault. This note covers the four surfaces and the query flow.
type: overview
status: current
lastVerified: 2026-04-20
tags: [introduction, architecture]
---

# claude-code-vault overview

`claude-code-vault` is a local-first MCP server plus CLI that turns a folder of markdown notes into a searchable knowledge base. No remote services are required at runtime: embeddings are computed on-device with a small sentence-transformer model, and the index lives in a single SQLite file under `.vault-cache/`.

## The four surfaces

- **MCP server** — stdio JSON-RPC. Exposes `vault_list`, `vault_read`, `vault_search`, `vault_related`, plus three semantic tools. See [[claude-code-vault/architecture/mcp-server]].
- **CLI** — `claude-code-vault <command>`. Same operations as the MCP tools, plus indexing utilities. See [[claude-code-vault/architecture/cli]].
- **Embeddings pipeline** — chunker, embedder, sqlite-vec index, file watcher. See [[claude-code-vault/architecture/embeddings-pipeline]].
- **Web viewer** — optional Vite/React SPA backed by an Express server. Clone-only, never shipped in the npm tarball.

## How a query flows

1. A consumer (Claude, the CLI, or the viewer) calls one of the search tools.
2. The query is embedded with `Xenova/all-MiniLM-L6-v2` (384-dim).
3. Filters (tag / date / type / id-prefix) are applied as a sqlite-vec rowid pre-filter — see [[claude-code-vault/features/semantic-search]] for the recipe.
4. Top-K chunks come back ranked by cosine distance. Optionally [[claude-code-vault/features/graph-expansion]] walks wiki-links to surface related notes.

## What this vault is not

- Not a replacement for Obsidian / your editor of choice.
- Not a writing assistant — it reads existing markdown, it doesn't generate it.
- Not a remote vector database. The whole point is everything stays on your machine.
