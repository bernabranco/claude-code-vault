#!/usr/bin/env node
/**
 * Char-budget helper assertions — issue #30.
 *
 * Covers the envelope contract for the four search tools:
 *  - under-budget passthrough
 *  - drop-from-bottom when over budget
 *  - single top item over budget (at-least-one-result contract)
 *  - empty input
 *  - very large maxChars
 *  - exact-boundary equality
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCharBudget } from "../lib/budgets.js";

function sized(id, bytes) {
  // Build an item whose JSON.stringify(item).length equals `bytes` exactly.
  // Skeleton: {"id":"X","pad":"..."} — measure skeleton then pad the string.
  const skeleton = JSON.stringify({ id, pad: "" });
  const padLen = bytes - skeleton.length;
  if (padLen < 0) throw new Error(`bytes ${bytes} too small for id ${id}`);
  return { id, pad: "x".repeat(padLen) };
}

describe("applyCharBudget", () => {
  it("returns envelope with truncated:false when under budget", () => {
    const items = [sized("a", 50), sized("b", 50), sized("c", 50)];
    const out = applyCharBudget(items, 1000);
    assert.equal(out.truncated, false);
    assert.equal(out.results.length, 3);
    assert.deepEqual(
      out.results.map((r) => r.id),
      ["a", "b", "c"]
    );
  });

  it("drops from the bottom when over budget", () => {
    const items = [sized("a", 40), sized("b", 40), sized("c", 40), sized("d", 40)];
    // Budget fits two items (80) but not three (120).
    const out = applyCharBudget(items, 100);
    assert.equal(out.truncated, true);
    assert.equal(out.results.length, 2);
    assert.deepEqual(
      out.results.map((r) => r.id),
      ["a", "b"]
    );
  });

  it("returns the top item even when it alone exceeds the budget", () => {
    const items = [sized("a", 500), sized("b", 20)];
    const out = applyCharBudget(items, 100);
    assert.equal(out.truncated, true);
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].id, "a");
  });

  it("returns empty envelope on empty input", () => {
    const out = applyCharBudget([], 1000);
    assert.deepEqual(out, { results: [], truncated: false });
  });

  it("also handles non-array input gracefully", () => {
    assert.deepEqual(applyCharBudget(undefined, 1000), { results: [], truncated: false });
    assert.deepEqual(applyCharBudget(null, 1000), { results: [], truncated: false });
  });

  it("does not truncate when maxChars is very large", () => {
    const items = Array.from({ length: 50 }, (_, i) => sized(`n${i}`, 100));
    const out = applyCharBudget(items, 10_000_000);
    assert.equal(out.truncated, false);
    assert.equal(out.results.length, 50);
  });

  it("does not truncate when budget exactly equals total size", () => {
    const a = sized("a", 30);
    const b = sized("b", 30);
    const c = sized("c", 30);
    const total = 30 + 30 + 30;
    const out = applyCharBudget([a, b, c], total);
    assert.equal(out.truncated, false);
    assert.equal(out.results.length, 3);
  });

  it("truncates when total overshoots by a single byte", () => {
    const a = sized("a", 30);
    const b = sized("b", 30);
    const c = sized("c", 30);
    const out = applyCharBudget([a, b, c], 89);
    assert.equal(out.truncated, true);
    assert.equal(out.results.length, 2);
  });
});
