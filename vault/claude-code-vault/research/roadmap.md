---
id: roadmap
title: Roadmap
description: What's shipped, what's next, and what's deliberately out of scope for claude-code-vault
summary: Shipped so far (filter-before-rank, heading-aware chunking, HyDE, eval harness), near-term retrieval and ergonomics work, and the deliberate non-goals (not Obsidian, not a vector DB, not a remote service).
type: research
status: current
lastVerified: 2026-04-20
tags: [roadmap, planning]
---

# Roadmap

## Recently shipped

- Filter-before-rank in sqlite-vec — see [[claude-code-vault/architecture/embeddings-pipeline]].
- Heading-aware chunking with breadcrumb-prepended embedding input.
- Opt-in HyDE for vocabulary-gap queries — see [[claude-code-vault/features/semantic-search]].
- Retrieval eval harness with recall@5 / MRR@5 baselines and a 5pp regression gate in CI.

## Near-term — retrieval quality

- Query classifier so HyDE only fires on queries that look like they need it (keyword-shaped queries skip it).
- Cross-encoder rerank as an opt-in second pass when precision matters more than latency.
- Better gold dataset coverage — the current set is small and self-referential.

## Near-term — ergonomics

- Per-query result preview in the web viewer, not just the note list.
- Better error messages on cache-version mismatches (currently the only signal is a thrown error).

## Mid-term — ecosystem

- Polish the MCP tool descriptions so they're idiomatic for non-Claude clients.
- Document a vault-authoring guide separate from these self-docs.

## Out of scope

These come up as feature requests but are deliberate non-goals:

- **Not Obsidian.** No plugin system, no graph view, no editor. Use whatever editor you like; this tool reads the markdown.
- **Not a vector database.** sqlite-vec is enough for the personal-vault scale this is built for. If you need millions of vectors, use Qdrant or LanceDB.
- **Not a remote service.** No hosted version. The local-first promise is the product.
- **Not a docs generator.** The tool reads notes, it doesn't write them. See the gotchas note for the conventions a vault should follow.
