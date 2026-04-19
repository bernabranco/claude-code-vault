## Summary

<!-- What does this change, and why? One or two sentences. -->

## Type of change

- [ ] Bug fix
- [ ] New retrieval technique / MCP tool / CLI command
- [ ] Viewer change
- [ ] Indexer / embeddings change
- [ ] Docs / chore

## Checks

- [ ] `npx tsc --noEmit --allowJs --skipLibCheck index.js lib/*.js` passes
- [ ] `cd web && npx tsc --noEmit` passes (if viewer touched)
- [ ] Smoke-tested the affected surface (`node lib/mcp.js`, `node index.js ...`, or viewer boot)
- [ ] `node test/retrieval/eval.js` still green (if retrieval behavior touched)
- [ ] Updated `README.md` if behavior or flags changed
- [ ] No new runtime dependencies added to the published tarball (or: listed them below with justification)

## Notes

<!-- Anything the reviewer should know — tradeoffs, follow-ups, screenshots
for viewer changes, recall@5 deltas for retrieval changes, etc. -->
