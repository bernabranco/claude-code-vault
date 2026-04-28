#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import chokidar from "chokidar";
import fsSync from "fs";
import path from "path";
import { createRequire } from "node:module";
import { Vault } from "./vault.js";
import { lintVault } from "./linter.js";
import { createNote, writeNote, editSection } from "./vault-write.js";
import { appendEntry, isLoggingEnabled } from "./query-log.js";
import { applyCharBudget, DEFAULT_MAX_CHARS } from "./budgets.js";
import { buildGlossary, resolveJargon } from "./glossary.js";
import { computePageRank } from "./graph.js";
import { extractOutline, renderOutlineBlock, fitOutlineBlocks } from "./outline.js";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const queryLogEnabled = isLoggingEnabled();
async function logQuery(tool, query, results, options) {
  if (!queryLogEnabled) return;
  const resultCount = Array.isArray(results) ? results.length : 0;
  let topScore = null;
  if (resultCount > 0) {
    const top = results[0];
    if (typeof top.similarity === "number") topScore = top.similarity;
    else if (typeof top.relevance === "number") topScore = top.relevance;
  }
  await appendEntry(cacheDir, { tool, query, resultCount, topScore, options });
}

const vaultDir = process.env.VAULT_DIR || "./vault";
const vault = new Vault(vaultDir);
await vault.reindex();
let glossary = new Map();
try {
  glossary = await buildGlossary(vault);
} catch (e) {
  console.error("initial glossary build failed:", e.message);
}
let pageRankScores = new Map();
try {
  pageRankScores = computePageRank(vault);
} catch (e) {
  console.error("initial pagerank build failed:", e.message);
}

const cacheDir = path.resolve(vaultDir, "..", ".vault-cache");
fsSync.mkdirSync(cacheDir, { recursive: true });

let embeddingsDb = null;
let embeddingsReady = null;
let syncEmbeddings = null;
let semanticSearch = null;
let searchChunks = null;
let expandNeighbors = null;
try {
  const mod = await import("./embeddings.js");
  const graphMod = await import("./graph.js");
  syncEmbeddings = mod.syncEmbeddings;
  semanticSearch = mod.semanticSearch;
  searchChunks = mod.searchChunks;
  expandNeighbors = graphMod.expandNeighbors;
  embeddingsDb = mod.openEmbeddingsDb(path.join(cacheDir, "embeddings-v2.db"));
  embeddingsReady = syncEmbeddings(embeddingsDb, vault).catch((e) => {
    console.error("initial embedding sync failed:", e);
    embeddingsDb = null;
  });
} catch (e) {
  console.error("semantic search disabled:", e.message);
}

let reindexTimer = null;
const scheduleReindex = () => {
  clearTimeout(reindexTimer);
  reindexTimer = setTimeout(async () => {
    try {
      await vault.reindex();
      glossary = await buildGlossary(vault);
      try {
        pageRankScores = computePageRank(vault);
      } catch (e) {
        console.error("pagerank rebuild failed:", e.message);
      }
      if (embeddingsDb && syncEmbeddings) await syncEmbeddings(embeddingsDb, vault);
    } catch (e) {
      console.error("reindex failed:", e);
    }
  }, 300);
};

const watcher = chokidar
  .watch(vaultDir, { ignoreInitial: true, ignored: /(^|[\/\\])\../ })
  .on("all", scheduleReindex);

const server = new McpServer({ name: "claude-code-vault", version: pkg.version });

const safe = (handler) => async (args) => {
  try {
    return await handler(args);
  } catch (err) {
    console.error("tool handler failed:", err);
    return {
      isError: true,
      content: [{ type: "text", text: `Tool error: ${err.message}` }],
    };
  }
};

