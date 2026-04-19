---
title: Tempo Vault — Index
tags: [tempo, documentation, index]
date: 2026-04-17
description: Navigation guide for the Tempo vault. Start here when opening a fresh Claude session.
---

# Tempo Vault — Index

Everything you'd tell a new engineer about Tempo lives here. **Start with this file** in a fresh Claude session — then follow the links.

> Tempo is a fake product used as a demo vault. It's a focus/Pomodoro timer SaaS with a local-first desktop + web client. Nothing here is real.

## 🗂️ Folders

One folder per content type. Each folder holds one kind of note so an LLM can jump straight to the right drawer without guessing.

- **`adrs/`** — Architecture Decision Records (why a choice was made)
- **`designs/`** — system/architecture designs (how it's built)
- **`features/`** — user-facing feature specs (what the product does)
- **`gotchas/`** — non-obvious traps worth reading before shipping
- **`research/`** — market, user, and prior-art research
- **`go-to-market/`** — pricing, positioning, rollout

Top-level files (`overview.md`, `VAULT_SUMMARY.md`) stay at the root as entry points.

## 📚 Documents

### Root
- [[tempo/overview]] — product summary, tech stack, quick start

### Designs
- [[tempo/designs/frontend-architecture]] — React, Zustand, Web Workers, SQLite WASM

### Features
- [[tempo/features/focus-sessions]] — the core "start a session" flow

### ADRs
- [[tempo/adrs/adr-001-local-first-sqlite]] — why SQLite-in-browser over a cloud DB
- [[tempo/adrs/adr-002-web-workers-for-timers]] — why timers run in a Worker

### Gotchas
- [[tempo/gotchas/gotchas]] — **read before shipping**: tab-throttling traps, SQLite WAL quirks

### Research
- [[tempo/research/productivity-market-2026]] — focus-app landscape in 2026

### Go-to-market
- [[tempo/go-to-market/pricing]] — Free + Pro tiers, upgrade gates

## Conventions

- Wiki-links are **project-scoped**: `[[tempo/gotchas/gotchas]]`, never `[[gotchas]]`.
- Every note has frontmatter (`title`, `tags`, `date`, `description`).
- Non-obvious traps go in `gotchas/`, not mixed into design docs.
