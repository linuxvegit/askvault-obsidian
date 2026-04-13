---
title: Local Index Scoring for Wiki Retrieval
date: 2026-04-10
status: reviewed
origin: docs/ideation/2026-04-10-askvault-open-ideation.md (Idea #2)
---

# Local Index Scoring for Wiki Retrieval

## Problem

Every chat query currently requires two LLM round-trips: one to read `index.md` and select relevant wiki pages, and one to answer the question using those pages. The first call is pure classification — it receives the full index and returns a JSON array of up to 5 file paths. This doubles per-query latency and API cost, and becomes more expensive as the wiki grows (larger index.md = more input tokens).

## Goal

Replace the first LLM call with local BM25 scoring over enriched index metadata. The LLM is invoked only for the answer generation step. Fall back to the LLM retrieval path when local scoring confidence is low.

## Users

All AskVault users. This is invisible infrastructure — behavior should be indistinguishable from the current LLM retrieval for the user, just faster and cheaper.

## Requirements

### R1: BM25 Scoring Engine
- Implement BM25 (Okapi BM25) scoring in TypeScript with no external dependencies
- Score the user's query against all wiki page entries in the index
- Return the top 5 pages by score
- Scoring corpus: enriched index entries (see R2), not raw page content

### R2: Enriched Index Entries
- During `rebuildIndex()`, read each wiki page's YAML frontmatter and extract: `type`, `tags`, `related` fields
- Include the existing one-line summary (first content line after frontmatter)
- Store enriched entries in `index.md` in a structured format that is both human-readable and parseable
- The enriched index must remain valid markdown (index.md is visible to users)

### R3: In-Memory Index
- On plugin load and after each index rebuild, parse `index.md` into an in-memory data structure suitable for BM25 scoring
- Do not re-read `index.md` from disk on every query — cache it in memory
- Invalidate and reload when `rebuildIndex()` completes

### R4: Hybrid Retrieval with LLM Fallback
- If the top BM25 score is below a confidence threshold, fall back to the existing LLM retrieval path (send index.md to LLM)
- The threshold should be a hardcoded constant; threshold tuning is out of scope for this iteration
- When falling back, log the fallback event (for future tuning)

### R5: Query Preprocessing
- Tokenize the user's query using simple whitespace + punctuation splitting
- Lowercase normalization (consistent with existing `toFileName()` convention)

## Non-Goals

- Semantic/embedding-based scoring (no vector math, no external embedding APIs)
- Configurable top-K in settings (fixed at 5 for now)
- Changes to the answer generation LLM call (only the page selection step changes)
- Changes to ingest, lint, or any other WikiService operation beyond index rebuild
- Persisting BM25 term statistics to disk (recomputed on load from index.md)

## Success Criteria

- Chat queries that previously took 2 LLM calls now take 1 (when BM25 confidence is above threshold)
- Retrieved pages are comparable quality to LLM selection for well-formed questions
- No visible latency increase for the scoring step (should be <50ms for wikis with <5,000 pages)
- Fallback threshold is set conservatively (falls back often); calibration against real queries is deferred to post-ship tuning

## Open Questions

- **Enriched index format:** What structured format in index.md balances human readability with parseability? Candidates: enhanced markdown list entries, YAML blocks per section, or a hidden metadata comment block.
- **Fallback threshold:** What BM25 score constitutes "low confidence"? Will need empirical tuning after implementation. Start with a conservative threshold (fall back often) and tighten over time.
- **Stopword list:** Use a minimal hardcoded list (~50 words) or a more comprehensive one? Minimal is simpler and less likely to remove domain-relevant terms.

## Risks

| Risk | Mitigation |
|---|---|
| BM25 misses semantically relevant pages that LLM retrieval would catch | Hybrid fallback; conservative threshold initially |
| Enriched index format makes index.md less readable | Keep format as close to current markdown list as possible |
| In-memory index stale after external wiki edits | Reload on vault events (file change in wiki folder) |