server.registerTool(
  "vault_search",
  {
    description:
      "REACH FOR THIS BEFORE Grep when you know a specific term (function name, env var, file name, error string). The vault indexes project docs, ADRs, runbooks, and gotchas — answers to 'what is X?' / 'where is X documented?' live here, not in the source tree. Scoring tiers (higher wins): title match +10, tag match +5, id match +3, body phrase match +2, +1 per matching token for multi-word queries. Metadata hits always outrank body-only hits. Status-aware: `status: deprecated` excluded by default, `status: stale` downranked — override with `includeDeprecated` and `staleWeight` (0..1, default 0.7). Response shape: `{ results, truncated }`; `truncated: true` means lower-ranked results were dropped to fit `maxChars` (default 8000 ≈ 2000 tokens). Top result always returned.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().positive().optional(),
      includeDeprecated: z.boolean().optional(),
      staleWeight: z.number().min(0).max(1).optional(),
      maxChars: z.number().int().positive().optional().default(DEFAULT_MAX_CHARS),
    },
  },
  safe(async ({ query, limit, includeDeprecated, staleWeight, maxChars }) => {
    const ranked = vault
      .search(query, { includeDeprecated, staleWeight })
      .slice(0, limit ?? 10)
      .map(({ id, title, tags, relevance, wordCount, status, type, summary, lastVerified }) => ({
        id,
        title,
        tags,
        relevance,
        wordCount,
        status,
        type,
        summary,
        lastVerified,
      }));
    const envelope = applyCharBudget(ranked, maxChars);
    await logQuery("vault_search", query, ranked, {
      limit,
      includeDeprecated,
      staleWeight,
      maxChars,
      truncated: envelope.truncated,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    };
  })
);

server.registerTool(
  "vault_read",
  {
    description:
      "REACH FOR THIS BEFORE opening source files with Read whenever you have a vault note id in hand (from search, tour, outline, a wiki-link, or a prior turn). Reads a single vault note by id (e.g. 'claude-code-vault/overview'). Returns full raw markdown plus forward links and backlinks. `resolvedTerms` is always present: when `resolveJargon` is true (default), it lists bare mentions of terms defined in any `type: glossary` note — each with `{ term, definition, source, sectionHeading }` — capped at 20 entries per read. When `resolveJargon: false`, it is an empty array. Mentions inside code fences/spans, `[[wiki-links]]`, and frontmatter are ignored; the note's own glossary terms (if it is itself a glossary) are never resolved back to itself.",
    inputSchema: {
      id: z.string(),
      resolveJargon: z.boolean().optional().default(true),
    },
  },
  safe(async ({ id, resolveJargon: shouldResolve }) => {
    const note = await vault.getNote(id);
    if (!note) {
      return {
        isError: true,
        content: [{ type: "text", text: `Note not found: ${id}` }],
      };
    }
    const backlinks = vault.getBacklinksFor(id);
    const payload = {
      id: note.id,
      title: note.title,
      tags: note.tags,
      status: note.status,
      type: note.type,
      summary: note.summary,
      lastVerified: note.lastVerified,
      content: note.content,
      links: note.links,
      backlinks,
    };
    payload.resolvedTerms = shouldResolve === false
      ? []
      : resolveJargon(note.content, glossary, { excludeSourceId: note.id });
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  })
);

server.registerTool(
  "vault_list",
  {
    description:
      "REACH FOR THIS BEFORE Glob / `ls` when you want to discover what the vault covers. Lists all vault notes, optionally filtered by a tag. Returns id, title, tags, and word count for each. Response shape: `{ results, truncated }`. Results are trimmed from the bottom to fit `maxChars` (default 8000 ≈ 2000 tokens); `truncated: true` means more notes exist but were dropped. Use a larger `maxChars` to paginate by byte budget.",
    inputSchema: {
      tag: z.string().optional(),
      maxChars: z.number().int().positive().optional().default(DEFAULT_MAX_CHARS),
    },
  },
  safe(async ({ tag, maxChars }) => {
    const notes = vault.list(tag).map(({ id, title, tags, wordCount, status, type, summary, lastVerified }) => ({
      id,
      title,
      tags,
      wordCount,
      status,
      type,
      summary,
      lastVerified,
    }));
    const envelope = applyCharBudget(notes, maxChars);
    return {
      content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    };
  })
);

