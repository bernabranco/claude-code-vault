---
title: Focus Sessions — the main loop
tags: [tempo, technical, features]
date: 2026-04-17
description: The core "start a session" feature — what it does, how it's built, where it lives in the code.
---

# Focus Sessions

The user hits **Start**, a 25-minute timer begins, they work, a bell rings, they take a 5-minute break. That's it. Everything else is scaffolding.

## Flow

1. User clicks **Start** → Zustand dispatches `startSession({ length: 25*60 })`.
2. Store spins up the Timer Worker (if not already running) — see [[tempo/technical/decisions/adr-002-web-workers-for-timers]].
3. Worker posts `{ remaining, phase: 'focus' }` at 1 Hz.
4. UI renders. Store buffers ticks in memory.
5. On completion: store writes a `sessions` row to SQLite — see [[tempo/technical/decisions/adr-001-local-first-sqlite]].
6. UI transitions to a break phase. Repeat.

## Limits (by tier)

Free users get 3 sessions per day. Pro users get unlimited and can customize durations. Details in [[tempo/business/pricing]]. The gate is enforced at step 1 — `startSession` throws `DailyLimitReached` if the user hits the cap.

## Data model

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- ULID
  started_at  INTEGER NOT NULL,           -- epoch ms
  ended_at    INTEGER,                    -- null while in progress
  length_s    INTEGER NOT NULL,           -- planned length
  actual_s    INTEGER,                    -- actual focused time (< length_s if paused)
  tag         TEXT,                       -- user-defined, nullable
  interrupted INTEGER NOT NULL DEFAULT 0  -- 1 if user hit "stop" early
);
```

No foreign keys, no user_id — this is local-first storage. Sync (Pro only) adds a device id column downstream.

## Edge cases

- **User closes the tab mid-session:** `beforeunload` writes a partial row with `interrupted=1`. Recovered on next open.
- **System sleeps:** Worker detects the gap via `performance.now()` and flags the session as interrupted.
- **Clock skew:** we trust `performance.now()` for deltas, never wall-clock. Wall-clock is only stored in `started_at` for display.
