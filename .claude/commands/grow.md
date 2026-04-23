---
description: Propose and create new GitHub issues to grow the project
---

Generate a batch of well-scoped GitHub issues for claude-code-vault.

1. **Gather context** — Run these in parallel:
   - `gh issue list --repo bernabranco/claude-code-vault --state open --limit 50 --json number,title,labels` — open issues (avoid duplicates)
   - `git log main -20 --oneline` — recent momentum (what's being worked on)
   - Read `README.md` for unchecked roadmap items (`- [ ]`)
   - Read `CLAUDE.md` for architecture context

2. **Identify gaps** — Think across these surfaces and find the most valuable missing pieces:
   - **Retrieval quality** — search precision, ranking, chunk quality, HyDE, filters
   - **MCP tool surface** — tool ergonomics, response format, missing tools
   - **Write-back** — vault_write, section edit, auto-link, stub creation
   - **Linter** — new lint rules, false positive reduction, fix suggestions
   - **Web UI** — graph view, reader UX, search in browser
   - **CLI** — missing commands, output formats, discoverability
   - **Hooks** — enforcement, gap detection, coverage reporting
   - **Ops** — CI, eval harness, performance, cold-start time
   - **Docs** — self-docs vault gaps, onboarding, examples

3. **Propose 5 issues** — For each, produce:
   - **Title** — `feat:` / `fix:` / `chore:` / `docs:` prefix, concise
   - **Why** — one sentence on the user problem or gap it closes
   - **Scope** — what files/modules change, rough effort (S/M/L)
   - **Acceptance criteria** — 2-4 bullets on what "done" looks like

   Prioritize: things on the unchecked roadmap first, then gaps you spotted in the codebase. Skip anything already in the open issue list.

4. **Confirm** — Present the 5 proposals and ask: "Which should I create? (e.g. 'all', '1 3 5', or 'none')"

5. **Create selected issues** — For each approved issue, run:
   ```
   gh issue create --repo bernabranco/claude-code-vault \
     --title "<title>" \
     --body "<full description with Why, Scope, Acceptance criteria as markdown>"
   ```
   Apply labels where they exist (`enhancement`, `bug`, `documentation`, `good first issue`).

6. **Report** — List created issue URLs.
