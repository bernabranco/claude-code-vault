import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KNOWN_STATUSES = new Set(["draft", "current", "stale", "deprecated"]);
const KNOWN_TYPES = new Set([
  "adr",
  "feature",
  "gotcha",
  "runbook",
  "glossary",
  "overview",
  "architecture",
  "research",
]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const warnedFor = new Set();
function warnOnce(filePath, field, value) {
  const key = `${filePath}::${field}::${value}`;
  if (warnedFor.has(key)) return;
  warnedFor.add(key);
  console.error(`[vault] ${filePath}: unknown ${field} "${value}"`);
}

/**
 * Vault — indexes and searches markdown files in a local directory.
 *
 * - Recursively scans for .md files
 * - Extracts frontmatter (YAML), title, tags, content
 * - Provides full-text search across notes
 * - Exports vault state for Claude context
 */
export class Vault {
  constructor(vaultDir = "./vault") {
    this.vaultDir = path.resolve(vaultDir);
    this.index = [];
    this.lastIndexed = null;
  }

  /**
   * Recursively scan vaultDir and index all .md files.
   * Returns array of { id, path, title, tags, size, wordCount, frontmatter }.
   */
  async reindex() {
    this.index = [];
    await this._scanDir(this.vaultDir);
    this.lastIndexed = new Date().toISOString();
    return this.index;
  }

  async _scanDir(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const atRoot = path.resolve(dir) === this.vaultDir;

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await this._scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          // Skip top-level README.md — it's vault-schema meta-docs, not a note.
          if (atRoot && entry.name.toLowerCase() === "readme.md") continue;
          const note = await this._indexFile(fullPath);
          if (note) this.index.push(note);
        }
      }
    } catch (err) {
      console.error(`Failed to scan ${dir}:`, err.message);
    }
  }

  async _indexFile(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const relativePath = path.relative(this.vaultDir, filePath);
      const id = relativePath.replace(/\.md$/, "").replace(/\\/g, "/");

      // Parse frontmatter (YAML between ---)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      let frontmatter = {};
      let bodyStart = 0;

      if (frontmatterMatch) {
        const fm = frontmatterMatch[1];
        frontmatter = this._parseFrontmatter(fm, relativePath);
        bodyStart = frontmatterMatch[0].length;
      }

      const body = content.slice(bodyStart).trim();

      // Extract title: first H1 or use filename
      let title = frontmatter.title || this._extractTitle(body) || id;

      // Extract tags from frontmatter or #hashtags in content
      const tags = [
        ...(frontmatter.tags || []),
        ...this._extractTags(body),
      ];

      // Extract backlinks: [[note-id]] syntax
      const links = this._extractBacklinks(content);

      // Count words
      const wordCount = body.split(/\s+/).length;

      return {
        id,
        path: relativePath,
        title,
        tags: [...new Set(tags)], // dedupe
        links,
        size: content.length,
        wordCount,
        frontmatter,
        status: frontmatter.status ?? "current",
        type: frontmatter.type ?? null,
        summary: frontmatter.summary ?? frontmatter.description ?? null,
        lastVerified: frontmatter.lastVerified ?? null,
        lastModified: (await fs.stat(filePath)).mtime.toISOString(),
        // Internal-only: lowercased body for substring matching in search()
        // (#56). Leading underscore marks it as "never serialize" — exportAsJson,
        // list(), and MCP payloads explicitly pick their fields, and this one
        // must stay out of every wire format to avoid leaking note bodies.
        _bodyLower: body.toLowerCase(),
      };
    } catch (err) {
      console.error(`Failed to index ${filePath}:`, err.message);
      return null;
    }
  }

  /**
   * Simple YAML frontmatter parser.
   * Recognized: title, tags, date, description, status, type, summary, lastVerified.
   * Unknown enum values for status/type are warned to stderr but kept as-is.
   */
  _parseFrontmatter(yaml, filePath = "<unknown>") {
    const result = {};
    const lines = yaml.split("\n");

    for (const line of lines) {
      const [key, ...valueParts] = line.split(":");
      if (!key || !valueParts.length) continue;

      const k = key.trim();
      const value = valueParts.join(":").trim();

      if (k === "title") {
        result.title = value.replace(/^["']|["']$/g, "");
      } else if (k === "tags") {
        // tags: [auth, firebase, security]
        const match = value.match(/\[(.*?)\]/);
        result.tags = match
          ? match[1].split(",").map((t) => t.trim())
          : [];
      } else if (k === "terms") {
        // terms: [TermOne, TermTwo] (used by glossary notes)
        const match = value.match(/\[(.*?)\]/);
        result.terms = match
          ? match[1].split(",").map((t) => t.trim()).filter(Boolean)
          : [];
      } else if (k === "date") {
        result.date = value;
      } else if (k === "description") {
        result.description = value.replace(/^["']|["']$/g, "");
      } else if (k === "summary") {
        result.summary = value.replace(/^["']|["']$/g, "");
      } else if (k === "status") {
        const v = value.replace(/^["']|["']$/g, "");
        if (v && !KNOWN_STATUSES.has(v)) warnOnce(filePath, "status", v);
        result.status = v || undefined;
      } else if (k === "type") {
        const v = value.replace(/^["']|["']$/g, "");
        if (v && !KNOWN_TYPES.has(v)) warnOnce(filePath, "type", v);
        result.type = v || undefined;
      } else if (k === "lastVerified") {
        const v = value.replace(/^["']|["']$/g, "");
        if (v && !ISO_DATE_RE.test(v)) warnOnce(filePath, "lastVerified", v);
        result.lastVerified = v || undefined;
      }
    }

    return result;
  }

  /**
   * Extract first H1 heading from markdown.
   */
  _extractTitle(markdown) {
    const match = markdown.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract hashtags from content (e.g., #auth, #firebase).
   */
  _extractTags(markdown) {
    const matches = markdown.match(/#\w+/g);
    return matches ? matches.map((tag) => tag.slice(1)) : [];
  }

  /**
   * Extract backlinks from content (e.g., [[note-id]] or [[note-id|label]]).
   * Skips content inside inline code spans and fenced code blocks — wiki-link
   * syntax shown as an example shouldn't count as a real edge.
   */
  _extractBacklinks(content) {
    const stripped = content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "");
    const matches = stripped.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
    return matches
      .map((m) => m.replace(/\[\[([^\]|]+).*\]\]/, "$1").trim())
      .filter((link) => link.length > 0);
  }

  /**
   * Search vault by query (title, tags, id, body).
   *
   * Status-aware (#21): notes with `status: deprecated` are excluded by
   * default; `status: stale` has its relevance multiplied by `staleWeight`
   * (default 0.7). Pass `{ includeDeprecated: true }` to get the raw set.
   *
   * Body matching (#56): body hits add a small weight (2 for full-phrase
   * substring, 1 per token for multi-word queries) so literal identifiers
   * that only appear inside a note body (function names, env-vars, model
   * constants) are findable. Title/tag matches still outrank body-only by
   * design (10 vs ≤2+tokens).
   */
  search(query, opts = {}) {
    if (!query || typeof query !== "string") {
      return [];
    }

    const includeDeprecated = opts.includeDeprecated === true;
    const staleWeight = typeof opts.staleWeight === "number" ? opts.staleWeight : 0.7;
    const q = query.toLowerCase();
    // Split on whitespace for multi-token scoring; ignore tokens shorter than
    // 2 chars so stopword noise ("a", "i") doesn't inflate scores.
    const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
    const isMultiToken = tokens.length > 1;
    const results = [];

    for (const note of this.index) {
      if (!includeDeprecated && note.status === "deprecated") continue;

      const score = this._scoreNote(note, q, tokens, isMultiToken);

      if (score > 0) {
        const relevance = note.status === "stale" ? score * staleWeight : score;
        // Strip the internal-only body-lower field — it must not leak into
        // callers, MCP responses, or JSON exports.
        const safe = { ...note, relevance };
        delete safe._bodyLower;
        results.push(safe);
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Score a single note against the query. Extracted to keep `search()`
   * readable and below the linter's cognitive-complexity threshold.
   */
  _scoreNote(note, q, tokens, isMultiToken) {
    let score = 0;
    if (note.title.toLowerCase().includes(q)) score += 10;
    if (note.tags.some((tag) => tag.toLowerCase().includes(q))) score += 5;
    if (note.id.toLowerCase().includes(q)) score += 3;
    if (note._bodyLower?.includes(q)) score += 2;
    // Multi-token body scoring: 1 point per matching token, so a note that
    // contains all three of ["pv_", "prefix", "key"] outranks one with two.
    if (isMultiToken && note._bodyLower) {
      for (const tok of tokens) {
        if (note._bodyLower.includes(tok)) score += 1;
      }
    }
    return score;
  }

  /**
   * Get a single note by id.
   */
  async getNote(id) {
    const note = this.index.find((n) => n.id === id);
    if (!note) return null;

    // Read full content
    const filePath = path.join(this.vaultDir, note.path);
    const content = await fs.readFile(filePath, "utf-8");

    // Strip internal underscore-prefixed index fields (#56 `_bodyLower`).
    const safe = { ...note, content };
    delete safe._bodyLower;
    return safe;
  }

  /**
   * Export vault as JSON for Claude context.
   */
  exportAsJson() {
    return {
      vault: this.vaultDir,
      indexedAt: this.lastIndexed,
      totalNotes: this.index.length,
      notes: this.index.map((note) => ({
        id: note.id,
        title: note.title,
        tags: note.tags,
        path: note.path,
        wordCount: note.wordCount,
        status: note.status,
        type: note.type,
        summary: note.summary,
        lastVerified: note.lastVerified,
        lastModified: note.lastModified,
      })),
    };
  }

  /**
   * Export vault as markdown for Claude context.
   */
  async exportAsMarkdown() {
    let output = `# Vault Export\n\n`;
    output += `Exported: ${new Date().toISOString()}\n`;
    output += `Total notes: ${this.index.length}\n\n`;

    // Group by tags
    const byTag = {};
    for (const note of this.index) {
      const tag = note.tags[0] || "uncategorized";
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(note);
    }

    for (const [tag, notes] of Object.entries(byTag)) {
      output += `## ${tag}\n\n`;
      for (const note of notes) {
        output += `- **${note.title}** \`${note.id}\` (${note.wordCount} words)\n`;
      }
      output += "\n";
    }

    return output;
  }

  /**
   * List all notes, optionally filtered by tag.
   * Strips internal underscore-prefixed fields (e.g. `_bodyLower` from #56)
   * so callers never see index-only helpers.
   */
  list(tag = null) {
    let notes = this.index;

    if (tag) {
      notes = notes.filter((n) => n.tags.includes(tag));
    }

    return notes
      .map((n) => {
        const safe = { ...n };
        delete safe._bodyLower;
        return safe;
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * Build a graph of notes and their backlinks.
   * Returns { nodes: Note[], edges: [{source, target}] }
   * Only includes edges where both source and target exist.
   */
  getGraph() {
    const nodeIds = new Set(this.index.map((n) => n.id));
    const edges = [];

    for (const note of this.index) {
      if (!note.links) continue;

      for (const link of note.links) {
        // Only add edge if target exists
        if (nodeIds.has(link)) {
          edges.push({ source: note.id, target: link });
        }
      }
    }

    // Strip internal underscore-prefixed index fields (#56 `_bodyLower`) so
    // node payloads sent to the viewer / MCP never carry body text.
    const nodes = this.index.map((n) => {
      const safe = { ...n };
      delete safe._bodyLower;
      return safe;
    });

    return {
      nodes,
      edges,
    };
  }

  /**
   * Get backlinks for a note (notes that link TO this note).
   */
  getBacklinksFor(noteId) {
    const backlinks = [];
    for (const note of this.index) {
      if (note.links && note.links.includes(noteId)) {
        backlinks.push(note.id);
      }
    }
    return backlinks;
  }

  /**
   * Get forward links for a note (notes this note links TO).
   */
  getLinksFor(noteId) {
    const note = this.index.find((n) => n.id === noteId);
    return note ? (note.links || []) : [];
  }
}
