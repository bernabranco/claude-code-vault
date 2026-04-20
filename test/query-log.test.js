#!/usr/bin/env node
/**
 * Query-miss log assertions — issue #25.
 *
 * Exercises isLoggingEnabled toggling, appendEntry JSONL writes, rotation
 * at MAX_BYTES, readEntries merging active + rotated, miss classification,
 * top-query grouping, tailEntries, and clearLog.
 */
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import {
  isLoggingEnabled,
  logFilePath,
  appendEntry,
  readEntries,
  isMiss,
  listMisses,
  topEmptyQueries,
  tailEntries,
  clearLog,
  __test,
} from "../lib/query-log.js";

const { MAX_BYTES, DEFAULT_MIN_SCORE } = __test;

const CACHE = path.join(os.tmpdir(), `vault-qlog-${process.pid}`);

function reset() {
  if (fs.existsSync(CACHE)) fs.rmSync(CACHE, { recursive: true, force: true });
  fs.mkdirSync(CACHE, { recursive: true });
}
function teardown() {
  try { fs.rmSync(CACHE, { recursive: true, force: true }); } catch {}
}

let failed = 0;
function assert(cond, msg) {
  if (cond) process.stderr.write(`  ✓ ${msg}\n`);
  else { failed++; process.stderr.write(`  ✗ ${msg}\n`); }
}

