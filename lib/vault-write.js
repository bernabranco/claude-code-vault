import fs from "fs/promises";
import path from "path";
import {
  findFrontmatter,
  parseSections,
  findSection,
  appendToSectionLines,
  replaceSectionLines,
} from "./sections.js";

/**
 * Write-back primitives (#22).
 *
 * Both functions take a reindexed Vault (for validation context), write the
 * target file atomically, and return { id, path, content }. Callers are
 * responsible for reindexing afterwards — keeping write and index concerns
 * separated so MCP can drive embedding resync while the CLI stays simple.
 */

const FM_ARRAY_KEYS = new Set(["tags", "terms"]);
const FM_FIELD_ORDER = [
  "title",
  "type",
  "status",
  "date",
  "lastVerified",
  "description",
  "summary",
  "tags",
  "terms",
];
const VALID_STATUSES = new Set(["draft", "current", "stale", "deprecated"]);

function splitFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1], body: match[2] };
}

function parseFrontmatterBlock(yaml) {
  const fm = {};
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const k = line.slice(0, colonIdx).trim();
    const v = line.slice(colonIdx + 1).trim();
    if (!k) continue;
    if (FM_ARRAY_KEYS.has(k)) {
      const m = v.match(/\[(.*?)\]/);
      fm[k] = m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
    } else {
      fm[k] = v.replace(/^["']|["']$/g, "");
    }
  }
  return fm;
}

function serializeField(k, v) {
  if (FM_ARRAY_KEYS.has(k)) {
    const arr = Array.isArray(v) ? v : [];
    return `${k}: [${arr.join(", ")}]`;
  }
  const s = String(v);
  // Quote strings containing YAML-significant chars so the parser round-trips.
  const needsQuote = /[:#]/.test(s) || /^\s|\s$/.test(s);
  return `${k}: ${needsQuote ? `"${s.replace(/"/g, '\\"')}"` : s}`;
}

function serializeFrontmatter(fm) {
  const lines = [];
  const seen = new Set();
  for (const k of FM_FIELD_ORDER) {
    if (fm[k] == null || fm[k] === "") continue;
    seen.add(k);
    lines.push(serializeField(k, fm[k]));
  }
  for (const k of Object.keys(fm)) {
    if (seen.has(k) || fm[k] == null || fm[k] === "") continue;
    lines.push(serializeField(k, fm[k]));
  }
  return lines.join("\n");
}

function validateId(id) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(id)) {
    throw new Error(
      `id must match [a-zA-Z0-9/_-] and start with alphanumeric: ${id}`
    );
  }
  if (id.includes("..")) throw new Error(`id cannot contain '..': ${id}`);
}

function resolveInsideVault(vaultDir, id) {
  const vaultAbs = path.resolve(vaultDir);
  const fileAbs = path.resolve(path.join(vaultAbs, `${id}.md`));
  if (fileAbs !== vaultAbs && !fileAbs.startsWith(vaultAbs + path.sep)) {
    throw new Error(`Resolved path escapes vault: ${id}`);
  }
  return fileAbs;
}

/**
 * Collect wiki-link targets outside code fences/spans — mirrors vault.js.
 */
function extractWikiTargets(body) {
  const stripped = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const matches = stripped.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
  return matches
    .map((m) => m.replace(/\[\[([^\]|]+).*\]\]/, "$1").trim())
    .filter(Boolean);
}

function findDeadLinks(vault, body, selfId = null, extraIds = []) {
  const noteIds = new Set(vault.index.map((n) => n.id));
  if (selfId) noteIds.add(selfId);
  for (const id of extraIds) noteIds.add(id);
  const dead = [];
  for (const target of extractWikiTargets(body)) {
    if (!noteIds.has(target)) dead.push(target);
  }
  return [...new Set(dead)];
}

