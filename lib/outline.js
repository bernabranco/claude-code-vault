/**
 * Outline extraction + rendering helpers for `vault_outline` (issue #29).
 *
 * Exposes three pure functions:
 *   - `extractOutline(md, maxDepth)` — ATX heading skeleton, fence-aware.
 *   - `renderOutlineBlock(note, headings)` — single-note markdown block.
 *   - `fitOutlineBlocks(blocks, budget)` — pack blocks under a char budget,
 *     preserving a whole-note boundary and emitting a truncation marker.
 *
 * Frontmatter at the top of the file is ignored. ATX-style headings only
 * (`# heading`, `## heading`, etc). Setext-style (underlined) headings are
 * intentionally not supported — no note in the vault uses them and they
 * would complicate the scanner. Fence-stripping mirrors the pattern in
 * `lib/vault.js._extractBacklinks` and `lib/glossary.js`.
 */

const MAX_ATX_DEPTH = 6;

function stripFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? markdown.slice(match[0].length) : markdown;
}

/**
 * Extract ATX headings up to `maxDepth` from a markdown body.
 * Skips headings inside fenced code blocks (``` or ~~~, any indent <4 sp).
 *
 * @param {string} markdown
 * @param {number} maxDepth  maximum heading level to include (default 2)
 * @returns {Array<{ level: number, text: string }>}
 */
export function extractOutline(markdown, maxDepth = 2) {
  if (typeof markdown !== "string" || markdown.length === 0) return [];
  const depth = Math.max(1, Math.min(MAX_ATX_DEPTH, Number.isFinite(maxDepth) ? maxDepth : 2));
  const body = stripFrontmatter(markdown);
  const lines = body.split("\n");

  const headings = [];
  let fence = null; // null | "`" | "~"
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    // Fence open/close. Match at line start (optional up-to-3-space indent).
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const char = fenceMatch[1][0];
      if (fence === null) {
        fence = char;
      } else if (fence === char) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;
    // Commonmark permits up to 3 leading spaces before the opening '#'.
    const h = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    const level = h[1].length;
    if (level > depth) continue;
    const text = h[2].trim();
    if (text.length === 0) continue;
    headings.push({ level, text });
  }
  return headings;
}

/**
 * Render a single note's outline block: a synthetic `# title (id)` line
 * followed by indented markdown headings (H2+, since the title line already
 * acts as the H1). Level-1 headings from the body are skipped to avoid
 * duplicating the title.
 *
 * @param {{ id: string, title: string }} note
 * @param {Array<{ level: number, text: string }>} headings
 * @returns {string}
 */
export function renderOutlineBlock(note, headings) {
  const lines = [`# ${note.title} (${note.id})`];
  for (const h of headings) {
    if (h.level <= 1) continue;
    const pad = "  ".repeat(Math.max(0, h.level - 1));
    const hashes = "#".repeat(h.level);
    lines.push(`${pad}${hashes} ${h.text}`);
  }
  return lines.join("\n");
}

/**
 * Pack rendered outline blocks into a single string under `budget` chars.
 * The first block is always included even if it alone exceeds the budget
 * (at-least-one contract, matches `applyCharBudget`). When any blocks are
 * dropped, a `[truncated: N note(s) omitted]` marker is appended at a
 * whole-note boundary.
 *
 * Returns both the packed text and the count of notes actually included,
 * so callers can build an envelope ({ outline, truncated, noteCount }).
 *
 * @param {string[]} blocks
 * @param {number} budget
 * @returns {{ text: string, included: number, omitted: number }}
 */
export function fitOutlineBlocks(blocks, budget) {
  if (blocks.length === 0) return { text: "", included: 0, omitted: 0 };
  let text = "";
  let included = 0;
  for (const block of blocks) {
    const next = included === 0 ? block : text + "\n\n" + block;
    if (next.length > budget && included > 0) break;
    text = next;
    included += 1;
  }
  const omitted = blocks.length - included;
  if (omitted > 0) {
    const suffix = omitted === 1 ? "" : "s";
    text += `\n\n[truncated: ${omitted} note${suffix} omitted]`;
  }
  return { text, included, omitted };
}
