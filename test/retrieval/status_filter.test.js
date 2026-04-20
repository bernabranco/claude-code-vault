#!/usr/bin/env node
/**
 * Status-aware retrieval assertions — issue #21.
 *
 * Builds a tiny synthetic vault on disk (current / stale / deprecated copies
 * of the same content), then asserts the search APIs honor the new defaults
 * and overrides:
 *
 *   1. Default keyword search excludes the deprecated note.
 *   2. Default semantic + chunk search exclude the deprecated note.
 *   3. includeDeprecated: true brings the deprecated note back.
 *   4. Stale notes appear but rank below current (similarity * 0.7 < current).
 *   5. staleWeight: 1.0 disables the downrank.
 *
 * Stays out of the boilerplate vault so the recall@5 baseline numbers from
 * eval.js are not perturbed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Vault } from "../../lib/vault.js";
import {
  openEmbeddingsDb,
  syncEmbeddings,
  semanticSearch,
  searchChunks,
} from "../../lib/embeddings.js";

const FIXTURE = path.join(os.tmpdir(), `vault-status-fixture-${process.pid}`);
const DB_PATH = path.join(os.tmpdir(), `vault-status-${process.pid}.db`);

function note({ status }) {
  // Body is byte-identical across statuses so embeddings are identical too —
  // any similarity gap between current and stale must come from the multiplier,
  // not from chunk-content drift.
  return `---
title: Authentication notes
type: feature
status: ${status}
date: 2026-01-01
lastVerified: 2026-04-20
description: Notes about JWT authentication and session handling
summary: How JWT-based authentication and session rotation work in this service.
tags: [auth, jwt, session]
---

# Authentication notes

## Background

JWT-based authentication is the standard approach for stateless session handling. Tokens carry the user identity and a short expiry; rotation happens on refresh.

## Implementation

The authentication middleware verifies the JWT signature, checks expiry, and attaches the decoded user to the request. Refresh tokens are stored server-side so revocation is possible without waiting for the access token to expire.
`;
}

function setupFixture() {
  if (fs.existsSync(FIXTURE)) fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE, "demo"), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, "demo", "auth-current.md"), note({ status: "current" }));
  fs.writeFileSync(path.join(FIXTURE, "demo", "auth-stale.md"), note({ status: "stale" }));
  fs.writeFileSync(path.join(FIXTURE, "demo", "auth-deprecated.md"), note({ status: "deprecated" }));
}

function teardown() {
  try { fs.rmSync(FIXTURE, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(DB_PATH); } catch {}
}

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    process.stderr.write(`  ✓ ${msg}\n`);
  } else {
    failed++;
    process.stderr.write(`  ✗ ${msg}\n`);
  }
}

async function main() {
  setupFixture();
  const vault = new Vault(FIXTURE);
  await vault.reindex();

  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = openEmbeddingsDb(DB_PATH);
  await syncEmbeddings(db, vault);

  const query = "jwt authentication";

  process.stderr.write("Keyword search (vault.search)\n");
  const kwDefault = vault.search("auth");
  const kwIds = kwDefault.map((r) => r.id);
  assert(!kwIds.includes("demo/auth-deprecated"), "default keyword search excludes deprecated");
  assert(kwIds.includes("demo/auth-current"), "default keyword search keeps current");
  assert(kwIds.includes("demo/auth-stale"), "default keyword search keeps stale");

  const kwOpenDefault = vault.search("auth", { includeDeprecated: true });
  assert(
    kwOpenDefault.some((r) => r.id === "demo/auth-deprecated"),
    "includeDeprecated: true brings deprecated back into keyword results"
  );

  const kwCurrent = kwDefault.find((r) => r.id === "demo/auth-current");
  const kwStale = kwDefault.find((r) => r.id === "demo/auth-stale");
  assert(
    kwCurrent && kwStale && kwStale.relevance < kwCurrent.relevance,
    `stale relevance (${kwStale?.relevance}) is below current (${kwCurrent?.relevance})`
  );

  const kwNoDownrank = vault.search("auth", { staleWeight: 1.0 });
  const kwStaleNoDownrank = kwNoDownrank.find((r) => r.id === "demo/auth-stale");
  assert(
    kwStaleNoDownrank && kwStaleNoDownrank.relevance === kwCurrent.relevance,
    "staleWeight: 1.0 disables the keyword downrank"
  );

  process.stderr.write("\nSemantic search (semanticSearch)\n");
  const semDefault = await semanticSearch(db, vault, query, { limit: 10 });
  const semIds = semDefault.map((r) => r.id);
  assert(!semIds.includes("demo/auth-deprecated"), "default semanticSearch excludes deprecated");
  assert(semIds.includes("demo/auth-current"), "default semanticSearch keeps current");

  const semOpen = await semanticSearch(db, vault, query, { limit: 10, includeDeprecated: true });
  assert(
    semOpen.some((r) => r.id === "demo/auth-deprecated"),
    "includeDeprecated: true brings deprecated back into semanticSearch"
  );

  const semCurrent = semDefault.find((r) => r.id === "demo/auth-current");
  const semStale = semDefault.find((r) => r.id === "demo/auth-stale");
  assert(
    semCurrent && semStale && semStale.similarity < semCurrent.similarity,
    `stale similarity (${semStale?.similarity}) is below current (${semCurrent?.similarity})`
  );

  const semNoDownrank = await semanticSearch(db, vault, query, { limit: 10, staleWeight: 1.0 });
  const semCurrentRaw = semNoDownrank.find((r) => r.id === "demo/auth-current");
  const semStaleRaw = semNoDownrank.find((r) => r.id === "demo/auth-stale");
  assert(
    semCurrentRaw && semStaleRaw && Math.abs(semStaleRaw.similarity - semCurrentRaw.similarity) < 0.0005,
    "staleWeight: 1.0 makes stale similarity match current (same content)"
  );

  process.stderr.write("\nChunk search (searchChunks)\n");
  const chunkDefault = await searchChunks(db, vault, query, { limit: 10 });
  const chunkNoteIds = new Set(chunkDefault.map((r) => r.noteId));
  assert(!chunkNoteIds.has("demo/auth-deprecated"), "default searchChunks excludes deprecated chunks");
  assert(chunkNoteIds.has("demo/auth-current"), "default searchChunks keeps current chunks");

  const chunkOpen = await searchChunks(db, vault, query, { limit: 10, includeDeprecated: true });
  assert(
    chunkOpen.some((r) => r.noteId === "demo/auth-deprecated"),
    "includeDeprecated: true brings deprecated chunks back"
  );

  db.close();
  teardown();

  if (failed > 0) {
    process.stderr.write(`\n✗ ${failed} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stderr.write("\n✓ All status-aware retrieval assertions passed.\n");
}

main().catch((err) => {
  console.error(err);
  teardown();
  process.exit(1);
});
