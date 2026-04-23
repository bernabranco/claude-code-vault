# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install
npm install && cd web && npm install && cd ..

# MCP server (stdio, used by Claude Code via .mcp.json)
node lib/mcp.js

# Web UI
node lib/server.js          # backend → http://localhost:4001
cd web && npm run dev        # frontend → http://localhost:5173
npm run dev                  # both together (concurrently)

# CLI
node index.js --help
node index.js semantic-search "why SQLite over cloud DB"
node index.js search-chunks "tab throttling" --limit 5

# Type-check (run before PRs)
npx tsc --noEmit --allowJs --skipLibCheck index.js lib/*.js
cd web && npx tsc --noEmit && cd ..

# Build web
npm run build

# Re-index vault + smoke test
node index.js index
node index.js search "architecture" --limit 3
node index.js lint            # exits 1 on any error-level finding

# Retrieval eval
npm run eval                  # recall@5 + MRR@5 against gold dataset
npm run eval:bless            # update baseline after intentional improvement
node test/retrieval/eval.js --gate 3 --warn-gate 1   # custom thresholds
node test/retrieval/eval.js --hyde                    # measure HyDE lift (needs ANTHROPIC_API_KEY)
node test/retrieval/eval.js --json                    # machine-readable
```

## Architecture

The system has three entry points that share most of `lib/`:

- **`lib/mcp.js`** — MCP stdio server, the primary Claude Code integration. Exposes 8 vault tools, wires up chokidar file-watch → reindex, lazy-loads `embeddings.js`, and applies char budgets via `budgets.js`.
- **`lib/server.js`** — Express REST backend for the web UI at port 4001.
- **`index.js`** — CLI using `commander`; thin wrapper over the same `lib/` functions.

### Data flow

1. **Indexing**: `Vault` (`lib/vault.js`) scans `.md` files recursively, parses YAML frontmatter, and builds an in-memory index. The index is the source of truth; the SQLite DB is a cache.
2. **Chunking**: `chunkMarkdown()` (`lib/chunks.js`) splits notes on heading boundaries (100–1500 chars), attaches heading breadcrumbs and extracted wiki-links to each chunk.
3. **Embeddings**: `lib/embeddings.js` runs `Xenova/all-MiniLM-L6-v2` locally via `@huggingface/transformers`. Vectors stored in `sqlite-vec` at `.vault-cache/embeddings-v2.db`. First run downloads ~22MB of ONNX weights; subsequent runs only re-embed notes whose `lastModified` changed.
4. **Graph**: Wiki-links form a directed graph. `lib/graph.js` computes PageRank and `expandNeighbors()` for the `*_with_context` tools. Neighbor ranking: bidirectional edges first → link frequency → recency → alphabetical.
5. **MCP tools**: All search/list tools return `{ results, truncated }` with a `maxChars` budget (default 8000). The `*_with_context` tools share the same budget logic but have a different envelope shape.

### Key modules

| File | Role |
|---|---|
| `lib/vault.js` | In-memory markdown index, frontmatter parsing, full-text search |
| `lib/chunks.js` | Heading-boundary chunker; produces breadcrumbed chunks with wiki-link extraction |
| `lib/embeddings.js` | Local embeddings (MiniLM), sqlite-vec storage, `semanticSearch` / `searchChunks` |
| `lib/graph.js` | Wiki-link graph, PageRank, neighbor expansion |
| `lib/mcp.js` | MCP server, all 8 tool definitions, chokidar watcher |
| `lib/budgets.js` | `applyCharBudget()` — shared truncation logic for all search tools |
| `lib/vault-write.js` | `createNote`, `writeNote`, `editSection` — atomic write with schema enforcement |
| `lib/linter.js` | Dead-link detection, missing frontmatter, orphans, stale dates |
| `lib/glossary.js` | `type: glossary` notes; jargon auto-resolution on `vault_read` |
| `lib/hyde.js` | HyDE query expansion (generates a hypothetical answer, embeds it instead of raw query) |
| `lib/sections.js` | Heading-path matching for `vault_append_section` / `vault_replace_section` |
| `lib/schemas.js` | Typed-note schemas (ADR, feature, gotcha, runbook, glossary) |
| `lib/query-log.js` | Opt-in query miss log; enable with `VAULT_QUERY_LOG=1` |
| `lib/gap-analyzer.js` | `vault gap <repo>` — classifies git-tracked files as covered/mentioned/uncovered |

### Hooks (`hooks/`)

Three Claude Code hooks ship with the package:

- **`vault-first-reminder.mjs`** — PreToolUse on Grep/Glob; emits a one-per-session nudge to try `vault_semantic_search` first.
- **`vault-first-subagent.mjs`** — PreToolUse on Agent/Task; **blocks** subagent spawns if no `vault_*` call appears in the last 20 tool uses. Fails open on error.
- **`vault-gap-report.mjs`** — SessionEnd; prints to stderr if ≥ 3 files edited and zero vault queries made. Threshold overridden by `CLAUDE_VAULT_GAP_THRESHOLD`. Disable all hooks with `CLAUDE_VAULT_HOOK_DISABLE=1`.

### Vault structure convention

```
vault/
└── <project>/
    ├── VAULT_SUMMARY.md    ← index; Claude reads this first
    ├── overview.md
    ├── adrs/
    ├── architecture/
    ├── features/
    ├── gotchas/
    └── research/
```

Frontmatter fields the indexer uses: `title`, `tags`, `description`, `date`, `status` (draft/current/stale/deprecated), `type`, `lastVerified`, `summary`. `status: deprecated` notes are excluded from retrieval by default; `status: stale` notes are downranked by `staleWeight` (default 0.7).

### Retrieval eval

Gold dataset lives in `test/retrieval/gold.json`. CI fails when any tool's `recall@5` drops ≥ 2pp vs the committed baseline. Add entries when shipping notes whose retrieval is non-obvious; never delete to make metrics look better. Unit tests for individual `lib/` modules are co-located in `lib/*.test.js`.

## Scope rules

- **MCP surface stays at 8 tools.** A new tool needs a clear reason it can't compose from existing ones.
- **Local-first.** No cloud calls on the critical path.
- **Markdown is source of truth.** The SQLite DB is a cache; if they disagree, files win.
- **Merge via `gh pr merge --merge`**, never `--squash`. Squash drops graph history.
