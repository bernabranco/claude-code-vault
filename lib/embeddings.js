import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { pipeline } from "@huggingface/transformers";
import fs from "fs/promises";
import path from "path";
import { chunkMarkdown } from "./chunks.js";

const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
const EMBED_DIMS = 384;

let _extractor = null;
async function getExtractor() {
  if (!_extractor) {
    _extractor = await pipeline("feature-extraction", EMBED_MODEL);
  }
  return _extractor;
}

export async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data);
}

export function openEmbeddingsDb(dbPath) {
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_meta (
      note_id       TEXT PRIMARY KEY,
      last_modified TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS note_chunks (
      rowid        INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id      TEXT NOT NULL,
      chunk_idx    INTEGER NOT NULL,
      heading_path TEXT NOT NULL,
      text         TEXT NOT NULL,
      links        TEXT NOT NULL,
      tags_json    TEXT NOT NULL DEFAULT '[]',
      note_date    TEXT,
      UNIQUE(note_id, chunk_idx)
    );
    CREATE INDEX IF NOT EXISTS idx_note_chunks_note_id ON note_chunks(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_chunks_date ON note_chunks(note_date);
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      rowid     INTEGER PRIMARY KEY,
      embedding FLOAT[${EMBED_DIMS}] distance_metric=cosine
    );
  `);
  return db;
}

async function replaceChunksForNote(db, noteId, chunks, noteMeta = {}) {
  const existingRowids = db
    .prepare("SELECT rowid FROM note_chunks WHERE note_id = ?")
    .all(noteId)
    .map((r) => r.rowid);

  if (existingRowids.length) {
    const delVec = db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
    for (const rid of existingRowids) delVec.run(BigInt(rid));
    db.prepare("DELETE FROM note_chunks WHERE note_id = ?").run(noteId);
  }

  const insertChunk = db.prepare(
    "INSERT INTO note_chunks(note_id, chunk_idx, heading_path, text, links, tags_json, note_date) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING rowid"
  );
  const insertVec = db.prepare(
    "INSERT INTO vec_chunks(rowid, embedding) VALUES (?, ?)"
  );

  const tagsJson = JSON.stringify(noteMeta.tags ?? []);
  const noteDate = noteMeta.date ?? null;

  for (const ch of chunks) {
    const breadcrumb = ch.heading_path.join(" > ");
    const embedText_ = `${breadcrumb}\n\n${ch.text}`;
    const vec = await embedText(embedText_);
    const { rowid } = insertChunk.get(
      noteId,
      ch.chunk_idx,
      JSON.stringify(ch.heading_path),
      ch.text,
      JSON.stringify(ch.links),
      tagsJson,
      noteDate
    );
    insertVec.run(BigInt(rowid), vec);
  }
}

export async function syncEmbeddings(db, vault) {
  const existing = new Map(
    db
      .prepare("SELECT note_id, last_modified FROM note_meta")
      .all()
      .map((r) => [r.note_id, r.last_modified])
  );
  const currentIds = new Set();
  const upsertMeta = db.prepare(
    "INSERT INTO note_meta(note_id, last_modified) VALUES (?, ?) ON CONFLICT(note_id) DO UPDATE SET last_modified = excluded.last_modified"
  );

  let reembedded = 0;
  let totalChunks = 0;
  for (const note of vault.index) {
    currentIds.add(note.id);
    if (existing.get(note.id) === note.lastModified) continue;

    const filePath = path.join(vault.vaultDir, note.path);
    const raw = await fs.readFile(filePath, "utf-8");
    const chunks = chunkMarkdown(raw, note.title);
    await replaceChunksForNote(db, note.id, chunks, {
      tags: note.tags,
      date: note.frontmatter?.date ?? null,
    });
    upsertMeta.run(note.id, note.lastModified);
    reembedded++;
    totalChunks += chunks.length;
  }

  const deletedIds = [...existing.keys()].filter((id) => !currentIds.has(id));
  if (deletedIds.length) {
    for (const id of deletedIds) {
      await replaceChunksForNote(db, id, []);
    }
    const deleteMeta = db.prepare("DELETE FROM note_meta WHERE note_id = ?");
    for (const id of deletedIds) deleteMeta.run(id);
  }

  const chunkCount = db.prepare("SELECT count(*) AS n FROM note_chunks").get().n;
  return {
    reembedded,
    deleted: deletedIds.length,
    newChunks: totalChunks,
    totalChunks: chunkCount,
    totalNotes: vault.index.length,
  };
}

/**
 * Build the rowid pre-filter SQL + bind values from filter options.
 * Returns { sql: " AND rowid IN (...)" or "", binds: [] }.
 *
 * Filters are AND-combined across fields; within `tag` (when array), entries
 * are OR-combined (any-match).
 */
function buildFilterClause(filters) {
  const where = [];
  const binds = [];

  if (filters.folder) {
    const folder = String(filters.folder);
    const prefix = folder.endsWith("/") ? folder : folder + "/";
    where.push("(note_id = ? OR note_id LIKE ?)");
    binds.push(folder, prefix + "%");
  }

  if (filters.tag) {
    const tags = Array.isArray(filters.tag) ? filters.tag : [filters.tag];
    if (tags.length > 0) {
      const placeholders = tags.map(() => "?").join(", ");
      where.push(
        `EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value IN (${placeholders}))`
      );
      binds.push(...tags.map(String));
    }
  }

  if (filters.after) {
    where.push("note_date >= ?");
    binds.push(String(filters.after));
  }

  if (filters.before) {
    where.push("note_date <= ?");
    binds.push(String(filters.before));
  }

  if (where.length === 0) return { sql: "", binds: [] };
  const inner = `SELECT rowid FROM note_chunks WHERE ${where.join(" AND ")}`;
  return { sql: ` AND rowid IN (${inner})`, binds };
}

function normalizeOpts(optsOrLimit, defaultLimit) {
  if (optsOrLimit == null) return { limit: defaultLimit };
  if (typeof optsOrLimit === "number") return { limit: optsOrLimit };
  return { limit: defaultLimit, ...optsOrLimit };
}

export async function searchChunks(db, vault, query, optsOrLimit) {
  const opts = normalizeOpts(optsOrLimit, 5);
  const queryVec = await embedText(query);
  const filter = buildFilterClause(opts);
  const sql = `
    SELECT c.note_id, c.chunk_idx, c.heading_path, c.text, c.links, v.distance
    FROM (
      SELECT rowid, distance FROM vec_chunks
      WHERE embedding MATCH ?
        AND k = ?${filter.sql}
      ORDER BY distance
    ) v
    JOIN note_chunks c ON c.rowid = v.rowid
    ORDER BY v.distance
  `;
  const rows = db.prepare(sql).all(queryVec, opts.limit, ...filter.binds);

  return rows.map((r) => {
    const note = vault.index.find((n) => n.id === r.note_id);
    return {
      noteId: r.note_id,
      title: note?.title ?? r.note_id,
      headingPath: JSON.parse(r.heading_path),
      chunkIdx: r.chunk_idx,
      text: r.text,
      links: JSON.parse(r.links),
      similarity: Number((1 - r.distance).toFixed(4)),
    };
  });
}

export async function semanticSearch(db, vault, query, optsOrLimit) {
  const opts = normalizeOpts(optsOrLimit, 10);
  const chunkHits = await searchChunks(db, vault, query, {
    ...opts,
    limit: opts.limit * 4,
  });
  const byNote = new Map();
  for (const hit of chunkHits) {
    const prev = byNote.get(hit.noteId);
    if (!prev || hit.similarity > prev.similarity) {
      byNote.set(hit.noteId, hit);
    }
  }
  const ranked = [...byNote.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, opts.limit);

  return ranked.map((hit) => {
    const note = vault.index.find((n) => n.id === hit.noteId);
    return {
      id: hit.noteId,
      title: hit.title,
      tags: note?.tags ?? [],
      similarity: hit.similarity,
      bestChunkHeading: hit.headingPath.join(" > "),
    };
  });
}
