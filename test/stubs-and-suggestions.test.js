#!/usr/bin/env node
/**
 * Stub creation + suggested-links assertions — issue #24.
 *
 * Exercises the autoStub opt-in through createNote, writeNote, editSection,
 * plus the computeSuggestedLinks helper and the stale-stub linter rule.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Vault } from "../lib/vault.js";
import { createNote, writeNote, editSection, __test } from "../lib/vault-write.js";
import { lintVault } from "../lib/linter.js";

const { computeSuggestedLinks, titleCaseFromId } = __test;

const FIXTURE = path.join(os.tmpdir(), `vault-stubs-fixture-${process.pid}`);

function setupFixture() {
  if (fs.existsSync(FIXTURE)) fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE, "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURE, "demo", "seed.md"),
    `---\ntitle: Authentication\ntype: overview\nstatus: current\ndate: 2026-01-01\nlastVerified: 2026-04-20\ndescription: Seed note about authentication\ntags: [seed, auth]\n---\n\n# Authentication\n\nLinkable body.\n`
  );
  fs.writeFileSync(
    path.join(FIXTURE, "demo", "terms.md"),
    `---\ntitle: Core terms\ntype: glossary\nstatus: current\ndate: 2026-01-01\nlastVerified: 2026-04-20\nterms: [JWT, Refresh Token]\ntags: [glossary]\n---\n\n# Core terms\n\n## JWT\n\nJSON Web Token.\n\n## Refresh Token\n\nLong-lived credential.\n`
  );
}
function teardown() {
  try { fs.rmSync(FIXTURE, { recursive: true, force: true }); } catch {}
}

let failed = 0;
function assert(cond, msg) {
  if (cond) process.stderr.write(`  ✓ ${msg}\n`);
  else { failed++; process.stderr.write(`  ✗ ${msg}\n`); }
}
async function expectThrow(fn, matcher, msg) {
  try { await fn(); } catch (err) {
    const ok = typeof matcher === "string" ? err.message.includes(matcher) : matcher.test(err.message);
    assert(ok, `${msg} (got: ${err.message})`); return;
  }
  assert(false, `${msg} (no error thrown)`);
}

async function main() {
  setupFixture();
  const vault = new Vault(FIXTURE);
  await vault.reindex();

  process.stderr.write("titleCaseFromId\n");
  assert(titleCaseFromId("demo/my-new-thing") === "My New Thing", "kebab → title case");
  assert(titleCaseFromId("demo/multi_word_id") === "Multi Word Id", "snake → title case");

  process.stderr.write("\nautoStub: createNote stubs unresolved targets\n");
  const r1 = await createNote(
    vault,
    {
      id: "demo/article",
      type: "feature",
      title: "Article",
      body: "## What\n\nRefers to [[demo/ghost-one]] and [[demo/ghost-two]].\n\n## Why\n\nReason.\n\n## How\n\nSteps.",
      tags: ["demo"],
    },
    { autoStub: true }
  );
  assert(r1.createdStubs.length === 2, "two stubs created");
  assert(r1.createdStubs.includes("demo/ghost-one"), "ghost-one stubbed");
  assert(r1.createdStubs.includes("demo/ghost-two"), "ghost-two stubbed");
  assert(fs.existsSync(path.join(FIXTURE, "demo", "ghost-one.md")), "stub file on disk");
  const stubContent = fs.readFileSync(path.join(FIXTURE, "demo", "ghost-one.md"), "utf-8");
  assert(stubContent.includes("status: draft"), "stub status is draft");
  assert(stubContent.includes("tags: [stub]"), "stub tag is [stub]");
  assert(stubContent.includes("[[demo/article]]"), "stub backlinks to source");
  assert(stubContent.includes("title: Ghost One"), "stub title is title-cased id");

  process.stderr.write("\nautoStub default off (strict) keeps old behavior\n");
  setupFixture();
  await vault.reindex();
  await expectThrow(
    () =>
      createNote(vault, {
        id: "demo/strict",
        type: "feature",
        title: "Strict",
        body: "## What\n\n[[demo/ghost]]\n\n## Why\n\nx\n\n## How\n\ny",
      }),
    "unresolved wiki-links",
    "default (no opts) still throws on dead links"
  );

  process.stderr.write("\nautoStub: writeNote stubs + suggests\n");
  setupFixture();
  await vault.reindex();
  const r2 = await writeNote(
    vault,
    "demo/seed",
    "Plain authentication notes mentioning JWT and Refresh Token rotation. Also refers to [[demo/new-thing]].\n",
    { autoStub: true }
  );
  assert(r2.createdStubs.includes("demo/new-thing"), "writeNote stubbed new-thing");
  // suggestedLinks should surface glossary terms JWT and Refresh Token (they point at demo/terms).
  const termTargets = r2.suggestedLinks.filter((s) => s.target === "demo/terms").map((s) => s.matchedText);
  assert(termTargets.includes("JWT"), "suggests JWT from glossary");
  assert(termTargets.includes("Refresh Token"), "suggests Refresh Token from glossary");
  assert(r2.suggestedLinks.every((s) => s.target !== "demo/seed"), "does not suggest self");

  process.stderr.write("\nsuggestedLinks skips already-linked targets\n");
  setupFixture();
  await vault.reindex();
  // Body references Authentication by its title AND already links demo/seed — the title suggestion should be dropped.
  const r3 = await createNote(
    vault,
    {
      id: "demo/uses-auth",
      type: "overview",
      title: "Uses authentication",
      body: "# Notes\n\nWe build on [[demo/seed]] for authentication handling.\n",
    },
    { autoStub: true }
  );
  assert(
    r3.suggestedLinks.every((s) => s.target !== "demo/seed"),
    "target already wiki-linked does not get suggested"
  );

  process.stderr.write("\nsuggestedLinks ignores code fences and inline code\n");
  setupFixture();
  await vault.reindex();
  const r4 = await createNote(
    vault,
    {
      id: "demo/fenced",
      type: "overview",
      title: "Fenced",
      body: "# Fenced\n\nHere is some code:\n\n```\nAuthentication is a keyword used in auth().\n```\n\nAnd `Authentication` inline is also code. Body has no bare mention.\n",
    },
    { autoStub: true }
  );
  const authSuggest = r4.suggestedLinks.find((s) => s.target === "demo/seed");
  assert(!authSuggest, "no suggestion when all mentions are in fences/inline code");

  process.stderr.write("\nsuggestedLinks counts occurrences and reports first line\n");
  setupFixture();
  await vault.reindex();
  const r5 = await createNote(
    vault,
    {
      id: "demo/multi",
      type: "overview",
      title: "Multi",
      body: "# Multi\n\nAuthentication here.\n\nMore on Authentication.\n\nAuthentication last time.\n",
    },
    { autoStub: true }
  );
  const authHit = r5.suggestedLinks.find((s) => s.target === "demo/seed" && s.matchedOn === "title");
  assert(authHit && authHit.count >= 3, `counts >=3 occurrences (got ${authHit?.count})`);
  assert(authHit && typeof authHit.firstLine === "number", "firstLine is a number");

  process.stderr.write("\neditSection auto-stubs\n");
  setupFixture();
  await vault.reindex();
  await createNote(vault, {
    id: "demo/gotchas",
    type: "gotcha",
    title: "Gotchas",
    body: "## First\n\n**Symptom**: x\n\n**Cause**: y\n\n**Fix**: z\n",
  });
  const r6 = await editSection(
    vault,
    "demo/gotchas",
    "append",
    ["First"],
    "\n\n**See also**: [[demo/another-stub]].\n",
    { autoStub: true }
  );
  assert(r6.createdStubs.includes("demo/another-stub"), "editSection append stubbed new target");
  assert(fs.existsSync(path.join(FIXTURE, "demo", "another-stub.md")), "stub file written from section edit");

  process.stderr.write("\nstub idempotent: existing file is not overwritten\n");
  setupFixture();
  await vault.reindex();
  fs.writeFileSync(path.join(FIXTURE, "demo", "preexisting.md"), `---\ntitle: Preexisting\ntype: overview\nstatus: current\ntags: []\n---\n\n# Preexisting\n\nReal content that must not be clobbered.\n`);
  await vault.reindex();
  const r7 = await createNote(
    vault,
    {
      id: "demo/source",
      type: "overview",
      title: "Source",
      body: "# Source\n\nLink to [[demo/preexisting]].\n",
    },
    { autoStub: true }
  );
  assert(r7.createdStubs.length === 0, "no stubs created when target already exists");
  const preContent = fs.readFileSync(path.join(FIXTURE, "demo", "preexisting.md"), "utf-8");
  assert(preContent.includes("Real content that must not be clobbered"), "preexisting note untouched");

  process.stderr.write("\ninvalid-shaped target with autoStub still throws (can't stub it)\n");
  setupFixture();
  await vault.reindex();
  await expectThrow(
    () =>
      createNote(
        vault,
        {
          id: "demo/bad-target",
          type: "overview",
          title: "Bad target",
          body: "# X\n\nLink to [[../escape]].\n",
        },
        { autoStub: true }
      ),
    "unresolved wiki-links",
    "invalid id shape left as dead link, not stubbed"
  );

  process.stderr.write("\nstale-stub linter rule\n");
  setupFixture();
  fs.writeFileSync(
    path.join(FIXTURE, "demo", "old-stub.md"),
    `---\ntitle: Old stub\ntype: overview\nstatus: draft\ndate: 2026-01-01\nlastVerified: 2026-01-01\ndescription: Stub — to be written.\nsummary: Stub — to be written.\ntags: [stub]\n---\n\n# Old stub\n\nStub body referencing [[demo/seed]].\n`
  );
  fs.writeFileSync(
    path.join(FIXTURE, "demo", "fresh-stub.md"),
    `---\ntitle: Fresh stub\ntype: overview\nstatus: draft\ndate: ${new Date().toISOString().slice(0, 10)}\nlastVerified: 2026-04-20\ndescription: Stub — to be written.\nsummary: Stub — to be written.\ntags: [stub]\n---\n\n# Fresh stub\n\nStub body referencing [[demo/seed]].\n`
  );
  await vault.reindex();
  const findings = await lintVault(vault, { staleStubDays: 7 });
  const stale = findings.filter((f) => f.code === "stale-stub");
  assert(stale.some((f) => f.noteId === "demo/old-stub"), "flags old stub");
  assert(!stale.some((f) => f.noteId === "demo/fresh-stub"), "doesn't flag fresh stub");
  assert(!stale.some((f) => f.noteId === "demo/seed"), "doesn't flag non-stub notes");

  // Filling in the stub (status: current) should clear the warning.
  fs.writeFileSync(
    path.join(FIXTURE, "demo", "old-stub.md"),
    `---\ntitle: Old stub\ntype: overview\nstatus: current\ndate: 2026-01-01\nlastVerified: 2026-01-01\ndescription: Now filled in\ntags: [stub]\n---\n\n# Old stub\n\nReal content now.\n`
  );
  await vault.reindex();
  const after = await lintVault(vault, { staleStubDays: 7 });
  assert(
    !after.some((f) => f.code === "stale-stub" && f.noteId === "demo/old-stub"),
    "filled-in stub no longer flagged"
  );

  process.stderr.write("\ncomputeSuggestedLinks unit: returns [] on a body with no matches\n");
  setupFixture();
  await vault.reindex();
  const empty = computeSuggestedLinks(vault, "Body talking about pineapples only.\n", null);
  assert(empty.length === 0, "no suggestions when nothing matches");

  teardown();
  if (failed > 0) {
    process.stderr.write(`\n✗ ${failed} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stderr.write("\n✓ All stubs-and-suggestions assertions passed.\n");
}

main().catch((err) => {
  console.error(err);
  teardown();
  process.exit(1);
});
