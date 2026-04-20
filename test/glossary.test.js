#!/usr/bin/env node
/**
 * Shared glossary resolution assertions — issue #31.
 *
 * Exercises buildGlossary (section headings, frontmatter fallbacks,
 * non-glossary notes ignored) and resolveJargon (word-boundary matching,
 * code-fence/span/wiki-link skipping, source-note exclusion, case-insensitive
 * detection, dedupe).
 */
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Vault } from "../lib/vault.js";
import { buildGlossary, resolveJargon } from "../lib/glossary.js";

const ROOT = path.join(os.tmpdir(), `vault-glossary-${process.pid}`);

function reset() {
  if (fs.existsSync(ROOT)) fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
}
function teardown() {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
}

let failed = 0;
function assert(cond, msg) {
  if (cond) process.stderr.write(`  ✓ ${msg}\n`);
  else { failed++; process.stderr.write(`  ✗ ${msg}\n`); }
}

async function writeNote(relPath, content) {
  const full = path.join(ROOT, relPath);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, "utf-8");
}

async function makeVault() {
  const v = new Vault(ROOT);
  await v.reindex();
  return v;
}

async function main() {
  reset();

  process.stderr.write("buildGlossary picks up glossary notes\n");
  await writeNote(
    "shared/glossary/rag.md",
    `---
id: shared/glossary/rag
title: RAG terms
type: glossary
status: current
tags: [glossary]
terms: [RRF, MRR]
---

# RAG terms

## RRF

Reciprocal Rank Fusion — fuses two ranked lists without score calibration.

## MRR

Mean Reciprocal Rank — retrieval quality metric.
`
  );
  await writeNote(
    "shared/glossary/domain.md",
    `---
id: shared/glossary/domain
title: Domain terms
type: glossary
status: current
tags: [glossary]
terms: [Embedding]
summary: Fallback summary for embedding
---

# Domain terms

(no matching H2 for Embedding — should fall back to summary)
`
  );
  await writeNote(
    "notes/random.md",
    `---
id: notes/random
title: Non-glossary note
type: architecture
status: current
tags: [arch]
---

# Not a glossary

## RRF

This is not a glossary — even though it has a heading called RRF it should not contribute.
`
  );

  let vault = await makeVault();
  let glossary = await buildGlossary(vault);
  assert(glossary.has("rrf"), "RRF registered (lowercase key)");
  assert(glossary.has("mrr"), "MRR registered");
  assert(glossary.has("embedding"), "Embedding registered with summary fallback");
  assert(!glossary.has("not a glossary"), "non-glossary H2 ignored");

  const rrf = glossary.get("rrf");
  assert(rrf.source === "shared/glossary/rag", "RRF source points at glossary note");
  assert(rrf.definition.includes("Reciprocal Rank Fusion"), "RRF definition captured from section body");
  assert(rrf.sectionHeading === "RRF", "RRF sectionHeading preserved");

  const embedding = glossary.get("embedding");
  assert(embedding.definition === "Fallback summary for embedding", "Embedding falls back to summary");
  assert(embedding.sectionHeading === null, "Embedding sectionHeading null when no section");

  process.stderr.write("\nresolveJargon finds bare mentions\n");
  const resolved = resolveJargon(
    "We evaluate retrieval with MRR and also track RRF fusion.",
    glossary
  );
  const terms = resolved.map((r) => r.term).sort();
  assert(terms.length === 2, "two terms resolved");
  assert(terms[0] === "MRR" && terms[1] === "RRF", "MRR + RRF returned");

  process.stderr.write("\nresolveJargon respects word boundaries\n");
  const boundary = resolveJargon("MRRX and xRRF should not match, MRR. should", glossary);
  assert(boundary.length === 1, "only MRR (punctuation ok) matched");
  assert(boundary[0].term === "MRR", "MRR matched with trailing period");

  process.stderr.write("\nresolveJargon is case-insensitive\n");
  const caseInsensitive = resolveJargon("we compute rrf and Mrr", glossary);
  const caseTerms = caseInsensitive.map((r) => r.term).sort();
  assert(caseTerms.length === 2 && caseTerms[0] === "MRR" && caseTerms[1] === "RRF", "lowercase prose matched canonical terms");

  process.stderr.write("\nresolveJargon skips code fences and spans\n");
  const inCode = resolveJargon(
    "Plain text.\n\n```\nRRF in a code fence\n```\n\nAlso `MRR` inline code.",
    glossary
  );
  assert(inCode.length === 0, "terms inside fences/spans ignored");

  process.stderr.write("\nresolveJargon skips wiki-link targets\n");
  const inLink = resolveJargon("See [[shared/glossary/rag|RRF details]] for more.", glossary);
  assert(inLink.length === 0, "wiki-link contents ignored");

  process.stderr.write("\nresolveJargon excludes source note\n");
  const excluded = resolveJargon(
    "## RRF\n\nReciprocal Rank Fusion...",
    glossary,
    { excludeSourceId: "shared/glossary/rag" }
  );
  assert(excluded.length === 0, "source glossary does not resolve its own terms");

  process.stderr.write("\nresolveJargon dedupes repeated mentions\n");
  const deduped = resolveJargon("RRF is used. RRF again. And RRF once more.", glossary);
  assert(deduped.length === 1, "single entry per term");

  process.stderr.write("\nresolveJargon skips frontmatter\n");
  const withFm = resolveJargon(
    `---\nid: x\ntitle: Something about RRF\n---\n\nBody has no jargon.\n`,
    glossary
  );
  assert(withFm.length === 0, "frontmatter mentions do not count");

  process.stderr.write("\nresolveJargon empty glossary is a no-op\n");
  const empty = resolveJargon("RRF and MRR everywhere", new Map());
  assert(empty.length === 0, "empty glossary returns empty array");

  process.stderr.write("\nCRLF frontmatter is stripped\n");
  const crlf = resolveJargon(
    "---\r\ntitle: Something about RRF\r\n---\r\nBody has no jargon here.\r\n",
    glossary
  );
  assert(crlf.length === 0, "CRLF frontmatter mentions ignored");

  process.stderr.write("\nmin term length filter ignores single-char terms\n");
  await writeNote(
    "shared/glossary/shorts.md",
    `---
id: shared/glossary/shorts
title: Short
type: glossary
status: current
tags: [glossary]
terms: [A, BB, CCC]
---

# Short

## A

Single letter term — should NOT register.

## BB

Two letter term — should register.

## CCC

Three letter term — should register.
`
  );
  let shortsVault = await makeVault();
  const shortsGlossary = await buildGlossary(shortsVault);
  assert(!shortsGlossary.has("a"), "single-letter term filtered out");
  assert(shortsGlossary.has("bb"), "two-letter term registered");
  assert(shortsGlossary.has("ccc"), "three-letter term registered");

  process.stderr.write("\nresolveJargon caps at MAX_RESOLVED_TERMS\n");
  const manyTerms = [];
  for (let i = 0; i < 30; i++) manyTerms.push(`Termword${String.fromCharCode(65 + i)}x`);
  const termsYaml = `[${manyTerms.join(", ")}]`;
  await writeNote(
    "shared/glossary/many.md",
    `---
id: shared/glossary/many
title: Many
type: glossary
status: current
tags: [glossary]
terms: ${termsYaml}
summary: bulk terms
---

# Many
`
  );
  let manyVault = await makeVault();
  const manyGlossary = await buildGlossary(manyVault);
  const prose = manyTerms.join(" and ");
  const capped = resolveJargon(prose, manyGlossary);
  assert(capped.length === 20, `capped at 20 resolved terms (got ${capped.length})`);

  process.stderr.write("\nregex-metachar term is escaped\n");
  await writeNote(
    "shared/glossary/meta.md",
    `---
id: shared/glossary/meta
title: Meta
type: glossary
status: current
tags: [glossary]
terms: [C++]
summary: C plus plus
---

# Meta
`
  );
  let metaVault = await makeVault();
  const metaGlossary = await buildGlossary(metaVault);
  const metaHit = resolveJargon("We ship C++ code here.", metaGlossary);
  assert(metaHit.length === 1, "C++ matched literally");
  assert(metaHit[0].term === "C++", "C++ preserved");

  process.stderr.write("\nmulti-word terms match with whitespace\n");
  await writeNote(
    "shared/glossary/multi.md",
    `---
id: shared/glossary/multi
title: Multi-word
type: glossary
status: current
tags: [glossary]
terms: [Cross-encoder, Dense retrieval]
---

# Multi

## Cross-encoder

Joint query+passage transformer.

## Dense retrieval

Retrieval by vector similarity.
`
  );
  vault = await makeVault();
  glossary = await buildGlossary(vault);
  const multi = resolveJargon("We first do dense retrieval then a cross-encoder pass.", glossary);
  const multiTerms = multi.map((r) => r.term).sort();
  assert(multiTerms.length === 2, "two multi-word terms matched");
  assert(multiTerms[0] === "Cross-encoder", "Cross-encoder matched hyphenated");
  assert(multiTerms[1] === "Dense retrieval", "Dense retrieval matched with space");

  process.stderr.write("\nhyphen-adjacent mentions resolve (non-word boundary)\n");
  const hyphen = resolveJargon("a cross-encoder-pass stage", glossary);
  assert(
    hyphen.some((r) => r.term === "Cross-encoder"),
    "Cross-encoder matched inside cross-encoder-pass"
  );

  teardown();
  if (failed > 0) {
    process.stderr.write(`\n${failed} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stderr.write("\nall glossary assertions passed\n");
}

main().catch((e) => {
  process.stderr.write(`test error: ${e.stack || e.message}\n`);
  teardown();
  process.exit(1);
});
