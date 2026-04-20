---
id: adr-001-local-first-embeddings
title: ADR-001 — local-first embeddings with MiniLM + sqlite-vec
description: Why claude-code-vault embeds on-device with a small sentence-transformer rather than calling a remote embedding API
summary: Decision (accepted 2026-03-01) to embed on-device with all-MiniLM-L6-v2 + sqlite-vec rather than call a remote embedding API. Trade-off accepted: 384-dim recall ceiling in exchange for no API key, no network, and no per-query cost.
type: adr
status: current
date: 2026-03-01
lastVerified: 2026-04-20
tags: [decision, embeddings, local-first]
---

# ADR-001 — local-first embeddings with MiniLM + sqlite-vec

## Context

The package is pitched as "local-first." That promise breaks if the first thing a fresh install does is call out to a paid embedding API. We needed a way to compute embeddings and run vector search without any network round-trip after model download.

## Decision

- **Embedding model:** `Xenova/all-MiniLM-L6-v2` (384-dim) loaded via `@huggingface/transformers`.
- **Vector store:** `sqlite-vec` (`vec0` virtual table) inside the same `better-sqlite3` database that holds the chunk and note metadata.
- **Cache location:** `.vault-cache/embeddings-vN.db` (filename versioned — see [[claude-code-vault/gotchas/gotchas]] on cache filename bumps).

Why this beats the alternatives:

- **No API key required.** The package works the moment `npm install` finishes and the model has downloaded once (~25 MB).
- **One file = one index.** SQLite is the only durable artifact. Wipe `.vault-cache/` to fully reset.
- **Filter and rank in one query.** sqlite-vec lets us pre-filter rowids by tag / date / type / id-prefix, then KNN-rank inside the filtered set. No second-pass filtering in JS. See [[claude-code-vault/architecture/embeddings-pipeline]].
- **Small enough to ship anywhere.** MiniLM-L6 runs in ~100 ms per chunk on a laptop CPU. Larger models are not worth the trade for a personal vault.

## Alternatives

- **Remote embedding API (OpenAI `text-embedding-3-small`, Voyage, Cohere).** Higher recall, especially on jargon. Rejected because it requires an API key on first run, incurs per-query cost, and makes the package unusable offline or in air-gapped environments — breaking the "local-first" promise.
- **Larger on-device model (e.g. `bge-large-en`, 1024-dim).** Better recall. Rejected because embed time jumps ~4× on a laptop CPU and the cache file grows proportionally; the recall gain does not justify the friction for a personal-vault workload.
- **No vector search at all — only keyword search.** Simplest. Rejected because users routinely phrase queries that don't share lexical tokens with the target note (e.g. "why is install slow" → note titled "NODE_MODULE_VERSION mismatch").
- **Separate vector DB (Chroma, Qdrant, LanceDB).** More featureful. Rejected because it adds a second durable artifact, a second install step, and usually a daemon — all of which fight the "one `npm install` and go" posture.

## Consequences

- Recall on jargon-heavy queries is lower than a frontier model would give. Mitigated by [[claude-code-vault/features/semantic-search]]'s opt-in HyDE flag, which uses Anthropic's API only when the user explicitly asks for it.
- Re-embedding the whole vault on a model change is expensive. Mitigated by versioning the cache filename so old indexes are abandoned cleanly rather than silently corrupted.
- `better-sqlite3` is a native module — version bumps occasionally break installs on fresh machines. See [[claude-code-vault/gotchas/gotchas]].
- Model download (~25 MB) happens on first run; CI environments that don't cache `node_modules` or the Hugging Face cache pay it every build.
