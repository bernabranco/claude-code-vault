---
id: core-terms
title: Core terms
description: Vocabulary used throughout the claude-code-vault codebase and docs
summary: Glossary — Vault, Note, Chunk, Backlink, HyDE, MCP, Embedding, Cache. Each term has its own H2 section matching the frontmatter `terms:` list so the linter can verify coverage.
type: glossary
status: current
lastVerified: 2026-04-20
tags: [glossary, reference]
terms: [Vault, Note, Chunk, Backlink, HyDE, MCP, Embedding, Cache]
---

# Core terms

This note is the canonical source for domain vocabulary in `claude-code-vault`. Each term has its own H2 section so retrieval can return the definition on its own, and the frontmatter `terms:` list lets the linter catch drift between the declared vocabulary and what the file actually defines.

## Vault

A directory of markdown notes that `claude-code-vault` indexes, searches, and exposes to Claude. One working copy typically holds one Vault; large projects may nest sub-vaults by folder.

## Note

A single `.md` file inside a Vault, with YAML frontmatter on top and markdown body below. The unit of retrieval for `vault_list` and the unit of similarity for `vault_related`.

## Chunk

A sub-note slice produced by the embeddings pipeline — roughly one H2 or H3 section. Chunks are what `search-chunks` ranks; they're smaller than Notes so retrieval can point at the right paragraph instead of the whole file.

## Backlink

A `[[note-id]]` reference from one Note to another, tracked as a directed edge in the vault graph. Used by `vault_related` and by the orphan-detection rule in the linter.

## HyDE

"Hypothetical Document Embeddings" — an optional query expansion that asks an LLM to draft a plausible answer, then embeds *that* answer instead of the raw question. Enabled with `--hyde`; requires `ANTHROPIC_API_KEY`.

## MCP

Model Context Protocol — the JSON-RPC-over-stdio protocol Claude Code uses to talk to external tools. `claude-code-vault mcp` starts an MCP server that exposes vault operations as tools.

## Embedding

A dense vector representing a Chunk's meaning, produced by a local model and stored in a SQLite table via `sqlite-vec`. Similarity is cosine distance between embeddings.

## Cache

The `.vault-cache/` directory that stores the embeddings DB. Filename encodes schema version (`embeddings-v2.db`); bumping the schema means writing a new filename and abandoning the old one. See [[claude-code-vault/gotchas/gotchas]].
