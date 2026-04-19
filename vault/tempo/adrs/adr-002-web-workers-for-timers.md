---
title: ADR-002 — Timers run in a Web Worker
tags: [tempo, technical, decisions, adr, timers]
date: 2026-04-17
description: Why the Pomodoro tick loop runs in a dedicated Web Worker instead of the main thread.
---

# ADR-002: Timers run in a Web Worker

**Status:** accepted, 2026-02-28
**Supersedes:** n/a

## Context

First version of Tempo ran the tick loop with `setInterval` on the main thread. Reports started coming in: *"I backgrounded the tab for 25 minutes and when I came back my timer was at 9 minutes."*

Root cause: Chrome and Firefox throttle timers in background tabs. `setInterval(1000)` becomes `setInterval(≥60000)` once the tab is hidden long enough. The timer doesn't pause — it just ticks slower than it claims to. This is [[tempo/gotchas/gotchas]] #1, written up after we got burned.

## Decision

Move the tick loop to a **dedicated Web Worker**. Workers are throttled much less aggressively than main-thread tabs — they can still fire `setTimeout` on time as long as the page isn't fully evicted.

Architecture:
- Worker computes elapsed time from a monotonic clock (`performance.now()` inside the Worker), not a naive counter.
- Worker posts `{ remaining, phase }` messages at 1 Hz.
- Main thread (React + Zustand — see [[tempo/designs/frontend-architecture]]) just renders the latest value.

## Consequences

### Good
- Timer accuracy survives a backgrounded tab. Drift measured in production is <100ms per 25-min session.
- Clean separation of concerns — the Worker has no React, no DOM, no IndexedDB.

### Bad
- Message overhead. A `postMessage` every second is fine in practice but measurable on low-end devices.
- Testing is slightly more involved; see the Worker test harness in `src/timer/__tests__/`.
- Workers can still be suspended if the browser reclaims memory. Rare, but possible. We detect this on resume and reconcile against `performance.now()`.

### Related
- The feature using this timer: [[tempo/features/focus-sessions]]
- Storage decisions that interact with tick accounting: [[tempo/adrs/adr-001-local-first-sqlite]]
- Integration: [[tempo/designs/frontend-architecture]]
