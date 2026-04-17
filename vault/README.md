# Claude Code Vault

Local-first markdown vault for giving Claude persistent context across sessions.

## One Folder Per Project

Each project you work on gets its own top-level folder. Everything about that project — architecture, decisions, research, features, gotchas — lives inside it.

```
vault/
├── README.md
├── tempo/                    ← each project is self-contained (this one is the demo)
│   ├── VAULT_SUMMARY.md      ← index for this project (Claude reads first)
│   ├── overview.md
│   ├── technical/
│   │   ├── architecture/
│   │   │   ├── frontend-architecture.md
│   │   │   └── gotchas.md
│   │   ├── decisions/        ← ADRs
│   │   └── features/
│   ├── strategy/
│   │   └── research/
│   └── business/
├── another-project/
│   └── ...
└── shared/                   ← (optional) cross-project notes
```

Do not put loose topic folders at the root (`architecture/`, `decisions/`, etc.) — they lose their project context. Always nest under a project.

## Conventions

- **Every project has a `VAULT_SUMMARY.md`** at its root — this is the index Claude reads first.
- **Frontmatter on every note** — `title`, `tags`, `date`, `description`.
- **Backlinks are project-scoped**: `[[tempo/technical/architecture/gotchas]]`, not `[[gotchas]]`. Keeps links unambiguous once you add more projects.
- **`architecture/gotchas.md` is high-leverage** — put non-obvious traps there (the things that bite you in production), not in the main architecture docs.

## Example Frontmatter

```markdown
---
title: My Note Title
tags: [project-name, architecture, firebase]
date: 2026-04-17
description: One-line summary used in search results and the index
---

# Note Content
```

## Starting a New Project Drawer

1. `mkdir vault/new-project/`
2. Create `vault/new-project/VAULT_SUMMARY.md` as the index
3. Add subfolders as needed (`architecture/`, `features/`, etc.)
4. Point Claude at the new project by saving a memory or adding a line to the project's `CLAUDE.md`

## Web UI (Optional)

The React app under `web/` renders the vault as a searchable graph. It needs `lib/server.js` running to index and serve notes. Claude itself does **not** need the backend — it reads markdown directly from disk.
