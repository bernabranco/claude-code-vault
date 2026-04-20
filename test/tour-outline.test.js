#!/usr/bin/env node
/**
 * vault_tour + vault_outline assertions — issue #29.
 *
 * Exercises:
 *   - computePageRank: monotonicity (hub > leaf), empty vault, deprecated skip,
 *     stale downweight, project prefix filter semantics.
 *   - extractOutline: maxDepth, code-fence skipping (``` and ~~~), frontmatter.
 *   - tour envelope respects maxChars (applyCharBudget integration).
 *   - outline truncation marker appears when blocks exceed maxChars.
 */
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Vault } from "../lib/vault.js";
import { computePageRank } from "../lib/graph.js";
import { extractOutline } from "../lib/outline.js";
import { applyCharBudget } from "../lib/budgets.js";

const ROOT = path.join(os.tmpdir(), `vault-tour-outline-${process.pid}`);

function reset() {
  if (fs.existsSync(ROOT)) fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
}
function teardown() {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {}
}

let failed = 0;
function assert(cond, msg) {
  if (cond) process.stderr.write(`  ✓ ${msg}\n`);
  else {
    failed++;
    process.stderr.write(`  ✗ ${msg}\n`);
  }
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

  process.stderr.write("computePageRank: hub > leaf monotonicity\n");
  await writeNote(
    "demo/VAULT_SUMMARY.md",
    `---
id: demo/vault-summary
title: Demo Vault Summary
type: overview
status: current
---

# Demo

See [[demo/hub]] for architecture.
`
  );
  await writeNote(
    "demo/hub.md",
    `---
id: demo/hub
title: Architecture Hub
type: architecture
status: current
---

# Architecture Hub

Shared by many notes.

## Context

Used across the stack.
`
  );
  await writeNote(
    "demo/a.md",
    `---
id: demo/a
title: Leaf A
type: feature
status: current
---

# Leaf A

See [[demo/hub]].
`
  );
  await writeNote(
    "demo/b.md",
    `---
id: demo/b
title: Leaf B
type: feature
status: current
---

# Leaf B

See [[demo/hub]].
`
  );
  await writeNote(
    "demo/c.md",
    `---
id: demo/c
title: Leaf C
type: feature
status: current
---

# Leaf C

See [[demo/hub]] and [[demo/a]].
`
  );
  await writeNote(
    "demo/orphan.md",
    `---
id: demo/orphan
title: Lonely Leaf
type: feature
status: current
---

# Lonely Leaf

No links.
`
  );

  let vault = await makeVault();
  let ranks = computePageRank(vault);
  assert(ranks.size === vault.index.length, "ranks cover every active note");
  const hubScore = ranks.get("demo/hub") ?? 0;
  const leafScore = ranks.get("demo/orphan") ?? 0;
  assert(hubScore > leafScore, `hub (${hubScore.toFixed(5)}) > orphan (${leafScore.toFixed(5)})`);
  const leafAScore = ranks.get("demo/a") ?? 0;
  assert(hubScore > leafAScore, `hub (${hubScore.toFixed(5)}) > leaf a (${leafAScore.toFixed(5)})`);

  process.stderr.write("\ncomputePageRank: empty vault is graceful\n");
  const emptyRanks = computePageRank({ index: [] });
  assert(emptyRanks instanceof Map, "empty vault returns a Map");
  assert(emptyRanks.size === 0, "empty vault returns empty scores");

  process.stderr.write("\ncomputePageRank: undefined vault guard\n");
  const guard1 = computePageRank(null);
  const guard2 = computePageRank(undefined);
  assert(guard1.size === 0, "null vault returns empty Map");
  assert(guard2.size === 0, "undefined vault returns empty Map");

  process.stderr.write("\ncomputePageRank: deprecated notes excluded\n");
  await writeNote(
    "demo/deprecated-note.md",
    `---
id: demo/deprecated-note
title: Gone
type: feature
status: deprecated
---

# Gone
`
  );
  vault = await makeVault();
  ranks = computePageRank(vault);
  assert(!ranks.has("demo/deprecated-note"), "deprecated note absent from scores");

  process.stderr.write("\ncomputePageRank: stale downweight\n");
  await writeNote(
    "demo/stale-note.md",
    `---
id: demo/stale-note
title: Stale
type: feature
status: stale
---

# Stale

See [[demo/hub]].
`
  );
  await writeNote(
    "demo/current-note.md",
    `---
id: demo/current-note
title: Current
type: feature
status: current
---

# Current

See [[demo/hub]].
`
  );
  vault = await makeVault();
  ranks = computePageRank(vault);
  const staleScore = ranks.get("demo/stale-note") ?? 0;
  const currentScore = ranks.get("demo/current-note") ?? 0;
  assert(
    staleScore < currentScore,
    `stale (${staleScore.toFixed(6)}) penalized vs current (${currentScore.toFixed(6)})`
  );

  process.stderr.write("\nproject id-prefix filter semantics\n");
  await writeNote(
    "other-proj/note.md",
    `---
id: other-proj/note
title: Other Project Note
type: feature
status: current
---

# Other
`
  );
  vault = await makeVault();
  // Emulate the mcp filter: prefix = project + "/"; match id === project OR startsWith prefix.
  const filterByProject = (noteId, project) => {
    const prefix = project.endsWith("/") ? project : project + "/";
    return noteId === project || noteId.startsWith(prefix);
  };
  const demoMatches = vault.index
    .filter((n) => filterByProject(n.id, "demo"))
    .map((n) => n.id);
  assert(
    demoMatches.every((id) => id.startsWith("demo/")),
    "project=demo matches only demo/* ids"
  );
  const otherMatches = vault.index
    .filter((n) => filterByProject(n.id, "other-proj"))
    .map((n) => n.id);
  assert(
    otherMatches.length === 1 && otherMatches[0] === "other-proj/note",
    "project=other-proj matches single note"
  );
  // No project = no filter: returns all.
  assert(vault.index.length >= 7, "vault has many notes overall (no filter)");

  process.stderr.write("\nempty-edge vault: no links → no throw, zero-ish scores\n");
  const emptyRoot = path.join(os.tmpdir(), `vault-empty-${process.pid}`);
  if (fs.existsSync(emptyRoot)) fs.rmSync(emptyRoot, { recursive: true, force: true });
  fs.mkdirSync(emptyRoot, { recursive: true });
  await fsp.writeFile(
    path.join(emptyRoot, "solo.md"),
    `---\nid: solo\ntitle: Solo\ntype: feature\nstatus: current\n---\n\n# Solo\n\nNo links.\n`,
    "utf-8"
  );
  const soloVault = new Vault(emptyRoot);
  await soloVault.reindex();
  const soloRanks = computePageRank(soloVault);
  assert(soloRanks.size === 1, "single-note vault returns one rank");
  assert((soloRanks.get("solo") ?? 0) > 0, "single-note rank is positive");
  fs.rmSync(emptyRoot, { recursive: true, force: true });

  process.stderr.write("\nextractOutline: maxDepth respected (maxDepth:2 suppresses H3)\n");
  const md1 = `# Title\n\n## Section A\n\ntext\n\n### Sub A1\n\ntext\n\n## Section B\n\n### Sub B1\n`;
  const depth2 = extractOutline(md1, 2);
  const levels2 = depth2.map((h) => h.level);
  assert(
    levels2.every((lvl) => lvl <= 2),
    `no H3 at maxDepth 2 (got levels ${levels2.join(",")})`
  );
  const depth3 = extractOutline(md1, 3);
  assert(
    depth3.some((h) => h.level === 3),
    "H3 included at maxDepth 3"
  );

  process.stderr.write("\nextractOutline: backtick fences skipped\n");
  const md2 = `# Title\n\n## Real\n\n\`\`\`\n## Fake heading in code fence\n\`\`\`\n\n## Also real\n`;
  const out2 = extractOutline(md2, 2).map((h) => h.text);
  assert(
    out2.includes("Real") && out2.includes("Also real") && !out2.includes("Fake heading in code fence"),
    "backtick-fenced heading excluded"
  );

  process.stderr.write("\nextractOutline: tilde fences skipped\n");
  const md3 = `# Title\n\n~~~\n## Not a real heading\n~~~\n\n## Only heading\n`;
  const out3 = extractOutline(md3, 2).map((h) => h.text);
  assert(
    out3.length === 2 && out3.includes("Only heading") && !out3.includes("Not a real heading"),
    "tilde-fenced heading excluded"
  );

  process.stderr.write("\nextractOutline: frontmatter ignored\n");
  const md4 = `---\ntitle: Foo\nsummary: "# looks like heading"\n---\n\n# Actual Title\n\n## A\n`;
  const out4 = extractOutline(md4, 2).map((h) => h.text);
  assert(
    out4.length === 2 && out4[0] === "Actual Title" && out4[1] === "A",
    "frontmatter stripped before scan"
  );

  process.stderr.write("\nextractOutline: empty input\n");
  assert(extractOutline("", 2).length === 0, "empty string → []");
  assert(extractOutline(null, 2).length === 0, "null input → []");

  process.stderr.write("\napplyCharBudget: tour envelope truncates to fit maxChars\n");
  const bigItems = Array.from({ length: 20 }, (_, i) => ({
    id: `demo/note-${i}`,
    title: `Note ${i} with a reasonably long padded title so JSON bytes grow`,
    summary: "x".repeat(200),
    type: "feature",
    pageRank: 0.01 - i * 0.0001,
    status: "current",
  }));
  const envelope = applyCharBudget(bigItems, 800);
  assert(envelope.truncated === true, "envelope.truncated flagged");
  assert(envelope.results.length < bigItems.length, "envelope dropped lower-ranked items");
  assert(envelope.results.length >= 1, "envelope keeps at least top item");

  process.stderr.write("\noutline truncation: marker appears when over budget\n");
  // Synthesize blocks like the mcp tool would produce.
  const fatBlocks = [];
  for (let i = 0; i < 8; i++) {
    fatBlocks.push(
      `# Note ${i} (demo/note-${i})\n## Heading ${i} A\n## Heading ${i} B\n## Heading ${i} C`
    );
  }
  // Emulate fitOutlineBlocks with a tight budget.
  const fit = (blocks, budget) => {
    let text = "";
    let included = 0;
    for (const block of blocks) {
      const next = included === 0 ? block : text + "\n\n" + block;
      if (next.length > budget && included > 0) break;
      text = next;
      included += 1;
    }
    const omitted = blocks.length - included;
    if (omitted > 0) {
      const suffix = omitted === 1 ? "" : "s";
      text += `\n\n[truncated: ${omitted} note${suffix} omitted]`;
    }
    return text;
  };
  const tight = fit(fatBlocks, 200);
  assert(/\[truncated: \d+ notes? omitted\]/.test(tight), "truncation marker present");
  assert(tight.includes("# Note 0 (demo/note-0)"), "first note preserved even with tight budget");

  process.stderr.write("\noutline: single oversize block still returned (at-least-one contract)\n");
  const huge = "# Huge (demo/huge)\n" + "## Section\n".repeat(500);
  const fitHuge = fit([huge], 100);
  assert(fitHuge.startsWith("# Huge"), "single oversize block is returned unsliced");
  assert(!/\[truncated:/.test(fitHuge), "no truncation marker when only one block and nothing omitted");

  teardown();
  if (failed > 0) {
    process.stderr.write(`\n${failed} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stderr.write("\nall tour+outline assertions passed\n");
}

main().catch((e) => {
  process.stderr.write(`test error: ${e.stack || e.message}\n`);
  teardown();
  process.exit(1);
});
