---
description: Smoke check + code review + open PR against main
---

Run the pre-ship pipeline for claude-code-vault before opening a PR to `main`.

$ARGUMENTS

Steps:

1. **Smoke check** — Run `npm install --no-audit --no-fund` and then `node lib/mcp.js --help >/dev/null 2>&1 || node --check lib/mcp.js`. If anything fails, stop and report.

2. **Changed files** — Run `git diff main...HEAD --name-only`. Show the list.

3. **Code review** — Invoke the `code-reviewer` agent: "Review these files for pre-ship on claude-code-vault: [list]. Be strict — this is a published npm package. Flag all critical and high-severity issues as blockers; flag medium as warnings. Apply the surface-specific checklist for each file."

4. **Gate** — If any critical or high findings, stop and ask the user to fix before shipping.

5. **Iterate** — Once the user says fixed, re-run steps 1 and 3 on the updated diff. Only proceed when both pass clean.

6. **Open PR** — Invoke `issue-manager`: "Open a PR for the current branch against `main`. Summarize changes from `git diff main...HEAD`. Title should follow conventional-commit style (`feat:` / `fix:` / `chore:` / `docs:`). Body sections: Summary, Changes, Verification. Reference any `Closes #<n>` if the branch name encodes an issue number."

Report the final PR URL. Reminder: merges use `--merge` (never `--squash`); release-manager handles that, not this skill.
