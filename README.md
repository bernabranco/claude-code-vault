# claude-vault

A markdown knowledge vault designed for Claude — not adapted to Claude.

Most PKM tools (Obsidian, Logseq, Notion) were built for humans writing notes; LLM features are bolted on as plugins. `claude-vault` starts from the other direction: **what would a knowledge base look like if an LLM agent was the primary consumer?**

> ⚠️ **Status: early, personal tool.** See the roadmap for what's built vs. planned.

## The Pitch

**Today:** a vault of markdown files Claude reads directly (via MCP tools), with a 3D graph UI for humans to browse.

**Goal:** a vault Claude can *query* — semantic search, graph-aware context, chunk-level retrieval, native MCP tools. A persistent memory layer that plugs into Claude Code in one command.

Browse the demo vault shipped with this repo: [`vault/tempo/`](vault/tempo/) — a fake focus-timer SaaS with ADRs, features, gotchas, market research, and pricing, all wiki-linked into a real graph.

## How it looks in practice

Walk-through using the demo vault. Imagine you've just opened Claude Code in a Tempo-like repo.

### "What's this project?"
Claude calls `vault_read("tempo/overview")`. Gets the overview + 4 wiki-links pointing at architecture, the core feature, pricing, and market research. Claude now knows where to look next — no grepping required.

### "Why did we pick SQLite over a cloud DB?"
Nothing in the vault contains the literal string *"cloud DB"*. Keyword search returns zero results. Claude falls back to `vault_semantic_search("why SQLite over cloud DB")` → top hit is [`adr-001-local-first-sqlite`](vault/tempo/technical/decisions/adr-001-local-first-sqlite.md) with similarity 0.84, best-chunk heading `ADR-001 > Context`. **Meaning-based retrieval**, not substring matching.

### "Where's the tab-throttling gotcha?"
Claude doesn't want the whole [`gotchas.md`](vault/tempo/technical/architecture/gotchas.md) file — just the relevant paragraph. `vault_search_chunks("tab throttling")` returns the exact passage ("`setTimeout` in a background tab is throttled to 1s minimum") with breadcrumb `Gotchas > 1. setTimeout...`. ~40 tokens returned instead of the full file.

### "Show me ADR-001 with its neighbors"
`vault_read_with_context("tempo/technical/decisions/adr-001-local-first-sqlite")` returns the ADR **plus** 3 ranked graph neighbors — [`frontend-architecture`](vault/tempo/technical/architecture/frontend-architecture.md), [`focus-sessions`](vault/tempo/technical/features/focus-sessions.md), [`adr-002`](vault/tempo/technical/decisions/adr-002-web-workers-for-timers.md) — each with an intro snippet. One round-trip. Bidirectional edges first, then ranked by how many chunks reference them.

Full tool list is below. `vault_list`, `vault_related`, `vault_search`, and `vault_search_chunks_with_context` round out the other four.

## Why not Obsidian?

Obsidian is excellent at what it does. The difference:

| | claude-vault | Obsidian |
|---|---|---|
| Primary consumer | LLM agent | Human writing notes |
| Editing | Any editor (VSCode, nvim) | Built-in WYSIWYG |
| Plugin ecosystem | None (by design — minimal surface) | 1000+ plugins |
| Retrieval | Semantic + graph-aware, built-in | Substring search + graph (via plugins) |
| MCP integration | Native | Via third-party plugins |
| Price | Free, OSS | Free personal, $50/yr commercial |

For manual note-taking, use Obsidian. For an LLM-consumable knowledge base that lives next to your code, `claude-vault` is the pitch.

## Structure

```
vault/
├── README.md                   ← conventions doc
├── tempo/                      ← demo vault shipped with this repo
│   ├── VAULT_SUMMARY.md        ← index Claude reads first
│   ├── overview.md
│   ├── technical/              ← code, architecture, features, gotchas, ADRs
│   ├── strategy/               ← research, roadmap, product direction
│   └── business/               ← GTM, pricing, rollout
└── your-project/               ← (added by `claude-vault init`)
    └── ...
```

One folder per project. Each project has a `VAULT_SUMMARY.md` that Claude reads as the index. Three drawers — **technical**, **strategy**, **business** — for the three kinds of content Claude is useful for.

