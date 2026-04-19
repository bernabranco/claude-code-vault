#!/usr/bin/env node
/**
 * Retrieval eval harness — issue #15.
 *
 * Runs every gold query against keyword / semantic / chunk search and
 * reports recall@5 + MRR@5. Compares against test/retrieval/baseline.json
 * if present, exits non-zero when a tool's recall@5 drops by more than
 * the gate (default 5pp).
 *
 * Usage:
 *   node test/retrieval/eval.js                  # eval + diff vs baseline
 *   node test/retrieval/eval.js --update-baseline
 *   node test/retrieval/eval.js --gate 10        # tolerate up to 10pp drop
 *   node test/retrieval/eval.js --json           # machine-readable output
 *   node test/retrieval/eval.js --vault ./vault  # override vault dir
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
    gate: 5,
    json: false,
    vault: path.resolve(__dirname, "..", "..", "vault"),
    gold: path.join(__dirname, "gold.json"),
    baseline: path.join(__dirname, "baseline.json"),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--update-baseline") args.updateBaseline = true;
    else if (a === "--json") args.json = true;
    else if (a === "--gate") args.gate = Number(argv[++i]);
    else if (a === "--vault") args.vault = path.resolve(argv[++i]);
    else if (a === "--gold") args.gold = path.resolve(argv[++i]);
    else if (a === "--baseline") args.baseline = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node test/retrieval/eval.js [--update-baseline] [--gate N] [--json] [--vault DIR] [--gold FILE] [--baseline FILE]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
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
  const total = perQuery.length;
  if (total === 0) return { recallAt5: 0, mrrAt5: 0, count: 0 };
  let hits = 0;
  let mrrSum = 0;
  for (const q of perQuery) {
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

    const kwResults = vault.search(q.query).slice(0, K);
    perTool.keyword.push({
      ...baseEntry,
      rank: rankOfNote(kwResults, q.expectedNoteId, "id"),
    });

    const semResults = await semanticSearch(db, vault, q.query, K);
    perTool.semantic.push({
      ...baseEntry,
      rank: rankOfNote(semResults, q.expectedNoteId, "id"),
    });

    const chunkResults = await searchChunks(db, vault, q.query, K);
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

function checkRegression(result, baseline, gatePp) {
  if (!baseline) return { ok: true, regressions: [] };
  const regressions = [];
  for (const tool of Object.keys(result.summary)) {
    const cur = result.summary[tool].overall.recallAt5;
    const base = baseline.summary?.[tool]?.overall?.recallAt5;
    if (base === undefined) continue;
    const dropPp = (base - cur) * 100;
    if (dropPp > gatePp) {
      regressions.push({ tool, basePct: base * 100, curPct: cur * 100, dropPp });
    }
  }
  return { ok: regressions.length === 0, regressions };
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
    const { ok, regressions } = checkRegression(result, baseline, opts.gate);
    if (!ok) {
      console.error(
        `\n✗ Regression: ${regressions.length} tool(s) dropped recall@5 by more than ${opts.gate}pp`,
      );
      for (const r of regressions) {
        console.error(
          `  ${r.tool}: ${r.basePct.toFixed(1)}% → ${r.curPct.toFixed(1)}% (-${r.dropPp.toFixed(1)}pp)`,
        );
      }
      process.exit(1);
    }
    if (baseline) console.log("✓ No retrieval regression.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
