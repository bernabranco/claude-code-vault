---
title: Frontend Architecture
tags: [tempo, technical, architecture, frontend]
date: 2026-04-17
description: React + Vite + Zustand + Web Worker timer + SQLite-WASM persistence.
---

# Frontend Architecture

Tempo is a single-page app, entirely client-side by default. No server round-trips on the critical path.

## Layers

```
┌────────────────────────────────┐
│  UI (React 19 + Tailwind)      │  ← dumb, reads from Zustand
├────────────────────────────────┤
│  Zustand store                 │  ← source of truth for UI state
├────────────────────────────────┤
│  Timer Worker                  │  ← see [[tempo/technical/decisions/adr-002-web-workers-for-timers]]
│  SQLite-WASM (OPFS)            │  ← see [[tempo/technical/decisions/adr-001-local-first-sqlite]]
└────────────────────────────────┘
```

The store subscribes to messages from the Timer Worker (one message per second) and persists session deltas to SQLite on `onblur`/close.

## Module boundaries

- `src/timer/` — Worker code. Pure: no DOM, no React. Deterministic tick accounting.
- `src/store/` — Zustand slices (`timer`, `sessions`, `settings`). No side effects inside reducers.
- `src/db/` — SQLite helpers. Exposes `saveSession(data)` / `listSessions()` / `getSession(id)`.
- `src/ui/` — components. Read from store selectors, dispatch actions.

## Known traps

Before touching this code, skim [[tempo/technical/architecture/gotchas]]. The two biggest:

1. **Tab throttling** killed our first timer implementation. That's why [[tempo/technical/decisions/adr-002-web-workers-for-timers]] exists.
2. **OPFS writes block the main thread** if you forget to use the async cursor. Always `await db.execAsync(...)`.

## Test strategy

Vitest + happy-dom for store/reducer tests. Workers are harder — we stub `postMessage` in a companion test file.
