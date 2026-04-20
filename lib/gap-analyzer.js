import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

/**
 * Repo → vault gap analyzer (issue #26).
 *
 * Identifies "significant surfaces" in a host repo (top-level `src/` subdirs,
 * route-declaring files, schema files, package.json scripts) and bucketizes
 * them into three coverage tiers relative to the vault:
 *
 *   - `covered`   — surface name appears in a note id, title, tag, or
 *                   wiki-link target ("strong" documentation signal).
 *   - `mentioned` — surface name appears somewhere in a note body but NOT in
 *                   any structural slot above. Prose-only coverage: the topic
 *                   is discussed but doesn't have a dedicated note.
 *   - `uncovered` — zero mentions anywhere in the vault, including bodies.
 *                   These are the true priority gaps.
 *
 * Surfaces are sorted by recency of last `git log` touch so the most actively-
 * churning under-documented areas float to the top.
 *
 * Conservative by design: uses `git ls-files` to respect `.gitignore`, plain
 * substring matching against normalized haystacks, and simple regex heuristics
 * for route/schema detection. Short tokens (<3 chars) are skipped to avoid
 * false positives.
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
 * strong-signal coverage test: if the surface name (normalized) appears
 * anywhere in this haystack, the surface has a dedicated note / structural
 * mention in the vault.
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
 * Build a normalized haystack of vault note *bodies* only (the markdown
 * content minus frontmatter). Used to detect "mentioned in prose" coverage —
 * surfaces whose name shows up in text but not in any structural slot.
 *
 * Reads files on-demand from disk; vault.index doesn't carry body text.
 */
export async function buildVaultBodyHaystack(vault) {
  const parts = [];
  for (const note of vault.index) {
    try {
      const abs = path.join(vault.vaultDir, note.path);
      const raw = await fs.readFile(abs, "utf-8");
      const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
      const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
      parts.push(normalizeToken(body));
    } catch {
      // unreadable note — skip silently; the structural haystack still covers it
    }
  }
  return parts.filter(Boolean).join(" | ");
}

/**
 * Surface is "covered" (strong signal) iff its normalized name has a
 * non-trivial substring match in the structural haystack. Names shorter than
 * 3 chars are skipped (too noisy).
 */
export function surfaceIsCovered(surface, haystack) {
  const token = normalizeToken(surface.name);
  if (!token || token.length < 3) return false;
  return haystack.includes(token);
}

/**
 * Surface is "mentioned" (weak signal) iff its normalized name appears in the
 * body haystack. Short tokens are skipped on the same rationale.
 */
export function surfaceIsMentioned(surface, bodyHaystack) {
  const token = normalizeToken(surface.name);
  if (!token || token.length < 3) return false;
  return bodyHaystack.includes(token);
}

/**
 * Classify a surface into one of three coverage tiers:
 *   "covered"   — strong structural match (title/id/tag/wiki-link)
 *   "mentioned" — prose match only (body text, no dedicated note)
 *   "uncovered" — no match anywhere
 */
export function classifySurface(surface, structuralHaystack, bodyHaystack) {
  if (surfaceIsCovered(surface, structuralHaystack)) return "covered";
  if (surfaceIsMentioned(surface, bodyHaystack)) return "mentioned";
  return "uncovered";
}

/**
 * Main entry: produce the gap report with three coverage tiers.
 *
 * Return shape:
 *   {
 *     repo, generatedAt,
 *     surfaces: [...],   // all surfaces, each with a `coverage` field
 *     covered:   [...],  // surfaces with coverage === "covered"
 *     mentioned: [...],  // surfaces with coverage === "mentioned"
 *     uncovered: [...],  // surfaces with coverage === "uncovered"
 *     missing:   [...],  // alias for uncovered (back-compat with earlier shape)
 *     gaps:      [...],  // alias for uncovered (back-compat with earlier shape)
 *   }
 *
 * Each surface now has: { kind, name, path, mtime, coverage, covered }.
 * (`covered` boolean kept for back-compat; `coverage` is the new tier string.)
 *
 * Each tier bucket is sorted by mtime descending (most recently touched first),
 * with null mtimes last.
 */
