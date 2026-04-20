---
id: vault-summary
title: claude-code-vault — vault summary
description: Top-level orientation for the claude-code-vault demo vault — what's in here and where to start
summary: Index and orientation for the claude-code-vault self-docs. Lists every note in this vault and points new readers at the right starting note.
type: overview
status: current
lastVerified: 2026-04-20
tags: [orientation, index]
---

# claude-code-vault demo vault

This vault doubles as documentation for `claude-code-vault` itself and as the retrieval-eval fixture used by `test/retrieval/eval.js`. The notes follow the same conventions any consumer vault should follow: YAML frontmatter, one concept per file, breadcrumb-style headings, wiki-links between notes.

## Where to start

- New here? → [[claude-code-vault/overview]]
- Want to use the search API? → [[claude-code-vault/features/semantic-search]]
- Hitting an install or runtime error? → [[claude-code-vault/gotchas/gotchas]]
- Cutting a release? → [[claude-code-vault/runbooks/publish-release]]
- Confused by a term? → [[claude-code-vault/glossary/core-terms]] or [[shared/glossary/rag-terms]] for cross-project RAG vocabulary
- Curious *why* the stack looks the way it does? → [[claude-code-vault/adrs/adr-001-local-first-embeddings]]
- Looking ahead? → [[claude-code-vault/research/roadmap]]

## Folders

- `adrs/` — architecture decision records, one decision per note
- `architecture/` — how the moving parts fit together
- `features/` — user-facing capabilities and how to invoke them
- `gotchas/` — real failure modes and their fixes
- `runbooks/` — step-by-step operational procedures
- `glossary/` — canonical definitions of domain vocabulary
- `research/` — open questions and forward-looking notes
