import fs from "fs/promises";
import path from "path";

/**
 * Vault linter — checks a reindexed Vault for content-quality issues.
 *
 * Finding shape: { level, code, message, noteId, file, line }
 *   level: "error" | "warning" | "info"
 *   code:  stable identifier (part of the public contract; don't rename)
 *   line:  1-based; points at the frontmatter block when field-specific
 */

const DEFAULT_STALE_DAYS = 180;
const MIN_BODY_CHARS = 200;
const MAX_BODY_CHARS = 15000;
const DUP_THRESHOLD = 0.55;

export async function lintVault(vault, opts = {}) {
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const findings = [];
  const noteIds = new Set(vault.index.map((n) => n.id));

  const fileCache = new Map();
  const readFile = async (note) => {
    if (fileCache.has(note.id)) return fileCache.get(note.id);
    const abs = path.join(vault.vaultDir, note.path);
    const raw = await fs.readFile(abs, "utf-8");
    fileCache.set(note.id, raw);
    return raw;
  };

  for (const note of vault.index) {
    const raw = await readFile(note);
    const file = path.join(vault.vaultDir, note.path);
    const lines = splitFrontmatterLines(raw);

    pushMissingFields(findings, note, file, lines);
    pushUnknownEnums(findings, note, file, lines);
    pushDeadLinks(findings, note, noteIds, file, raw);
    pushHeadingSkips(findings, note, file, raw, lines.bodyStartLine);
    pushSizeFindings(findings, note, file, raw, lines.bodyStartLine);
    pushStaleDate(findings, note, file, lines, staleDays);
  }

  pushOrphans(findings, vault);
  pushDuplicateCandidates(findings, vault);

  return findings;
}

function splitFrontmatterLines(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const out = { hasFrontmatter: !!match, fieldLines: new Map(), bodyStartLine: 1 };
  if (!match) return out;
  const fmLines = match[1].split("\n");
  fmLines.forEach((line, i) => {
    const m = line.match(/^\s*([A-Za-z_]+)\s*:/);
    if (m) out.fieldLines.set(m[1], i + 2); // +1 for the opening ---, +1 for 1-based
  });
  out.bodyStartLine = fmLines.length + 3;
  return out;
}

function lineFor(lines, field) {
  return lines.fieldLines.get(field) ?? 1;
}

function pushMissingFields(findings, note, file, lines) {
  if (!note.frontmatter?.title) {
    findings.push({
      level: "error",
      code: "missing-frontmatter-field",
      message: `Note "${note.id}" has no frontmatter \`title\`. Search and list views will show "undefined".`,
      noteId: note.id,
      file,
      line: 1,
    });
  }
  if (!note.type) {
    findings.push({
      level: "warning",
      code: "missing-frontmatter-field",
      message: `Note "${note.id}" is missing frontmatter \`type\`. Typed-note schemas and type-aware filters can't apply.`,
      noteId: note.id,
      file,
      line: 1,
    });
  }
  if (!note.frontmatter?.tags || note.frontmatter.tags.length === 0) {
    findings.push({
      level: "warning",
      code: "missing-frontmatter-field",
      message: `Note "${note.id}" has no frontmatter \`tags\`. Tag filters won't find it.`,
      noteId: note.id,
      file,
      line: 1,
    });
  }
  if (!note.frontmatter?.description && !note.frontmatter?.summary) {
    findings.push({
      level: "info",
      code: "missing-frontmatter-field",
      message: `Note "${note.id}" has no \`description\` or \`summary\`. Search results won't have a blurb.`,
      noteId: note.id,
      file,
      line: 1,
    });
  }
}

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

function pushUnknownEnums(findings, note, file, lines) {
  const s = note.frontmatter?.status;
  if (s && !KNOWN_STATUSES.has(s)) {
    findings.push({
      level: "warning",
      code: "unknown-status",
      message: `Note "${note.id}" has unknown status "${s}". Valid: draft, current, stale, deprecated.`,
      noteId: note.id,
      file,
      line: lineFor(lines, "status"),
    });
  }
  const t = note.frontmatter?.type;
  if (t && !KNOWN_TYPES.has(t)) {
    findings.push({
      level: "warning",
      code: "unknown-type",
      message: `Note "${note.id}" has unknown type "${t}". Valid: ${[...KNOWN_TYPES].join(", ")}.`,
      noteId: note.id,
      file,
      line: lineFor(lines, "type"),
    });
  }
  const lv = note.frontmatter?.lastVerified;
  if (lv && !ISO_DATE_RE.test(lv)) {
    findings.push({
      level: "warning",
      code: "invalid-lastverified",
      message: `Note "${note.id}" has lastVerified "${lv}" — expected YYYY-MM-DD.`,
      noteId: note.id,
      file,
      line: lineFor(lines, "lastVerified"),
    });
  }
}

