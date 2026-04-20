/**
 * Character-budget helpers for MCP search tools (issue #30).
 *
 * `applyCharBudget(items, maxChars)` trims a pre-ranked result list so the
 * JSON-serialized total does not exceed `maxChars`. Drops from the bottom
 * (results are assumed ranked high-to-low). Honors an at-least-one-result
 * contract: if the top item alone exceeds the budget, it is still returned
 * (with `truncated: true`) so the caller never gets an empty response for a
 * non-empty search.
 *
 * Returns an envelope `{ results, truncated }` that the MCP layer serializes
 * as the tool response. The envelope is always returned — even when the
 * budget is not hit — so downstream agents can rely on a stable shape.
 *
 * Accounting includes:
 *  - `WRAPPER_OVERHEAD` — a fixed allowance for the envelope bytes
 *    (`{"results":[],"truncated":false}` ≈ 32 chars; rounded to 40 to leave
 *    slack for the flipped `truncated: true` path and any future wrapper
 *    keys). Subtracted from the caller's `maxChars` up-front.
 *  - comma separators between array elements — 1 byte per item except the
 *    first. Without this the budget can overshoot by N-1 bytes for N items.
 *
 * At tight budgets (a few hundred chars) this tightening matters; at the
 * 8000-char default it is negligible. Documented so callers passing very
 * small `maxChars` values understand the effective-budget math.
 */
export const DEFAULT_MAX_CHARS = 8000;
export const WRAPPER_OVERHEAD = 40;

/**
 * Measure an item's contribution to the JSON budget. We use
 * `JSON.stringify(item).length` so the accounting matches the bytes the
 * MCP layer will eventually emit.
 */
function itemChars(item) {
  return JSON.stringify(item).length;
}

/**
 * Trim `items` to fit within `maxChars` of serialized JSON, dropping from
 * the bottom. Always returns at least the top item when `items` is
 * non-empty, even if that single item already exceeds the effective budget
 * (effective = `maxChars` minus wrapper overhead). Comma separators
 * between items are included in the running total.
 *
 * @param {Array<object>} items  pre-ranked list of results
 * @param {number} maxChars      positive integer char budget
 * @returns {{ results: Array<object>, truncated: boolean }}
 */
export function applyCharBudget(items, maxChars) {
  if (!Array.isArray(items) || items.length === 0) {
    return { results: [], truncated: false };
  }

  const rawBudget = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;
  // Subtract fixed wrapper overhead so the final serialized envelope fits.
  const budget = Math.max(0, rawBudget - WRAPPER_OVERHEAD);
  const results = [];
  let used = 0;
  let truncated = false;

  for (const item of items) {
    const size = itemChars(item);
    // Comma separator between items: 1 byte per item except the first.
    const sep = results.length === 0 ? 0 : 1;
    if (results.length === 0) {
      // At-least-one-result contract: keep top item even if it busts budget.
      results.push(item);
      used += size;
      if (used > budget) truncated = true;
      continue;
    }
    if (used + sep + size > budget) {
      truncated = true;
      break;
    }
    results.push(item);
    used += sep + size;
  }

  return { results, truncated };
}
