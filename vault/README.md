# Claude Code Vault

Local-first markdown vault for giving Claude persistent context across sessions.

## One folder per project, type-first inside

Each project you work on gets its own top-level folder. Inside that folder, notes are grouped by **type** (adr, design, feature, gotcha, research, go-to-market) — not by audience. An LLM looking for *"why did we pick X"* knows to check `adrs/`; looking for *"what can a free user do"* knows to check `go-to-market/`. Stable folder names mean stable retrieval.

```
vault/
├── README.md
├── claude-code-vault/                ← each project is self-contained (this one is the self-docs)
│   ├── VAULT_SUMMARY.md              ← index for this project (Claude reads first)
│   ├── overview.md                   ← the elevator pitch
│   ├── adrs/                         ← Architecture Decision Records
│   │   └── adr-001-local-first-embeddings.md
│   ├── architecture/                 ← system/component architecture notes
│   │   └── mcp-server.md
│   ├── features/                     ← user-facing feature specs
│   │   └── semantic-search.md
│   ├── gotchas/                      ← non-obvious traps, read before shipping
│   │   └── gotchas.md
│   └── research/                     ← thesis, technique survey, roadmap
│       └── llm-first-docs.md
├── another-project/
│   └── ...
└── shared/                           ← (optional) cross-project notes
```

Do not put loose topic folders at the root (`adrs/`, `designs/`, etc.) — they lose their project context. Always nest under a project.

## Folder types

| Folder | What goes here |
|---|---|
| `adrs/` | Architecture Decision Records — why a choice was made, what was rejected, consequences |
| `designs/` | System and component design docs — how something is built |
| `features/` | User-facing feature specs — what the product does, flows, edge cases |
| `gotchas/` | Non-obvious traps that bit you in production; hazards worth reading before touching the code |
| `research/` | Market snapshots, user research, competitive analysis, prior art |
| `go-to-market/` | Pricing, positioning, rollout, sales |
| `runbooks/` | (optional) step-by-step operational procedures — incidents, deploys, backups |

Add folders as needed; skip the ones you don't use.

## Conventions

- **Every project has a `VAULT_SUMMARY.md`** at its root — this is the index Claude reads first.
- **Frontmatter on every note** — see schema below.
- **Wiki-links are project-scoped**: `[[claude-code-vault/gotchas/gotchas]]`, not `[[gotchas]]`. Keeps links unambiguous once you add more projects.
- **Gotchas are first-class** — put non-obvious traps in `gotchas/`, not buried in design docs. They're what Claude needs to surface before suggesting changes.

## Frontmatter schema

All fields are optional except where noted; missing fields fall back to sensible defaults. The parser is additive — older notes keep working.

| Field | Required | Type | Notes |
|---|---|---|---|
| `title` | recommended | string | Falls back to first H1, then file id |
| `tags` | recommended | `[a, b, c]` | Combined with inline `#hashtags` from the body |
| `date` | optional | `YYYY-MM-DD` | When the note was authored. Used by `after`/`before` filters. |
| `description` | optional | string | One-line blurb shown in search results / list views |
| `summary` | optional | string | Longer TL;DR. Falls back to `description` when absent. Future: pinned as chunk-0. |
| `status` | optional | `draft \| current \| stale \| deprecated` | Defaults to `current`. Drives status-aware retrieval (future). |
| `type` | optional | `adr \| feature \| gotcha \| runbook \| glossary \| overview \| architecture \| research` | Enables typed-note schemas (future). Unknown values warn on stderr. |
| `lastVerified` | optional | `YYYY-MM-DD` | Last time the note's claims were checked against reality. Distinct from file mtime. |

## Example frontmatter

```markdown
---
title: My Note Title
tags: [project-name, adr, storage]
date: 2026-04-17
description: One-line summary used in search results and the index
summary: Longer TL;DR — what this note tells you and when to read it
status: current
type: adr
lastVerified: 2026-04-20
---

# Note Content
```

## Per-type note schemas

When a note sets `type:`, the linter enforces a minimal body schema for that type. The goal is predictable retrieval — chunks have the same breadcrumbs and bold labels across notes of the same kind, so keyword search finds them and LLMs can scan them consistently.

Scaffold a new note with the right shape via `claude-code-vault add <path> "<title>" --type <t>`.

| Type | Required structure | Rationale |
|---|---|---|
| `adr` | H2 sections: `## Context`, `## Decision`, `## Alternatives`, `## Consequences` | Standard ADR format; these are the four questions every decision record answers. |
| `feature` | H2 sections: `## What`, `## Why`, `## How` | Enough to explain a user-visible feature without prescribing a rigid template. |
| `runbook` | An `## Steps` H2, and at least one `### Verify` H3 subsection | Every step should be independently verifiable — no blind runbooks. |
| `gotcha` | Each H2 section contains bold labels `**Symptom**`, `**Cause**`, `**Fix**` | Gotchas are scanned under pressure; the labels make the triage info findable. |
| `glossary` | Frontmatter `terms: [A, B, C]` list, and a matching `## A`, `## B`, `## C` H2 for each | Declarative term list lets the linter catch drift between what's declared and what's defined. |
| `overview` / `architecture` / `research` | No body schema — only the universal frontmatter rules apply | These are free-form narrative; forcing structure would hurt more than help. |

Types not in the table above warn as `unknown-type`. See [[claude-code-vault/gotchas/gotchas]] for the full enum.

## Starting a new project

1. `mkdir vault/new-project/`
2. Create `vault/new-project/VAULT_SUMMARY.md` as the index
3. Add type folders as needed (`adrs/`, `designs/`, `features/`, etc.)
4. Point Claude at the new project by saving a memory or adding a line to the project's `CLAUDE.md`

## Web UI (optional)

The React app under `web/` renders the vault as a searchable graph. It needs `lib/server.js` running to index and serve notes. Claude itself does **not** need the backend — it reads markdown directly from disk.
