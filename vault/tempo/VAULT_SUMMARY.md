---
title: Tempo Vault — Index
tags: [tempo, documentation, index]
date: 2026-04-17
description: Navigation guide for the Tempo vault. Start here when opening a fresh Claude session.
---

# Tempo Vault — Index

Everything you'd tell a new engineer about Tempo lives here. **Start with this file** in a fresh Claude session — then follow the links.

> Tempo is a fake product used as a demo vault. It's a focus/Pomodoro timer SaaS with a local-first desktop + web client. Nothing here is real.

## 🗂️ Three Drawers

- **`technical/`** — code, architecture, features, ADRs, gotchas
- **`strategy/`** — research, product direction
- **`business/`** — pricing, rollout

Top-level files (`overview.md`, `VAULT_SUMMARY.md`) stay at the root as entry points.

## 📚 Documents

### Root
- [[tempo/overview]] — product summary, tech stack, quick start

### Technical — Architecture
- [[tempo/technical/architecture/frontend-architecture]] — React, Zustand, Web Workers, SQLite WASM
- [[tempo/technical/architecture/gotchas]] — **read before shipping**: tab-throttling traps, SQLite WAL quirks

### Technical — Features
- [[tempo/technical/features/focus-sessions]] — the core "start a session" flow

### Technical — Decisions (ADRs)
- [[tempo/technical/decisions/adr-001-local-first-sqlite]] — why SQLite-in-browser over a cloud DB
- [[tempo/technical/decisions/adr-002-web-workers-for-timers]] — why timers run in a Worker

### Strategy
- [[tempo/strategy/research/productivity-market-2026]] — focus-app landscape in 2026

### Business
- [[tempo/business/pricing]] — Free + Pro tiers, upgrade gates

## Conventions

- Wiki-links are **project-scoped**: `[[tempo/technical/architecture/gotchas]]`, never `[[gotchas]]`.
- Every note has frontmatter (`title`, `tags`, `date`, `description`).
- Non-obvious traps go in `gotchas.md`, not mixed into architecture docs.
