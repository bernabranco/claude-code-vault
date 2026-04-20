/**
 * Line-preserving heading tree for section-level edits (#23).
 *
 * Distinct from chunks.js: chunks.js is shaped for retrieval (merges short
 * sections together, splits oversized ones, drops empty ones). For surgical
 * edits we need every heading boundary preserved verbatim with the exact
 * source line ranges. Mixing the two would mean either retrieval loses
 * locality or edits lose precision.
 */

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_RE = /^```/;
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/**
 * Locate the frontmatter block (if any) and return { fmEnd, bodyStartLine }.
 * fmEnd is the byte offset where frontmatter ends; bodyStartLine is the
 * 0-indexed line in the original file at which the body begins.
 */
export function findFrontmatter(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { fmEnd: 0, bodyStartLine: 0 };
  const fmText = m[0];
  return { fmEnd: fmText.length, bodyStartLine: fmText.split("\n").length - 1 };
}

/**
 * Parse the body of a markdown file into a flat list of section records.
 * Each record describes a heading and the half-open line range [bodyStart,
 * bodyEnd) of its body — the lines after the heading up to (but not
 * including) the next same-or-higher heading.
 *
 * Lines inside fenced code blocks that look like headings are ignored.
 *
 * Line numbers are 0-indexed against `bodyLines`. Callers translate back
 * to file lines by adding `bodyStartLine`.
 *
 * Returns: [{ level, text, headingLine, bodyStart, bodyEnd, ancestors }]
 *   - level: 1-6
 *   - text: heading text after the `#` markers, trimmed
 *   - headingLine: line index of the `#` line
 *   - bodyStart: line index of the first body line (== headingLine + 1)
 *   - bodyEnd: exclusive end of body region (start of next same-or-higher
 *     heading, or bodyLines.length if last)
 *   - ancestors: array of parent heading texts (root → immediate parent)
 */
export function parseSections(bodyLines) {
  const sections = [];
  const stack = [];
  let inFence = false;

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (FENCE_RE.test(line.trimStart())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = line.match(HEADING_RE);
    if (!h) continue;
    const level = h[1].length;
    const text = h[2].trim();

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const ancestors = stack.map((s) => s.text);

    const section = {
      level,
      text,
      headingLine: i,
      bodyStart: i + 1,
      bodyEnd: bodyLines.length,
      ancestors,
    };
    sections.push(section);
    stack.push(section);
  }

  // Second pass: close out bodyEnd at the next same-or-higher heading.
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j].level <= sections[i].level) {
        sections[i].bodyEnd = sections[j].headingLine;
        break;
      }
    }
  }

  return sections;
}

/**
 * Find the unique section matching headingPath under strict-ancestor-chain
 * semantics. `["A", "B"]` means: a heading "B" whose immediate parent in
 * the heading hierarchy is "A". Empty path is rejected by the caller.
 *
 * Throws if the path matches zero sections (with the closest near-misses
 * surfaced) or more than one (ambiguity — caller must disambiguate).
 */
export function findSection(sections, headingPath) {
  if (!Array.isArray(headingPath) || headingPath.length === 0) {
    throw new Error("headingPath must be a non-empty array of heading texts");
  }
  for (const part of headingPath) {
    if (typeof part !== "string" || !part.trim()) {
      throw new Error("headingPath entries must be non-empty strings");
    }
  }
  const target = headingPath[headingPath.length - 1].trim();
  const expectedAncestors = headingPath.slice(0, -1).map((s) => s.trim());

  const matches = sections.filter((s) => {
    if (s.text !== target) return false;
    if (s.ancestors.length !== expectedAncestors.length) return false;
    for (let i = 0; i < expectedAncestors.length; i++) {
      if (s.ancestors[i] !== expectedAncestors[i]) return false;
    }
    return true;
  });

  if (matches.length === 0) {
    const breadcrumbs = sections.map((s) => [...s.ancestors, s.text].join(" > "));
    throw new Error(
      `headingPath not found: ${headingPath.join(" > ")}. Available headings: ${
        breadcrumbs.length ? breadcrumbs.join("; ") : "(none)"
      }`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `headingPath is ambiguous: ${headingPath.join(" > ")} matches ${
        matches.length
      } sections at lines ${matches.map((m) => m.headingLine).join(", ")}. Disambiguate by extending the path.`
    );
  }
  return matches[0];
}

/**
 * Apply an append: insert `addition` after the section's last non-blank
 * body line, separated by a blank line, before the next same-or-higher
 * heading. Returns the new bodyLines array.
 */
export function appendToSectionLines(bodyLines, section, addition) {
  const additionLines = String(addition).replace(/\s+$/, "").split("\n");
  // Find the last non-blank line in the body region.
  let insertAt = section.bodyEnd; // default: just before next heading
  for (let i = section.bodyEnd - 1; i >= section.bodyStart; i--) {
    if (bodyLines[i].trim() !== "") {
      insertAt = i + 1;
      break;
    }
  }
  // Build the splice payload: blank-line separator (if needed) + content +
  // trailing blank if there's something after.
  const payload = [];
  const prevLine = insertAt > 0 ? bodyLines[insertAt - 1] : "";
  if (prevLine.trim() !== "") payload.push("");
  payload.push(...additionLines);
  // Ensure a blank line between our addition and the next section (if any).
  const nextLine = bodyLines[insertAt];
  if (nextLine !== undefined && nextLine.trim() !== "") payload.push("");

  const out = bodyLines.slice();
  out.splice(insertAt, 0, ...payload);
  return out;
}

/**
 * Apply a replace: swap the entire body region (after the heading line up
 * to the next same-or-higher heading) with `replacement`. The heading line
 * itself is preserved verbatim. Returns the new bodyLines array.
 */
export function replaceSectionLines(bodyLines, section, replacement) {
  const replacementText = String(replacement).replace(/^\s+|\s+$/g, "");
  const replacementLines = replacementText === "" ? [] : replacementText.split("\n");
  // Build the body slot: blank line after heading, the content, blank line
  // before next heading. Empty replacement just collapses to a single blank
  // line so the heading isn't glued to the next one.
  const slot = [];
  if (replacementLines.length > 0) {
    slot.push("");
    slot.push(...replacementLines);
    if (section.bodyEnd < bodyLines.length) slot.push("");
  } else {
    slot.push("");
  }
  const out = bodyLines.slice();
  out.splice(section.bodyStart, section.bodyEnd - section.bodyStart, ...slot);
  return out;
}

export const __test = { HEADING_RE, FENCE_RE };
