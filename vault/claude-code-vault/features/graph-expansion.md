---
id: graph-expansion
title: Graph expansion via wiki-links
description: How vault_related and read-with-context walk the wiki-link graph to surface neighboring notes
type: feature
tags: [graph, wiki-links, related]
---

# Graph expansion via wiki-links

Wiki-links in note bodies form a directed graph between notes. `vault_related` and `read-with-context` walk that graph to surface neighbors — useful when a single note answers part of a question and the rest lives one hop away.

## Public surface

- **CLI:** `claude-code-vault related <id>` and `claude-code-vault read-with-context <id>`
- **MCP:** the `vault_related` tool

Both accept a `depth` parameter (default 1, capped at 2) and a `limit` on how many neighbors to return.

## What gets returned

Each neighbor includes:

- `id` — the neighbor note's id
- `title` — its title
- `direction` — `forward` (this note links to it), `backward` (it links to this note), or `bidirectional`
- `weight` — number of edges between the two notes
- a short snippet of the neighbor's body so a downstream LLM can decide whether to expand it

## Ranking

Neighbors are ranked:

1. **Bidirectional first** — mutual links almost always indicate the strongest semantic relationship.
2. Then by total edge weight (multiple links between the same pair of notes count more).
3. Then by `lastModified` descending — fresher notes bubble up.
4. Then by id for determinism.

## When to use depth=2

Depth 1 is the right default — it returns immediate neighbors and is usually sufficient. Depth 2 is for "what's in the broader neighborhood" — useful when seeding a chat with context, expensive when answering a precise question.
