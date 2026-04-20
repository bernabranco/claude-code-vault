---
id: gotchas
title: Gotchas
description: Real failure modes you'll hit when running, installing, or extending claude-code-vault, and the fix for each
summary: Real failure modes — NODE_MODULE_VERSION, sqlite-vec rowid ambiguity, cache filename bumps, MCP stdout discipline, chokidar reindex behavior, ANTHROPIC_API_KEY hygiene, no --no-verify or --squash, vault gap matcher quirks. Read before shipping.
type: gotcha
status: current
lastVerified: 2026-04-20
tags: [troubleshooting, install, runtime]
---

# Gotchas

Each gotcha is one H2 section so it can be retrieved on its own. Every section follows the **Symptom / Cause / Fix** schema enforced by the linter.

## `NODE_MODULE_VERSION` mismatch on install

**Symptom**: `Error: The module was compiled against a different Node.js version` from `better-sqlite3`.

**Cause**: `better-sqlite3` is a native module pinned to a Node ABI. Installing on Node 20 and running on Node 22 (or vice versa) breaks.

**Fix**: `rm -rf node_modules .vault-cache && npm install` on the Node version you actually run with. Use `node --version` to confirm.

## sqlite-vec rowid must be qualified

**Symptom**: `ambiguous column: rowid` when joining `vec_chunks` with `note_chunks`.

**Cause**: `sqlite-vec`'s `vec0` virtual table exposes `rowid` and so does `note_chunks`. Unqualified `rowid` is rejected.

**Fix**: always write `v.rowid` and `c.rowid` explicitly in joins. See the SQL in [[claude-code-vault/architecture/embeddings-pipeline]].

## Cache filename bump required after schema or model changes

**Symptom**: weird ranking, missing chunks, or runtime errors after pulling a new version.

**Cause**: `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables — schema changes don't apply on top of an old DB.

**Fix**: any change to schema, chunking, or embedding model bumps the cache filename (e.g. `embeddings-v2.db` → `embeddings-v3.db`). Old DB is abandoned, not migrated. Users delete `.vault-cache/` to fully reset.

## Stdout discipline in the MCP server

**Symptom**: MCP client reports "invalid JSON-RPC frame" and disconnects.

**Cause**: anything written to `stdout` from the server process collides with the JSON-RPC stream.

**Fix**: all logs go through `console.error` (stderr). Never `console.log` from server code paths. Same applies to dependencies — vet any new package that might log to stdout.

## `chokidar` reindexes the whole file on every save

**Symptom**: editor "save on keypress" plugins cause CPU spikes during indexing.

**Cause**: each save event triggers a per-file reindex. There is no debounce by design — staleness during a typing session is worse than CPU.

**Fix**: this is intentional. If you genuinely need debouncing, wrap the watcher in your own consumer; don't change the library default.

## `ANTHROPIC_API_KEY` leaks if committed

**Symptom**: API key visible in git history or on GitHub after a push.

**Cause**: HyDE reads `ANTHROPIC_API_KEY` from the environment; a committed `.env` ships it too. The codebase never logs the key value, but the file itself would leak.

**Fix**: keep the key in `.env` (already in `.gitignore`) or your shell profile. If it lands in history, rotate the key before anything else — purging history doesn't recall copies.

## Never `--no-verify` or `--squash`

**Symptom**: history loses per-commit context; PR references in docs go stale.

**Cause**: squash-merging collapses the commit trail that this repo's docs point at, and `--no-verify` skips the hooks that catch the breakage before it ships.

**Fix**: merge PRs with `gh pr merge --merge --delete-branch`. Always run pre-commit hooks. If a hook fails, fix the root cause — don't bypass it.

## `vault gap` reports a note as uncovered despite semantic coverage

**Symptom**: A surface like `lib/server.js` lands in `mentioned` or `uncovered` even though a dedicated note exists describing it.

**Cause**: The matcher is deliberately strict — "covered" requires the surface's normalized token (e.g. `lib server`) to appear as a substring of a note's id, title, tag, or wiki-link target. Note bodies are checked separately as the weaker "mentioned" signal. A note titled "Web viewer architecture" with id `web-viewer` semantically covers `lib/server.js` but doesn't satisfy the tokenic match. Strictness is by design: looser matching would false-positive constantly on common words like `server`, `config`, `utils`.

**Fix**: add the surface name as a tag in the note's frontmatter — `tags: [viewer, server, lib/server.js]`. Tags double as accurate metadata and as matcher-visible tokens. See `vault/claude-code-vault/architecture/web-viewer.md` for the pattern.

## `vault gap` only detects modules under `src/`

**Symptom**: Running `vault gap` on a monorepo with `packages/<name>` or `apps/<name>` layouts reports zero source modules.

**Cause**: `detectSurfaces` in `lib/gap-analyzer.js` hardcodes `parts[0] === "src"` when extracting top-level module names. Repos using `packages/`, `apps/`, `lib/` at the root, or a flat layout get no src-module surfaces. Route files and schemas still get detected via content/filename heuristics; only the `src-module` dimension silently collapses.

**Fix**: known limitation — a future config option (`--roots src,packages,apps`) will make this user-tunable. For now, route and schema surfaces still give useful coverage signal on non-standard layouts.

## `vault gap` flags a file as a route because of commented-out code

**Symptom**: A test fixture or example file with commented-out `app.get('/example', ...)` is classified as a `route-file`.

**Cause**: Route detection uses regex (`app.(get|post|...)(`, `router.(get|post|...)(`, framework decorators) against file content. `stripComments` removes `//` and `/* */` comments, but matches inside string literals (e.g. `const doc = "app.get is used for..."` or multi-line template strings) still trigger the regex. Note: the analyzer's own test file `test/gap-analyzer.test.js` is a known self-inflicted case — its fixtures contain `router.get(...)` strings.

**Fix**: accept as-is for now — the heuristic is intentionally loose. If a false-positive becomes painful, either rename the file out of the route-candidate extension set or move the example code into a markdown fence (which isn't scanned).

