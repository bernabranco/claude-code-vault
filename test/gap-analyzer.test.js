#!/usr/bin/env node
/**
 * Gap analyzer assertions — issue #26.
 *
 * Uses tmpdir fixtures: builds a miniature "host repo" under `git init` with
 * src/ modules, route files, SQL schema, and package.json scripts, plus a
 * tiny vault that covers SOME surfaces but not others. Asserts the gap
 * report flags the right surfaces and respects .gitignore + JSON shape.
 */
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  analyzeGaps,
  buildVaultBodyHaystack,
  buildVaultHaystack,
  classifySurface,
  detectSurfaces,
  formatMarkdown,
  listGitFiles,
  normalizeToken,
  surfaceIsCovered,
  surfaceIsMentioned,
} from "../lib/gap-analyzer.js";
import { Vault } from "../lib/vault.js";

const TMP_BASE = path.join(os.tmpdir(), `vault-gap-${process.pid}`);

let failed = 0;
function assert(cond, msg) {
  if (cond) process.stderr.write(`  ✓ ${msg}\n`);
  else {
    failed++;
    process.stderr.write(`  ✗ ${msg}\n`);
  }
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  if (res.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed in ${cwd}: ${res.stderr || res.stdout}`
    );
  }
  return res.stdout;
}

async function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, "utf-8");
}

function setupDirs(name) {
  const root = path.join(TMP_BASE, name);
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  return root;
}

async function buildRepoFixture() {
  const repo = setupDirs("repo");
  run("git", ["init", "-q"], repo);
  run("git", ["config", "user.email", "test@example.com"], repo);
  run("git", ["config", "user.name", "test"], repo);
  run("git", ["config", "commit.gpgsign", "false"], repo);

  await writeFile(
    repo,
    ".gitignore",
    ["node_modules/", "dist/", "*.log", ""].join("\n")
  );
  await writeFile(
    repo,
    "package.json",
    JSON.stringify(
      {
        name: "hostrepo",
        version: "0.0.1",
        scripts: {
          build: "tsc",
          test: "node --test",
          "deploy:prod": "./scripts/deploy.sh",
        },
      },
      null,
      2
    )
  );

  // src/ modules
  await writeFile(repo, "src/auth/login.js", "export function login() {}\n");
  await writeFile(repo, "src/auth/session.js", "export function session() {}\n");
  await writeFile(repo, "src/billing/charge.js", "export function charge() {}\n");
  await writeFile(repo, "src/inventory/sku.js", "export function sku() {}\n");

  // Route file
  await writeFile(
    repo,
    "src/routes/users.js",
    [
      "import express from 'express';",
      "const router = express.Router();",
      "router.get('/users', (req, res) => res.json([]));",
      "router.post('/users', (req, res) => res.json({}));",
      "export default router;",
    ].join("\n")
  );

  // Schema file
  await writeFile(
    repo,
    "db/schema.sql",
    "CREATE TABLE users (id INT PRIMARY KEY, email TEXT);\n"
  );
  await writeFile(
    repo,
    "db/migrations/001_init.sql",
    "ALTER TABLE users ADD COLUMN created_at TIMESTAMP;\n"
  );

  // Files that SHOULD be ignored
  await writeFile(repo, "node_modules/lodash/index.js", "module.exports = {};\n");
  await writeFile(repo, "dist/bundle.js", "// bundled\n");
  await writeFile(repo, "server.log", "ignored log\n");

  // Non-route JS file that should not be flagged as a route
  await writeFile(
    repo,
    "src/utils/format.js",
    "export function fmt(x) { return String(x); }\n"
  );

  run("git", ["add", "-A"], repo);
  run("git", ["commit", "-q", "-m", "initial"], repo);

  return repo;
}

async function buildVaultFixture({ covers }) {
  const vaultRoot = setupDirs("vault");
  const projectDir = path.join(vaultRoot, "proj");
  fs.mkdirSync(projectDir, { recursive: true });

  // Always create a summary note referencing the vault.
  await writeFile(
    projectDir,
    "VAULT_SUMMARY.md",
    [
      "---",
      "title: Project vault",
      "tags: [proj, index]",
      "date: 2026-04-20",
      "---",
      "",
      "# Project vault",
      "",
      "Entry point.",
      "",
    ].join("\n")
  );

  if (covers.includes("auth")) {
    await writeFile(
      projectDir,
      "features/auth-login.md",
      [
        "---",
        "title: Auth login",
        "tags: [auth, feature]",
        "date: 2026-04-20",
        "---",
        "",
        "# Auth login",
        "",
        "Covers the auth module.",
        "",
      ].join("\n")
    );
  }

  if (covers.includes("schema")) {
    await writeFile(
      projectDir,
      "designs/schema.md",
      [
        "---",
        "title: Database schema",
        "tags: [schema, db]",
        "date: 2026-04-20",
        "---",
        "",
        "# Database schema",
        "",
        "Describes schema.sql.",
        "",
      ].join("\n")
    );
  }

  if (covers.includes("build")) {
    await writeFile(
      projectDir,
      "gotchas/build-pipeline.md",
      [
        "---",
        "title: Build pipeline",
        "tags: [build, ci]",
        "date: 2026-04-20",
        "---",
        "",
        "# Build pipeline",
        "",
        "Notes about the build script.",
        "",
      ].join("\n")
    );
  }

  // If requested, add a note whose body MENTIONS `billing` in prose but
  // whose title/tags/links never use the word — exactly the "mentioned in
  // prose" case we want to distinguish from both uncovered and covered.
  if (covers.includes("billing-prose")) {
    await writeFile(
      projectDir,
      "designs/payments-overview.md",
      [
        "---",
        "title: Payments overview",
        "tags: [payments, commerce]",
        "date: 2026-04-20",
        "---",
        "",
        "# Payments overview",
        "",
        "We integrate Stripe for checkout. The billing flow is described",
        "informally here but does not have its own dedicated note yet.",
        "",
      ].join("\n")
    );
  }

  const vault = new Vault(vaultRoot);
  await vault.reindex();
  return vault;
}

async function main() {
  if (fs.existsSync(TMP_BASE)) fs.rmSync(TMP_BASE, { recursive: true, force: true });
  fs.mkdirSync(TMP_BASE, { recursive: true });

  process.stderr.write("normalizeToken lowercases + strips punctuation\n");
  assert(normalizeToken("src/Auth/Login.js") === "src auth login js".replace(" js", ""), "strips extension + path separators");
  assert(normalizeToken("deploy:prod") === "deploy prod", "colon becomes space");
  assert(normalizeToken("") === "", "empty string safe");
  assert(normalizeToken(null) === "", "null safe");

  process.stderr.write("\nlistGitFiles honors .gitignore\n");
  const repo = await buildRepoFixture();
  const files = listGitFiles(repo);
  assert(files.includes("package.json"), "tracked root file listed");
  assert(files.includes("src/auth/login.js"), "tracked src file listed");
  assert(files.includes("db/schema.sql"), "tracked schema file listed");
  assert(!files.some((f) => f.startsWith("node_modules/")), "node_modules excluded");
  assert(!files.some((f) => f.startsWith("dist/")), "dist excluded");
  assert(!files.some((f) => f.endsWith(".log")), "*.log excluded");

  process.stderr.write("\ndetectSurfaces finds src modules, routes, schemas, scripts\n");
  const surfaces = await detectSurfaces(repo, files);
  const byKind = (kind) => surfaces.filter((s) => s.kind === kind);
  const srcModules = byKind("src-module").map((s) => s.name).sort();
  assert(
    JSON.stringify(srcModules) === JSON.stringify(["auth", "billing", "inventory", "routes", "utils"]),
    `src modules detected: ${srcModules.join(", ")}`
  );
  const routeFiles = byKind("route-file").map((s) => s.name);
  assert(routeFiles.includes("src/routes/users.js"), "express router file detected");
  assert(!routeFiles.includes("src/utils/format.js"), "non-route js file NOT flagged as route");
  const schemaFiles = byKind("schema-file").map((s) => s.name).sort();
  assert(schemaFiles.includes("schema.sql"), "schema.sql detected");
  assert(schemaFiles.includes("001_init.sql"), "migration .sql detected");
  const scripts = byKind("script").map((s) => s.name).sort();
  assert(JSON.stringify(scripts) === JSON.stringify(["build", "deploy:prod", "test"]), "package.json scripts detected");

  process.stderr.write("\nbuildVaultHaystack + surfaceIsCovered substring match\n");
  const vault = await buildVaultFixture({
    covers: ["auth", "schema", "build", "billing-prose"],
  });
  const haystack = buildVaultHaystack(vault);
  assert(Array.isArray(haystack), "haystack is per-note array");
  assert(haystack.some((n) => n.includes("auth")), "haystack mentions auth");
  assert(haystack.some((n) => n.includes("schema")), "haystack mentions schema");
  assert(surfaceIsCovered({ kind: "src-module", name: "auth" }, haystack) === true, "auth src module covered");
  assert(surfaceIsCovered({ kind: "src-module", name: "inventory" }, haystack) === false, "inventory NOT covered");
  assert(surfaceIsCovered({ kind: "script", name: "build" }, haystack) === true, "build script covered");
  assert(surfaceIsCovered({ kind: "script", name: "deploy:prod" }, haystack) === false, "deploy:prod NOT covered");
  assert(surfaceIsCovered({ kind: "src-module", name: "ab" }, haystack) === false, "too-short token skipped");

  process.stderr.write("\nbuildVaultBodyHaystack + surfaceIsMentioned prose match\n");
  const bodyHaystack = await buildVaultBodyHaystack(vault);
  assert(Array.isArray(bodyHaystack), "bodyHaystack is per-note array");
  assert(bodyHaystack.some((n) => n.includes("billing")), "body haystack mentions billing (prose-only)");
  assert(
    surfaceIsMentioned({ kind: "src-module", name: "billing" }, bodyHaystack) === true,
    "billing prose-mentioned"
  );
  assert(
    surfaceIsMentioned({ kind: "src-module", name: "inventory" }, bodyHaystack) === false,
    "inventory NOT even prose-mentioned"
  );
  assert(
    surfaceIsCovered({ kind: "src-module", name: "billing" }, haystack) === false,
    "billing NOT in structural haystack (only prose)"
  );

  process.stderr.write("\nclassifySurface tiers\n");
  assert(
    classifySurface({ kind: "src-module", name: "auth" }, haystack, bodyHaystack) === "covered",
    "auth → covered (structural)"
  );
  assert(
    classifySurface({ kind: "src-module", name: "billing" }, haystack, bodyHaystack) === "mentioned",
    "billing → mentioned (prose only)"
  );
  assert(
    classifySurface({ kind: "src-module", name: "inventory" }, haystack, bodyHaystack) === "uncovered",
    "inventory → uncovered (nowhere)"
  );

  process.stderr.write("\nanalyzeGaps produces three-tier report\n");
  const report = await analyzeGaps(vault, repo);
  assert(report.repo === path.resolve(repo), "report carries resolved repo path");
  assert(Array.isArray(report.surfaces) && report.surfaces.length > 0, "surfaces array populated");
  assert(Array.isArray(report.covered), "covered is an array");
  assert(Array.isArray(report.mentioned), "mentioned is an array");
  assert(Array.isArray(report.uncovered), "uncovered is an array");
  assert(Array.isArray(report.gaps), "gaps alias preserved");
  assert(Array.isArray(report.missing), "missing alias preserved");
  assert(report.gaps === report.uncovered, "gaps alias points at uncovered");
  assert(report.missing === report.uncovered, "missing alias points at uncovered");

  const asKey = (s) => `${s.kind}::${s.name}`;
  const coveredNames = new Set(report.covered.map(asKey));
  const mentionedNames = new Set(report.mentioned.map(asKey));
  const uncoveredNames = new Set(report.uncovered.map(asKey));

  assert(coveredNames.has("src-module::auth"), "auth in covered");
  assert(coveredNames.has("script::build"), "build in covered");
  assert(mentionedNames.has("src-module::billing"), "billing in mentioned (prose only)");
  assert(!coveredNames.has("src-module::billing"), "billing NOT in covered");
  assert(!uncoveredNames.has("src-module::billing"), "billing NOT in uncovered");
  assert(uncoveredNames.has("src-module::inventory"), "inventory in uncovered");
  assert(uncoveredNames.has("script::deploy:prod"), "deploy:prod in uncovered");

  // Every surface has a coverage tier, and the booleans agree.
  for (const s of report.surfaces) {
    assert(
      s.coverage === "covered" || s.coverage === "mentioned" || s.coverage === "uncovered",
      `surface ${s.name} has valid coverage tier (${s.coverage})`
    );
    assert(s.covered === (s.coverage === "covered"), `surface ${s.name} covered bool matches tier`);
  }

  // Sorting: within uncovered, non-null mtime surfaces precede null-mtime scripts.
  const firstScriptIdx = report.uncovered.findIndex((g) => g.kind === "script");
  const firstSrcIdx = report.uncovered.findIndex((g) => g.kind !== "script" && g.mtime);
  if (firstScriptIdx >= 0 && firstSrcIdx >= 0) {
    assert(firstSrcIdx < firstScriptIdx, "mtime-ful uncovered surfaces precede null-mtime scripts");
  }

  process.stderr.write("\nformatMarkdown renders three coverage tiers\n");
  const md = formatMarkdown(report);
  assert(md.startsWith("# Vault Gap Report"), "markdown starts with title");
  assert(md.includes("**Repo**"), "markdown lists repo");
  assert(md.includes("**Uncovered**:"), "markdown shows uncovered count");
  assert(md.includes("**Mentioned (prose only)**:"), "markdown shows mentioned count");
  assert(md.includes("**Covered**:"), "markdown shows covered count");
  assert(md.includes("## Uncovered (no mentions)"), "markdown has Uncovered section");
  assert(md.includes("## Mentioned in prose"), "markdown has Mentioned section");
  assert(md.includes("## Covered"), "markdown has Covered section");
  assert(md.includes("Source modules"), "markdown has src-module subsection");
  assert(md.includes("inventory"), "markdown lists inventory uncovered");
  // billing is mentioned in prose, so it should appear under Mentioned but
  // not under Uncovered.
  const uncoveredBlock = md.slice(
    md.indexOf("## Uncovered"),
    md.indexOf("## Mentioned")
  );
  const mentionedBlock = md.slice(
    md.indexOf("## Mentioned"),
    md.indexOf("## Covered")
  );
  assert(!uncoveredBlock.includes("`billing`"), "billing NOT listed under Uncovered");
  assert(mentionedBlock.includes("`billing`"), "billing listed under Mentioned");

  process.stderr.write("\nformatMarkdown handles zero-uncovered / zero-mentioned case\n");
  const fullCoverVault = await buildVaultFixture({
    covers: ["auth", "schema", "build"],
  });
  // Rebuild with a vault that mentions every surface.
  const vaultRoot2 = setupDirs("vault-full");
  const projectDir2 = path.join(vaultRoot2, "proj");
  await writeFile(
    projectDir2,
    "overview.md",
    [
      "---",
      "title: Coverage",
      "tags: [auth, billing, inventory, routes, utils, users, schema, migrations, build, test, deploy]",
      "date: 2026-04-20",
      "---",
      "",
      "# Coverage",
      "Links: [[auth]] [[billing]] [[inventory]] [[routes]] [[utils]] [[users]] [[schema]] [[deploy prod]] [[001 init]] [[format]]",
      "",
    ].join("\n")
  );
  const vaultFull = new Vault(vaultRoot2);
  await vaultFull.reindex();
  const fullReport = await analyzeGaps(vaultFull, repo);
  // Force an empty-tiers render and assert it renders cleanly.
  const emptyMd = formatMarkdown({
    ...fullReport,
    uncovered: [],
    mentioned: [],
    gaps: [],
    missing: [],
  });
  assert(
    emptyMd.includes("Every significant surface has at least a dedicated vault note"),
    "empty-tier report renders cleanly"
  );
  // Keep the lint clean:
  void fullCoverVault;

  process.stderr.write("\nJSON shape matches three-tier contract\n");
  const parsed = JSON.parse(JSON.stringify(report));
  assert(typeof parsed.generatedAt === "string", "generatedAt is a string");
  assert(Array.isArray(parsed.surfaces), "surfaces array present");
  assert(Array.isArray(parsed.covered), "covered array present in JSON");
  assert(Array.isArray(parsed.mentioned), "mentioned array present in JSON");
  assert(Array.isArray(parsed.uncovered), "uncovered array present in JSON");
  assert(Array.isArray(parsed.gaps), "gaps alias present in JSON");
  assert(Array.isArray(parsed.missing), "missing alias present in JSON");
  for (const s of parsed.surfaces) {
    assert(typeof s.kind === "string" && typeof s.name === "string", `surface has kind+name (${s.kind})`);
    assert(
      s.coverage === "covered" || s.coverage === "mentioned" || s.coverage === "uncovered",
      `surface.coverage is one of the three tiers (${s.name} → ${s.coverage})`
    );
  }
  for (const u of parsed.uncovered) {
    assert(u.coverage === "uncovered", `uncovered entry tagged uncovered (${u.name})`);
    assert(u.covered === false, `uncovered.covered === false (${u.name})`);
  }
  for (const m of parsed.mentioned) {
    assert(m.coverage === "mentioned", `mentioned entry tagged mentioned (${m.name})`);
    assert(m.covered === false, `mentioned.covered === false (${m.name})`);
  }
  for (const c of parsed.covered) {
    assert(c.coverage === "covered", `covered entry tagged covered (${c.name})`);
    assert(c.covered === true, `covered.covered === true (${c.name})`);
  }

  process.stderr.write("\nlistGitFiles on non-repo throws\n");
  const notRepo = path.join(TMP_BASE, "not-a-repo");
  fs.mkdirSync(notRepo, { recursive: true });
  let threw = false;
  try {
    listGitFiles(notRepo);
  } catch {
    threw = true;
  }
  assert(threw, "non-repo path rejected");

  process.stderr.write("\nper-note haystack prevents cross-note bleed\n");
  // Construct a vault with TWO notes where joining them with " | " (the old
  // approach) would accidentally let "auth login" match text spanning the
  // boundary: note A ends with "auth", note B starts with "login". With
  // per-note matching, neither note alone contains "auth login", so a
  // surface named "auth login" must NOT be classified as covered.
  const bleedVaultRoot = setupDirs("bleed-vault");
  const bleedProj = path.join(bleedVaultRoot, "proj");
  fs.mkdirSync(bleedProj, { recursive: true });
  await writeFile(
    bleedProj,
    "a-auth.md",
    ["---", "title: Something auth", "date: 2026-04-20", "---", "", "# Auth", ""].join("\n")
  );
  await writeFile(
    bleedProj,
    "b-login.md",
    ["---", "title: Login flow", "date: 2026-04-20", "---", "", "# Login flow", ""].join("\n")
  );
  const bleedVault = new Vault(bleedVaultRoot);
  await bleedVault.reindex();
  const bleedHaystack = buildVaultHaystack(bleedVault);
  assert(
    surfaceIsCovered({ kind: "src-module", name: "auth login" }, bleedHaystack) === false,
    "multi-word surface does NOT bleed across adjacent notes"
  );
  assert(
    surfaceIsCovered({ kind: "src-module", name: "auth" }, bleedHaystack) === true,
    "single-word surface still matches within one note"
  );
  assert(
    surfaceIsCovered({ kind: "src-module", name: "login" }, bleedHaystack) === true,
    "other single-word surface still matches within its note"
  );

  process.stderr.write("\nempty vault (no notes) → all surfaces uncovered\n");
  const emptyVaultRoot = setupDirs("empty-vault");
  fs.mkdirSync(path.join(emptyVaultRoot, "proj"), { recursive: true });
  const emptyVault = new Vault(emptyVaultRoot);
  await emptyVault.reindex();
  // Should not throw, should produce a report, should have all surfaces as uncovered.
  const emptyReport = await analyzeGaps(emptyVault, repo);
  assert(Array.isArray(emptyReport.uncovered), "empty vault analyze produced uncovered array");
  assert(emptyReport.covered.length === 0, "empty vault: no surfaces covered");
  assert(emptyReport.mentioned.length === 0, "empty vault: no surfaces mentioned");
  assert(
    emptyReport.uncovered.length === emptyReport.surfaces.length,
    "empty vault: every surface in uncovered"
  );

  process.stderr.write("\nmalformed package.json does not crash, yields zero scripts\n");
  const badPkgRepo = setupDirs("bad-pkg-repo");
  run("git", ["init", "-q"], badPkgRepo);
  run("git", ["config", "user.email", "test@example.com"], badPkgRepo);
  run("git", ["config", "user.name", "test"], badPkgRepo);
  run("git", ["config", "commit.gpgsign", "false"], badPkgRepo);
  await writeFile(badPkgRepo, "package.json", "{ this is not valid json ");
  await writeFile(badPkgRepo, "src/thing/x.js", "export function x() {}\n");
  run("git", ["add", "-A"], badPkgRepo);
  run("git", ["commit", "-q", "-m", "initial"], badPkgRepo);
  const badPkgFiles = listGitFiles(badPkgRepo);
  const badPkgSurfaces = await detectSurfaces(badPkgRepo, badPkgFiles);
  const badPkgScripts = badPkgSurfaces.filter((s) => s.kind === "script");
  assert(badPkgScripts.length === 0, "malformed package.json yields zero script surfaces");
  assert(
    badPkgSurfaces.some((s) => s.kind === "src-module" && s.name === "thing"),
    "malformed package.json does not prevent src-module detection"
  );

  process.stderr.write("\nzero-commit git repo → empty files list, not a throw\n");
  const emptyRepo = setupDirs("empty-repo");
  run("git", ["init", "-q"], emptyRepo);
  run("git", ["config", "user.email", "test@example.com"], emptyRepo);
  run("git", ["config", "user.name", "test"], emptyRepo);
  const emptyFiles = listGitFiles(emptyRepo);
  assert(Array.isArray(emptyFiles), "zero-commit repo returned array");
  assert(emptyFiles.length === 0, "zero-commit repo returned empty array");

  process.stderr.write("\ndetectSurfaces skips generated dirs (dist/ etc)\n");
  const skipRepo = setupDirs("skip-dirs-repo");
  run("git", ["init", "-q"], skipRepo);
  run("git", ["config", "user.email", "test@example.com"], skipRepo);
  run("git", ["config", "user.name", "test"], skipRepo);
  run("git", ["config", "commit.gpgsign", "false"], skipRepo);
  // Note: no .gitignore — these dirs are INTENTIONALLY committed to exercise
  // the SKIP_DIRS filter rather than the .gitignore path.
  await writeFile(skipRepo, "src/keep/ok.js", "export function ok() {}\n");
  await writeFile(skipRepo, "dist/bundle/index.js", "router.get('/dist-route', ()=>{});\n");
  await writeFile(skipRepo, "node_modules/pkg/routes.js", "app.get('/nm', ()=>{});\n");
  await writeFile(skipRepo, "coverage/lcov/x.js", "server.get('/cov', ()=>{});\n");
  await writeFile(skipRepo, "build/out.js", "router.post('/b', ()=>{});\n");
  run("git", ["add", "-A"], skipRepo);
  run("git", ["commit", "-q", "-m", "initial"], skipRepo);
  const skipFiles = listGitFiles(skipRepo);
  const skipSurfaces = await detectSurfaces(skipRepo, skipFiles);
  const skipSrcModules = skipSurfaces.filter((s) => s.kind === "src-module").map((s) => s.name);
  assert(skipSrcModules.includes("keep"), "committed real src module is detected");
  assert(
    !skipSurfaces.some((s) => s.path.startsWith("dist/")),
    "dist/ surfaces excluded"
  );
  assert(
    !skipSurfaces.some((s) => s.path.startsWith("node_modules/")),
    "node_modules/ surfaces excluded"
  );
  assert(
    !skipSurfaces.some((s) => s.path.startsWith("coverage/")),
    "coverage/ surfaces excluded"
  );
  assert(
    !skipSurfaces.some((s) => s.path.startsWith("build/")),
    "build/ surfaces excluded"
  );

  process.stderr.write("\nfileDeclaresRoute ignores commented-out routes\n");
  const commentRepo = setupDirs("comment-route-repo");
  run("git", ["init", "-q"], commentRepo);
  run("git", ["config", "user.email", "test@example.com"], commentRepo);
  run("git", ["config", "user.name", "test"], commentRepo);
  run("git", ["config", "commit.gpgsign", "false"], commentRepo);
  // File that ONLY declares a route inside a comment — should NOT be classified.
  await writeFile(
    commentRepo,
    "src/demo/commented.js",
    [
      "// Example of what the route WOULD look like:",
      "// app.get('/example', (req, res) => res.json({}));",
      "/* router.post('/nope', () => {}); */",
      "export function demo() { return 1; }",
      "",
    ].join("\n")
  );
  // Sanity companion: a real live route in the same repo to confirm detection still fires.
  await writeFile(
    commentRepo,
    "src/real/live.js",
    [
      "import express from 'express';",
      "const router = express.Router();",
      "router.get('/live', (req, res) => res.json([]));",
      "export default router;",
      "",
    ].join("\n")
  );
  run("git", ["add", "-A"], commentRepo);
  run("git", ["commit", "-q", "-m", "initial"], commentRepo);
  const commentFiles = listGitFiles(commentRepo);
  const commentSurfaces = await detectSurfaces(commentRepo, commentFiles);
  const commentRoutePaths = new Set(
    commentSurfaces.filter((s) => s.kind === "route-file").map((s) => s.path)
  );
  assert(
    !commentRoutePaths.has("src/demo/commented.js"),
    "file with ONLY commented routes is NOT classified as a route file"
  );
  assert(
    commentRoutePaths.has("src/real/live.js"),
    "file with a live route IS still classified"
  );

  if (fs.existsSync(TMP_BASE)) fs.rmSync(TMP_BASE, { recursive: true, force: true });
  if (failed > 0) {
    process.stderr.write(`\n✗ ${failed} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stderr.write("\n✓ All gap-analyzer assertions passed.\n");
}

main().catch((err) => {
  console.error(err);
  if (fs.existsSync(TMP_BASE)) fs.rmSync(TMP_BASE, { recursive: true, force: true });
  process.exit(1);
});
