---
id: npm-scripts
title: npm scripts reference
description: What each package.json script does and when to run it
summary: Canonical reference for every script in package.json — dev vs start, the setup script, vault:* commands, and how they relate to the CLI, MCP server, and web viewer.
type: runbook
status: current
lastVerified: 2026-04-20
tags: [runbook, scripts, cli, dev, build, start, setup, vault:index, vault:list, vault:search, vault:export]
---

# npm scripts reference

All scripts in `package.json` and when to use each.

## Development

| Script | Command | When to use |
|--------|---------|-------------|
| `dev` | `concurrently "node --watch lib/server.js" "cd web && npm run dev"` | Active development — runs the API server under `node --watch` and the Vite dev server for the web viewer in parallel |
| `build` | `cd web && npm run build` | Build the web viewer SPA into `web/dist/` before `start` or release |
| `start` | `node lib/server.js` | Run the web viewer in production mode (expects `web/dist/` to exist) |
| `setup` | `npm install && cd web && npm install` | First-time setup — installs root deps **and** web/ deps in one shot |

## MCP server

| Script | Command | When to use |
|--------|---------|-------------|
| `mcp` | `node lib/mcp.js` | Run the stdio MCP server — normally invoked by Claude Desktop / Claude Code via their MCP config, not manually |

## CLI

| Script | Command | When to use |
|--------|---------|-------------|
| `cli` | `node index.js` | Entry point for the CLI; prefer calling `claude-code-vault` directly once installed |
| `vault:index` | `node index.js index` | Rebuild the `.vault-cache/` SQLite index — rarely needed; the viewer and MCP server re-index on startup |
| `vault:list` | `node index.js list` | List every note with frontmatter — useful for debugging ids and tags |
| `vault:search` | `node index.js search <query>` | Keyword search from the terminal without booting the viewer |
| `vault:export` | `node index.js export` | Emit the full vault as JSON for external tooling or backups |

## Which one do I actually run?

- **Writing notes day-to-day:** `npm run dev`, then edit markdown, let chokidar reindex.
- **Checking what's in the vault from the terminal:** `npm run vault:list` or `npm run vault:search "<query>"`.
- **Shipping the tarball:** `npm run build` then `npm publish` — see [[claude-code-vault/runbooks/publish-release]].
- **Running under Claude Desktop:** the `mcp` script, wired via the MCP config. Never run it in a terminal expecting output — stdout is reserved for JSON-RPC.

See [[claude-code-vault/architecture/web-viewer]] for how `start` and `dev` wire up, and [[claude-code-vault/architecture/mcp-server]] for the `mcp` path.