function titleCaseFromId(id) {
  const last = id.split("/").pop() || id;
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function writeStubFile(vault, targetId, sourceId) {
  const filePath = resolveInsideVault(vault.vaultDir, targetId);
  // Don't overwrite if someone raced us to it.
  try {
    await fs.stat(filePath);
    return false;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const today = new Date().toISOString().split("T")[0];
  const fm = {
    title: titleCaseFromId(targetId),
    type: "overview",
    status: "draft",
    date: today,
    lastVerified: today,
    description: "Stub — to be written.",
    summary: "Stub — to be written.",
    tags: ["stub"],
  };
  const body = `# ${fm.title}\n\nThis stub was auto-created from a reference in [[${sourceId}]]. Replace this body with the real content.\n`;
  const content = `---\n${serializeFrontmatter(fm)}\n---\n\n${body}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, content);
  return true;
}

/**
 * Create stubs for any unresolved wiki-link targets in `body`. Skips
 * targets whose shape isn't a valid note id. Returns the ids actually
 * created (caller is responsible for reindexing). Assumes the source
 * note itself is a valid link target — we don't stub the source.
 */
async function autoStubDeadLinks(vault, body, sourceId) {
  const targets = extractWikiTargets(body);
  const existing = new Set(vault.index.map((n) => n.id));
  existing.add(sourceId);
  const seen = new Set();
  const created = [];
  for (const target of targets) {
    if (seen.has(target) || existing.has(target)) continue;
    seen.add(target);
    try {
      validateId(target);
    } catch {
      continue; // invalid id shape — leave as a real dead link for the linter
    }
    const wrote = await writeStubFile(vault, target, sourceId);
    if (wrote) created.push(target);
  }
  return created;
}

/**
 * Suggest wiki-links the author probably meant but didn't write: bare
 * mentions of known note titles or glossary terms that aren't already
 * linked. Case-insensitive, word-boundary, strips code fences and inline
 * code. Dedups per target, reports a count + first-occurrence line.
 */
function computeSuggestedLinks(vault, body, selfId) {
  const stripped = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, " ");
  const lines = stripped.split("\n");
  const alreadyLinked = new Set(extractWikiTargets(body));

  const candidates = [];
  for (const note of vault.index) {
    if (note.id === selfId) continue;
    if (alreadyLinked.has(note.id)) continue;
    if (note.title) candidates.push({ target: note.id, text: note.title, matchedOn: "title" });
    if (note.type === "glossary" && Array.isArray(note.frontmatter?.terms)) {
      for (const term of note.frontmatter.terms) {
        if (term && term.trim()) {
          candidates.push({ target: note.id, text: term.trim(), matchedOn: "term" });
        }
      }
    }
  }

  const results = new Map();
  for (const cand of candidates) {
    const esc = cand.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\W)(${esc})(\\W|$)`, "gi");
    let count = 0;
    let firstLine = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      re.lastIndex = 0;
      const matches = line.match(re);
      if (matches) {
        count += matches.length;
        if (firstLine === null) firstLine = i;
      }
    }
    if (count === 0) continue;
    const key = `${cand.target}::${cand.matchedOn}::${cand.text.toLowerCase()}`;
    const prev = results.get(key);
    if (!prev || count > prev.count) {
      results.set(key, {
        target: cand.target,
        matchedText: cand.text,
        matchedOn: cand.matchedOn,
        count,
        firstLine,
      });
    }
  }
  return [...results.values()].sort((a, b) => b.count - a.count || a.target.localeCompare(b.target));
}

async function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

/**
 * Create a new note. Fails on id collision, missing required fields, or
 * — when `opts.autoStub` is false (default) — unresolved wiki-links. When
 * `opts.autoStub` is true, each unresolved target with a valid id shape
 * becomes a draft stub note (tags: [stub]) pointing back at this note;
 * invalid id shapes still throw.
 *
 * Returns { id, path, content, createdStubs, suggestedLinks }.
 * `suggestedLinks` is always computed; `createdStubs` is empty unless
 * autoStub is true.
 */
