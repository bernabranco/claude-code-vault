import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

/**
 * Repo → vault gap analyzer (issue #26).
 *
 * Identifies "significant surfaces" in a host repo (top-level `src/` subdirs,
 * route-declaring files, schema files, package.json scripts) and reports which
 * ones have **no** corresponding vault mention (note id, title, tag, or
 * wiki-link target). Surfaces are sorted by recency of last `git log` touch so
 * the most actively-churning undocumented areas float to the top.
 *
 * Conservative by design: uses `git ls-files` to respect `.gitignore`, plain
 * substring matching against a normalized haystack of all vault surface tokens,
 * and simple regex heuristics for route/schema detection. False negatives are
 * preferable to false positives — a noisy gap report is worse than a terse one.
 */

const ROUTE_PATTERNS = [
  /\bapp\.(get|post|put|patch|delete|head|options|use|all)\s*\(/,
  /\brouter\.(get|post|put|patch|delete|head|options|use|all)\s*\(/,
  /\b(fastify|server)\.(get|post|put|patch|delete|head|options|route)\s*\(/,
  /@(Get|Post|Put|Patch|Delete|Head|Options|Route|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*\(/,
  /\bcreateRouter\s*\(/,
];

const SCHEMA_FILE_RE = /(^|\/)(schema\.prisma|schema\.sql|.*\.sql)$/i;
const SCHEMA_DIR_RE = /(^|\/)(migrations|migration|prisma|db\/migrate|schema)\//i;
const ROUTE_CANDIDATE_EXT_RE = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|java|kt|rs|php)$/i;

/**
 * Run `git ls-files` inside `repoPath` and return the tracked paths (relative
 * to repoPath). Honors `.gitignore` automatically. Throws if the directory
 * isn't a git repo or git isn't available — callers should handle that.
 */
export function listGitFiles(repoPath) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoPath,
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`git ls-files failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString("utf-8") : "";
    throw new Error(`git ls-files exited ${result.status}: ${stderr.trim()}`);
  }
  const raw = result.stdout.toString("utf-8");
  if (!raw) return [];
  return raw.split("\0").filter((s) => s.length > 0);
}

/**
 * For a given relative file path inside repoPath, return the unix-ish ISO
 * timestamp of its last commit (`git log -1 --format=%cI -- <path>`), or
 * `null` if git has no history for the file (freshly added, untracked, etc).
 */
export function lastCommitISO(repoPath, relFile) {
  const result = spawnSync(
    "git",
    ["log", "-1", "--format=%cI", "--", relFile],
    { cwd: repoPath, encoding: "utf-8" }
  );
  if (result.status !== 0) return null;
  const out = (result.stdout || "").trim();
  return out.length > 0 ? out : null;
}

/**
 * Quick file read that returns empty string on failure (binary files,
 * permissions, etc). Limits to the first ~256 KB because route declarations
 * are always near the top; no need to slurp megabyte bundles.
 */
async function safeReadHead(absPath, maxBytes = 256 * 1024) {
  try {
    const fh = await fs.open(absPath, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      return buf.slice(0, bytesRead).toString("utf-8");
    } finally {
      await fh.close();
    }
  } catch {
    return "";
  }
}

function fileDeclaresRoute(content) {
  if (!content) return false;
  return ROUTE_PATTERNS.some((re) => re.test(content));
}

/**
 * Walk the tracked file list and return significant surfaces.
 * Surface shape: { kind, name, path, mtime }
 *   kind: "src-module" | "route-file" | "schema-file" | "script"
 *   name: human-readable identifier used for matching + display
 *   path: representative repo-relative path (or script name)
 *   mtime: last commit ISO timestamp, or null
 */
export async function detectSurfaces(repoPath, files) {
  const surfaces = [];
  const srcModules = new Map(); // name -> representative file path

  for (const rel of files) {
    const parts = rel.split("/");

    // Top-level src/<subdir>/... — represent the subdir as a single surface.
    if (parts.length >= 3 && parts[0] === "src") {
      const name = parts[1];
      if (!srcModules.has(name)) srcModules.set(name, rel);
    }

    if (SCHEMA_FILE_RE.test(rel) || SCHEMA_DIR_RE.test(rel)) {
      surfaces.push({
        kind: "schema-file",
        name: path.basename(rel),
        path: rel,
        mtime: null,
      });
    }
  }

  for (const [name, repPath] of srcModules) {
    surfaces.push({ kind: "src-module", name, path: repPath, mtime: null });
  }

  // Route detection — only scan files whose extension looks like source code.
  const routeCandidates = files.filter((f) => ROUTE_CANDIDATE_EXT_RE.test(f));
  for (const rel of routeCandidates) {
    const abs = path.join(repoPath, rel);
    const head = await safeReadHead(abs);
    if (fileDeclaresRoute(head)) {
      surfaces.push({
        kind: "route-file",
        name: rel,
        path: rel,
        mtime: null,
      });
    }
  }

  // package.json scripts.
  const pkgRel = files.find((f) => f === "package.json");
  if (pkgRel) {
    try {
      const raw = await fs.readFile(path.join(repoPath, pkgRel), "utf-8");
      const pkg = JSON.parse(raw);
      const scripts = pkg.scripts || {};
      for (const scriptName of Object.keys(scripts)) {
        surfaces.push({
          kind: "script",
          name: scriptName,
          path: `package.json#scripts.${scriptName}`,
          mtime: null,
        });
      }
    } catch {
      // malformed package.json — skip silently
    }
  }

  return dedupeSurfaces(surfaces);
}

