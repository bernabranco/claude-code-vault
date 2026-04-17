---
title: Tempo Overview
tags: [tempo, overview]
date: 2026-04-17
description: What Tempo is, how it's built, and what to read next.
---

# Tempo

Tempo is a **focus timer** for people who bounce between tabs. A session runs in a Web Worker so a background tab can't throttle it; data stays local in SQLite-WASM so you don't need an account to start, and sync is opt-in.

## Stack

- **Frontend:** React 19 + Vite + Zustand. See [[tempo/technical/architecture/frontend-architecture]].
- **Storage:** SQLite compiled to WASM, persisted to OPFS. See [[tempo/technical/decisions/adr-001-local-first-sqlite]].
- **Timer runtime:** dedicated Web Worker for drift-free tick accounting. See [[tempo/technical/decisions/adr-002-web-workers-for-timers]].
- **Sync (Pro):** encrypted blobs to Cloudflare R2, keyed on a passphrase the user owns.

## Core flows

1. **Start a focus session** — the main loop. Details in [[tempo/technical/features/focus-sessions]].
2. **Review history** — calendar heatmap + drill-down to individual sessions.
3. **Sync across devices** (Pro only) — see [[tempo/business/pricing]] for tier gates.

## Why it exists

The focus-timer space is crowded but mostly cloud-first and account-gated. Tempo's pitch is *"start in one click, own your data."* Market context: [[tempo/strategy/research/productivity-market-2026]].

## Quick start (dev)

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # vitest
```

No backend needed to run locally — the app is entirely client-side until you enable sync.
