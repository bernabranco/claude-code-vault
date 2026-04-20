/**
 * Pure heading extraction for `vault_outline` (issue #29).
 *
 * Given a markdown body, returns the heading skeleton — `[{ level, text }]`
 * — up to `maxDepth`. Headings inside fenced code blocks are skipped
 * (both ``` and ~~~ fences), mirroring the fence-stripping pattern in
 * `lib/vault.js._extractBacklinks` and `lib/glossary.js`.
 *
 * Frontmatter at the top of the file is ignored. ATX-style headings only
 * (`# heading`, `## heading`, etc). Setext-style (underlined) headings are
 * intentionally not supported — no note in the vault uses them and they
 * would complicate the scanner.
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
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    const level = h[1].length;
    if (level > depth) continue;
    const text = h[2].trim();
    if (text.length === 0) continue;
    headings.push({ level, text });
  }
  return headings;
}
