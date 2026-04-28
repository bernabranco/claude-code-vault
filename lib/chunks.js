const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_RE = /^```/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const MIN_CHUNK_CHARS = 100;
const MAX_CHUNK_CHARS = 1500;

function extractLinks(text) {
  const links = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const id = m[1].trim();
    if (id) links.push(id);
  }
  return [...new Set(links)];
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function splitOversized(text, max) {
  const paras = text.split(/\n\n+/);
  const parts = [];
  let cur = "";
  for (const p of paras) {
    const candidate = cur ? cur + "\n\n" + p : p;
    if (candidate.length > max && cur) {
      parts.push(cur);
      cur = p;
    } else {
      cur = candidate;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function parseRawChunks(lines, noteTitle) {
  const raw = [];
  const stack = [];
  let buffer = [];
  let inFence = false;

  const currentPath = () =>
    stack.length === 0 ? [noteTitle] : stack.map((h) => h.text);

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) raw.push({ heading_path: currentPath(), text });
    buffer = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line.trimStart())) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }
    const h = line.match(HEADING_RE);
    if (h) {
      flush();
      const level = h[1].length;
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      stack.push({ level, text: h[2] });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return raw;
}

function samePath(a, b) {
  return (
    a.length === b.length && a.every((seg, i) => seg === b[i])
  );
}

export function chunkMarkdown(markdown, noteTitle) {
  const raw = parseRawChunks(stripFrontmatter(markdown).split("\n"), noteTitle);

  const merged = [];
  for (const ch of raw) {
    const prev = merged.at(-1);
    if (ch.text.length < MIN_CHUNK_CHARS && prev && samePath(prev.heading_path, ch.heading_path)) {
      // Same section continuation — merge without changing the breadcrumb.
      prev.text += "\n\n" + ch.text;
    } else {
      merged.push({ heading_path: ch.heading_path, text: ch.text });
    }
  }

  const final = [];
  let idx = 0;
  for (const ch of merged) {
    const parts =
      ch.text.length <= MAX_CHUNK_CHARS
        ? [ch.text]
        : splitOversized(ch.text, MAX_CHUNK_CHARS);
    for (const text of parts) {
      final.push({ chunk_idx: idx++, heading_path: ch.heading_path, text, links: extractLinks(text) });
    }
  }

  return final;
}
