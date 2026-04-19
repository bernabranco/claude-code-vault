---
title: Pricing
tags: [tempo, business, pricing]
date: 2026-04-17
description: Free and Pro tier breakdown, where the gates are, why.
---

# Pricing

Two tiers. No enterprise tier yet — not enough signal to justify it.

## Free

- Up to **3 focus sessions per day**
- Fixed 25/5 durations (Pomodoro classic)
- Local-only data (SQLite in the browser — see [[tempo/adrs/adr-001-local-first-sqlite]])
- History, tags, heatmap — all included

The cap is daily, not monthly — we want people to hit it *frequently enough to feel it* but not so often they churn in frustration. 3/day landed after A/B testing 2 vs 3 vs 5.

Gate enforcement lives in [[tempo/features/focus-sessions]] at step 1 of the session-start flow.

## Pro — $4/month or $36/year

- **Unlimited sessions**
- **Custom durations** (any multiple of 5 minutes, from 10 to 90)
- **Cross-device sync** — passphrase-encrypted, end-to-end. We can't read it; neither can anyone we subpoena.
- **Calendar export** — `.ics` feed of sessions
- **Priority support** (realistically: you email us, we reply within a day)

Price chosen to be **lower than the perceived cost of a single distracting Twitter hour**. Rounds nicely in local currencies.

## Why this works (we think)

Research in [[tempo/research/productivity-market-2026]] suggests our target users will pay once they trust the tool. The free tier exists specifically to earn that trust — not to be a permanent resting point.

## Checkout

Stripe hosted checkout. No subscription management UI in-app yet; Pro users get a Stripe customer portal link from settings.

See [[tempo/overview]] for the product pitch this pricing supports.
