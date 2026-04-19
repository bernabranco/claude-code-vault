---
id: embeddings-pipeline
title: Embeddings pipeline architecture
description: How notes are chunked, embedded, indexed, and queried with sqlite-vec, including the filter-before-rank pattern
type: architecture
tags: [embeddings, sqlite-vec, indexing]
---

# Embeddings pipeline architecture

## Schema sketch

Three tables in `.vault-cache/embeddings-vN.db`:

- `note_meta` — one row per note. Holds frontmatter (id, title, tags as `tags_json`, type, `note_date`, mtime, hash).
- `note_chunks` — one row per chunk. Holds `note_id`, ordinal, heading-breadcrumb, body, char range. Joined to `note_meta` for filter pushdown.
- `vec_chunks` — sqlite-vec `vec0` virtual table. One vector per chunk, keyed by the chunk's rowid in `note_chunks`.

## Sync loop

1. Walk the vault. For each `.md` file, parse frontmatter and hash the body.
2. If the hash matches the cached hash, skip. Otherwise re-chunk and re-embed only that note.
3. Chunks are 100–1500 characters, broken on heading boundaries with a heading stack so the breadcrumb (`Section > Subsection`) is preserved.
4. The embedding input is `breadcrumb + "\n\n" + chunk_body` — giving the model the section context the chunk was written under.
5. `chokidar` watches the vault folder for live edits and triggers a per-file re-index.

## Filter-before-rank

The hot path for [[claude-code-vault/features/semantic-search]] is a single SQL query that combines the WHERE filter and the KNN search:

```sql
SELECT c.note_id, c.heading, c.body, v.distance
FROM vec_chunks v
JOIN note_chunks c ON c.rowid = v.rowid
WHERE v.rowid IN (
  SELECT nc.rowid FROM note_chunks nc
  JOIN note_meta nm ON nm.id = nc.note_id
  WHERE <user filters>
)
  AND v.embedding MATCH ?
ORDER BY v.distance
LIMIT ?
```

The subquery cuts the candidate set down before sqlite-vec computes distances. This is what lets a vault with 10k chunks return filtered semantic results in under 50 ms.

## Cache versioning

The cache filename embeds a schema version (`embeddings-v2.db`). Any change to chunking, schema, or embedding model bumps the version — the old DB is abandoned, not migrated. See [[claude-code-vault/gotchas/gotchas]] for why this matters.
