/**
 * Shared glossary resolution (#31).
 *
 * Any note with `type: glossary` contributes its terms. A term's definition is
 * the body of the H2 section whose heading matches the term (case-insensitive);
 * H3+ headings inside a section are kept as definition text. If the term is
 * declared in frontmatter `terms:` but no matching H2 exists, the note's
 * `summary` is used as a weaker fallback.
 *
 * `resolveJargon` scans arbitrary markdown for bare mentions of known terms
 * and returns sidecar definitions. Matching is case-insensitive and uses
 * standard `\b` word-boundary semantics (so `Cross-encoder` matches inside
 * `cross-encoder-pass`). Code fences, inline code, wiki-link targets, and
 * frontmatter are stripped before matching. Self-references are excluded so
 * a glossary note doesn't resolve its own terms back to itself. The output is
 * capped at `MAX_RESOLVED_TERMS` to bound response size.
 */
import fs from "fs/promises";
import path from "path";

const MAX_DEFINITION_CHARS = 400;
const MAX_RESOLVED_TERMS = 20;
const MIN_TERM_LENGTH = 2;

function stripCode(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

function extractSections(body) {
  const sections = [];
  const lines = body.split("\n");
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (current) sections.push(current);
      current = { heading: h2[1].trim(), lines: [] };
      continue;
    }
    if (!current) continue;
    if (/^#\s+/.test(line) || /^##\s+/.test(line)) {
      sections.push(current);
      current = null;
      continue;
    }
    current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function condenseDefinition(text) {
  const trimmed = text.trim().replace(/\n{2,}/g, "\n\n");
  if (trimmed.length <= MAX_DEFINITION_CHARS) return trimmed;
  return trimmed.slice(0, MAX_DEFINITION_CHARS - 1).trimEnd() + "…";
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Walk the vault index and build a term → definition map from every
 * `type: glossary` note. Later entries overwrite earlier ones; callers that
 * care about precedence should sort `vault.index` before calling.
 */
export async function buildGlossary(vault) {
  const terms = new Map();
  for (const note of vault.index) {
    if (note.type !== "glossary") continue;
    const filePath = path.join(vault.vaultDir, note.path);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(vault.vaultDir + path.sep) && resolved !== vault.vaultDir) continue;
    let raw;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    const frontmatterMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;
    const declared = Array.isArray(note.frontmatter?.terms) ? note.frontmatter.terms : [];
    const sectionsByHeading = new Map();
    for (const section of extractSections(body)) {
      sectionsByHeading.set(section.heading.toLowerCase(), section);
    }

    const register = (term, definition, sectionHeading) => {
      const trimmed = term.trim();
      const key = trimmed.toLowerCase();
      if (key.length < MIN_TERM_LENGTH) return;
      if (terms.has(key)) return;
      terms.set(key, {
        term: trimmed,
        definition: condenseDefinition(definition || note.summary || ""),
        source: note.id,
        sectionHeading: sectionHeading ?? null,
      });
    };

    for (const term of declared) {
      const section = sectionsByHeading.get(term.toLowerCase());
      const definition = section ? section.lines.join("\n") : "";
      register(term, definition, section?.heading ?? null);
    }
    for (const [, section] of sectionsByHeading) {
      if (!declared.some((t) => t.toLowerCase() === section.heading.toLowerCase())) {
        register(section.heading, section.lines.join("\n"), section.heading);
      }
    }
  }
  return terms;
}

/**
 * Scan `markdown` for bare mentions of any known term and return matching
 * definitions. Mentions inside code fences, inline code, or wiki-links are
 * ignored; the source note (`excludeSourceId`) is skipped so a glossary note
 * doesn't resolve its own terms.
 */
export function resolveJargon(markdown, glossary, { excludeSourceId } = {}) {
  if (!glossary || glossary.size === 0) return [];
  const frontmatterMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = frontmatterMatch ? markdown.slice(frontmatterMatch[0].length) : markdown;
  const haystack = stripCode(body).replace(/\[\[[^\]]+\]\]/g, " ");
  const matched = [];
  const seen = new Set();
  for (const [key, entry] of glossary) {
    if (matched.length >= MAX_RESOLVED_TERMS) break;
    if (excludeSourceId && entry.source === excludeSourceId) continue;
    if (seen.has(key)) continue;
    const pattern = new RegExp(`(?<!\\w)${escapeRegex(entry.term)}(?!\\w)`, "i");
    if (pattern.test(haystack)) {
      seen.add(key);
      matched.push({
        term: entry.term,
        definition: entry.definition,
        source: entry.source,
        sectionHeading: entry.sectionHeading,
      });
    }
  }
  return matched;
}
