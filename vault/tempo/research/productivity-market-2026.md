---
title: Productivity / Focus-App Market — 2026 Snapshot
tags: [tempo, strategy, research, market]
date: 2026-04-17
description: Quick snapshot of the focus/Pomodoro app landscape and where Tempo fits.
---

# Productivity / Focus-App Market — 2026 Snapshot

Light research dump. Not a business plan — just enough context to decide where to invest.

## Landscape

Three clusters today:

1. **Cloud-first, account-gated.** Forest, Focus Keeper, Session. Require signup, data lives on their servers. Good retention from habit tracking; hostile to privacy-conscious users.
2. **Desktop-only, one-time purchase.** Flow (Mac), Be Focused. Older audience, no sync across devices, minimal feature velocity.
3. **OSS / self-hosted.** Gnome Pomodoro, Super Productivity. Technical audience only; no polish.

**Nobody ships local-first with opt-in sync.** That's the gap [[tempo/overview]] targets.

## User segments

Through interviews (n=22, spring 2026) the segments that care are:

- **Privacy-aware knowledge workers** (~45% of interviews) — won't give their focus data to a SaaS they don't trust. Willing to pay once they trust the tool.
- **Multi-device users** (~30%) — want Mac + iOS sync but don't want an account. Our passphrase-encrypted sync is the fit.
- **Minimalists** (~25%) — want *one* tool that doesn't grow into a kitchen-sink productivity suite. "Just a timer."

## Why now

Browser capability unlocks (OPFS, stable Web Workers) make "local-first web app" viable without a native wrapper. Five years ago this product would've been a Tauri/Electron download. See [[tempo/adrs/adr-001-local-first-sqlite]] for the tech that makes it work.

## Pricing implications

Free tier has to be genuinely useful so users can validate the tool before paying. Pro is "sync + unlimited sessions + custom durations" — see [[tempo/go-to-market/pricing]] for the breakdown.
