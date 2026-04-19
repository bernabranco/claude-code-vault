---
id: adr-001-local-first-embeddings
title: ADR-001 — local-first embeddings with MiniLM + sqlite-vec
description: Why claude-code-vault embeds on-device with a small sentence-transformer rather than calling a remote embedding API
type: adr
status: accepted
date: 2026-03-01
tags: [decision, embeddings, local-first]
---

# ADR-001 — local-first embeddings with MiniLM + sqlite-vec

## Context

The package is pitched as "local-first." That promise breaks if the first thing a fresh install does is call out to a paid embedding API. We needed a way to compute embeddings and run vector search without any network round-trip after model download.

## Decision

- **Embedding model:** `Xenova/all-MiniLM-L6-v2` (384-dim) loaded via `@huggingface/transformers`.
- **Vector store:** `sqlite-vec` (`vec0` virtual table) inside the same `better-sqlite3` database that holds the chunk and note metadata.
- **Cache location:** `.vault-cache/embeddings-vN.db` (filename versioned — see [[claude-code-vault/gotchas/gotchas]] on cache filename bumps).

## Rationale

- **No API key required.** The package works the moment `npm install` finishes and the model has downloaded once (~25 MB).
- **One file = one index.** SQLite is the only durable artifact. Wipe `.vault-cache/` to fully reset.
- **Filter and rank in one query.** sqlite-vec lets us pre-filter rowids by tag / date / type / id-prefix, then KNN-rank inside the filtered set. No second-pass filtering in JS. See [[claude-code-vault/architecture/embeddings-pipeline]].
- **Small enough to ship anywhere.** MiniLM-L6 runs in ~100 ms per chunk on a laptop CPU. Larger models are not worth the trade for a personal vault.

## Trade-offs accepted

- Recall on jargon-heavy queries is lower than a frontier model would give. Mitigated by [[claude-code-vault/features/semantic-search]]'s opt-in HyDE flag, which uses Anthropic's API only when the user explicitly asks for it.
- Re-embedding the whole vault on a model change is expensive. Mitigated by versioning the cache filename so old indexes are abandoned cleanly rather than silently corrupted.
- `better-sqlite3` is a native module — version bumps occasionally break installs on fresh machines. See [[claude-code-vault/gotchas/gotchas]].
