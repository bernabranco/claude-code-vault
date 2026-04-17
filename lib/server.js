import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import chokidar from "chokidar";
import { Vault } from "./vault.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vault = new Vault("./vault");
const app = express();
const PORT = process.env.PORT || 4001;

// Middleware
app.use(express.json());

// Boot: index vault immediately
console.log("Indexing vault...");
await vault.reindex();
console.log(`✓ Indexed ${vault.index.length} notes`);

// Watch for changes to vault files
chokidar
  .watch("./vault/**/*.md", { ignoreInitial: true })
  .on("all", async (event, filePath) => {
    console.log(`[${event}] ${filePath} — re-indexing...`);
    await vault.reindex();
  });

// ===== API ROUTES =====

/**
 * GET /api/notes — List all notes, optionally filtered by tag
 * Query: ?tag=architecture
 */
app.get("/api/notes", (req, res) => {
  const tag = req.query.tag ? String(req.query.tag) : null;
  const notes = vault.list(tag);
  res.json(notes);
});

/**
 * GET /api/notes/:id — Get a single note with full content
 * Supports nested IDs like /api/notes/architecture/auth-flow
 * All parts after /api/notes/ are treated as the note ID (splat)
 */
app.get("/api/notes/*", async (req, res) => {
  const id = req.params[0]; // splat captures everything after /api/notes/
  const note = await vault.getNote(id);

  if (!note) {
    return res.status(404).json({ error: "Note not found" });
  }

  res.json(note);
});

/**
 * GET /api/search — Search notes by query
 * Query: ?q=authentication
 */
app.get("/api/search", (req, res) => {
  const q = req.query.q ? String(req.query.q) : "";
  if (!q.trim()) {
    return res.json([]);
  }

  const results = vault.search(q);
  res.json(results);
});

/**
 * GET /api/graph — Get graph of all notes and their links
 * Returns { nodes, edges }
 */
app.get("/api/graph", (req, res) => {
  const graph = vault.getGraph();
  res.json(graph);
});

/**
 * GET /api/tags — Get all unique tags across the vault
 */
app.get("/api/tags", (req, res) => {
  const tagSet = new Set();
  for (const note of vault.index) {
    note.tags.forEach((tag) => tagSet.add(tag));
  }

  const tags = Array.from(tagSet).sort();
  res.json(tags);
});

/**
 * POST /api/reindex — Force a re-index of the vault
 */
app.post("/api/reindex", async (req, res) => {
  console.log("Manual reindex requested");
  await vault.reindex();
  res.json({
    totalNotes: vault.index.length,
    lastIndexed: vault.lastIndexed,
  });
});

// ===== STATIC FILES & SPA FALLBACK =====

// Serve built frontend static files
const distPath = path.join(__dirname, "..", "web", "dist");
app.use(express.static(distPath));

// SPA fallback: any route not matched above serves index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"), (err) => {
    if (err) {
      res.status(404).json({ error: "Frontend not built. Run: npm run build" });
    }
  });
});

// ===== START SERVER =====

app.listen(PORT, () => {
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║      claude-vault running              ║");
  console.log(`║  http://localhost:${PORT}`.padEnd(40) + "║");
  console.log("║  Vault: ./vault                        ║");
  console.log(`║  Notes: ${vault.index.length}`.padEnd(40) + "║");
  console.log("╚════════════════════════════════════════╝\n");
});
