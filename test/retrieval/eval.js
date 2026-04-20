#!/usr/bin/env node
/**
 * Retrieval eval harness — issue #15 + #28.
 *
 * Runs every gold query against keyword / semantic / chunk search and
 * reports recall@5 + MRR@5. Compares against test/retrieval/baseline.json
 * if present and applies a two-tier gate:
 *   - drop > --gate pp (default 2pp) on any tool → fail (exit 1)
 *   - drop between --warn-gate (default 0.5pp) and --gate pp → warn on
 *     stderr as a GitHub Actions workflow annotation, exit 0
 *
 * Usage:
 *   node test/retrieval/eval.js                     # eval + diff vs baseline
 *   node test/retrieval/eval.js --update-baseline   # rewrite baseline.json
 *   node test/retrieval/eval.js --gate 2            # fail threshold in pp
 *   node test/retrieval/eval.js --warn-gate 0.5     # warn threshold in pp
 *   node test/retrieval/eval.js --json              # machine-readable output
 *   node test/retrieval/eval.js --vault ./vault     # override vault dir
 */
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { Vault } from "../../lib/vault.js";
import {
  openEmbeddingsDb,
  syncEmbeddings,
  semanticSearch,
  searchChunks,
} from "../../lib/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K = 5;

function parseArgs(argv) {
  const args = {
    updateBaseline: false,
    gate: 2,
    warnGate: 0.5,
    json: false,
    hyde: false,
    vault: path.resolve(__dirname, "..", "..", "vault"),
    gold: path.join(__dirname, "gold.json"),
    baseline: path.join(__dirname, "baseline.json"),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--update-baseline") args.updateBaseline = true;
    else if (a === "--json") args.json = true;
    else if (a === "--hyde") args.hyde = true;
    else if (a === "--gate") args.gate = Number(argv[++i]);
    else if (a === "--warn-gate") args.warnGate = Number(argv[++i]);
    else if (a === "--vault") args.vault = path.resolve(argv[++i]);
    else if (a === "--gold") args.gold = path.resolve(argv[++i]);
    else if (a === "--baseline") args.baseline = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node test/retrieval/eval.js [--update-baseline] [--gate N] [--warn-gate N] [--json] [--hyde] [--vault DIR] [--gold FILE] [--baseline FILE]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.gate) || args.gate < 0) {
    console.error(`--gate must be a non-negative number (got ${args.gate})`);
    process.exit(2);
  }
  if (!Number.isFinite(args.warnGate) || args.warnGate < 0) {
    console.error(`--warn-gate must be a non-negative number (got ${args.warnGate})`);
    process.exit(2);
  }
  if (args.warnGate > args.gate) {
    console.error(
      `--warn-gate (${args.warnGate}pp) must be <= --gate (${args.gate}pp)`,
    );
    process.exit(2);
  }
  return args;
}

function rankOfNote(results, expectedNoteId, idKey) {
  for (let i = 0; i < results.length; i++) {
    if (results[i][idKey] === expectedNoteId) return i + 1;
  }
  return null;
}

function chunkRankMatching(results, expectedNoteId, expectedChunkHeading) {
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.noteId !== expectedNoteId) continue;
    if (!expectedChunkHeading) return i + 1;
    const heading = r.headingPath?.[r.headingPath.length - 1];
    if (heading === expectedChunkHeading) return i + 1;
  }
  return null;
}

function aggregate(perQuery) {
  const scored = perQuery.filter((q) => !q.skipped);
  const total = scored.length;
  if (total === 0) return { recallAt5: 0, mrrAt5: 0, count: 0 };
  let hits = 0;
  let mrrSum = 0;
  for (const q of scored) {
    if (q.rank !== null) {
      hits++;
      mrrSum += 1 / q.rank;
    }
  }
  return {
    recallAt5: Number((hits / total).toFixed(4)),
    mrrAt5: Number((mrrSum / total).toFixed(4)),
    count: total,
  };
}

function aggregateByCategory(perQuery) {
  const byCat = new Map();
  for (const q of perQuery) {
    if (!byCat.has(q.category)) byCat.set(q.category, []);
    byCat.get(q.category).push(q);
  }
  const out = {};
  for (const [cat, qs] of byCat) out[cat] = aggregate(qs);
  return out;
}

