---
id: retrieval-eval
title: Retrieval eval + regression gate
description: How to run the retrieval eval harness, interpret results, and bless a new baseline
summary: The retrieval eval harness runs every gold query against keyword, semantic, and chunk search and compares recall@5 against test/retrieval/baseline.json. CI fails PRs on >2pp drops and annotates PRs on 0.5-2pp drops. Bless a new baseline with `npm run eval:bless` only when the improvement is deliberate.
type: runbook
status: current
lastVerified: 2026-04-20
tags: [runbook, retrieval, eval, ci, baseline, recall, mrr, gold, regression, gate]
---

# Retrieval eval + regression gate

The retrieval eval harness (`test/retrieval/eval.js`) measures recall@5 and MRR@5 across the three retrieval surfaces (keyword, semantic, chunks) over a gold query set (`test/retrieval/gold.json`). CI runs it on every PR and gates merges on regression.

## Commands

| Command | What it does |
|---------|--------------|
| `npm run eval` | Run the eval and diff against `test/retrieval/baseline.json`. Non-zero exit on >2pp drop on any tool. |
| `npm run eval -- --gate 1` | Tighten the fail threshold to 1pp for this run. |
| `npm run eval -- --warn-gate 0.25` | Tighten the warn threshold to 0.25pp for this run. |
| `npm run eval -- --hyde` | Run with HyDE query expansion (requires `ANTHROPIC_API_KEY`). |
| `npm run eval -- --json` | Machine-readable output on stdout (human report suppressed). |
| `npm run eval:bless` | Overwrite `test/retrieval/baseline.json` with the current metrics. |

## Gate tiers

The gate has two tiers, both computed per tool on recall@5:

1. **Fail** (`--gate`, default `2pp`). Any tool whose recall@5 drops by more than this exits 1. CI blocks the PR.
2. **Warn** (`--warn-gate`, default `0.5pp`). Drops between the warn and fail thresholds are surfaced as `::warning file=test/retrieval/baseline.json::...` on stderr. GitHub Actions renders those as PR annotations. Exit stays 0.

Drops at or below the warn threshold are silent (noise floor for a 14-query gold set).

Improvements are printed in the human report (`Δrecall +X.Xpp`) but never auto-update the baseline — you must bless deliberately.

## Steps

Follow these when the eval fails on your PR.

### 1. Read the CI log

The eval step lists each failing tool with `base% -> cur% (-Xpp)`. Note which tool(s) dropped and by how much.

### 2. Reproduce locally

Run `npm run eval -- --gate 2 --warn-gate 0.5`. Same thresholds as CI, same output.

### 3. Classify the drop

- **Unintended regression.** Your change broke something. Fix the code, not the baseline.
- **Intentional trade-off** (e.g. a better chunking strategy that costs 3pp on keyword-only queries but wins 8pp on semantic-only). Land the improvement, then bless.
- **Gold set is wrong.** The query expected the old behavior. Edit `test/retrieval/gold.json`, re-bless.

### 4. Bless a new baseline (only if appropriate)

If the shift is intentional, run `npm run eval:bless` and commit the updated `baseline.json` in the same PR as the change that caused the shift. Call it out in the PR description — blessing a baseline without explaining why is the main way retrieval decay sneaks in.

### Verify

Rerun `npm run eval` — it should now pass with `✓ No retrieval regression.` on stdout and exit 0. If CI was the trigger, push the commit and confirm the workflow goes green.

### When the eval warns (not fails)

A warn-tier drop (0.5-2pp) is a yellow flag, not a blocker. Read the annotation, decide whether to investigate or ignore. The baseline is unchanged — if a subsequent PR pushes the same tool another 1pp, it becomes a fail.

## Why these thresholds

Default `--gate 2` tolerates ~1 query flip on the 14-query gold set (1/14 = 7pp on a per-tool basis, but per-tool averages smooth this). A drop >2pp means at least one real regression, not sampling noise.

Default `--warn-gate 0.5` catches partial-rank drops (e.g. a query moving from rank 2 to rank 5 on chunks) that don't flip recall@5 but do move MRR@5. Over time, multiple silent warns compound.

Tune `--gate` down (1pp or lower) once the gold set grows past ~50 queries — the noise floor drops.

## CI wiring

`.github/workflows/ci.yml` runs:

```yaml
- name: Retrieval eval (recall@5 vs baseline)
  run: node test/retrieval/eval.js --gate 2 --warn-gate 0.5
```

The step runs after the vault lint and before the other retrieval assertions. The web viewer build runs in parallel; the eval does not depend on it.

## Related

- [[claude-code-vault/architecture/embeddings-pipeline]] — how keyword / semantic / chunk search are layered.
- [[claude-code-vault/runbooks/npm-scripts]] — every script in `package.json`.
- Issue #15 (eval harness), #28 (this gate), #25 (query-miss log for discovering gold-set gaps).
