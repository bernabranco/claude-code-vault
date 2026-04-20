---
id: publish-release
title: Publish a release
description: Step-by-step runbook for cutting and publishing a new claude-code-vault release to npm and GitHub
summary: Runbook — bump version, update changelog, tag, push, merge PR with `gh pr merge --merge`, publish to npm, verify `npx` install. Each step has a Verify subsection so you know it succeeded.
type: runbook
status: current
lastVerified: 2026-04-20
tags: [release, ops, npm]
---

# Publish a release

How to cut a new `claude-code-vault` release. Every step ends with a **Verify** subsection — if verify fails, stop and investigate before moving on. Don't skip ahead.

## Steps

### 1. Pre-flight checks on `main`

On a fresh clone of `main`:

```bash
git pull origin main
npm ci
node index.js lint
npm run eval
```

Lint must be clean. Eval must meet the recall floor the repo ships with.

### Verify

`node index.js lint` prints `✓ No issues found.` and exits 0. Eval prints a recall@5 number at or above the baseline in [[claude-code-vault/research/roadmap]].

### 2. Bump version + update changelog

Edit `package.json` — bump `version` by patch / minor / major per semver.

Draft a short changelog entry in the PR body (or `CHANGELOG.md` if one exists). Mention every merged PR since the last release.

### Verify

`node -p "require('./package.json').version"` prints the new version. `git diff package.json` shows only the version line changed.

### 3. Commit + open release PR

```bash
git checkout -b release/vX.Y.Z
git add package.json
git commit -m "release: vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --title "release: vX.Y.Z" --body "<changelog>"
```

Wait for CI to go green. **Never** merge red.

### Verify

`gh pr checks` shows every check ✓. No reviewer has blocking comments.

### 4. Merge with `--merge` (never `--squash`)

```bash
gh pr merge --merge --delete-branch
```

Squash-merge would collapse the per-commit history that the self-docs reference. See [[claude-code-vault/gotchas/gotchas]] for why.

### Verify

`git log main --oneline | head` shows the merge commit and the version bump as separate commits. The release branch is gone locally and on the remote.

### 5. Tag and publish to npm

```bash
git checkout main && git pull
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
npm publish
```

### Verify

`npm view claude-code-vault version` prints the new version. `gh release view vX.Y.Z` shows the tag on GitHub.

### 6. Smoke-test the published package

In a scratch directory:

```bash
mkdir /tmp/ccv-smoke && cd /tmp/ccv-smoke
npx claude-code-vault@latest init demo
npx claude-code-vault index --vault vault
```

### Verify

`init` creates the folder tree. `index` reports a non-zero note count without errors. Delete `/tmp/ccv-smoke` when done.
