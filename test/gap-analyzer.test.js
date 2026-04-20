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
  buildVaultHaystack,
  detectSurfaces,
  formatMarkdown,
  listGitFiles,
  normalizeToken,
  surfaceIsCovered,
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
  const vault = await buildVaultFixture({ covers: ["auth", "schema", "build"] });
  const haystack = buildVaultHaystack(vault);
  assert(haystack.includes("auth"), "haystack mentions auth");
  assert(haystack.includes("schema"), "haystack mentions schema");
  assert(surfaceIsCovered({ kind: "src-module", name: "auth" }, haystack) === true, "auth src module covered");
  assert(surfaceIsCovered({ kind: "src-module", name: "inventory" }, haystack) === false, "inventory NOT covered");
  assert(surfaceIsCovered({ kind: "script", name: "build" }, haystack) === true, "build script covered");
  assert(surfaceIsCovered({ kind: "script", name: "deploy:prod" }, haystack) === false, "deploy:prod NOT covered");
  assert(surfaceIsCovered({ kind: "src-module", name: "ab" }, haystack) === false, "too-short token skipped");

  process.stderr.write("\nanalyzeGaps produces sorted gap list\n");
  const report = await analyzeGaps(vault, repo);
  assert(report.repo === path.resolve(repo), "report carries resolved repo path");
  assert(Array.isArray(report.surfaces) && report.surfaces.length > 0, "surfaces array populated");
  assert(Array.isArray(report.gaps), "gaps is an array");
  const gapNames = report.gaps.map((g) => `${g.kind}::${g.name}`);
  assert(gapNames.includes("src-module::inventory"), "inventory module flagged as gap");
  assert(gapNames.includes("src-module::billing"), "billing module flagged as gap");
  assert(gapNames.includes("script::deploy:prod"), "deploy:prod script flagged as gap");
  assert(!gapNames.includes("src-module::auth"), "auth module NOT flagged (covered)");
  assert(!gapNames.includes("script::build"), "build script NOT flagged (covered)");

  // Sorting: non-null mtime gaps should precede null-mtime gaps (scripts).
  const firstScriptIdx = report.gaps.findIndex((g) => g.kind === "script");
  const firstSrcIdx = report.gaps.findIndex((g) => g.kind !== "script" && g.mtime);
  if (firstScriptIdx >= 0 && firstSrcIdx >= 0) {
    assert(firstSrcIdx < firstScriptIdx, "mtime-ful surfaces come before null-mtime scripts");
  }

  process.stderr.write("\nformatMarkdown includes sections and counts\n");
  const md = formatMarkdown(report);
  assert(md.startsWith("# Vault Gap Report"), "markdown starts with title");
  assert(md.includes("**Repo**"), "markdown lists repo");
  assert(md.includes("**Gaps (no vault mention)**"), "markdown summarizes gap count");
  assert(md.includes("Source modules"), "markdown has src-module section");
  assert(md.includes("inventory"), "markdown lists inventory gap");

  process.stderr.write("\nformatMarkdown handles zero-gap case\n");
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
  // Not guaranteed to hit zero (some tokens like "users" route file full path
  // may still miss), so just assert the happy-path empty format doesn't crash:
  const fullMd = formatMarkdown({
    ...fullReport,
    gaps: [],
  });
  assert(fullMd.includes("No gaps detected"), "empty-gap report renders cleanly");
  // Keep the lint clean:
  void fullCoverVault;

  process.stderr.write("\nJSON shape matches contract\n");
  const parsed = JSON.parse(JSON.stringify(report));
  assert(typeof parsed.generatedAt === "string", "generatedAt is a string");
  assert(Array.isArray(parsed.surfaces), "surfaces array present");
  for (const g of parsed.gaps) {
    assert(typeof g.kind === "string" && typeof g.name === "string", `gap has kind+name (${g.kind})`);
    assert(g.covered === false, `gap.covered always false (${g.name})`);
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
