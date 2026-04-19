#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import chokidar from "chokidar";
import fsSync from "fs";
import path from "path";
import { Vault } from "./vault.js";

const vaultDir = process.env.VAULT_DIR || "./vault";
const vault = new Vault(vaultDir);
await vault.reindex();

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
      if (embeddingsDb && syncEmbeddings) await syncEmbeddings(embeddingsDb, vault);
    } catch (e) {
      console.error("reindex failed:", e);
    }
  }, 300);
};

const watcher = chokidar
  .watch(vaultDir, { ignoreInitial: true, ignored: /(^|[\/\\])\../ })
  .on("all", scheduleReindex);

const server = new McpServer({ name: "claude-code-vault", version: "0.1.0" });

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
      "Search vault notes by keyword. Matches against note title, tags, and id — NOT body content. Returns notes ranked by relevance.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().positive().optional(),
    },
  },
  safe(async ({ query, limit }) => {
    const results = vault
      .search(query)
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
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  })
);

server.registerTool(
  "vault_read",
  {
    description:
      "Read a single vault note by id (e.g. 'claude-code-vault/overview'). Returns full raw markdown plus forward links and backlinks.",
    inputSchema: { id: z.string() },
  },
  safe(async ({ id }) => {
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
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  })
);

server.registerTool(
  "vault_list",
  {
    description:
      "List all vault notes, optionally filtered by a tag. Returns id, title, tags, and word count for each.",
    inputSchema: { tag: z.string().optional() },
  },
  safe(async ({ tag }) => {
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
    return {
      content: [{ type: "text", text: JSON.stringify(notes, null, 2) }],
    };
  })
);

server.registerTool(
  "vault_related",
  {
    description:
      "Get the 1-hop graph neighbors for a note: forward links (notes it links to) and backlinks (notes that link to it).",
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
        "Search vault notes by meaning, not exact keywords. Returns notes ranked by cosine similarity of their best-matching chunk to the query, along with the heading path of that best chunk. Supports optional pre-filters: `folder` (prefix match on note id), `tag` (string or array, any-match), and `after`/`before` (YYYY-MM-DD bounds on frontmatter `date`). Filters are applied *before* vector search, so `limit` counts results from the filtered subset. Use when looking for notes *about* a concept (e.g. 'notes about authentication'). Pair with vault_read when you need the full note, or vault_search_chunks when you only need the most relevant paragraphs.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().optional(),
        folder: z.string().optional(),
        tag: z.union([z.string(), z.array(z.string())]).optional(),
        after: z.string().optional(),
        before: z.string().optional(),
        hyde: z.boolean().optional(),
      },
    },
    safe(async ({ query, limit, folder, tag, after, before, hyde }) => {
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
      });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    })
  );

  server.registerTool(
    "vault_search_chunks",
    {
      description:
        "Search vault at the paragraph/section level. Returns the most semantically similar chunks (not whole notes), each with its heading breadcrumb (e.g. 'ADR-001 > Rationale > Why Workers'), the chunk text itself, any wiki-links it contains, and a similarity score. Supports optional pre-filters: `folder` (prefix match on note id), `tag` (string or array, any-match), and `after`/`before` (YYYY-MM-DD bounds on frontmatter `date`). Filters are applied *before* vector search, so `limit` counts results from the filtered subset. Use this when you want just the relevant passage — much cheaper than reading whole notes. Follow up with vault_read if the surrounding file context matters.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().optional(),
        folder: z.string().optional(),
        tag: z.union([z.string(), z.array(z.string())]).optional(),
        after: z.string().optional(),
        before: z.string().optional(),
        hyde: z.boolean().optional(),
      },
    },
    safe(async ({ query, limit, folder, tag, after, before, hyde }) => {
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
      });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    })
  );

  server.registerTool(
    "vault_read_with_context",
    {
      description:
        "Read a note AND its graph neighbors (notes it links to + notes that link to it) in one call. Each neighbor comes with its relation (forward/backlink/bidirectional), an edge weight (how many chunks reference it), and an intro snippet. Use this instead of vault_read when you want the surrounding context — saves round-trips. Bounded by maxChars (default 8000); `truncated: true` in the response means some snippets were trimmed or neighbors dropped.",
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
        "Like vault_search_chunks but also returns graph neighbors of the notes whose chunks were hit. For each chunk result you get the usual (text, heading breadcrumb, links, similarity); additionally a `neighbors` array lists notes linked from those chunks, ranked by edge weight (bidirectional first, then link frequency, then recency). Supports the same pre-filters as vault_search_chunks (`folder`, `tag`, `after`, `before`) — filters are applied to the chunk search stage, not to neighbor expansion. Use when a query needs both the passage and the surrounding graph context. maxChars caps total neighbor-snippet bytes.",
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
      },
    },
    safe(async ({ query, limit, depth, maxChars, folder, tag, after, before, hyde }) => {
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

const shutdown = async () => {
  await watcher.close();
  if (embeddingsDb) embeddingsDb.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
