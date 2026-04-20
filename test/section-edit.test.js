#!/usr/bin/env node
/**
 * Section-level edit assertions — issue #23.
 *
 * Builds a throwaway vault with a multi-heading note, then exercises
 * editSection (append + replace) directly. Covers happy paths, path
 * resolution edge cases, ambiguity handling, frontmatter preservation,
 * subsection wipe semantics, and dead-link rejection.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Vault } from "../lib/vault.js";
import { editSection } from "../lib/vault-write.js";
import { parseSections, findSection } from "../lib/sections.js";

const FIXTURE = path.join(os.tmpdir(), `vault-section-fixture-${process.pid}`);

const SAMPLE = `---
title: Gotchas
type: gotcha
status: current
date: 2026-01-01
lastVerified: 2026-04-20
description: Demo gotcha note for section-edit tests
tags: [demo, gotcha]
---

# Gotchas

Intro paragraph.

## Auth retry storm

**Symptom**: clients hammer the auth endpoint.

**Cause**: missing exponential backoff.

**Fix**: add jitter.

### Verify

Run \`./scripts/check-backoff.sh\`.

## Cache stampede

**Symptom**: thundering herd on cache miss.

**Cause**: no request coalescing.

**Fix**: single-flight wrapper.

# Appendix

Trailing notes here.
`;

function setupFixture() {
  if (fs.existsSync(FIXTURE)) fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE, "demo"), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, "demo", "gotchas.md"), SAMPLE);
  // Seed a second note that exists as a wiki-link target.
  fs.writeFileSync(
    path.join(FIXTURE, "demo", "seed.md"),
    `---\ntitle: Seed\ntype: overview\nstatus: current\ndate: 2026-01-01\ntags: [seed]\n---\n\n# Seed\n\nLinkable.\n`
  );
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
    const ok = typeof matcher === "string" ? err.message.includes(matcher) : matcher.test(err.message);
    assert(ok, `${msg} (got: ${err.message})`);
    return;
  }
  assert(false, `${msg} (no error thrown)`);
}

async function main() {
  setupFixture();
  const vault = new Vault(FIXTURE);
  await vault.reindex();

  process.stderr.write("parseSections + findSection unit checks\n");
  const bodyLines = SAMPLE.split(/\n---\n/).slice(2).join("\n---\n").split("\n");
  // Simpler: re-parse via the same pathway editSection uses.
  const lines = SAMPLE.split("\n");
  const fmEnd = lines.findIndex((l, i) => i > 0 && l === "---") + 1;
  const sections = parseSections(lines.slice(fmEnd));
  const breadcrumbs = sections.map((s) => [...s.ancestors, s.text].join(" > "));
  assert(breadcrumbs.includes("Gotchas"), "parses H1 Gotchas");
  assert(breadcrumbs.includes("Gotchas > Auth retry storm"), "parses H2 under H1");
  assert(
    breadcrumbs.includes("Gotchas > Auth retry storm > Verify"),
    "parses H3 under H2"
  );
  assert(breadcrumbs.includes("Appendix"), "parses second top-level H1");

  const found = findSection(sections, ["Gotchas", "Auth retry storm"]);
  assert(found.level === 2 && found.text === "Auth retry storm", "findSection returns H2 match");

  process.stderr.write("\nappend happy path\n");
  await editSection(vault, "demo/gotchas", "append", ["Gotchas", "Auth retry storm"], "**New note**: also add metrics.");
  let updated = fs.readFileSync(path.join(FIXTURE, "demo", "gotchas.md"), "utf-8");
  assert(updated.includes("**New note**: also add metrics."), "appended content present");
  // Verify the addition lives inside the right section — must appear before the H3 Verify subsection? Actually
  // append goes to the end of the section body, which is *before* the next same-or-higher heading. The H3 Verify is
  // a child, so the section ends at the next H2 (Cache stampede). Addition should land between Verify section and
  // Cache stampede.
  const newIdx = updated.indexOf("**New note**: also add metrics.");
  const cacheIdx = updated.indexOf("## Cache stampede");
  const verifyIdx = updated.indexOf("### Verify");
  assert(verifyIdx < newIdx && newIdx < cacheIdx, "appended content lands after subsections, before next sibling H2");

  process.stderr.write("\nreplace happy path (wipes subsections)\n");
  await editSection(vault, "demo/gotchas", "replace", ["Gotchas", "Auth retry storm"], "Section was rewritten.");
  updated = fs.readFileSync(path.join(FIXTURE, "demo", "gotchas.md"), "utf-8");
  assert(updated.includes("## Auth retry storm"), "heading preserved on replace");
  assert(updated.includes("Section was rewritten."), "replacement body present");
  assert(!updated.includes("### Verify"), "subsection wiped on replace");
  assert(!updated.includes("**Symptom**: clients hammer"), "old body wiped on replace");
  assert(updated.includes("## Cache stampede"), "next sibling section preserved");
  assert(updated.includes("# Appendix"), "trailing top-level section preserved");

  process.stderr.write("\nfrontmatter preservation\n");
  assert(updated.startsWith("---\n"), "frontmatter still leads");
  assert(updated.includes("title: Gotchas"), "frontmatter title preserved");
  assert(updated.includes("tags: [demo, gotcha]"), "frontmatter tags preserved");

  process.stderr.write("\nempty replace clears body but keeps heading\n");
  setupFixture();
  await editSection(vault, "demo/gotchas", "replace", ["Gotchas", "Cache stampede"], "");
  updated = fs.readFileSync(path.join(FIXTURE, "demo", "gotchas.md"), "utf-8");
  assert(updated.includes("## Cache stampede"), "empty replace keeps heading");
  assert(!updated.includes("**Symptom**: thundering herd"), "empty replace clears body");

  process.stderr.write("\nrejections\n");
  setupFixture();
  await expectThrow(
    () => editSection(vault, "demo/missing", "append", ["Gotchas"], "x"),
    "Note not found",
    "rejects missing note"
  );
  await expectThrow(
    () => editSection(vault, "demo/gotchas", "append", [], "x"),
    "non-empty array",
    "rejects empty headingPath"
  );
  await expectThrow(
    () => editSection(vault, "demo/gotchas", "append", ["Nonexistent"], "x"),
    "headingPath not found",
    "rejects unmatched path"
  );
  await expectThrow(
    () => editSection(vault, "demo/gotchas", "append", ["Auth retry storm"], "x"),
    "headingPath not found",
    "rejects path missing ancestor (loose match disabled)"
  );
  await expectThrow(
    () => editSection(vault, "demo/gotchas", "append", ["Gotchas", "Auth retry storm"], "Link to [[demo/ghost]]"),
    "unresolved wiki-links",
    "rejects dead wiki-link in append content"
  );
  await expectThrow(
    () => editSection(vault, "demo/gotchas", "append", ["Gotchas", "Auth retry storm"], "   "),
    "content cannot be empty",
    "rejects empty content for append"
  );
  await expectThrow(
    () => editSection(vault, "demo/gotchas", "frob", ["Gotchas"], "x"),
    "mode must be",
    "rejects unknown mode"
  );

  process.stderr.write("\nambiguity rejection\n");
  // Add a second "Auth retry storm" under Appendix to force ambiguity? They'd have different ancestors,
  // so strict matching would NOT consider them ambiguous. To prove ambiguity rejection works, we need
  // two sections with identical ancestors + text. Easiest: duplicate H2 "Cache stampede" under Gotchas.
  const ambiguous = SAMPLE.replace(
    "# Appendix",
    "## Cache stampede\n\nDuplicate under same H1.\n\n# Appendix"
  );
  fs.writeFileSync(path.join(FIXTURE, "demo", "gotchas.md"), ambiguous);
  await vault.reindex();
  await expectThrow(
    () => editSection(vault, "demo/gotchas", "append", ["Gotchas", "Cache stampede"], "x"),
    "ambiguous",
    "rejects ambiguous path (two sections with same ancestor + text)"
  );

  process.stderr.write("\ncode-fence false-heading immunity\n");
  setupFixture();
  const fenced = SAMPLE.replace(
    "Trailing notes here.",
    "```\n## Not a real heading\n```\n\nTrailing notes here."
  );
  fs.writeFileSync(path.join(FIXTURE, "demo", "gotchas.md"), fenced);
  await vault.reindex();
  await editSection(vault, "demo/gotchas", "append", ["Appendix"], "Real append.");
  updated = fs.readFileSync(path.join(FIXTURE, "demo", "gotchas.md"), "utf-8");
  assert(updated.includes("Real append."), "appended past code-fenced false heading");
  assert(updated.includes("```\n## Not a real heading\n```"), "code fence body untouched");

  process.stderr.write("\natomic write cleanup\n");
  const leftovers = fs
    .readdirSync(path.join(FIXTURE, "demo"))
    .filter((f) => f.includes(".tmp-"));
  assert(leftovers.length === 0, `no .tmp-* leftovers (found: ${leftovers.join(", ")})`);

  teardown();
  if (failed > 0) {
    process.stderr.write(`\n✗ ${failed} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stderr.write("\n✓ All section-edit assertions passed.\n");
}

main().catch((err) => {
  console.error(err);
  teardown();
  process.exit(1);
});