function dedupeSurfaces(surfaces) {
  const seen = new Map();
  for (const s of surfaces) {
    const key = `${s.kind}::${s.name}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

/**
 * Normalize a token for conservative substring matching: lowercase, strip
 * path extension, replace non-alphanumeric with spaces, collapse whitespace.
 */
export function normalizeToken(s) {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Build a single normalized haystack string covering vault note ids, titles,
 * tags, and wiki-link targets. Substring matching against this string is the
 * conservative coverage test: if the surface name (normalized) appears
 * anywhere, it's considered documented.
 */
export function buildVaultHaystack(vault) {
  const parts = [];
  for (const note of vault.index) {
    parts.push(normalizeToken(note.id));
    parts.push(normalizeToken(note.title));
    for (const tag of note.tags || []) parts.push(normalizeToken(tag));
    for (const link of note.links || []) parts.push(normalizeToken(link));
  }
  return parts.filter(Boolean).join(" | ");
}

/**
 * Surface is "covered" iff its normalized name has a non-trivial substring
 * match in the haystack. Names shorter than 3 chars are skipped (too noisy).
 */
export function surfaceIsCovered(surface, haystack) {
  const token = normalizeToken(surface.name);
  if (!token || token.length < 3) return false;
  return haystack.includes(token);
}

/**
 * Main entry: produce the gap report.
 *   { repo, generatedAt, surfaces: [...], gaps: [...] }
 * Each gap: { kind, name, path, mtime, covered: false }
 * Gaps are sorted by mtime descending (most recently touched first), with
 * null mtimes last.
 */
export async function analyzeGaps(vault, repoPath, opts = {}) {
  const files = opts.files ?? listGitFiles(repoPath);
  const surfaces = await detectSurfaces(repoPath, files);
  const haystack = buildVaultHaystack(vault);

  const enriched = surfaces.map((s) => {
    const mtime = s.kind === "script" ? null : lastCommitISO(repoPath, s.path);
    return { ...s, mtime, covered: surfaceIsCovered(s, haystack) };
  });

  const gaps = enriched
    .filter((s) => !s.covered)
    .sort((a, b) => {
      if (a.mtime && b.mtime) return a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0;
      if (a.mtime) return -1;
      if (b.mtime) return 1;
      return a.name.localeCompare(b.name);
    });

  return {
    repo: path.resolve(repoPath),
    generatedAt: new Date().toISOString(),
    surfaces: enriched,
    gaps,
  };
}

/**
 * Format the report as a markdown document suitable for stdout or file
 * output. Groups by surface kind, shows the last-touched timestamp, and
 * includes a short summary line at the top.
 */
export function formatMarkdown(report) {
  const lines = [];
  lines.push(`# Vault Gap Report`);
  lines.push("");
  lines.push(`- **Repo**: \`${report.repo}\``);
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **Surfaces scanned**: ${report.surfaces.length}`);
  lines.push(`- **Gaps (no vault mention)**: ${report.gaps.length}`);
  lines.push("");

  if (report.gaps.length === 0) {
    lines.push(`_No gaps detected — every significant surface has at least one vault mention._`);
    lines.push("");
    return lines.join("\n");
  }

  const byKind = new Map();
  for (const g of report.gaps) {
    if (!byKind.has(g.kind)) byKind.set(g.kind, []);
    byKind.get(g.kind).push(g);
  }

  const kindTitles = {
    "src-module": "Source modules",
    "route-file": "Route files",
    "schema-file": "Schema files",
    script: "Package scripts",
  };

  const kindOrder = ["src-module", "route-file", "schema-file", "script"];
  for (const kind of kindOrder) {
    const rows = byKind.get(kind);
    if (!rows || rows.length === 0) continue;
    lines.push(`## ${kindTitles[kind] || kind} (${rows.length})`);
    lines.push("");
    for (const row of rows) {
      const when = row.mtime ? row.mtime.slice(0, 10) : "—";
      lines.push(`- [${when}] \`${row.name}\` — ${row.path}`);
    }
    lines.push("");
  }

  lines.push(`_Sorted by last git commit touching the surface path (most recent first)._`);
  lines.push("");
  return lines.join("\n");
}
