---
title: Gotchas — read before shipping
tags: [tempo, technical, architecture, gotchas]
date: 2026-04-17
description: Non-obvious traps that bit us in production. Read this before touching the timer or storage code.
---

# Gotchas

Small list, keeps growing.

## 1. `setTimeout` in a background tab is throttled to 1s minimum

This is why the timer runs in a Worker — see [[tempo/adrs/adr-002-web-workers-for-timers]]. If you see "drift" reports in Sentry, check that the session was started while the tab was foregrounded; that path has a different code branch.

## 2. OPFS is same-origin only

If a user opens Tempo in both `app.tempo.com` and `tempo.com`, the SQLite databases are **separate**. Silent data-loss if we don't detect it. We now check the origin at boot and refuse to mount if it's unexpected.

## 3. SQLite WAL mode + OPFS = corruption risk on force-close

We hit this in beta. Users who force-quit mid-write would sometimes see "database is locked" on next open. Fix: `PRAGMA journal_mode=MEMORY` for the hot path, flush to WAL on `visibilitychange=hidden`.

## 4. Zustand subscriptions leak across HMR

In dev only. A `subscribe()` call inside a component without cleanup survives HMR reloads and fires twice. Use `useEffect` + cleanup, not top-level `subscribe()`.
