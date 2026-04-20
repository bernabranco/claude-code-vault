#!/usr/bin/env node
/**
 * Write-back assertions — issue #22.
 *
 * Exercises createNote + writeNote against a throwaway vault on disk:
 *   - happy path create + round-trip through Vault.reindex()
 *   - id collision, missing required fields, dead wiki-links, path escape
 *   - writeNote preserves frontmatter on body-only input
 *   - writeNote merge-patches frontmatter on full-markdown input
 *   - writeNote rejects non-existent ids
 *   - atomic write leaves no .tmp-* turds on success
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Vault } from "../lib/vault.js";
import { createNote, writeNote, __test } from "../lib/vault-write.js";

const FIXTURE = path.join(os.tmpdir(), `vault-write-fixture-${process.pid}`);

function setupFixture() {
  if (fs.existsSync(FIXTURE)) fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE, "demo"), { recursive: true });
  // Seed one existing note so we have an id to link to and to overwrite.
  const seed = `---
title: Seed note
type: overview
status: current
date: 2026-01-01
lastVerified: 2026-04-20
description: Pre-existing note used as link target
tags: [seed, demo]
---

# Seed note

Some seed content to link against from later notes.
`;
  fs.writeFileSync(path.join(FIXTURE, "demo", "seed.md"), seed);
}

function teardown() {
  try { fs.rmSync(FIXTURE, { recursive: true, force: true }); } catch {}
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

async function expectThrow(fn, matcher, msg) {
  try {
    await fn();
  } catch (err) {
    const m = typeof matcher === "string" ? err.message.includes(matcher) : matcher.test(err.message);
    assert(m, `${msg} (got: ${err.message})`);
    return;
  }
  assert(false, `${msg} (no error thrown)`);
}

async function main() {
  setupFixture();
  const vault = new Vault(FIXTURE);
  await vault.reindex();

  process.stderr.write("createNote happy path\n");
  const created = await createNote(vault, {
    id: "demo/new-feature",
    type: "feature",
    title: "New feature",
    body: "## What\n\nA new feature.\n\n## Why\n\nBecause.\n\n## How\n\nLike [[demo/seed]].\n",
    tags: ["demo", "new"],
    description: "One-line description",
    summary: "Summary TL;DR",
  });
  assert(created.id === "demo/new-feature", "returns id");
  assert(fs.existsSync(path.join(FIXTURE, "demo", "new-feature.md")), "file written to disk");
  const createdContent = fs.readFileSync(path.join(FIXTURE, "demo", "new-feature.md"), "utf-8");
  assert(createdContent.startsWith("---\n"), "has frontmatter block");
  assert(createdContent.includes("type: feature"), "type serialized");
  assert(createdContent.includes("status: current"), "status defaults to current");
  assert(/date: \d{4}-\d{2}-\d{2}/.test(createdContent), "date stamped");
  assert(/lastVerified: \d{4}-\d{2}-\d{2}/.test(createdContent), "lastVerified stamped");
  assert(createdContent.includes("tags: [demo, new]"), "tags array serialized");

  // Vault indexes the new note correctly.
  await vault.reindex();
  const reread = vault.index.find((n) => n.id === "demo/new-feature");
  assert(reread && reread.title === "New feature", "vault reindex picks up the new note");
  assert(reread && reread.status === "current", "indexed status is current");
  assert(reread && reread.type === "feature", "indexed type is feature");

  process.stderr.write("\ncreateNote rejections\n");
  await expectThrow(
    () => createNote(vault, { id: "demo/new-feature", type: "feature", title: "dup", body: "hi" }),
    "already exists",
    "rejects id collision"
  );
  await expectThrow(
    () => createNote(vault, { id: "demo/no-title", type: "feature", body: "hi" }),
    "title is required",
    "rejects missing title"
  );
  await expectThrow(
    () => createNote(vault, { id: "demo/no-type", title: "x", body: "hi" }),
    "type is required",
    "rejects missing type"
  );
  await expectThrow(
    () => createNote(vault, { id: "demo/no-body", type: "feature", title: "x" }),
    "body is required",
    "rejects missing body"
  );
  await expectThrow(
    () =>
      createNote(vault, {
        id: "demo/bad-link",
        type: "feature",
        title: "x",
        body: "## What\n\nLink to [[demo/does-not-exist]].\n",
      }),
    "unresolved wiki-links",
    "rejects unresolved wiki-links"
  );
  await expectThrow(
    () =>
      createNote(vault, {
        id: "../escape",
        type: "feature",
        title: "x",
        body: "body",
      }),
    /id must match|cannot contain '\.\.'|escapes vault/,
    "rejects path escape"
  );
  await expectThrow(
    () =>
      createNote(vault, {
        id: "demo/bad-status",
        type: "feature",
        title: "x",
        body: "body",
        status: "nonsense",
      }),
    "status must be one of",
    "rejects unknown status"
  );

  process.stderr.write("\nwriteNote body-only preserves frontmatter\n");
  const bodyOnlyRes = await writeNote(
    vault,
    "demo/new-feature",
    "## What\n\nUpdated body only.\n\n## Why\n\nRefreshed.\n\n## How\n\nStill references [[demo/seed]].\n"
  );
  assert(bodyOnlyRes.content.includes("type: feature"), "body-only preserves type");
  assert(bodyOnlyRes.content.includes("tags: [demo, new]"), "body-only preserves tags");
  assert(bodyOnlyRes.content.includes("Updated body only"), "body replaced");
  assert(bodyOnlyRes.content.includes("description: One-line description"), "body-only preserves description");

  process.stderr.write("\nwriteNote full-markdown merges frontmatter\n");
  const fullMdRes = await writeNote(
    vault,
    "demo/new-feature",
    `---
status: stale
summary: New summary
---

## What

Merge-patched frontmatter.

## Why

Because.

## How

See [[demo/seed]].
`
  );
  assert(fullMdRes.content.includes("status: stale"), "status patched");
  assert(fullMdRes.content.includes("summary: New summary"), "summary patched");
  assert(fullMdRes.content.includes("type: feature"), "unchanged type preserved");
  assert(fullMdRes.content.includes("tags: [demo, new]"), "unchanged tags preserved");
  assert(fullMdRes.content.includes("Merge-patched frontmatter"), "body replaced");

  process.stderr.write("\nwriteNote rejections\n");
  await expectThrow(
    () => writeNote(vault, "demo/does-not-exist", "body"),
    "Note not found",
    "rejects missing note"
  );
  await expectThrow(
    () => writeNote(vault, "demo/new-feature", "Body with [[demo/ghost]] link.\n"),
    "unresolved wiki-links",
    "rejects unresolved wiki-links on update"
  );
  await expectThrow(
    () => writeNote(vault, "demo/new-feature", "   \n   \n"),
    "body cannot be empty",
    "rejects empty body"
  );

  process.stderr.write("\nAtomic write cleanup\n");
  const leftovers = fs
    .readdirSync(path.join(FIXTURE, "demo"))
    .filter((f) => f.includes(".tmp-"));
  assert(leftovers.length === 0, `no .tmp-* files left behind (found: ${leftovers.join(", ")})`);

  process.stderr.write("\nvalidateId unit checks\n");
  const { validateId } = __test;
  assert.throws = () => {};
  try { validateId("demo/good_id-1"); assert(true, "accepts valid id"); }
  catch (e) { assert(false, `should accept valid id: ${e.message}`); }
  try { validateId("has space"); assert(false, "should reject space"); }
  catch { assert(true, "rejects id with space"); }
  try { validateId(""); assert(false, "should reject empty"); }
  catch { assert(true, "rejects empty id"); }
  try { validateId("foo/../bar"); assert(false, "should reject .."); }
  catch { assert(true, "rejects id with .."); }

  teardown();
  if (failed > 0) {
    process.stderr.write(`\n✗ ${failed} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stderr.write("\n✓ All vault-write assertions passed.\n");
}

main().catch((err) => {
  console.error(err);
  teardown();
  process.exit(1);
});