async function runEval(opts) {
  const goldRaw = JSON.parse(fs.readFileSync(opts.gold, "utf8"));
  const queries = goldRaw.queries;
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error(`No queries found in ${opts.gold}`);
  }

  const vault = new Vault(opts.vault);
  await vault.reindex();

  const dbPath = path.join(os.tmpdir(), `vault-eval-${process.pid}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = openEmbeddingsDb(dbPath);

  if (!opts.json) {
    process.stderr.write(
      `[eval] vault=${opts.vault} notes=${vault.index.length} queries=${queries.length}\n`,
    );
    if (opts.hyde) {
      const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
      process.stderr.write(
        `[eval] HyDE enabled${hasKey ? "" : " — no ANTHROPIC_API_KEY, falling back to raw queries"}\n`,
      );
    }
    process.stderr.write(`[eval] embedding chunks (one-time)...\n`);
  }
  await syncEmbeddings(db, vault);

  const perTool = {
    keyword: [],
    semantic: [],
    chunks: [],
  };

  for (const q of queries) {
    const baseEntry = {
      query: q.query,
      expectedNoteId: q.expectedNoteId,
      expectedChunkHeading: q.expectedChunkHeading ?? null,
      category: q.category ?? "uncategorized",
    };

    const searchOpts = {
      limit: K,
      ...(q.filters ?? {}),
      hyde: opts.hyde,
      warnIfNoHydeKey: false,
    };

    // Keyword tool is note-level and doesn't support filters; when a query
    // specifies filters we skip keyword so we don't mis-attribute misses.
    if (q.filters) {
      perTool.keyword.push({ ...baseEntry, rank: null, skipped: true });
    } else {
      const kwResults = vault.search(q.query).slice(0, K);
      perTool.keyword.push({
        ...baseEntry,
        rank: rankOfNote(kwResults, q.expectedNoteId, "id"),
      });
    }

    const semResults = await semanticSearch(db, vault, q.query, searchOpts);
    perTool.semantic.push({
      ...baseEntry,
      rank: rankOfNote(semResults, q.expectedNoteId, "id"),
    });

    const chunkResults = await searchChunks(db, vault, q.query, searchOpts);
    perTool.chunks.push({
      ...baseEntry,
      rank: chunkRankMatching(
        chunkResults,
        q.expectedNoteId,
        q.expectedChunkHeading,
      ),
    });
  }

  db.close();
  try { fs.unlinkSync(dbPath); } catch {}

  const summary = {};
  for (const [tool, perQuery] of Object.entries(perTool)) {
    summary[tool] = {
      overall: aggregate(perQuery),
      byCategory: aggregateByCategory(perQuery),
    };
  }
  return { perTool, summary, queryCount: queries.length };
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function printHumanReport(result, baseline) {
  const tools = Object.keys(result.summary);
  console.log("\nRetrieval eval — recall@5 / MRR@5");
  console.log("=".repeat(72));
  console.log(
    "Tool".padEnd(12) +
      "Recall@5".padEnd(12) +
      "MRR@5".padEnd(10) +
      "Δrecall".padEnd(10) +
      "ΔMRR".padEnd(10),
  );
  console.log("-".repeat(72));
  for (const tool of tools) {
    const cur = result.summary[tool].overall;
    const base = baseline?.summary?.[tool]?.overall;
    const dRecall = base ? cur.recallAt5 - base.recallAt5 : null;
    const dMrr = base ? cur.mrrAt5 - base.mrrAt5 : null;
    console.log(
      tool.padEnd(12) +
        fmtPct(cur.recallAt5).padEnd(12) +
        cur.mrrAt5.toFixed(3).padEnd(10) +
        (dRecall === null ? "—".padEnd(10) : fmtDelta(dRecall, true).padEnd(10)) +
        (dMrr === null ? "—".padEnd(10) : fmtDelta(dMrr, false).padEnd(10)),
    );
  }
  console.log("=".repeat(72));

  console.log("\nBy category (recall@5):");
  const cats = new Set();
  for (const tool of tools) {
    for (const c of Object.keys(result.summary[tool].byCategory)) cats.add(c);
  }
  const sortedCats = [...cats].sort();
  console.log(
    "Category".padEnd(20) + tools.map((t) => t.padEnd(12)).join(""),
  );
  console.log("-".repeat(20 + tools.length * 12));
  for (const cat of sortedCats) {
    const row =
      cat.padEnd(20) +
      tools
        .map((t) => {
          const m = result.summary[t].byCategory[cat];
          return (m ? fmtPct(m.recallAt5) : "—").padEnd(12);
        })
        .join("");
    console.log(row);
  }
  console.log();
}

function fmtDelta(n, isPct) {
  if (Math.abs(n) < 0.0001) return "  0.0";
  const sign = n > 0 ? "+" : "";
  return isPct ? `${sign}${(n * 100).toFixed(1)}pp` : `${sign}${n.toFixed(3)}`;
}

function checkRegression(result, baseline, failGatePp, warnGatePp) {
  if (!baseline) return { ok: true, failures: [], warnings: [] };
  const failures = [];
  const warnings = [];
  for (const tool of Object.keys(result.summary)) {
    const cur = result.summary[tool].overall.recallAt5;
    const base = baseline.summary?.[tool]?.overall?.recallAt5;
    if (base === undefined) continue;
    const dropPp = (base - cur) * 100;
    const entry = { tool, basePct: base * 100, curPct: cur * 100, dropPp };
    if (dropPp > failGatePp) {
      failures.push(entry);
    } else if (dropPp > warnGatePp) {
      warnings.push(entry);
    }
  }
  return { ok: failures.length === 0, failures, warnings };
}

async function main() {
  const opts = parseArgs(process.argv);
  const result = await runEval(opts);

  let baseline = null;
  if (fs.existsSync(opts.baseline)) {
    baseline = JSON.parse(fs.readFileSync(opts.baseline, "utf8"));
  }

  if (opts.updateBaseline) {
    const out = {
      generatedAt: new Date().toISOString(),
      queryCount: result.queryCount,
      summary: result.summary,
    };
    fs.writeFileSync(opts.baseline, JSON.stringify(out, null, 2) + "\n");
    process.stderr.write(`[eval] baseline written to ${opts.baseline}\n`);
  }

  if (opts.json) {
    console.log(JSON.stringify({ result: result.summary, baseline: baseline?.summary ?? null }, null, 2));
  } else {
    printHumanReport(result, baseline);
  }

  if (!opts.updateBaseline) {
    reportRegressions(result, baseline, opts);
  }
}

function reportRegressions(result, baseline, opts) {
  const { ok, failures, warnings } = checkRegression(
    result,
    baseline,
    opts.gate,
    opts.warnGate,
  );

  const baselineRel =
    path.relative(process.cwd(), opts.baseline) || opts.baseline;

  for (const w of warnings) {
    const msg = `${w.tool}: recall@5 ${w.basePct.toFixed(1)}% -> ${w.curPct.toFixed(1)}% (-${w.dropPp.toFixed(1)}pp, within warn zone ${opts.warnGate}-${opts.gate}pp)`;
    // GitHub Actions workflow command on stderr — shows up as a PR annotation.
    process.stderr.write(`::warning file=${baselineRel}::${msg}\n`);
  }

  if (!ok) {
    console.error(
      `\n✗ Regression: ${failures.length} tool(s) dropped recall@5 by more than ${opts.gate}pp`,
    );
    for (const r of failures) {
      console.error(
        `  ${r.tool}: ${r.basePct.toFixed(1)}% → ${r.curPct.toFixed(1)}% (-${r.dropPp.toFixed(1)}pp)`,
      );
    }
    process.exit(1);
  }

  if (!baseline) return;
  if (warnings.length > 0) {
    console.log(
      `⚠ ${warnings.length} tool(s) in warn zone (${opts.warnGate}-${opts.gate}pp drop). See stderr annotations.`,
    );
  } else {
    console.log("✓ No retrieval regression.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