export async function analyzeGaps(vault, repoPath, opts = {}) {
  const files = opts.files ?? listGitFiles(repoPath);
  const surfaces = await detectSurfaces(repoPath, files);
  const structuralHaystack = buildVaultHaystack(vault);
  const bodyHaystack = await buildVaultBodyHaystack(vault);

  const enriched = surfaces.map((s) => {
    const mtime = s.kind === "script" ? null : lastCommitISO(repoPath, s.path);
    const coverage = classifySurface(s, structuralHaystack, bodyHaystack);
    return {
      ...s,
      mtime,
      coverage,
      covered: coverage === "covered",
    };
  });

  const sortByRecency = (a, b) => {
    if (a.mtime && b.mtime) {
      if (a.mtime < b.mtime) return 1;
      if (a.mtime > b.mtime) return -1;
      return 0;
    }
    if (a.mtime) return -1;
    if (b.mtime) return 1;
    return a.name.localeCompare(b.name);
  };

  const covered = enriched.filter((s) => s.coverage === "covered").sort(sortByRecency);
  const mentioned = enriched.filter((s) => s.coverage === "mentioned").sort(sortByRecency);
  const uncovered = enriched.filter((s) => s.coverage === "uncovered").sort(sortByRecency);

  return {
    repo: path.resolve(repoPath),
    generatedAt: new Date().toISOString(),
    surfaces: enriched,
    covered,
    mentioned,
    uncovered,
    missing: uncovered,
    gaps: uncovered,
  };
}

function groupByKind(rows) {
  const byKind = new Map();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind).push(r);
  }
  return byKind;
}

const KIND_TITLES = {
  "src-module": "Source modules",
  "route-file": "Route files",
  "schema-file": "Schema files",
  script: "Package scripts",
};
const KIND_ORDER = ["src-module", "route-file", "schema-file", "script"];

function renderKindSections(lines, rows) {
  const byKind = groupByKind(rows);
  for (const kind of KIND_ORDER) {
    const kindRows = byKind.get(kind);
    if (!kindRows || kindRows.length === 0) continue;
    lines.push(`### ${KIND_TITLES[kind] || kind} (${kindRows.length})`);
    lines.push("");
    for (const row of kindRows) {
      const when = row.mtime ? row.mtime.slice(0, 10) : "—";
      lines.push(`- [${when}] \`${row.name}\` — ${row.path}`);
    }
    lines.push("");
  }
}

/**
 * Format the report as a markdown document with three coverage sections.
 *
 * - `## Uncovered (no mentions)` — top priority: zero presence in the vault,
 *   worth writing a dedicated note.
 * - `## Mentioned in prose (no dedicated note)` — second priority: the topic
 *   appears in body text but nothing promotes it to a title/tag/link, so
 *   retrieval and graph queries miss it. Candidates for promotion.
 * - `## Covered` — count only by default (collapse-friendly). Included so the
 *   denominator is visible.
 */
export function formatMarkdown(report) {
  const lines = [];
  lines.push(`# Vault Gap Report`);
  lines.push("");
  lines.push(`- **Repo**: \`${report.repo}\``);
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **Surfaces scanned**: ${report.surfaces.length}`);
  lines.push(`- **Uncovered**: ${report.uncovered.length}`);
  lines.push(`- **Mentioned (prose only)**: ${report.mentioned.length}`);
  lines.push(`- **Covered**: ${report.covered.length}`);
  lines.push("");

  if (report.surfaces.length === 0) {
    lines.push(`_No surfaces detected in the host repo._`);
    lines.push("");
    return lines.join("\n");
  }

  if (report.uncovered.length === 0 && report.mentioned.length === 0) {
    lines.push(
      `_Every significant surface has at least a dedicated vault note. Nice._`
    );
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`## Uncovered (no mentions)`);
  lines.push("");
  if (report.uncovered.length === 0) {
    lines.push(`_None — every surface appears somewhere in the vault._`);
    lines.push("");
  } else {
    lines.push(
      `_Top priority: no vault note mentions these at all. Consider writing a dedicated note._`
    );
    lines.push("");
    renderKindSections(lines, report.uncovered);
  }

  lines.push(`## Mentioned in prose (no dedicated note)`);
  lines.push("");
  if (report.mentioned.length === 0) {
    lines.push(`_None — every surface that appears in prose also has a title/tag/link entry._`);
    lines.push("");
  } else {
    lines.push(
      `_Second priority: these appear in note bodies but have no dedicated note, tag, or wiki-link target. Retrieval and graph queries likely miss them. Consider promoting to their own note._`
    );
    lines.push("");
    renderKindSections(lines, report.mentioned);
  }

  lines.push(`## Covered (${report.covered.length})`);
  lines.push("");
  lines.push(
    `_These surfaces have at least one note id / title / tag / wiki-link match. Full list omitted — pass \`--json\` for detail._`
  );
  lines.push("");

  lines.push(`_Each section sorted by last git commit touching the surface path (most recent first)._`);
  lines.push("");
  return lines.join("\n");
}
