---
description: 5-minute triage — recent activity, open PRs/issues, top 3 next actions
---

Run the daily 5-minute triage for claude-code-vault.

1. **Recent activity** — Run `git log main --since="24 hours ago" --oneline`. If empty, fall back to `git log main -5 --oneline`.

2. **Open PRs** — Run `gh pr list --repo bernabranco/claude-code-vault --state open --json number,title,headRefName,statusCheckRollup,mergeable --limit 20`. Flag any with failing CI (`statusCheckRollup.state != SUCCESS`), any `CONFLICTING`, and any open > 7 days.

3. **Open issues** — Run `gh issue list --repo bernabranco/claude-code-vault --limit 15 --state open`. Group by label (`priority:*` first, then by surface). Flag anything > 60 days with no activity.

4. **Quick scan** — If anything landed in `main` in the last 24h, invoke the `code-reviewer` agent on up to 3 most recently changed files: "Quick security + correctness scan on these recently merged files. Critical/high only — skip style nits."

5. **Summary** — Produce:
   - Top 3 things worth doing today (bug, PR to merge, issue to pick up)
   - Any stale PRs that should be closed or rebased
   - Any open critical/high issue that's blocked

6. **Action prompt** — "Want me to: (a) pick up an issue via `/fix <n>`, (b) clear merge-ready PRs via `release-manager`, or (c) create new issues from the scan via `issue-manager`?"
