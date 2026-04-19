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
- **Frontmatter on every note** — `title`, `tags`, `date`, `description`.
- **Wiki-links are project-scoped**: `[[claude-code-vault/gotchas/gotchas]]`, not `[[gotchas]]`. Keeps links unambiguous once you add more projects.
- **Gotchas are first-class** — put non-obvious traps in `gotchas/`, not buried in design docs. They're what Claude needs to surface before suggesting changes.

## Example frontmatter

```markdown
---
title: My Note Title
tags: [project-name, adr, storage]
date: 2026-04-17
description: One-line summary used in search results and the index
---

# Note Content
```

## Starting a new project

1. `mkdir vault/new-project/`
2. Create `vault/new-project/VAULT_SUMMARY.md` as the index
3. Add type folders as needed (`adrs/`, `designs/`, `features/`, etc.)
4. Point Claude at the new project by saving a memory or adding a line to the project's `CLAUDE.md`

## Web UI (optional)

The React app under `web/` renders the vault as a searchable graph. It needs `lib/server.js` running to index and serve notes. Claude itself does **not** need the backend — it reads markdown directly from disk.
