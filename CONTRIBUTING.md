# Contributing

Thanks for taking the time to contribute. This is an early project — small, focused PRs are easier to review and more likely to land.

## Dev setup

```bash
git clone https://github.com/bernabranco/claude-vault.git
cd claude-vault
npm install
cd web && npm install && cd ..
```

Node 20+ required. The `better-sqlite3` native module compiles on install.

## Running locally

```bash
# MCP server (stdio) — used by Claude Code via .mcp.json
node lib/mcp.js

# Web UI (browser graph viewer)
node lib/server.js           # backend → http://localhost:4001
cd web && npm run dev        # frontend → http://localhost:5173

# CLI
node index.js --help
node index.js semantic-search "why SQLite over cloud DB"
```

## Before opening a PR

Run the same checks CI runs:

```bash
npx tsc --noEmit --allowJs --skipLibCheck index.js lib/*.js
cd web && npx tsc --noEmit && cd ..
npm run build
node index.js index
node index.js search "architecture" --limit 3
```

If those all pass locally, CI should pass too.

## Workflow

1. **Branch off `main`**: `git checkout -b feat/your-thing`
2. **Commit style**: conventional-ish prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`). Short imperative subject, body optional.
3. **Open a PR** against `main`. CI will run — wait for green before asking for review.
4. **Merge** via `gh pr merge --merge` (preserves history — this project doesn't squash).

## Reporting bugs

Open a GitHub issue with:
- What you were trying to do
- What happened vs. what you expected
- Node version, OS, and anything in `.vault-cache/embeddings.db` state that might matter
- Minimal repro if possible

## Scope notes

- **Keep the MCP server surface small.** Eight tools today — adding a ninth is a deliberate choice, not a default. New tools should have a clear reason they can't be composed from existing ones.
- **Local-first stays.** No cloud calls on the critical path. Embeddings run locally, data stays on disk.
- **Markdown is the source of truth.** The database is a cache. If the cache disagrees with the files, the files win.

## Questions

Open a GitHub discussion or issue. Early-stage project — I'd rather talk than guess what you need.