server.registerTool(
  "vault_lint",
  {
    description:
      "CALL THIS BEFORE committing a new note or after a batch-edit to catch content-quality issues. Lints the vault for: dead wiki-links, missing frontmatter (title/type/tags/description), orphan notes, heading hierarchy skips, oversize/undersize notes, duplicate-candidate pairs (Jaccard on tokens), stale lastVerified dates, stale stubs (draft notes with tags: [stub] older than staleStubDays), and unknown enum values for status/type. Returns findings as a JSON array — each finding has { level: 'error'|'warning'|'info', code, message, noteId, file, line }. Codes are stable (e.g. 'dead-link', 'stale-stub'). Call this to check vault health before authoring new notes, or after large refactors.",
    inputSchema: {
      staleDays: z.number().int().positive().optional(),
      staleStubDays: z.number().int().positive().optional(),
    },
  },
  safe(async ({ staleDays, staleStubDays }) => {
    const findings = await lintVault(vault, { staleDays, staleStubDays });
    return {
      content: [{ type: "text", text: JSON.stringify(findings, null, 2) }],
    };
  })
);

server.registerTool(
  "vault_related",
  {
    description:
      "CALL THIS AFTER vault_read to decide which neighbor to pull next. Returns the 1-hop graph neighbors for a note: forward links and backlinks. Prefer vault_read_with_context if you know you'll want neighbor bodies in the same call.",
    inputSchema: { id: z.string() },
  },
  safe(async ({ id }) => {
    const exists = vault.index.some((n) => n.id === id);
    if (!exists) {
      return {
        isError: true,
        content: [{ type: "text", text: `Note not found: ${id}` }],
      };
    }
    const payload = {
      forwardLinks: vault.getLinksFor(id),
      backlinks: vault.getBacklinksFor(id),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  })
);

if (embeddingsDb) {
  server.registerTool(
    "vault_semantic_search",
    {
      description:
        "REACH FOR THIS FIRST — before Grep, before Read, before spawning a subagent — on any question-shaped task. The vault is this project's institutional memory (ADRs, design docs, runbooks, gotchas). If this returns nothing relevant, fall back to filesystem search. Searches by meaning, not exact keywords: notes ranked by cosine similarity of their best-matching chunk, returned with that chunk's heading path. Pair with vault_read for the full note, or vault_search_chunks for just the passage. Pre-filters (applied before vector search, so `limit` counts the filtered subset): `folder` (id prefix), `tag` (string or array, any-match), `after`/`before` (YYYY-MM-DD on frontmatter `date`). Status-aware: deprecated notes excluded, stale downranked 0.7×; override with `includeDeprecated` and `staleWeight`. Response shape: `{ results, truncated }` — lower-ranked matches are dropped to fit `maxChars` (default 8000 ≈ 2000 tokens); the top match is always returned.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().optional(),
        folder: z.string().optional(),
        tag: z.union([z.string(), z.array(z.string())]).optional(),
        after: z.string().optional(),
        before: z.string().optional(),
        hyde: z.boolean().optional(),
        includeDeprecated: z.boolean().optional(),
        staleWeight: z.number().min(0).max(1).optional(),
        maxChars: z.number().int().positive().optional().default(DEFAULT_MAX_CHARS),
      },
    },
    safe(async ({ query, limit, folder, tag, after, before, hyde, includeDeprecated, staleWeight, maxChars }) => {
      await embeddingsReady;
      if (!embeddingsDb) {
        return {
          isError: true,
          content: [{ type: "text", text: "Semantic search unavailable (initial sync failed)." }],
        };
      }
      const results = await semanticSearch(embeddingsDb, vault, query, {
        limit: limit ?? 10,
        folder,
        tag,
        after,
        before,
        hyde,
        includeDeprecated,
        staleWeight,
      });
      const envelope = applyCharBudget(results, maxChars);
      await logQuery("vault_semantic_search", query, results, {
        limit,
        folder,
        tag,
        after,
        before,
        hyde,
        includeDeprecated,
        staleWeight,
        maxChars,
        truncated: envelope.truncated,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
      };
    })
  );

  server.registerTool(
    "vault_search_chunks",
    {
      description:
        "REACH FOR THIS BEFORE Grep -A/-B/-C when you want one specific passage, not a whole note. Searches at the paragraph/section level and returns chunks ranked by semantic similarity, each with its heading breadcrumb (e.g. 'ADR-001 > Rationale > Why Workers'), the text, any wiki-links, and a score. Follow up with vault_read if the surrounding file context matters. Pre-filters (applied before vector search, so `limit` counts the filtered subset): `folder` (id prefix), `tag` (string or array, any-match), `after`/`before` (YYYY-MM-DD on frontmatter `date`). Status-aware: chunks from deprecated notes excluded, stale downranked 0.7×; override with `includeDeprecated` and `staleWeight`. Response shape: `{ results, truncated }` — lower-ranked chunks dropped to fit `maxChars` (default 8000 ≈ 2000 tokens); top chunk always returned.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().optional(),
        folder: z.string().optional(),
        tag: z.union([z.string(), z.array(z.string())]).optional(),
        after: z.string().optional(),
        before: z.string().optional(),
        hyde: z.boolean().optional(),
        includeDeprecated: z.boolean().optional(),
        staleWeight: z.number().min(0).max(1).optional(),
        maxChars: z.number().int().positive().optional().default(DEFAULT_MAX_CHARS),
      },
    },
    safe(async ({ query, limit, folder, tag, after, before, hyde, includeDeprecated, staleWeight, maxChars }) => {
      await embeddingsReady;
      if (!embeddingsDb) {
        return {
          isError: true,
          content: [{ type: "text", text: "Chunk search unavailable (initial sync failed)." }],
        };
      }
      const results = await searchChunks(embeddingsDb, vault, query, {
        limit: limit ?? 5,
        folder,
        tag,
        after,
        before,
        hyde,
        includeDeprecated,
        staleWeight,
      });
      const envelope = applyCharBudget(results, maxChars);
      await logQuery("vault_search_chunks", query, results, {
        limit,
        folder,
        tag,
        after,
        before,
        hyde,
        includeDeprecated,
        staleWeight,
        maxChars,
        truncated: envelope.truncated,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
      };
    })
  );

  server.registerTool(
    "vault_read_with_context",
    {
      description:
        "REACH FOR THIS INSTEAD OF vault_read when you're likely to need the surrounding docs — saves multi-call fan-out. Reads a note AND its graph neighbors (notes it links to + notes that link to it) in one call. Each neighbor comes with its relation (forward/backlink/bidirectional), an edge weight (how many chunks reference it), and an intro snippet. Bounded by maxChars (default 8000); `truncated: true` means some snippets were trimmed or neighbors dropped.",
      inputSchema: {
        id: z.string(),
        depth: z.number().int().min(1).max(2).optional(),
        maxChars: z.number().int().positive().optional(),
      },
    },
    safe(async ({ id, depth, maxChars }) => {
      await embeddingsReady;
      if (!embeddingsDb) {
        return {
          isError: true,
          content: [{ type: "text", text: "Graph expansion unavailable (embeddings not ready)." }],
        };
      }
      const note = await vault.getNote(id);
      if (!note) {
        return {
          isError: true,
          content: [{ type: "text", text: `Note not found: ${id}` }],
        };
      }
      const { neighbors, truncated } = await expandNeighbors(
        embeddingsDb,
        vault,
        [id],
        { depth: depth ?? 1, maxChars: maxChars ?? 8000 }
      );
      const payload = {
        note: {
          id: note.id,
          title: note.title,
          tags: note.tags,
          status: note.status,
          type: note.type,
          summary: note.summary,
          lastVerified: note.lastVerified,
          content: note.content,
          links: note.links,
          backlinks: vault.getBacklinksFor(id),
        },
        neighbors,
        truncated,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    })
  );

  server.registerTool(
    "vault_search_chunks_with_context",
    {
      description:
        "REACH FOR THIS INSTEAD OF vault_search_chunks when the answer likely spans a note and its neighbors. Like vault_search_chunks but also returns graph neighbors of the notes whose chunks were hit. For each chunk result you get the usual (text, heading breadcrumb, links, similarity); additionally a `neighbors` array lists notes linked from those chunks, ranked by edge weight (bidirectional first, then link frequency, then recency). Supports the same pre-filters as vault_search_chunks (`folder`, `tag`, `after`, `before`) — filters are applied to the chunk search stage, not to neighbor expansion. Status-aware: chunks from deprecated notes are excluded and chunks from stale notes are downranked (0.7×) by default — override with `includeDeprecated` and `staleWeight`. Use when a query needs both the passage and the surrounding graph context. maxChars caps total neighbor-snippet bytes.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().optional(),
        depth: z.number().int().min(1).max(2).optional(),
        maxChars: z.number().int().positive().optional(),
        folder: z.string().optional(),
        tag: z.union([z.string(), z.array(z.string())]).optional(),
        after: z.string().optional(),
        before: z.string().optional(),
        hyde: z.boolean().optional(),
        includeDeprecated: z.boolean().optional(),
        staleWeight: z.number().min(0).max(1).optional(),
      },
    },
    safe(async ({ query, limit, depth, maxChars, folder, tag, after, before, hyde, includeDeprecated, staleWeight }) => {
      await embeddingsReady;
      if (!embeddingsDb) {
        return {
          isError: true,
          content: [{ type: "text", text: "Graph expansion unavailable (embeddings not ready)." }],
        };
      }
      const chunks = await searchChunks(embeddingsDb, vault, query, {
        limit: limit ?? 5,
        folder,
        tag,
        after,
        before,
        hyde,
        includeDeprecated,
        staleWeight,
      });
      await logQuery("vault_search_chunks_with_context", query, chunks, {
        limit,
        depth,
        maxChars,
        folder,
        tag,
        after,
        before,
        hyde,
        includeDeprecated,
        staleWeight,
      });
      const anchorIds = [...new Set(chunks.map((c) => c.noteId))];
      const { neighbors, truncated } =
        anchorIds.length > 0
          ? await expandNeighbors(embeddingsDb, vault, anchorIds, {
              depth: depth ?? 1,
              maxChars: maxChars ?? 8000,
            })
          : { neighbors: [], truncated: false };
      const payload = { chunks, neighbors, truncated };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    })
  );
}

function normalizeFolderPrefix(folder) {
  if (!folder) return null;
  return folder.endsWith("/") ? folder : folder + "/";
}

function matchesFolder(noteId, folder, prefix) {
  if (!prefix) return true;
  return noteId === folder || noteId.startsWith(prefix);
}

function selectNotes(vault, folder) {
  const prefix = normalizeFolderPrefix(folder);
  return vault.index.filter((n) => {
    if (n.status === "deprecated") return false;
    return matchesFolder(n.id, folder, prefix);
  });
}

async function buildOutlineBlock(note, depth) {
  let raw = "";
  try {
    raw = await fs.readFile(path.join(vault.vaultDir, note.path), "utf-8");
  } catch {
    raw = "";
  }
  return renderOutlineBlock(note, extractOutline(raw, depth));
}

server.registerTool(
  "vault_tour",
  {
    description:
      "REACH FOR THIS AT SESSION START BEFORE exploring directories with Glob/ls — fastest way to orient in an unfamiliar vault. Returns the top-`limit` most important notes, ranked by graph centrality (PageRank, damping 0.85, blended 70/30 with inbound-degree). Deprecated excluded, stale downweighted 0.7×. VAULT_SUMMARY / overview notes get a seed bias so new sessions land on orientation first. `folder` is an optional id-prefix filter (e.g. 'claude-code-vault'). Response shape: `{ results, truncated }`. Each result: `{ id, title, summary, type, pageRank, status }`. Default `limit` 10 (max 200). Bounded by `maxChars` (default 8000 ≈ 2000 tokens).",
    inputSchema: {
      folder: z.string().min(1).optional(),
      limit: z.number().int().positive().max(200).optional(),
      maxChars: z.number().int().positive().optional().default(DEFAULT_MAX_CHARS),
    },
  },
  safe(async ({ folder, limit, maxChars }) => {
    const take = limit ?? 10;
    const ranked = selectNotes(vault, folder)
      .map((n) => ({
        id: n.id,
        title: n.title,
        summary: n.summary ?? null,
        type: n.type ?? null,
        pageRank: pageRankScores.get(n.id) ?? 0,
        status: n.status ?? "current",
      }))
      .sort((a, b) => {
        if (b.pageRank !== a.pageRank) return b.pageRank - a.pageRank;
        return a.id.localeCompare(b.id);
      })
      .slice(0, take);
    const envelope = applyCharBudget(ranked, maxChars);
    return {
      content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    };
  })
);

server.registerTool(
  "vault_outline",
  {
    description:
      "REACH FOR THIS INSTEAD OF reading multiple notes to understand a folder — skimmable TOC of titles + headings, no JSON parsing. Returns a plain-text table of contents: each note's title + top `maxDepth` heading levels. Structure per note: a `# title (id)` line followed by indented `##`/`###` headings. Deprecated excluded. `folder` is an optional id-prefix filter. Default `maxDepth` 2 (H2 only). Headings inside fenced code blocks are skipped. Response shape: `{ outline, truncated, noteCount }` — `outline` is the packed markdown text; if it exceeds `maxChars` (default 8000) it is cut at a whole-note boundary with a trailing `[truncated: N notes omitted]` marker and `truncated` is `true`.",
    inputSchema: {
      folder: z.string().min(1).optional(),
      maxDepth: z.number().int().min(1).max(6).optional(),
      maxChars: z.number().int().positive().optional().default(DEFAULT_MAX_CHARS),
    },
  },
  safe(async ({ folder, maxDepth, maxChars }) => {
    const depth = maxDepth ?? 2;
    const selected = selectNotes(vault, folder)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const budget =
      Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;
    const blocks = await Promise.all(
      selected.map((n) => buildOutlineBlock(n, depth))
    );
    const { text, included, omitted } = fitOutlineBlocks(blocks, budget);
    const envelope = {
      outline: text,
      truncated: omitted > 0,
      noteCount: included,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    };
  })
);

async function resyncAfterWrite() {
  await vault.reindex();
  try {
    glossary = await buildGlossary(vault);
  } catch (e) {
    console.error("post-write glossary rebuild failed:", e.message);
  }
  try {
    pageRankScores = computePageRank(vault);
  } catch (e) {
    console.error("post-write pagerank rebuild failed:", e.message);
  }
  if (embeddingsDb && syncEmbeddings) {
    try {
      await syncEmbeddings(embeddingsDb, vault);
    } catch (e) {
      console.error("post-write embedding sync failed:", e);
    }
  }
}

server.registerTool(
  "vault_create_note",
  {
    description:
      "CALL THIS AFTER a task where vault_search / vault_semantic_search came up empty on something you ended up learning — closes the knowledge loop so the next agent lands on the note instead of re-deriving it. Creates a new vault note. Fails if the id already exists or required fields are missing. Unresolved `[[target]]` wiki-links in the body auto-create draft stub notes (tags: [stub]) pointing back at this note, so authoring never blocks on chain-of-reference; the `createdStubs` field reports which ids were stubbed. Bare mentions of existing note titles or glossary terms come back as `suggestedLinks` (not auto-inserted — the agent decides). Frontmatter is built from the provided fields; `date` and `lastVerified` default to today. After writing, the vault is reindexed and embeddings are synced. Returns `{ note, createdStubs, suggestedLinks }`.",
    inputSchema: {
      id: z.string(),
      type: z.string(),
      title: z.string(),
      body: z.string(),
      tags: z.array(z.string()).optional(),
      description: z.string().optional(),
      summary: z.string().optional(),
      status: z.enum(["draft", "current", "stale", "deprecated"]).optional(),
    },
  },
  safe(async (params) => {
    const result = await createNote(vault, params, { autoStub: true });
    await resyncAfterWrite();
    const note = await vault.getNote(result.id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { note, createdStubs: result.createdStubs, suggestedLinks: result.suggestedLinks },
            null,
            2
          ),
        },
      ],
    };
  })
);

