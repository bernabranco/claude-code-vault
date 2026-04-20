---
id: web-viewer
title: Web viewer architecture
description: The Express + Vite SPA that renders the vault as a browsable knowledge graph in the browser
summary: How lib/server.js boots, what HTTP endpoints it exposes, how it shares the indexer with the CLI/MCP surfaces, and how the Vite-built frontend is served.
type: architecture
status: current
lastVerified: 2026-04-20
tags: [viewer, server, http, express, vite, lib/server.js]
---

# Web viewer architecture

The web viewer is an optional browsing UI for the vault. It runs as a single Express process that both serves a built Vite SPA and exposes a small JSON API over the same indexer used by the CLI and the MCP server.

## Entry point

`lib/server.js` is the full server. There is no separate router module — all routes are declared inline.

## HTTP surface

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/notes` | List all notes; optional `?tag=<name>` filter |
| `GET` | `/api/notes/*` | Read a single note by id (supports nested ids like `architecture/web-viewer`) |
| `GET` | `/api/search` | Keyword search over titles, tags, body |
| `GET` | `/api/graph` | Return the full wiki-link graph for visualization |
| `GET` | `/api/tags` | List every unique tag with counts |
| `POST` | `/api/reindex` | Force a full re-index; returns note count + timestamp |
| `GET` | `*` | SPA fallback — serves `web/dist/index.html` |

The splat route for `/api/notes/*` is intentional — it accepts nested ids, which matters because note ids are path-shaped (e.g. `architecture/mcp-server`).

## Lifecycle

1. Server reads `VAULT_DIR` from env; falls back to `./vault` if unset.
2. Instantiates a `Vault` and calls `reindex()` **before** calling `app.listen`, so the first request never hits an empty index.
3. `chokidar` watches `<vaultDir>/**/*.md` — any add/change/unlink triggers a full reindex.
4. Listens on `PORT` (default `4001`).

## How it shares state with CLI and MCP

All three surfaces (viewer, CLI, MCP) construct their own `Vault` instance against the same filesystem. They do not share memory — instead they share the on-disk `.vault-cache/` and the markdown files themselves. The viewer's chokidar watcher picks up edits made by the CLI within a few hundred milliseconds.

## Frontend pairing

The SPA lives in `web/` and is built with Vite into `web/dist/`. The server serves those static files after mounting the API routes, so a `/api/*` path always wins over the SPA fallback.

Dev mode uses `concurrently` to run the server under `node --watch` alongside the Vite dev server — see [[claude-code-vault/runbooks/npm-scripts]].

## Why Express and not a framework

The viewer has one job: render what the indexer already built. A framework would introduce build-time ceremony and routing conventions that this tiny surface doesn't need. Raw Express + a handful of routes stays close to the data and is easy to read end-to-end.