## Running locally

The vault is just markdown — Claude reads files directly, no backend required for that. The backend + web UI are for *you* to browse.

```bash
# Install
npm install
cd web && npm install && cd ..

# Run backend + UI (optional, for browsing)
node lib/server.js                # http://localhost:4001
cd web && npm run dev              # http://localhost:5173 (dev mode)
```

## Bootstrap a vault in any repo

```bash
claude-vault init [project-name]
```

Defaults the project name to the current directory name. Creates:

- `vault/<project>/` with drawer structure (`technical/`, `strategy/`, `business/`) and stub `VAULT_SUMMARY.md` + `overview.md`
- `.mcp.json` at repo root wiring Claude Code to the vault's MCP server (uses `npx claude-vault mcp` with `VAULT_DIR=./vault`)
- `.vault-cache/` entry in `.gitignore` so the local embeddings DB isn't committed

Idempotent: re-running skips existing files. After it finishes, restart Claude Code in the directory to load the vault tools.

## MCP server (Claude Code integration)

`.mcp.json` is committed at the repo root, so any Claude Code session started from this directory picks it up after `npm install`. Restart Claude Code and eight vault tools become available:

- `vault_search` — keyword matching (title/tag/id)
- `vault_semantic_search` — meaning-based, note-level (best-chunk aggregation)
- `vault_search_chunks` — meaning-based, paragraph/section-level (returns chunk text + heading breadcrumb)
- `vault_read` — full note content by id
- `vault_read_with_context` — note + ranked graph neighbors with snippets (one round-trip)
- `vault_search_chunks_with_context` — chunk search + graph neighbors of the notes hit
- `vault_list` — list notes, optionally filtered by tag
- `vault_related` — 1-hop graph neighbors (backlinks + forward links, IDs only)

Vault location defaults to `./vault`; override with `VAULT_DIR` in `.mcp.json` if needed.

### Semantic search + chunk retrieval

Embeddings run locally via `@huggingface/transformers` + `sqlite-vec` — no API key, no cloud. Notes are chunked on markdown heading boundaries (a chunk = text under one heading, bounded to 100–1500 chars with paragraph-level splitting for oversized sections). Each chunk carries a heading breadcrumb (`# Title > ## Section > ### Subsection`) and any wiki-links it contains. First startup downloads ~22MB of ONNX model weights to `.vault-cache/`; subsequent runs only re-embed notes whose `lastModified` changed.

```bash
# Note-level results (best chunk aggregated per note)
node index.js semantic-search "why SQLite over cloud DB" --limit 3

# Chunk-level results (return just the relevant passages)
node index.js search-chunks "tab throttling" --limit 5
node index.js search-chunks "..." --json   # for scripting
```

### Graph-aware context

Wiki-links form a graph. Fetching a note usually means also wanting its neighbors — forward links (notes it points to) and backlinks (notes that point to it). The `*_with_context` tools return both in one round-trip.

Neighbors are ranked: **bidirectional** (A ↔ B) first, then by **link frequency** (how many chunks actually reference the edge, using the per-chunk `links` array captured during chunking), then by **recency** (`lastModified`), then alphabetically. Each neighbor comes with its intro snippet (the `chunk_idx=0` chunk). A `maxChars` budget caps total snippet bytes — if we run out of room, lower-ranked neighbors are dropped and `truncated: true` is set.

```bash
node index.js read-with-context tempo/technical/decisions/adr-001-local-first-sqlite
node index.js search-with-context "tab throttling" --limit 3 --depth 2
```

## Roadmap

- [x] **MCP server** — vault exposed as MCP tools so Claude Code queries the vault natively instead of grepping files
- [x] **Semantic search** — local embeddings via `@huggingface/transformers` + `sqlite-vec`
- [x] **Chunk-level retrieval** — return the most relevant paragraphs with heading breadcrumbs, not whole files
- [x] **Graph-aware context** — `vault_read_with_context` and `vault_search_chunks_with_context` return ranked neighbors with snippets
- [x] **`claude-vault init`** — one command bootstraps a vault, `.mcp.json`, and `.gitignore` in any repo
- [ ] **npm publish** — install via `npx claude-vault init` without cloning
- [ ] **Public launch** — README polish, demo video, examples

## License

MIT
