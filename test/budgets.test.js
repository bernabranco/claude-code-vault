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
 *  - exact-boundary equality (wrapper + commas accounted for)
 *  - zod schema validation of the `maxChars` input field
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { applyCharBudget, WRAPPER_OVERHEAD, DEFAULT_MAX_CHARS } from "../lib/budgets.js";

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
    // Two items = 40 + 1 (comma) + 40 = 81 bytes of payload.
    // Three items = 40*3 + 2 (commas) = 122. Budget must be between 81+40 and 122+40.
    // Pick 140 → effective 100, fits 2 (81) but not 3 (122).
    const out = applyCharBudget(items, 140);
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

  it("does not truncate when budget exactly equals total size including overhead", () => {
    const a = sized("a", 30);
    const b = sized("b", 30);
    const c = sized("c", 30);
    // Payload = 30 + 1 + 30 + 1 + 30 = 92 bytes; plus WRAPPER_OVERHEAD.
    const total = 92 + WRAPPER_OVERHEAD;
    const out = applyCharBudget([a, b, c], total);
    assert.equal(out.truncated, false);
    assert.equal(out.results.length, 3);
  });

  it("truncates when total overshoots by a single byte", () => {
    const a = sized("a", 30);
    const b = sized("b", 30);
    const c = sized("c", 30);
    // Payload = 92; 1 byte below fits only 2 items (30 + 1 + 30 = 61).
    const out = applyCharBudget([a, b, c], 91 + WRAPPER_OVERHEAD);
    assert.equal(out.truncated, true);
    assert.equal(out.results.length, 2);
  });

  it("accounts for comma separators (N items = sum(sizes) + N-1 commas)", () => {
    // Three 30-byte items: serialized array payload = 30+1+30+1+30 = 92, not 90.
    const items = [sized("a", 30), sized("b", 30), sized("c", 30)];
    // Budget fits 90 bytes of items + overhead, but the 2 commas push total to 92.
    const out = applyCharBudget(items, 90 + WRAPPER_OVERHEAD);
    assert.equal(out.truncated, true);
    assert.ok(out.results.length < 3);
  });
});

describe("maxChars zod schema", () => {
  // Mirrors the schema used in lib/mcp.js input definitions for the four
  // search/list tools: z.number().int().positive().optional().default(8000).
  const schema = z.number().int().positive().optional().default(DEFAULT_MAX_CHARS);

  it("rejects zero", () => {
    assert.equal(schema.safeParse(0).success, false);
  });

  it("rejects negative integers", () => {
    assert.equal(schema.safeParse(-1).success, false);
  });

  it("rejects non-integers", () => {
    assert.equal(schema.safeParse(3.5).success, false);
  });

  it("accepts 1", () => {
    const r = schema.safeParse(1);
    assert.equal(r.success, true);
    assert.equal(r.data, 1);
  });

  it("accepts 8000", () => {
    const r = schema.safeParse(8000);
    assert.equal(r.success, true);
    assert.equal(r.data, 8000);
  });

  it("applies the default when absent", () => {
    const r = schema.safeParse(undefined);
    assert.equal(r.success, true);
    assert.equal(r.data, DEFAULT_MAX_CHARS);
    assert.equal(r.data, 8000);
  });
});