function pushDeadLinks(findings, note, noteIds, file, raw) {
  if (!note.links) return;
  for (const link of note.links) {
    if (noteIds.has(link)) continue;
    const re = new RegExp(
      `\\[\\[${link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\|[^\\]]+)?\\]\\]`
    );
    const lineIdx = raw.split("\n").findIndex((l) => re.test(l));
    findings.push({
      level: "error",
      code: "dead-link",
      message: `Note "${note.id}" links to "${link}", which doesn't exist.`,
      noteId: note.id,
      file,
      line: lineIdx >= 0 ? lineIdx + 1 : 1,
    });
  }
}

function pushHeadingSkips(findings, note, file, raw, bodyStartLine) {
  const lines = raw.split("\n");
  let prevLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+\S/);
    if (!m) continue;
    const level = m[1].length;
    if (prevLevel > 0 && level > prevLevel + 1) {
      findings.push({
        level: "warning",
        code: "heading-skip",
        message: `Note "${note.id}" jumps from h${prevLevel} to h${level} — chunk breadcrumbs will be awkward.`,
        noteId: note.id,
        file,
        line: i + 1,
      });
    }
    prevLevel = level;
  }
}

function pushSizeFindings(findings, note, file, raw, bodyStartLine) {
  const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
  const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw.trim();
  if (body.length < MIN_BODY_CHARS) {
    findings.push({
      level: "info",
      code: "undersized-note",
      message: `Note "${note.id}" is ${body.length} chars — too short to embed usefully (min ${MIN_BODY_CHARS}).`,
      noteId: note.id,
      file,
      line: bodyStartLine,
    });
  } else if (body.length > MAX_BODY_CHARS) {
    findings.push({
      level: "warning",
      code: "oversized-note",
      message: `Note "${note.id}" is ${body.length} chars — consider splitting (soft cap ${MAX_BODY_CHARS}).`,
      noteId: note.id,
      file,
      line: bodyStartLine,
    });
  }
}

function pushStaleDate(findings, note, file, lines, staleDays) {
  const lv = note.lastVerified;
  if (!lv || !ISO_DATE_RE.test(lv)) return;
  if (note.status !== "current") return;
  const ageDays = Math.floor((Date.now() - Date.parse(lv)) / 86400000);
  if (ageDays > staleDays) {
    findings.push({
      level: "warning",
      code: "stale-date",
      message: `Note "${note.id}" is marked \`current\` but lastVerified is ${ageDays} days old (> ${staleDays}).`,
      noteId: note.id,
      file,
      line: lineFor(lines, "lastVerified"),
    });
  }
}

function pushOrphans(findings, vault) {
  for (const note of vault.index) {
    if (note.type === "overview") continue;
    const fwd = note.links?.length ?? 0;
    const back = vault.getBacklinksFor(note.id).length;
    if (fwd === 0 && back === 0) {
      findings.push({
        level: "info",
        code: "orphan-note",
        message: `Note "${note.id}" has no forward links and no backlinks. Consider linking it from a sibling or VAULT_SUMMARY.`,
        noteId: note.id,
        file: path.join(vault.vaultDir, note.path),
        line: 1,
      });
    }
  }
}

const STOPWORDS = new Set([
  "the","and","for","with","that","this","have","has","had","are","was","were","been","being","will",
  "would","could","should","from","into","onto","over","under","about","than","then","there","here",
  "your","you","our","their","they","them","these","those","which","when","where","what","who","why",
  "how","not","but","any","all","some","one","two","only","also","such","own","same","use","uses",
  "used","using","like","very","just","each","both","many","more","most","other","another",
  "note","notes","vault","file","files",
]);

function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function pushDuplicateCandidates(findings, vault) {
  const enriched = vault.index.map((n) => ({
    id: n.id,
    title: n.title,
    tokens: tokenize(
      `${n.title} ${n.frontmatter?.description ?? ""} ${n.frontmatter?.summary ?? ""} ${n.tags.join(" ")}`
    ),
    file: path.join(vault.vaultDir, n.path),
  }));
  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      const score = jaccard(enriched[i].tokens, enriched[j].tokens);
      if (score >= DUP_THRESHOLD) {
        findings.push({
          level: "info",
          code: "duplicate-candidate",
          message: `Notes "${enriched[i].id}" and "${enriched[j].id}" look similar (Jaccard ${score.toFixed(2)}). Consider merging or cross-linking.`,
          noteId: enriched[i].id,
          related: enriched[j].id,
          file: enriched[i].file,
          line: 1,
          score: Number(score.toFixed(3)),
        });
      }
    }
  }
}

export function hasErrors(findings) {
  return findings.some((f) => f.level === "error");
}
