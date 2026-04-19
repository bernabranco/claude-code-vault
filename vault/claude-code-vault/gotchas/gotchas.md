---
id: gotchas
title: Gotchas
description: Real failure modes you'll hit when running, installing, or extending claude-code-vault, and the fix for each
type: gotchas
tags: [troubleshooting, install, runtime]
---

# Gotchas

Each gotcha is one section so it can be retrieved on its own.

## `NODE_MODULE_VERSION` mismatch on install

Symptom: `Error: The module was compiled against a different Node.js version` from `better-sqlite3`.

Cause: `better-sqlite3` is a native module pinned to a Node ABI. Installing on Node 20 and running on Node 22 (or vice versa) breaks.

Fix: `rm -rf node_modules .vault-cache && npm install` on the Node version you actually run with. Use `node --version` to confirm.

## sqlite-vec rowid must be qualified

Symptom: `ambiguous column: rowid` when joining `vec_chunks` with `note_chunks`.

Cause: `sqlite-vec`'s `vec0` virtual table exposes `rowid` and so does `note_chunks`. Unqualified `rowid` is rejected.

Fix: always write `v.rowid` and `c.rowid` explicitly in joins. See the SQL in [[claude-code-vault/architecture/embeddings-pipeline]].

## Cache filename bump required after schema or model changes

Symptom: weird ranking, missing chunks, or runtime errors after pulling a new version.

Cause: `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables — schema changes don't apply on top of an old DB.

Fix: any change to schema, chunking, or embedding model bumps the cache filename (e.g. `embeddings-v2.db` → `embeddings-v3.db`). Old DB is abandoned, not migrated. Users delete `.vault-cache/` to fully reset.

## Stdout discipline in the MCP server

Symptom: MCP client reports "invalid JSON-RPC frame" and disconnects.

Cause: anything written to `stdout` from the server process collides with the JSON-RPC stream.

Fix: all logs go through `console.error` (stderr). Never `console.log` from server code paths. Same applies to dependencies — vet any new package that might log to stdout.

## `chokidar` reindexes the whole file on every save

Symptom: editor "save on keypress" plugins cause CPU spikes during indexing.

Cause: each save event triggers a per-file reindex. There is no debounce by design — staleness during a typing session is worse than CPU.

Fix: this is intentional. If you genuinely need debouncing, wrap the watcher in your own consumer; don't change the library default.

## `ANTHROPIC_API_KEY` should never be committed

The HyDE feature reads `ANTHROPIC_API_KEY` from the environment when enabled. Keep it in `.env` (already gitignored) or your shell profile. The codebase never logs the key value, but a leaked `.env` would still leak it.

## Don't `--no-verify` or `--squash`

Project convention: always run pre-commit hooks; always merge PRs with `gh pr merge --merge` (no squash). Squash-merging this repo loses the per-commit context that the docs reference.
