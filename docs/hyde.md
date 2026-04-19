# HyDE: Hypothetical Document Embeddings

**Status:** shipped in PR for issue #16 (Phase 1 — retrieval precision).

HyDE is a query-side trick that lifts semantic-search recall on queries whose vocabulary doesn't match the target doc. This is *not* an indexing change — the vault embeddings stay exactly the same. The trick happens at search time.

## The problem

Embedding models (ours is `Xenova/all-MiniLM-L6-v2`, 384-dim) were trained mostly on `(passage, paraphrase of passage)` pairs. Their vector space is good at placing similar-looking *text* near each other. It is **not** optimized for the `(short question, long answer)` gap.

So this happens:

- User types: `"why did we pick local DB"`
- Target ADR says: `"SQLite-WASM persisted to OPFS... round-trip to a remote server introduced 1–3s latencies... broke the 'start in one click' promise"`

None of the target's words appear in the query. The model has to bridge `"local DB"` ↔ `"SQLite-WASM / OPFS / no network round-trip"` through pure semantic generalization. On a small, tight vault it usually works. On a bigger, messier corpus, recall drops.

## How HyDE bridges the gap

At search time, before embedding the query, ask a fast LLM to write a fake passage that would answer it:

```
Prompt: Write a 2-3 sentence passage from an engineering document that would
        answer this question: "why did we pick local DB"

LLM:    We chose local-first storage using an embedded database because round-trips
        to a remote server introduced unacceptable latency on session start.
        SQLite running in the browser via WASM lets us persist user data without
        any network dependency.
```

That fake passage **is never indexed** — it's only used as a search probe. We embed `"${query}\n\n${hypoPassage}"` and query sqlite-vec with that vector. The hypothetical passage shares vocabulary with real docs (`"latency"`, `"round-trip"`, `"SQLite"`, `"WASM"`, `"local-first"`), so cosine similarity with the real chunks climbs.

The original paper: [Gao et al., 2022 — Precise Zero-Shot Dense Retrieval without Relevance Labels](https://arxiv.org/abs/2212.10496).

## Concrete gains

On the tempo vault, our `vocabulary-gap` category (see [test/retrieval/gold.json](../test/retrieval/gold.json)) already hits 100% recall@5 for semantic — there's no headroom to demonstrate HyDE lift on this specific corpus. The value shows up on larger, lower-precision corpora where:

1. The query uses generic words (`"how do we handle auth"`)
2. The target docs use proprietary/jargon vocabulary (`"Identity Broker middleware"`, `"JWT rotation cadence"`)

We've wired HyDE so you can enable it per-query and measure on your own vault.

## Usage

### Prerequisites

Set `ANTHROPIC_API_KEY` in your environment. Never commit it:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # shell profile, or .env (gitignored)
```

No key? HyDE logs a single warning and falls back to the raw query. It is *never* a hard failure.

### CLI

```bash
# Add --hyde to any of the three semantic commands
claude-code-vault semantic-search "why did we pick local DB" --hyde
claude-code-vault search-chunks "timer accuracy in background tabs" --hyde
claude-code-vault search-with-context "storage tradeoffs" --hyde
```

### MCP

Add `"hyde": true` to the tool-call args:

```json
{
  "name": "vault_semantic_search",
  "arguments": {
    "query": "why did we pick local DB",
    "hyde": true
  }
}
```

All three semantic tools accept it: `vault_semantic_search`, `vault_search_chunks`, `vault_search_chunks_with_context`.

### Eval harness

```bash
node test/retrieval/eval.js --hyde              # measure + diff vs baseline
node test/retrieval/eval.js --hyde --update-baseline
```

## Design decisions

**Concat, not replace.** We embed `${query}\n\n${passage}` rather than the passage alone. If the LLM hallucinates vocabulary that drifts away from your corpus, keeping the raw query in the embedding text anchors the search. This is a known robust variant of the original HyDE.

**Haiku, not Opus/Sonnet.** HyDE only needs vocabulary overlap — not factual accuracy or deep reasoning. Haiku is ~10× cheaper and ~3× faster. Model is pinned in [`lib/hyde.js`](../lib/hyde.js) (`HYDE_MODEL`) if you want to change it.

**Opt-in, not always-on.** Every HyDE query adds one LLM round-trip (~300ms, ~$0.001). That's fine for chat use but wrong for bulk indexing or fully-local operation. Users toggle it per-query via the `--hyde` flag / `hyde: true` arg.

**Graceful fallback.** Missing API key, network error, or API failure → log once, use the raw query, search proceeds normally. HyDE is an upgrade, never a dependency.

**Remote-only (for now).** The Phase 1 roadmap scoped HyDE to the Anthropic API. A fully-local variant (small local model generating the hypothetical) is a future consideration — likely via `@huggingface/transformers` with a small instruction-tuned model, but generation quality matters less than for chat so it's tractable.

## When HyDE does *not* help

- **Keyword-shaped queries** (`"ADR-001"`, `"pricing"`, `"gotchas"`) — the raw query already matches title/tag/id. HyDE just adds latency.
- **Very small vaults** — semantic already works. Measure before enabling.
- **Queries where the LLM hallucinates wrong jargon** — if the hypothetical passage invents vocabulary that doesn't appear in your corpus, the probe drifts *away* from relevant chunks. Rare with a well-tuned prompt, but possible.

A future optimization: classify the query first (keyword-shaped? vocabulary-gap? multi-hop?) and only invoke HyDE on queries that look like they need it.

## Security

- Keys live in `process.env.ANTHROPIC_API_KEY` only — never hardcoded.
- `.env` and `.env.local` are in `.gitignore`.
- HyDE logs never include the key value.
- The query is sent to the Anthropic API when HyDE is on — treat query text the same way you treat any other outbound LLM call.

## Files touched

- [lib/hyde.js](../lib/hyde.js) — the `expandWithHyde(query)` helper
- [lib/embeddings.js](../lib/embeddings.js) — `searchChunks` reads `opts.hyde` and enriches the query before `embedText`
- [lib/mcp.js](../lib/mcp.js) — `hyde: z.boolean().optional()` on the three semantic tools
- [index.js](../index.js) — `--hyde` CLI flag on the three semantic commands
- [test/retrieval/eval.js](../test/retrieval/eval.js) — `--hyde` flag for measuring lift vs baseline
