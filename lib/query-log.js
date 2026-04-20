import fs from "fs/promises";
import path from "path";

/**
 * Query-miss logging (#25).
 *
 * Opt-in via VAULT_QUERY_LOG=1. Every search tool appends one JSONL line
 * with { timestamp, tool, query, resultCount, topScore, options }. The
 * intent is to surface content gaps — queries that found nothing or
 * nothing good — for later review. Local only; gitignored.
 *
 * Rotation: when the active file exceeds MAX_BYTES, rename it to
 * `query-log.jsonl.1` and start fresh. One rotated file is kept.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MIN_SCORE = 0.3;

let warnedOnFailure = false;
function warnOnce(err) {
  if (warnedOnFailure) return;
  warnedOnFailure = true;
  console.error(`[query-log] logging disabled for this session: ${err.message}`);
}

export function isLoggingEnabled(env = process.env) {
  const v = env.VAULT_QUERY_LOG;
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export function logFilePath(cacheDir) {
  return path.join(cacheDir, "query-log.jsonl");
}

async function rotateIfNeeded(filePath) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  if (stat.size < MAX_BYTES) return;
  const rotated = `${filePath}.1`;
  try { await fs.unlink(rotated); } catch (e) { if (e.code !== "ENOENT") throw e; }
  await fs.rename(filePath, rotated);
}

/**
 * Append a single query entry. Never throws — errors are warned to stderr
 * and then silenced for the remainder of the process. Search tools must
 * keep returning results even if logging fails.
 */
export async function appendEntry(cacheDir, entry) {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const filePath = logFilePath(cacheDir);
    await rotateIfNeeded(filePath);
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
    await fs.appendFile(filePath, line, "utf-8");
  } catch (err) {
    warnOnce(err);
  }
}

/**
 * Read log entries (active file + optional rotated predecessor, oldest-first).
 * Silently skips malformed lines. Returns [] if no log exists.
 */
export async function readEntries(cacheDir, { includeRotated = true } = {}) {
  const active = logFilePath(cacheDir);
  const rotated = `${active}.1`;
  const paths = includeRotated ? [rotated, active] : [active];
  const entries = [];
  for (const p of paths) {
    let raw;
    try {
      raw = await fs.readFile(p, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // skip malformed line
      }
    }
  }
  return entries;
}

/**
 * A "miss" is either zero results or best score below minScore.
 */
export function isMiss(entry, minScore = DEFAULT_MIN_SCORE) {
  if (typeof entry.resultCount !== "number" || entry.resultCount === 0) return true;
  if (typeof entry.topScore !== "number") return false;
  return entry.topScore < minScore;
}

function filterSince(entries, sinceISODate) {
  if (!sinceISODate) return entries;
  const floor = Date.parse(sinceISODate);
  if (Number.isNaN(floor)) return entries;
  return entries.filter((e) => Date.parse(e.timestamp) >= floor);
}

/**
 * Return miss entries in chronological order.
 */
export function listMisses(entries, { minScore = DEFAULT_MIN_SCORE, since } = {}) {
  return filterSince(entries, since).filter((e) => isMiss(e, minScore));
}

/**
 * Group misses by normalized query text, sorted by frequency. Normalization:
 * trim + lowercase. Display uses the first-seen verbatim query.
 */
export function topEmptyQueries(entries, { minScore = DEFAULT_MIN_SCORE, since, limit = 20 } = {}) {
  const misses = listMisses(entries, { minScore, since });
  const groups = new Map();
  for (const e of misses) {
    const q = typeof e.query === "string" ? e.query : "";
    const key = q.trim().toLowerCase();
    if (!key) continue;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.lastSeen = e.timestamp;
      if (typeof e.topScore === "number") g.topScores.push(e.topScore);
      g.tools.add(e.tool);
    } else {
      groups.set(key, {
        query: q.trim(),
        count: 1,
        firstSeen: e.timestamp,
        lastSeen: e.timestamp,
        topScores: typeof e.topScore === "number" ? [e.topScore] : [],
        tools: new Set([e.tool].filter(Boolean)),
      });
    }
  }
  return [...groups.values()]
    .map((g) => ({
      query: g.query,
      count: g.count,
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      bestTopScore: g.topScores.length ? Math.max(...g.topScores) : null,
      tools: [...g.tools],
    }))
    .sort((a, b) => b.count - a.count || a.query.localeCompare(b.query))
    .slice(0, limit);
}

export function tailEntries(entries, n = 20) {
  if (n <= 0) return [];
  return entries.slice(Math.max(0, entries.length - n));
}

/**
 * Remove both active and rotated logs. Returns how many files were
 * actually deleted.
 */
export async function clearLog(cacheDir) {
  const active = logFilePath(cacheDir);
  const rotated = `${active}.1`;
  let removed = 0;
  for (const p of [active, rotated]) {
    try {
      await fs.unlink(p);
      removed++;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  return removed;
}

export const __test = {
  MAX_BYTES,
  DEFAULT_MIN_SCORE,
};
