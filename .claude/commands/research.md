---
description: Survey the competitive landscape, find market gaps, propose strategic opportunities
---

Research the competitive landscape for claude-code-vault and surface high-value opportunities.

**Domain:** Knowledge bases, PKM tools, RAG systems, and memory layers designed for LLM agents and AI-assisted development.

1. **Understand where we stand** — Read in parallel:
   - `README.md` — current feature set and roadmap
   - `gh issue list --repo bernabranco/claude-code-vault --state open --json number,title` — what's already planned
   - `git log main -10 --oneline` — recent direction

2. **Survey the landscape** — Web-search and read landing pages / READMEs for tools in adjacent spaces. Cast wide — look across all of these angles:
   - PKM tools with LLM integration (Obsidian + plugins, Logseq, Notion AI, Roam)
   - Developer-focused knowledge bases (Outline, Confluence, Slab, GitBook)
   - RAG frameworks and memory layers (LlamaIndex, LangChain memory, Mem0, MemGPT/Letta)
   - MCP memory servers (any memory MCP tools in the ecosystem)
   - Agent context management (continues from session to session — what exists?)
   - Code documentation tools that target LLMs (context7, Mintlify, Swimm)
   - Vector DB / knowledge graph products aimed at developers (Weaviate, Qdrant, Neo4j integrations)

   For each tool found, capture: **what it does**, **what it does well**, **what it misses or does poorly**, **pricing/access model**.

3. **Find gaps** — After surveying, reason about:
   - What problems in the LLM-memory / developer-knowledge space does NO tool address well?
   - Where do developers currently use painful workarounds (pasting context, re-explaining things, long CLAUDE.md files)?
   - What would a team running Claude Code daily across multiple repos desperately want?
   - What's technically feasible for a small project that big players can't move fast on?
   - Are there adjacent spaces where claude-code-vault primitives (vault, semantic search, graph, MCP) could expand?

4. **Produce the report** — Structure it as:

   ### Competitive Map
   Table: Tool | Category | Strengths | Weaknesses | Pricing

   ### Underserved Problems
   3-5 specific problems the market isn't solving well, with evidence from the survey.

   ### Strategic Opportunities
   For each opportunity, write:
   - **Opportunity name** (crisp label)
   - **The gap** — what's missing in the market
   - **Why claude-code-vault is positioned to win it** — local-first, MCP-native, markdown-source-of-truth = what leverage?
   - **What it would take** — rough scope (S/M/L), key technical risk
   - **Upside** — who would use this, how many, what they'd pay

5. **Propose issues** — Pick the top 3 opportunities and draft a GitHub issue for each. Ask: "Should I create any of these? (e.g. 'all', '1 3', or 'none')"

6. **Create approved issues** — `gh issue create --repo bernabranco/claude-code-vault --title "..." --body "..."` with label `enhancement`.
