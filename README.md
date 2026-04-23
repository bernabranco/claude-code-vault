<div align="center">

# claude-code-vault

**A markdown knowledge base that Claude Code can search, read, and write — via MCP.**

[![npm version](https://img.shields.io/npm/v/claude-code-vault.svg)](https://www.npmjs.com/package/claude-code-vault)
[![CI](https://github.com/bernabranco/claude-code-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/bernabranco/claude-code-vault/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2)](https://modelcontextprotocol.io)

</div>

---

Claude Code is good at writing code but starts every session cold — no memory of decisions made, bugs already investigated, or patterns that matter in your repo. `claude-code-vault` gives it a persistent, searchable memory.

You write notes in plain markdown. The vault exposes them to Claude as **8 MCP tools** — keyword search, semantic search, graph-aware context, and write-back. Claude finds relevant notes automatically rather than grepping files or asking you to repeat yourself.

> ⚠️ **Status: early, active development.** MIT-licensed, source you can read.

<p align="center">
  <img src="assets/print2.jpg" alt="claude-code-vault web UI showing a force-directed graph of wiki-linked notes" width="100%" />
  <br />
  <sub><em>The self-docs vault as a graph — every wiki-link is an edge, every note a node.</em></sub>
</p>

## Bootstrap in any repo

```bash
npx claude-code-vault init [project-name]
```

This creates:
- `vault/<project>/` — folder structure (`adrs/`, `features/`, `gotchas/`, `research/`) with a stub `VAULT_SUMMARY.md`
- `.mcp.json` — wires Claude Code to the vault's MCP server
- `.gitignore` entry for `.vault-cache/` (local embeddings DB)

Restart Claude Code in the directory and the vault tools are available. Idempotent — safe to re-run.

## What Claude can do with the vault

| Tool | What it does |
|---|---|
| `vault_search` | Keyword search across titles, tags, and body |
| `vault_semantic_search` | Meaning-based search — finds relevant notes even with different wording |
| `vault_search_chunks` | Returns the specific paragraph that answers the query, not the whole file |
| `vault_read` | Full note content by ID |
| `vault_read_with_context` | Note + ranked wiki-link neighbors in one round-trip |
| `vault_search_chunks_with_context` | Chunk search + graph neighbors of the matched notes |
| `vault_list` | List notes, optionally filtered by tag |
| `vault_related` | 1-hop graph neighbors (backlinks + forward links) |

Search tools return a `{ results, truncated }` envelope with a `maxChars` budget (default 8000 chars). The top result is always returned even if it alone exceeds the budget.

Embeddings run **locally** via `@huggingface/transformers` + `sqlite-vec` — no API key, no cloud. First startup downloads ~22 MB of model weights; subsequent runs only re-embed changed notes.

## Write-back

Claude can add and update notes directly:

| Tool | What it does |
|---|---|
| `vault_create_note` | Create a new note with schema validation |
| `vault_write` | Overwrite a note |
| `vault_append_section` | Add content under a heading |
| `vault_replace_section` | Replace content under a heading |
| `vault_lint` | Run the linter and return findings |

## Vault structure

```
vault/
└── <project>/
    ├── VAULT_SUMMARY.md    ← Claude reads this first as the index
    ├── overview.md
    ├── adrs/               ← Architecture Decision Records
    ├── features/           ← feature specs
    ├── gotchas/            ← non-obvious traps
    └── research/           ← open questions, exploration
```

Notes use YAML frontmatter (`title`, `tags`, `description`, `date`, `status`, `type`). Wiki-links (`[[other-note]]`) form a graph that the `*_with_context` tools traverse. Notes with `status: deprecated` are excluded from retrieval; `status: stale` are downranked.

## Hooks (optional)

Three Claude Code hooks ship with the package to reinforce vault use:

**Vault-first reminder** — on the first Grep or Glob per session, emits a one-time nudge to try `vault_semantic_search` first. Never blocks.

**Subagent gate** — blocks subagent spawns if no `vault_*` tool was called in the last 20 tool uses. Subagents start cold; vault context should come before them.

**End-of-session gap report** — if the session edited ≥ 3 files but called zero vault tools, prints a reminder to `vault_create_note` on the way out. Visible to you, not injected into the model.

Wire them in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Grep|Glob",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-first-reminder.mjs" }]
      },
      {
        "matcher": "Agent|Task",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-first-subagent.mjs" }]
      }
    ],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node ${CLAUDE_PROJECT_DIR}/node_modules/claude-code-vault/hooks/vault-gap-report.mjs" }] }]
  }
}
```

Disable all hooks with `CLAUDE_VAULT_HOOK_DISABLE=1`.

## Web UI (optional)

Browse the vault in a browser — force-directed graph + note reader + lint panel.

```bash
npm install
node lib/server.js          # http://localhost:4001
cd web && npm run dev       # http://localhost:5173
```

<p align="center">
  <img src="assets/print1.jpg" alt="Note reader view — folder tree, rendered markdown, frontmatter sidebar" width="100%" />
  <br />
  <sub><em>Reader view — folder tree, rendered markdown, frontmatter on the right.</em></sub>
</p>

## CLI

```bash
node index.js semantic-search "why SQLite over cloud DB" --limit 3
node index.js search-chunks "tab throttling" --limit 5
node index.js lint              # exits 1 on errors
node index.js index             # re-index vault
```

## Roadmap

- [x] MCP server with 8 vault tools
- [x] Semantic search + chunk-level retrieval (local embeddings, no API key)
- [x] Graph-aware context (`*_with_context` tools)
- [x] `claude-code-vault init` bootstrap
- [x] Write-back tools (`vault_write`, `vault_create_note`, section edit)
- [x] Vault linter (`vault_lint` + CLI)
- [x] Hooks (vault-first reminder, subagent gate, gap report)
- [x] HyDE query expansion, status-aware retrieval, char budgets
- [x] Retrieval eval harness with CI gate
- [ ] Hybrid search (keyword + semantic via RRF)
- [ ] Reranker (cross-encoder pass over top-K)
- [ ] Federated search across multiple projects

Full tracker: [#33](https://github.com/bernabranco/claude-code-vault/issues/33).

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and workflow. All contributors agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