async function main() {
  reset();

  process.stderr.write("isLoggingEnabled respects env\n");
  assert(isLoggingEnabled({}) === false, "undefined → false");
  assert(isLoggingEnabled({ VAULT_QUERY_LOG: "" }) === false, "empty string → false");
  assert(isLoggingEnabled({ VAULT_QUERY_LOG: "0" }) === false, "'0' → false");
  assert(isLoggingEnabled({ VAULT_QUERY_LOG: "1" }) === true, "'1' → true");
  assert(isLoggingEnabled({ VAULT_QUERY_LOG: "true" }) === true, "'true' → true");
  assert(isLoggingEnabled({ VAULT_QUERY_LOG: "YES" }) === true, "'YES' → true");

  process.stderr.write("\nappendEntry writes one JSONL line per call\n");
  reset();
  await appendEntry(CACHE, { tool: "vault_search", query: "alpha", resultCount: 3, topScore: 0.8, options: {} });
  await appendEntry(CACHE, { tool: "vault_search", query: "beta", resultCount: 0, topScore: null, options: { limit: 5 } });
  const raw = await fsp.readFile(logFilePath(CACHE), "utf-8");
  const lines = raw.trim().split("\n");
  assert(lines.length === 2, "two lines written");
  const parsed = lines.map((l) => JSON.parse(l));
  assert(parsed[0].query === "alpha", "first entry's query preserved");
  assert(parsed[0].timestamp && Date.parse(parsed[0].timestamp) > 0, "timestamp is ISO-parseable");
  assert(parsed[1].options.limit === 5, "options round-trip through JSON");

  process.stderr.write("\nreadEntries returns parsed entries oldest-first\n");
  const entries = await readEntries(CACHE);
  assert(entries.length === 2, "both entries read back");
  assert(entries[0].query === "alpha" && entries[1].query === "beta", "order preserved");

  process.stderr.write("\nreadEntries returns [] when no log exists\n");
  reset();
  const empty = await readEntries(CACHE);
  assert(Array.isArray(empty) && empty.length === 0, "empty array when no file");

  process.stderr.write("\nreadEntries skips malformed lines silently\n");
  reset();
  await appendEntry(CACHE, { tool: "vault_search", query: "ok", resultCount: 1, topScore: 0.5, options: {} });
  // Append a deliberately broken line.
  await fsp.appendFile(logFilePath(CACHE), "not-json-line\n", "utf-8");
  await appendEntry(CACHE, { tool: "vault_search", query: "also-ok", resultCount: 0, topScore: null, options: {} });
  const mixed = await readEntries(CACHE);
  assert(mixed.length === 2, "malformed line skipped, good lines kept");
  assert(mixed[0].query === "ok" && mixed[1].query === "also-ok", "good entries intact");

  process.stderr.write("\nrotation: large active file is renamed to .1 on next append\n");
  reset();
  const active = logFilePath(CACHE);
  // Seed active log to just over MAX_BYTES with valid JSONL so readEntries can parse it.
  const bigEntry = JSON.stringify({
    timestamp: "2026-04-20T00:00:00.000Z",
    tool: "vault_search",
    query: "seed",
    resultCount: 0,
    topScore: null,
    options: {},
    filler: "x".repeat(4096),
  }) + "\n";
  let buf = "";
  while (buf.length <= MAX_BYTES) buf += bigEntry;
  await fsp.writeFile(active, buf, "utf-8");
  const statBefore = await fsp.stat(active);
  assert(statBefore.size > MAX_BYTES, `seed file exceeded threshold (${statBefore.size} > ${MAX_BYTES})`);

  await appendEntry(CACHE, { tool: "vault_search", query: "post-rotate", resultCount: 2, topScore: 0.9, options: {} });
  assert(fs.existsSync(`${active}.1`), "rotated file .1 exists");
  const newActive = await fsp.readFile(active, "utf-8");
  assert(newActive.trim().split("\n").length === 1, "new active file has just the new entry");
  const parsedNew = JSON.parse(newActive.trim());
  assert(parsedNew.query === "post-rotate", "new entry in fresh active file");

  process.stderr.write("\nreadEntries merges rotated + active, rotated first\n");
  const merged = await readEntries(CACHE);
  assert(merged.length > 1, "merged reading returns rotated + active");
  assert(merged[merged.length - 1].query === "post-rotate", "active entry is last (newest)");
  assert(merged[0].query === "seed", "rotated entries come first");

  process.stderr.write("\nincludeRotated=false skips rotated file\n");
  const activeOnly = await readEntries(CACHE, { includeRotated: false });
  assert(activeOnly.length === 1 && activeOnly[0].query === "post-rotate", "active only");

  process.stderr.write("\nrotation only keeps one prior file (second rotation overwrites .1)\n");
  // Seed again — current active is just "post-rotate". Fill it past threshold.
  await fsp.writeFile(active, buf, "utf-8");
  await appendEntry(CACHE, { tool: "vault_search", query: "second-rotate", resultCount: 0, topScore: null, options: {} });
  const rotatedContent = await fsp.readFile(`${active}.1`, "utf-8");
  assert(rotatedContent.includes('"query":"seed"'), "new rotated file is the once-oversize file (second overwrite expected)");

  process.stderr.write("\nisMiss classification\n");
  assert(isMiss({ resultCount: 0 }) === true, "zero results → miss");
  assert(isMiss({ resultCount: 3, topScore: 0.1 }) === true, "low score → miss");
  assert(isMiss({ resultCount: 3, topScore: 0.9 }) === false, "high score → not a miss");
  assert(isMiss({ resultCount: 3, topScore: 0.5 }, 0.9) === true, "custom threshold respected");
  assert(isMiss({ resultCount: 5 }) === false, "results w/ no topScore is not a miss");
  assert(DEFAULT_MIN_SCORE === 0.3, "default min score exposed for tests");

  process.stderr.write("\nlistMisses + since filter\n");
  reset();
  const base = "2026-04-20T12:00:00.000Z";
  // Write entries by hand via appendEntry then override timestamps by rewriting the file.
  const sample = [
    { timestamp: "2026-04-10T00:00:00.000Z", tool: "vault_search", query: "old-miss", resultCount: 0, topScore: null, options: {} },
    { timestamp: "2026-04-19T00:00:00.000Z", tool: "vault_search", query: "recent-miss", resultCount: 0, topScore: null, options: {} },
    { timestamp: "2026-04-19T00:05:00.000Z", tool: "vault_search", query: "recent-hit", resultCount: 5, topScore: 0.9, options: {} },
    { timestamp: base, tool: "vault_search", query: "fresh-miss", resultCount: 0, topScore: null, options: {} },
  ];
  await fsp.writeFile(logFilePath(CACHE), sample.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  const all = await readEntries(CACHE);
  const misses = listMisses(all);
  assert(misses.length === 3, "three misses total");
  const since = listMisses(all, { since: "2026-04-18" });
  assert(since.length === 2, "since filter drops old-miss");
  assert(!since.some((m) => m.query === "old-miss"), "old-miss excluded");
  assert(!since.some((m) => m.query === "recent-hit"), "hit never in misses");

  process.stderr.write("\ntopEmptyQueries groups + sorts\n");
  reset();
  const grouped = [
    { timestamp: "2026-04-10T00:00:00.000Z", tool: "vault_search",        query: "How do deploys work",   resultCount: 0, topScore: null, options: {} },
    { timestamp: "2026-04-11T00:00:00.000Z", tool: "vault_semantic_search", query: "how do deploys work", resultCount: 0, topScore: null, options: {} },
    { timestamp: "2026-04-12T00:00:00.000Z", tool: "vault_search",        query: "  HOW DO DEPLOYS WORK  ", resultCount: 0, topScore: null, options: {} },
    { timestamp: "2026-04-10T00:00:00.000Z", tool: "vault_search",        query: "rare question",         resultCount: 0, topScore: null, options: {} },
    { timestamp: "2026-04-12T00:00:00.000Z", tool: "vault_search",        query: "not a miss",            resultCount: 5, topScore: 0.9, options: {} },
  ];
  await fsp.writeFile(logFilePath(CACHE), grouped.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  const entries2 = await readEntries(CACHE);
  const top = topEmptyQueries(entries2, { limit: 10 });
  assert(top.length === 2, "two distinct miss groups (case+whitespace normalized)");
  assert(top[0].count === 3, "most-frequent group counted thrice");
  assert(top[0].query === "How do deploys work", "display uses first-seen verbatim query");
  assert(top[0].tools.includes("vault_search") && top[0].tools.includes("vault_semantic_search"), "tools aggregated across entries");
  assert(top[0].firstSeen < top[0].lastSeen, "firstSeen < lastSeen when multiple entries");

  process.stderr.write("\ntopEmptyQueries honors minScore\n");
  reset();
  const mixedScored = [
    { timestamp: "2026-04-10T00:00:00.000Z", tool: "vault_search", query: "borderline", resultCount: 1, topScore: 0.25, options: {} },
    { timestamp: "2026-04-11T00:00:00.000Z", tool: "vault_search", query: "borderline", resultCount: 1, topScore: 0.25, options: {} },
    { timestamp: "2026-04-12T00:00:00.000Z", tool: "vault_search", query: "strong",     resultCount: 5, topScore: 0.85, options: {} },
  ];
  await fsp.writeFile(logFilePath(CACHE), mixedScored.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  const entries3 = await readEntries(CACHE);
  const strictTop = topEmptyQueries(entries3, { minScore: 0.3, limit: 10 });
  assert(strictTop.length === 1 && strictTop[0].query === "borderline", "0.3 threshold flags borderline");
  const looserTop = topEmptyQueries(entries3, { minScore: 0.1, limit: 10 });
  assert(looserTop.length === 0, "0.1 threshold hides the borderline misses");
  assert(strictTop[0].bestTopScore !== null, "bestTopScore propagated");

  process.stderr.write("\ntailEntries returns last N\n");
  const entries4 = await readEntries(CACHE);
  const tail2 = tailEntries(entries4, 2);
  assert(tail2.length === 2, "tail returns at most n entries");
  assert(tail2[tail2.length - 1].query === "strong", "last entry is newest");
  assert(tailEntries(entries4, 0).length === 0, "tail 0 returns empty");
  assert(tailEntries(entries4, 99).length === entries4.length, "tail > length returns all");

  process.stderr.write("\nclearLog deletes both files\n");
  reset();
  await appendEntry(CACHE, { tool: "vault_search", query: "a", resultCount: 0, topScore: null, options: {} });
  await fsp.writeFile(`${logFilePath(CACHE)}.1`, "junk\n", "utf-8");
  const removed = await clearLog(CACHE);
  assert(removed === 2, "both active and rotated removed");
  assert(!fs.existsSync(logFilePath(CACHE)), "active gone");
  assert(!fs.existsSync(`${logFilePath(CACHE)}.1`), "rotated gone");
  const noop = await clearLog(CACHE);
  assert(noop === 0, "clearLog is idempotent");

  process.stderr.write("\nappendEntry never throws: bogus path swallows error\n");
  const bogus = "/this/should/not/be/a/writable/path/xyz";
  let threw = false;
  try {
    await appendEntry(bogus, { tool: "vault_search", query: "q", resultCount: 0, topScore: null, options: {} });
  } catch {
    threw = true;
  }
  assert(!threw, "appendEntry catches filesystem errors");

  teardown();
  if (failed > 0) {
    process.stderr.write(`\n✗ ${failed} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stderr.write("\n✓ All query-log assertions passed.\n");
}

main().catch((err) => {
  console.error(err);
  teardown();
  process.exit(1);
});
