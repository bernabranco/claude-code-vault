---
title: ADR-001 — Local-first storage via SQLite-WASM
tags: [tempo, technical, decisions, adr, storage]
date: 2026-04-17
description: Why Tempo stores session data in SQLite-WASM (OPFS) instead of a cloud database.
---

# ADR-001: Local-first storage via SQLite-WASM

**Status:** accepted, 2026-02-14
**Supersedes:** n/a

## Context

Early prototypes used Firestore. Every session start required a network round-trip; users on spotty wifi hit 1–3s latencies before their timer even started. The core product promise ("start in one click") was broken by our own storage layer.

We needed storage that:
- Works offline on first visit (no account required)
- Tolerates spotty networks without blocking the UI
- Can still sync across devices when the user wants it

## Decision

Use **SQLite compiled to WASM**, persisted to **OPFS** (Origin Private File System). Sync is layered on top as an opt-in Pro feature — see [[tempo/business/pricing]] — that uploads encrypted snapshots to R2.

The critical path — "start a session and write a tick" — never touches the network.

## Consequences

### Good
- Session starts in <50ms, all within the browser.
- Works fully offline. Opening the app on a plane just works.
- Users own their data by default. Exporting is a single `.sqlite` file.

### Bad
- OPFS is newer and has gotchas — see [[tempo/technical/architecture/gotchas]] for the WAL corruption case we hit in beta.
- Cross-origin mounts are impossible. Two subdomains = two databases. We warn on boot if origin mismatches.
- Sync conflict resolution is our problem, not the DB's. Current strategy: last-writer-wins per session, which is fine because sessions are append-only once ended.

### Related
- Timer accounting that depends on this storage: [[tempo/technical/features/focus-sessions]]
- The other major architectural choice: [[tempo/technical/decisions/adr-002-web-workers-for-timers]]
- Integration details: [[tempo/technical/architecture/frontend-architecture]]
