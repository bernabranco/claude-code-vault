---
id: shared/glossary/rag-terms
title: RAG and retrieval terms
description: Cross-project glossary for retrieval-augmented generation vocabulary
summary: Glossary of RAG/retrieval jargon shared across projects — RRF, MRR, Recall@k, Cross-encoder, Reranker, Dense retrieval, Sparse retrieval, BM25. Auto-resolved on vault_read.
type: glossary
status: current
lastVerified: 2026-04-20
tags: [glossary, reference, shared, rag, retrieval]
terms: [RRF, MRR, Recall, Cross-encoder, Reranker, Dense retrieval, Sparse retrieval, BM25]
---

# RAG and retrieval terms

Cross-project glossary. Any note indexed by `claude-code-vault` that mentions one of these terms in prose will have the definition returned as `resolvedTerms` by `vault_read` (unless `resolveJargon: false`). Terms are case-insensitive, word-boundary-matched, and ignored inside code fences and wiki-links.

## RRF

Reciprocal Rank Fusion — a score-free way to merge results from two or more ranked lists (e.g. keyword and semantic search). Each item's fused score is the sum of `1 / (k + rank)` across lists, with `k` usually 60. Used by hybrid-search implementations because it doesn't require score calibration between the two systems.

## MRR

Mean Reciprocal Rank — the retrieval-quality metric `1 / rank_of_first_correct`, averaged over queries. MRR@5 truncates the rank beyond position 5 (a miss counts as 0). Complements recall@k because it penalizes putting the right answer further down.

## Recall

Recall@k — the fraction of queries for which at least one relevant document appears in the top-k results. Recall@5 is the baseline retrieval metric in this repo's eval harness.

## Cross-encoder

A transformer that takes both the query and a candidate passage as joint input and outputs a single relevance score. Slower than dense retrieval (can't pre-embed the corpus) but more accurate, so it's typically run only over the top-K candidates from a cheaper first stage.

## Reranker

The second stage in a retrieve-then-rerank pipeline. Takes the top-K from a cheap retriever (BM25 or dense) and reorders them with a slower, more accurate model — almost always a cross-encoder in practice.

## Dense retrieval

Retrieval by vector similarity — query and documents are embedded into the same space and ranked by cosine distance. What `vault_semantic_search` does via `sqlite-vec`.

## Sparse retrieval

Retrieval by term overlap — BM25, TF-IDF, or plain keyword matching. What `vault_search` does. Complementary to dense retrieval because it catches exact-term matches (names, IDs, rare jargon) that embeddings miss.

## BM25

Best Match 25 — the dominant sparse-retrieval scoring function. Extends TF-IDF with term-frequency saturation and document-length normalization. The thing you're implicitly comparing against whenever someone says "lexical search."
