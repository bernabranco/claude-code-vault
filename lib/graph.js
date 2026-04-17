import fs from "fs/promises";
import path from "path";

const FALLBACK_SNIPPET_CHARS = 400;
const MIN_VIABLE_SNIPPET = 100;

function computeFrequencies(db, anchorIds) {
  const forwardFreq = new Map();
  const backlinkFreq = new Map();
  if (anchorIds.length === 0) return { forwardFreq, backlinkFreq };

  const anchorSet = new Set(anchorIds);
  const placeholders = anchorIds.map(() => "?").join(",");

  const outbound = db
    .prepare(`SELECT links FROM note_chunks WHERE note_id IN (${placeholders})`)
    .all(...anchorIds);
  for (const row of outbound) {
    for (const target of JSON.parse(row.links)) {
      if (!anchorSet.has(target)) {
        forwardFreq.set(target, (forwardFreq.get(target) || 0) + 1);
      }
    }
  }

  const inbound = db
    .prepare(`SELECT note_id, links FROM note_chunks WHERE note_id NOT IN (${placeholders})`)
    .all(...anchorIds);
  for (const row of inbound) {
    const links = JSON.parse(row.links);
    if (links.some((l) => anchorSet.has(l))) {
      backlinkFreq.set(row.note_id, (backlinkFreq.get(row.note_id) || 0) + 1);
    }
  }

  return { forwardFreq, backlinkFreq };
}

function rankNeighbors(db, vault, anchorIds) {
  const { forwardFreq, backlinkFreq } = computeFrequencies(db, anchorIds);
  const candidates = new Set([...forwardFreq.keys(), ...backlinkFreq.keys()]);

  const ranked = [];
  for (const id of candidates) {
    const note = vault.index.find((n) => n.id === id);
    if (!note) continue;
    const fwd = forwardFreq.get(id) || 0;
    const back = backlinkFreq.get(id) || 0;
    const relation = fwd > 0 && back > 0 ? "bidirectional" : fwd > 0 ? "forward" : "backlink";
    ranked.push({
      id,
      title: note.title,
      relation,
      forwardWeight: fwd,
      backlinkWeight: back,
      totalWeight: fwd + back,
      lastModified: note.lastModified,
    });
  }

  ranked.sort((a, b) => {
    const aBi = a.relation === "bidirectional" ? 1 : 0;
    const bBi = b.relation === "bidirectional" ? 1 : 0;
    if (aBi !== bBi) return bBi - aBi;
    if (b.totalWeight !== a.totalWeight) return b.totalWeight - a.totalWeight;
    if (a.lastModified !== b.lastModified) return b.lastModified.localeCompare(a.lastModified);
    return a.id.localeCompare(b.id);
  });

  return ranked;
}

async function fetchSnippet(db, vault, noteId) {
  const row = db
    .prepare("SELECT heading_path, text FROM note_chunks WHERE note_id = ? AND chunk_idx = 0")
    .get(noteId);
  if (row) {
    return {
      heading: JSON.parse(row.heading_path).join(" > "),
      text: row.text,
    };
  }
  const note = vault.index.find((n) => n.id === noteId);
  if (!note) return null;
  try {
    const raw = await fs.readFile(path.join(vault.vaultDir, note.path), "utf-8");
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    return { heading: note.title, text: body.slice(0, FALLBACK_SNIPPET_CHARS) };
  } catch {
    return null;
  }
}

function fitBudget(neighbors, maxChars) {
  let used = 0;
  const fitted = [];
  let truncated = false;

  for (const n of neighbors) {
    if (!n.snippet) {
      fitted.push(n);
      continue;
    }
    const remaining = maxChars - used;
    if (remaining < MIN_VIABLE_SNIPPET) {
      truncated = true;
      break;
    }
    if (n.snippet.text.length > remaining) {
      fitted.push({
        ...n,
        snippet: { ...n.snippet, text: n.snippet.text.slice(0, remaining - 1) + "…" },
      });
      used += remaining;
      truncated = true;
      break;
    }
    fitted.push(n);
    used += n.snippet.text.length;
  }

  if (fitted.length < neighbors.length) truncated = true;
  return { neighbors: fitted, truncated };
}

export async function expandNeighbors(db, vault, anchorIds, { depth = 1, maxChars = 8000 } = {}) {
  const seen = new Set(anchorIds);
  const collected = [];
  let frontier = [...anchorIds];

  for (let d = 1; d <= depth; d++) {
    const hop = rankNeighbors(db, vault, frontier).filter((n) => !seen.has(n.id));
    if (hop.length === 0) break;
    for (const n of hop) {
      collected.push({ ...n, distance: d });
      seen.add(n.id);
    }
    frontier = hop.slice(0, 3).map((n) => n.id);
  }

  for (const n of collected) {
    n.snippet = await fetchSnippet(db, vault, n.id);
  }

  return fitBudget(collected, maxChars);
}