export async function createNote(vault, params, opts = {}) {
  const {
    id,
    type,
    title,
    body,
    tags = [],
    description = "",
    summary = "",
    status = "current",
  } = params || {};
  const autoStub = opts.autoStub === true;

  validateId(id);
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("body is required");
  }
  if (!VALID_STATUSES.has(status)) {
    throw new Error(
      `status must be one of ${[...VALID_STATUSES].join(", ")}: got "${status}"`
    );
  }

  const filePath = resolveInsideVault(vault.vaultDir, id);

  let exists = false;
  try {
    await fs.stat(filePath);
    exists = true;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (exists) throw new Error(`Note already exists: ${id}`);

  let createdStubs = [];
  if (autoStub) {
    createdStubs = await autoStubDeadLinks(vault, body, id);
  }
  const dead = findDeadLinks(vault, body, id, createdStubs);
  if (dead.length > 0) {
    throw new Error(
      `Body has unresolved wiki-links: ${dead.join(", ")}. Create targets first, or fix the reference.`
    );
  }

  const today = new Date().toISOString().split("T")[0];
  const fm = {
    title,
    type,
    status,
    date: today,
    lastVerified: today,
    description,
    summary,
    tags,
  };

  const content = `---\n${serializeFrontmatter(fm)}\n---\n\n${body.trim()}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, content);

  const suggestedLinks = computeSuggestedLinks(vault, body, id);
  return {
    id,
    path: path.relative(vault.vaultDir, filePath),
    content,
    createdStubs,
    suggestedLinks,
  };
}

/**
 * Update an existing note. Content may be either:
 *
 *   1. Full markdown with a leading `---` frontmatter block. Frontmatter
 *      is merge-patched over the existing file's frontmatter (new keys win
 *      on overlap; untouched keys are preserved). Body is replaced.
 *
 *   2. Body-only markdown (no leading frontmatter block). Existing
 *      frontmatter is preserved verbatim; body is replaced.
 *
 * Fails if the note doesn't exist (use createNote) or the body introduces
 * unresolved wiki-links.
 */
export async function writeNote(vault, id, content, opts = {}) {
  const autoStub = opts.autoStub === true;
  validateId(id);
  if (typeof content !== "string") throw new Error("content must be a string");

  const filePath = resolveInsideVault(vault.vaultDir, id);

  let existing;
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Note not found: ${id} (use createNote to create it)`);
    }
    throw err;
  }

  const existingSplit = splitFrontmatter(existing);
  const existingFm = existingSplit.frontmatter
    ? parseFrontmatterBlock(existingSplit.frontmatter)
    : {};

  const incoming = splitFrontmatter(content);
  let mergedFm;
  let body;
  if (incoming.frontmatter !== null) {
    const patch = parseFrontmatterBlock(incoming.frontmatter);
    mergedFm = { ...existingFm, ...patch };
    body = incoming.body;
  } else {
    mergedFm = existingFm;
    body = content;
  }
  body = body.trim();
  if (!body) throw new Error("body cannot be empty");

  let createdStubs = [];
  if (autoStub) {
    createdStubs = await autoStubDeadLinks(vault, body, id);
  }
  const dead = findDeadLinks(vault, body, id, createdStubs);
  if (dead.length > 0) {
    throw new Error(
      `Body has unresolved wiki-links: ${dead.join(", ")}. Create targets first, or fix the reference.`
    );
  }

  const newContent = `---\n${serializeFrontmatter(mergedFm)}\n---\n\n${body}\n`;
  await atomicWrite(filePath, newContent);

  const suggestedLinks = computeSuggestedLinks(vault, body, id);
  return {
    id,
    path: path.relative(vault.vaultDir, filePath),
    content: newContent,
    createdStubs,
    suggestedLinks,
  };
}

/**
 * Edit a single heading-section of an existing note. `mode` is "append" or
 * "replace". headingPath is a strict ancestor chain (see sections.js). The
 * heading line itself is never modified; frontmatter is left untouched.
 *
 * Fails if the note doesn't exist, the path doesn't match (or matches more
 * than one section), or the resulting body introduces unresolved wiki-links.
 */
export async function editSection(vault, id, mode, headingPath, content, opts = {}) {
  const autoStub = opts.autoStub === true;
  if (mode !== "append" && mode !== "replace") {
    throw new Error(`mode must be "append" or "replace", got ${mode}`);
  }
  validateId(id);
  if (typeof content !== "string") throw new Error("content must be a string");
  if (mode === "append" && content.trim() === "") {
    throw new Error("content cannot be empty for append");
  }

  const filePath = resolveInsideVault(vault.vaultDir, id);

  let existing;
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Note not found: ${id} (use createNote to create it)`);
    }
    throw err;
  }

  const { fmEnd } = findFrontmatter(existing);
  const fmText = existing.slice(0, fmEnd);
  const bodyText = existing.slice(fmEnd);
  const trailingNewline = bodyText.endsWith("\n");
  const bodyLines = bodyText.replace(/\n$/, "").split("\n");

  const sections = parseSections(bodyLines);
  const section = findSection(sections, headingPath);

  const updatedLines =
    mode === "append"
      ? appendToSectionLines(bodyLines, section, content)
      : replaceSectionLines(bodyLines, section, content);

  let updatedBody = updatedLines.join("\n");
  if (trailingNewline && !updatedBody.endsWith("\n")) updatedBody += "\n";

  let createdStubs = [];
  if (autoStub) {
    createdStubs = await autoStubDeadLinks(vault, updatedBody, id);
  }
  const dead = findDeadLinks(vault, updatedBody, id, createdStubs);
  if (dead.length > 0) {
    throw new Error(
      `Body has unresolved wiki-links after edit: ${dead.join(
        ", "
      )}. Create targets first, or fix the reference.`
    );
  }

  const newContent = fmText + updatedBody;
  await atomicWrite(filePath, newContent);

  const suggestedLinks = computeSuggestedLinks(vault, updatedBody, id);
  return {
    id,
    path: path.relative(vault.vaultDir, filePath),
    content: newContent,
    createdStubs,
    suggestedLinks,
  };
}

// Exported for testing.
export const __test = {
  splitFrontmatter,
  parseFrontmatterBlock,
  serializeFrontmatter,
  validateId,
  extractWikiTargets,
  titleCaseFromId,
  computeSuggestedLinks,
  autoStubDeadLinks,
};
