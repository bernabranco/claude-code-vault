---
description: Pick up a GitHub issue end-to-end (plan → branch → fix → PR)
argument-hint: "<issue-number>"
---

Pick up a GitHub issue on claude-code-vault and implement a complete fix.

Issue number: $ARGUMENTS

Invoke the `issue-manager` agent with this exact instruction:

"Pick up issue #$ARGUMENTS from `bernabranco/claude-code-vault`.

Steps:
1. `gh issue view $ARGUMENTS --repo bernabranco/claude-code-vault` — read fully.
2. Identify the surface (MCP / indexer / CLI / viewer / docs) and apply that surface's conventions from `core-owner` + `code-reviewer`.
3. Produce a **short plan**: 3-7 bullets covering files to touch, approach, one risk, one unknown, verification step. End with 'Proceed?' and wait — do not edit unless the issue is trivial (typo, one-line docs fix).
4. On approval, branch: `git checkout -b fix/issue-$ARGUMENTS-<slug>` (or `feat/` / `docs/` as appropriate).
5. Implement minimal, targeted changes. Honor invariants in `core-owner`: `VAULT_DIR` env-var wins, MCP tool surface is a public contract, demo vault is `vault/claude-code-vault/` only, no new heavy runtime deps in the tarball.
6. **Evaluate** — Re-read the issue. Does the change address the root cause or just a symptom? Any edge cases missed (missing vault dir, malformed frontmatter, concurrent writes, viewer disabled)? If gaps, revise.
7. Verify: `npm install --no-audit --no-fund` cold + surface-specific smoke (`node lib/mcp.js`, `node index.js list`, or viewer boot as relevant).
8. Commit referencing the issue body (`Closes #$ARGUMENTS`). Git identity must be `bernardoagbranco@gmail.com` — stop and ask if it isn't.
9. Push and open a PR against `main` using the standard PR template. Title: `fix: <summary> (closes #$ARGUMENTS)` (or `feat:` / `docs:`).

Return the PR URL."
