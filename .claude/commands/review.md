---
description: Run code-reviewer over the current branch's diff vs main
---

Review the files changed on the current branch of claude-code-vault using the code-reviewer agent.

$ARGUMENTS

Steps:
1. Run `git diff main...HEAD --name-only` to list changed files on the branch. If that returns nothing, fall back to `git diff HEAD~1 --name-only`.
2. Show the list to the user.
3. For each changed file, identify its **surface** (MCP / indexer / CLI / viewer / docs) by path, and note any upstream files it imports from `lib/` — include those in the review context so stale-fallback and shape-drift issues are catchable.
4. Invoke the `code-reviewer` agent with: "Review these changed files on the current branch of claude-code-vault: [list]. Also read these upstream dependencies: [list]. Apply both the shared checklist and the surface-specific section (MCP / Indexer / CLI / Viewer) that matches each file's path. Pay particular attention to: MCP tool-schema changes (names, input/output shape), `VAULT_DIR` env-var regressions, indexer idempotency, and any new runtime deps creeping into the published tarball. Group findings by severity — critical, high, medium, low — with file, line, problem, and suggested fix."
5. After the review, ask: "Create GitHub issues for any of these findings via `issue-manager`?"
