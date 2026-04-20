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
 */
export const DEFAULT_MAX_CHARS = 8000;

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
 * non-empty, even if that single item already exceeds the budget.
 *
 * @param {Array<object>} items  pre-ranked list of results
 * @param {number} maxChars      positive integer char budget
 * @returns {{ results: Array<object>, truncated: boolean }}
 */
export function applyCharBudget(items, maxChars) {
  if (!Array.isArray(items) || items.length === 0) {
    return { results: [], truncated: false };
  }

  const budget = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;
  const results = [];
  let used = 0;
  let truncated = false;

  for (let i = 0; i < items.length; i++) {
    const size = itemChars(items[i]);
    if (results.length === 0) {
      // At-least-one-result contract: keep top item even if it busts budget.
      results.push(items[i]);
      used += size;
      if (used > budget) truncated = true;
      continue;
    }
    if (used + size > budget) {
      truncated = true;
      break;
    }
    results.push(items[i]);
    used += size;
  }

  return { results, truncated };
}
