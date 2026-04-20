import fs from "fs/promises";
import path from "path";

const FALLBACK_SNIPPET_CHARS = 400;
const MIN_VIABLE_SNIPPET = 100;

const PAGERANK_DAMPING = 0.85;
const PAGERANK_MAX_ITERS = 30;
const PAGERANK_TOLERANCE = 1e-6;
const STALE_MULTIPLIER = 0.7;
const SEED_BIAS = 3;
const PAGERANK_BLEND = 0.7; // 70% PageRank, 30% inbound-degree

function isSeedId(id) {
  if (!id) return false;
  const lower = id.toLowerCase();
  if (lower === "vault-summary" || lower === "overview") return true;
  if (lower.endsWith("/overview")) return true;
  return /(^|\/)vault[_-]?summary$/i.test(id);
}

/**
 * Build outbound edges (active targets only) and inbound-degree map.
 *
 * Repeated wiki-links from the same source are collapsed to a single edge,
 * so a body that mentions `[[demo/hub]]` five times contributes exactly one
 * unit of inbound-degree to `demo/hub`. This keeps PageRank proportional to
 * editorial structure, not prose repetition.
 */
function buildEdges(active, activeIds) {
  const outbound = new Map();
  const inboundDegree = new Map();
  for (const note of active) {
    const links = Array.isArray(note.links) ? note.links : [];
    const unique = Array.from(
      new Set(links.filter((l) => activeIds.has(l) && l !== note.id))
    );
    outbound.set(note.id, unique);
    for (const target of unique) {
      inboundDegree.set(target, (inboundDegree.get(target) || 0) + 1);
    }
  }
  return { outbound, inboundDegree };
}

/**
 * Seeded teleport distribution: seeds get SEED_BIAS× weight.
 */
function buildTeleport(active) {
  const teleport = new Map();
  let total = 0;
  for (const note of active) {
    const w = isSeedId(note.id) ? SEED_BIAS : 1;
    teleport.set(note.id, w);
    total += w;
  }
  for (const [id, w] of teleport) teleport.set(id, w / total);
  return teleport;
}

/**
 * One PageRank iteration. Returns `{ next, delta }`.
 * Dangling-node rank is redistributed proportional to teleport so total
 * probability mass is conserved.
 */
function iterateRank(active, outbound, teleport, rank) {
  const next = new Map();
  for (const note of active) {
    next.set(note.id, (1 - PAGERANK_DAMPING) * teleport.get(note.id));
  }
  let danglingMass = 0;
  for (const note of active) {
    const outs = outbound.get(note.id);
    const r = rank.get(note.id);
    if (!outs || outs.length === 0) {
      danglingMass += r;
      continue;
    }
    const share = (PAGERANK_DAMPING * r) / outs.length;
    for (const target of outs) {
      next.set(target, (next.get(target) || 0) + share);
    }
  }
  if (danglingMass > 0) {
    for (const note of active) {
      next.set(
        note.id,
        (next.get(note.id) || 0) + PAGERANK_DAMPING * danglingMass * teleport.get(note.id)
      );
    }
  }
  let delta = 0;
  for (const [id, r] of next) delta += Math.abs(r - (rank.get(id) || 0));
  return { next, delta };
}

/**
 * Blend PageRank with normalized inbound-degree, apply stale penalty.
 */
function blendScores(active, rank, inboundDegree) {
  let maxInbound = 0;
  for (const v of inboundDegree.values()) if (v > maxInbound) maxInbound = v;
  const N = Math.max(1, active.length);
  const blended = new Map();
  for (const note of active) {
    const pr = rank.get(note.id) || 0;
    const inDeg = inboundDegree.get(note.id) || 0;
    const normIn = maxInbound > 0 ? inDeg / maxInbound : 0;
    let score = PAGERANK_BLEND * pr + (1 - PAGERANK_BLEND) * (normIn / N);
    if (note.status === "stale") score *= STALE_MULTIPLIER;
    blended.set(note.id, score);
  }
  return blended;
}

/**
 * Compute blended importance scores for every non-deprecated note in the
 * vault. Combines iterative PageRank (damping 0.85, ≤30 iters) with 1-hop
 * inbound-degree so actual content hubs surface even when VAULT_SUMMARY is
 * thin. Seeds (`VAULT_SUMMARY*` / `overview*`) get a teleport bias so new
 * sessions land on orientation notes first. Stale notes are downweighted
 * post-hoc by 0.7× (matching Vault.search). Deprecated notes are excluded
 * from both the ranking and the graph.
 *
 * Returns a Map<noteId, score>. Empty vaults / vaults with no edges return
 * an empty Map (no throws).
 *
 * Pure JS, no deps. Complexity O(iters * edges) — fine for <50k edges.
 */
export function computePageRank(vault) {
  const empty = new Map();
  if (!vault || !Array.isArray(vault.index) || vault.index.length === 0) return empty;

  const active = vault.index.filter((n) => n.status !== "deprecated");
  if (active.length === 0) return empty;

  const activeIds = new Set(active.map((n) => n.id));
  const { outbound, inboundDegree } = buildEdges(active, activeIds);
  const teleport = buildTeleport(active);

  let rank = new Map();
  for (const note of active) rank.set(note.id, 1 / active.length);

  for (let iter = 0; iter < PAGERANK_MAX_ITERS; iter++) {
    const { next, delta } = iterateRank(active, outbound, teleport, rank);
    rank = next;
    if (delta < PAGERANK_TOLERANCE) break;
  }

  return blendScores(active, rank, inboundDegree);
}

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
