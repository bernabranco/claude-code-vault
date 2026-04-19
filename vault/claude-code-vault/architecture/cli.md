---
id: cli
title: CLI architecture
description: Commands exposed by the claude-code-vault CLI and the conventions they share
type: architecture
tags: [cli, commander]
---

# CLI architecture

The `claude-code-vault` bin is a `commander`-based CLI in `index.js`. Every command operates on the vault rooted at `VAULT_DIR` (or `./vault` if unset) and shares the same `.vault-cache/` index as the [[claude-code-vault/architecture/mcp-server]].

## Commands at a glance

| Command | Purpose |
|---------|---------|
| `list` | Print all notes with frontmatter |
| `read <id>` | Print one note by id |
| `read-with-context <id>` | Read a note plus its wiki-link neighbors |
| `search <query>` | Keyword search |
| `semantic-search <query>` | Embedding search at the note level |
| `search-chunks <query>` | Embedding search at the chunk level |
| `search-with-context <query>` | Chunk search plus neighboring chunks |
| `related <id>` | Walk wiki-link graph from a starting note |
| `index` | Force a full reindex |
| `serve` | Start the optional web viewer |

## Shared filter flags

Every search command accepts the same filter flag set:

- `--tag <tag>` — restrict to notes carrying this frontmatter tag
- `--type <type>` — restrict by frontmatter `type` (e.g. `adr`, `architecture`)
- `--id-prefix <prefix>` — restrict to notes whose id starts with this prefix
- `--since <YYYY-MM-DD>` / `--until <YYYY-MM-DD>` — date-range filter on `note_date`

These map directly onto the filter-before-rank subquery described in [[claude-code-vault/architecture/embeddings-pipeline]].

## Opt-in HyDE

The three semantic commands (`semantic-search`, `search-chunks`, `search-with-context`) accept a `--hyde` flag that runs the query through a small Anthropic model first to widen vocabulary coverage. Off by default — see [[claude-code-vault/features/semantic-search]] for when it helps.

## Error philosophy

CLI errors print to stderr and exit non-zero. The MCP server uses the same handlers but wraps results in `safe()` so a single malformed note doesn't take down a long-running session.