server.registerTool(
  "vault_write",
  {
    description:
      "PREFER vault_append_section / vault_replace_section for targeted edits — use this only for full-note rewrites. Updates an existing vault note. `content` may be either (a) full markdown with a leading `---` frontmatter block — frontmatter is merge-patched over the existing file's frontmatter (new keys win, untouched keys preserved) and body is replaced; or (b) body-only markdown (no leading frontmatter) — existing frontmatter is preserved verbatim and only the body is replaced. Fails if the note does not exist (use vault_create_note) or if the body is empty. Unresolved `[[target]]` wiki-links auto-stub (see vault_create_note). `suggestedLinks` returns bare mentions of known titles/terms. Returns `{ note, createdStubs, suggestedLinks }`.",
    inputSchema: {
      id: z.string(),
      content: z.string(),
    },
  },
  safe(async ({ id, content }) => {
    const result = await writeNote(vault, id, content, { autoStub: true });
    await resyncAfterWrite();
    const note = await vault.getNote(result.id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { note, createdStubs: result.createdStubs, suggestedLinks: result.suggestedLinks },
            null,
            2
          ),
        },
      ],
    };
  })
);

server.registerTool(
  "vault_append_section",
  {
    description:
      "PREFER THIS OVER vault_write when adding to an existing section — surgical edit, no risk of clobbering the rest of the note. Appends `content` to a single heading-section of an existing note, identified by `headingPath` — a strict ancestor chain of heading texts (e.g. `[\"Gotchas\", \"Auth retry storm\"]` for an H2 \"Auth retry storm\" nested directly under H1 \"Gotchas\"). The new content lands after the section's last non-blank body line, before the next same-or-higher heading. The heading line itself is never modified, frontmatter is left untouched. Fails if the path matches zero or multiple sections. Unresolved `[[target]]` wiki-links auto-stub (see vault_create_note); `suggestedLinks` returns bare mentions of known titles/terms. Returns `{ note, createdStubs, suggestedLinks }`.",
    inputSchema: {
      id: z.string(),
      headingPath: z.array(z.string()).min(1),
      content: z.string(),
    },
  },
  safe(async ({ id, headingPath, content }) => {
    const result = await editSection(vault, id, "append", headingPath, content, { autoStub: true });
    await resyncAfterWrite();
    const note = await vault.getNote(result.id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { note, createdStubs: result.createdStubs, suggestedLinks: result.suggestedLinks },
            null,
            2
          ),
        },
      ],
    };
  })
);

server.registerTool(
  "vault_replace_section",
  {
    description:
      "PREFER THIS OVER vault_write when rewriting one section — surgical edit, keeps the rest of the note untouched. Replaces the body of a single heading-section. `headingPath` selects the section under strict-ancestor-chain semantics (see vault_append_section). The heading line is preserved verbatim; everything between it and the next same-or-higher heading — including any nested subsections — is replaced with `content`. Pass an empty `content` to clear the section body. Frontmatter is untouched. Fails on path miss or ambiguous match. Unresolved `[[target]]` wiki-links auto-stub; `suggestedLinks` returns bare mentions. Returns `{ note, createdStubs, suggestedLinks }`.",
    inputSchema: {
      id: z.string(),
      headingPath: z.array(z.string()).min(1),
      content: z.string(),
    },
  },
  safe(async ({ id, headingPath, content }) => {
    const result = await editSection(vault, id, "replace", headingPath, content, { autoStub: true });
    await resyncAfterWrite();
    const note = await vault.getNote(result.id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { note, createdStubs: result.createdStubs, suggestedLinks: result.suggestedLinks },
            null,
            2
          ),
        },
      ],
    };
  })
);

const shutdown = async () => {
  await watcher.close();
  if (embeddingsDb) embeddingsDb.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
