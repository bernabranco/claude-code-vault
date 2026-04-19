---
id: mcp-server
title: MCP server architecture
description: The stdio MCP server's tool surface, lifecycle, and how it shares the index with the CLI
summary: How the MCP server boots, what tools it registers, why everything must use stderr (not stdout), and how the in-process index is shared with the CLI.
type: architecture
status: current
lastVerified: 2026-04-20
tags: [mcp, server, contract]
---

# MCP server architecture

## Tool surface

The server exposes the following tools — these names form a public contract that downstream consumers depend on:

| Tool | Purpose |
|------|---------|
| `vault_list` | List all notes with their frontmatter |
| `vault_read` | Read a note by id, returning frontmatter + body |
| `vault_search` | Keyword search over titles, tags, body |
| `vault_related` | Walk wiki-link graph from a starting note |
| `vault_semantic_search` | Embedding-based note search with filters |
| `vault_search_chunks` | Embedding-based chunk-level search |
| `vault_search_chunks_with_context` | Chunk search plus surrounding chunks for context window |

All inputs are validated with `zod` schemas. All outputs are wrapped in a `safe()` helper so a single bad note never crashes the server.

## Lifecycle

1. Server starts, reads `VAULT_DIR` from the environment (falls back to the current working directory's `vault/` folder).
2. Indexer runs once at startup — `chokidar` then watches the vault for live updates.
3. Each tool call opens a short-lived read connection to the SQLite cache. Writes only happen on indexer events.
4. All logs go to **stderr only**. `stdout` is reserved for the JSON-RPC stream — see [[claude-code-vault/gotchas/gotchas]].

## How it shares state with the CLI

Both surfaces hit the same `.vault-cache/` directory. Running `claude-code-vault index` from a terminal updates the same SQLite file the MCP server reads from. The watcher catches that change and the server picks up the new chunks within a few hundred milliseconds.

## Why stdio, not HTTP

MCP's stdio transport is the standard for local desktop integrations. It avoids port collisions, doesn't need TLS, and dies cleanly when the parent process (Claude Desktop, your IDE) exits.
