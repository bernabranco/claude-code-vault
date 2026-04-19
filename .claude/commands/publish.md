---
description: Cut a new npm release (version bump, publish, tag, GitHub release)
argument-hint: "[patch|minor|major]"
---

Cut a new npm release of claude-code-vault.

$ARGUMENTS

Invoke the `release-manager` agent with: "Run Phase B (publish a new version) for claude-code-vault. Steps: pre-flight (main clean, CI green, working tree clean), generate release notes from `$LAST_TAG..HEAD`, determine semver bump (feat → minor, fix/chore → patch, BREAKING CHANGE → major), run `npm version <bump>`, push with `--follow-tags`, `npm publish --access public`, verify with `npm view claude-code-vault version`, then `gh release create` with the release notes.

Hard rules to enforce:
- Never `--squash`, never `--no-verify`, never `--force` push.
- Git identity must be `bernardoagbranco@gmail.com` — stop and ask if it isn't.
- Never publish to npm without a tag pushed to origin.

If `$ARGUMENTS` specifies a bump level (patch/minor/major), use it. Otherwise infer from commits since the last tag and confirm the inferred bump with the user before running `npm version`.

Report: tag pushed, npm version confirmed, GitHub release URL."
