---
title: "feat: Add BM25 local scoring for wiki retrieval"
type: feat
status: active
date: 2026-04-10
origin: docs/brainstorms/2026-04-10-local-index-scoring-requirements.md
---

# feat: Add BM25 local scoring for wiki retrieval

## Overview

Replace the LLM-based page selection step in `findRelevantPages()` with a local BM25 scoring engine. Currently every chat query makes two LLM calls — one to pick relevant wiki pages from `index.md`, one to answer the question. This change eliminates the first call for high-confidence matches, significantly reducing per-query latency and API cost. A fallback to the existing LLM path fires when BM25 returns no term overlap.

## Problem Frame

The retrieval step sends the entire `index.md` to the LLM just to get back a JSON array of up to 5 file paths. This is pure classification work — the LLM reads a list and picks entries. As the wiki grows, this call gets more expensive (more input tokens) and adds latency before the user sees any response. BM25 is a well-established text scoring algorithm that handles this task locally in <50ms. (see origin: `docs/brainstorms/2026-04-10-local-index-scoring-requirements.md`)

## Requirements Trace

### Scoring Algorithm
- R1. BM25 scoring engine — pure TypeScript, no external deps, top 5 results
- R5. Query preprocessing — whitespace/punctuation tokenization, lowercase normalization

### Index Infrastructure
- R2. Enriched index entries — frontmatter metadata (type, tags, related) included in index.md
- R3. In-memory index — cached, invalidated on rebuildIndex() completion

### Retrieval Behavior
- R4. Hybrid retrieval — BM25 first, LLM fallback when top score is 0

## Scope Boundaries

- Only the page selection step changes — the answer generation LLM call is untouched
- ChatView.ts is not modified — `findRelevantPages()` retains its `Promise<string[]>` signature
- No new settings UI — threshold and top-K are hardcoded constants
- No new npm dependencies
- Fallback threshold tuning is out of scope for this iteration
- Configurable top-K is out of scope for this iteration
- Vault event-driven cache invalidation is deferred — invalidation bounded to `rebuildIndex()` calls only

## Context & Research

### Relevant Code and Patterns

- `src/WikiService.ts:408-445` — `findRelevantPages()`: reads index, sends to LLM via `callLLMRaw()`, parses JSON array of paths. **This is the method being modified.**
- `src/WikiService.ts:187-218` — `rebuildIndex()`: iterates sources/entities/concepts/queries dirs, extracts first-line summary, writes grouped markdown list to `index.md`. **This is enriched in Unit 2.**
- `src/WikiService.ts:70-87` — `readWikiFile()`/`writeWikiFile()`: all wiki I/O goes through these helpers
- `src/WikiSchema.ts:34-69` — `getSchema()`: in-memory caching pattern with `cachedSchema` field and lazy init. **BM25 index cache follows this same pattern.**
- `src/LLMService.ts:64-152` — `callLLMRaw()`: the LLM call eliminated by BM25 (used with maxTokens=500 in findRelevantPages)
- `src/ChatView.ts:199-213` — calls `findRelevantPages(message)` and uses result as `string[]`. **Untouched by this change.**
- `src/WikiService.ts:35-36` — `isBusy` guard: serializes ingest/lint/update but NOT `findRelevantPages()`. BM25 scoring is read-only and should not acquire this mutex.

### Institutional Learnings

- The codebase has zero tests — BM25Scorer will be the first significant algorithmic code. Adding tests for it is high value.
- Idea #1 (Query-Aware Retrieval Flywheel) is higher leverage and involves including `queries/` pages in retrieval. Including queries/ in the BM25 corpus from day one aligns both features.
- The LLM fallback path inherits the fragile JSON parsing retry. This is a known issue but out of scope for this plan (see Idea #3: Structured LLM Output).

## Key Technical Decisions

- **Enriched index format**: Enhanced markdown list entries with inline metadata brackets — `- entities/react.md [tags:framework,frontend related:sources/tutorial.md] -- Summary text`. Uses ASCII ` -- ` (space-hyphen-hyphen-space) as separator to avoid Unicode em-dash encoding ambiguity between write and parse paths. Parseable with a single regex, remains valid markdown, minimal disruption to current format. Rationale: keeps one entry per line (grep-friendly), avoids YAML/comment blocks that complicate parsing. (resolves Open Question from origin doc)
- **Scoring corpus**: Enriched index entries (summary + first 200 characters of page body after frontmatter + tags + related page names, concatenated). Rationale: `rebuildIndex()` already reads every page's content, so including the first paragraph adds no I/O cost and substantially improves term overlap for natural-language queries. Tags and related values are passed as raw strings to the tokenizer (no comma-splitting needed — the tokenizer splits on non-alphanumeric characters). (see origin: R1)
- **Fallback threshold**: Fall back when the top BM25 score is exactly 0 (no term overlap between query and any index entry). Rationale: simple, conservative, avoids the unnormalized-score calibration problem. A score of 0 means the query shares zero terms with any page — only the LLM can handle these. (resolves Open Question from origin doc)
- **BM25 as separate module**: New `src/BM25Scorer.ts` class, instantiated by WikiService. Rationale: keeps the scoring algorithm isolated and testable. WikiService remains the orchestrator.
- **No new settings**: BM25 parameters (k1=1.2, b=0.75) and top-K (5) are hardcoded constants in BM25Scorer. Rationale: these are standard BM25 defaults used across the IR community; tuning via settings adds UI complexity with negligible benefit.
- **Include queries/ pages in BM25 corpus**: The enriched index already includes the `queries/` section. BM25 scores them alongside entities/concepts/sources. Rationale: aligns with Idea #1 from ideation.

## Open Questions

### Resolved During Planning

- **Enriched index format**: Enhanced list entries with `[tags:... related:...]` brackets and ASCII ` -- ` separator (see Key Technical Decisions)
- **Fallback threshold**: Score == 0 (no term overlap) triggers fallback (see Key Technical Decisions)
- **Integration point**: BM25Scorer instantiated inside WikiService; `findRelevantPages()` is the sole caller; ChatView untouched

### Deferred to Implementation

- **Exact BM25 parameter sensitivity**: k1=1.2 and b=0.75 are standard defaults. If retrieval quality is noticeably worse than LLM selection, these can be adjusted without architectural changes.
- **Frontmatter parsing edge cases**: LLM-generated frontmatter may be malformed. Implementation should use try/catch per page and fall back to current first-line summary extraction.
- **Empty query after tokenization**: If the query tokenizes to zero terms, skip BM25 and go straight to LLM fallback.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Query Flow (after change):
                                    
  user question                     
       │                            
       ▼                            
  tokenize query (R5)               
       │                            
       ▼                            
  BM25 score against                
  in-memory index (R1,R3)           
       │                            
       ├─ top score > 0 ──► return top 5 paths           
       │                            
       └─ top score == 0 ──► LLM fallback (R4)           
                │                   
                ▼                    
          existing callLLMRaw path  
                │                    
                ▼                    
          return parsed paths       

Index Lifecycle:

  plugin load ──► parse index.md into memory (R3)
                      │
  rebuildIndex() ──► invalidate cache ──► re-parse on next access (R3)
                      │
  ingest/update/saveQuery done ──► rebuildIndex() called ──► cache refreshed
```

**Enriched index.md entry format:**
```
- entities/react.md [tags:framework,frontend related:sources/tutorial.md,concepts/component-model.md] -- A JavaScript UI library for building user interfaces
```

Regex to parse: `^- (.+\.md) \[tags:([^\]]*) related:([^\]]*)\] -- (.+)$`

Note: Uses ASCII ` -- ` separator (not Unicode em-dash). Regex uses `[^\]]*` instead of `(.*?)` for tags/related groups to prevent `]` characters in summary text from misaligning capture groups.

**BM25 in-memory structure per document:**
```
{ path: string, terms: string[], termFreqs: Map<string, number>, length: number }
```

Global: `docFreqs: Map<string, number>`, `avgDocLength: number`, `totalDocs: number`

## Implementation Units

- [ ] **Unit 1: Create BM25Scorer module**

**Goal:** Implement the Okapi BM25 scoring algorithm as a standalone, testable TypeScript class.

**Requirements:** R1, R5

**Dependencies:** None

**Files:**
- Create: `src/BM25Scorer.ts`

**Approach:**
- Export a `BM25Scorer` class with methods: `buildIndex(entries: IndexEntry[])` to precompute term frequencies and document frequencies, and `score(query: string): ScoredResult[]` to return top-K results
- `IndexEntry` type: `{ path: string; text: string }` where `text` is the concatenated scoring corpus (summary + first 200 chars of page body + tags + related names)
- Tokenization: lowercase, split on `/[^a-z0-9]+/`, filter empty strings
- BM25 parameters as module constants: `K1 = 1.2`, `B = 0.75`, `TOP_K = 5`
- `score()` tokenizes the query, computes BM25 score per document, returns top 5 sorted descending by score
- If query tokenizes to zero terms, return empty array
- All data structures are plain objects/Maps — no external deps

**Patterns to follow:**
- `src/WikiSchema.ts` caching pattern (lazy init, invalidation method)
- `toFileName()` lowercase normalization style from `src/WikiService.ts:89-91`

**Test scenarios:**
- Happy path: Query with matching terms returns expected pages sorted by score
- Happy path: Multi-term query boosts pages with more term matches
- Edge case: Query with zero terms after tokenization returns empty array
- Edge case: Single-document corpus returns that document if terms match
- Edge case: No documents in corpus returns empty array
- Edge case: Query terms not in any document returns all scores as 0
- Happy path: Document length normalization — shorter documents with same term frequency score higher (BM25 b parameter)
- Happy path: IDF weighting — terms appearing in fewer documents produce higher scores

**Verification:**
- BM25Scorer can be instantiated, fed a corpus, and returns correctly ordered results for known inputs

---

- [ ] **Unit 2: Enrich rebuildIndex() with frontmatter metadata**

**Goal:** Modify `rebuildIndex()` to read YAML frontmatter from each wiki page and write enriched entries to `index.md`.

**Requirements:** R2

**Dependencies:** None (can be done in parallel with Unit 1)

**Files:**
- Modify: `src/WikiService.ts` (rebuildIndex method, lines 187-218)

**Approach:**
- For each wiki page, split content at the second `---` to isolate frontmatter from body
- Parse frontmatter using Obsidian's `parseYaml()` (from `obsidian` module) wrapped in try/catch — on failure, fall back to current first-line summary extraction
- Extract `tags` (default to `[]`), `related` (default to `[]`), and the first non-empty body line as summary
- Write entries in enriched format: `- {type}/{filename}.md [tags:{csv} related:{csv}] -- {summary}`
- Tags as comma-separated values; related as comma-separated paths with `[[]]` wrappers stripped
- Sections with no entries still omitted (preserve current behavior)

**Patterns to follow:**
- Current `rebuildIndex()` iteration pattern (lines 187-218)
- `readWikiFile()` for file access (line 70)
- Obsidian's `parseYaml` (already available via the `obsidian` module import)

**Test scenarios:**
- Happy path: Page with complete frontmatter (type, tags, related) produces enriched entry
- Happy path: Page with empty tags/related arrays produces `[tags: related:]` entry
- Error path: Page with malformed/missing frontmatter falls back to first-line summary (no crash)
- Edge case: Page with no content after frontmatter uses filename as summary
- Integration: After rebuildIndex(), index.md contains enriched entries in the expected format

**Verification:**
- `index.md` output matches the enriched format specification for a test wiki with varied frontmatter

---

- [ ] **Unit 3: Add in-memory index cache to WikiService**

**Goal:** Parse `index.md` into an in-memory data structure on load and after each rebuild, exposing it for BM25 scoring.

**Requirements:** R3

**Dependencies:** Unit 2 (enriched format must be defined to parse it)

**Files:**
- Modify: `src/WikiService.ts`

**Approach:**
- Add a private `cachedIndex: IndexEntry[] | null = null` field to WikiService (follows `WikiSchema.cachedSchema` pattern)
- Add a private `parseIndex(content: string): IndexEntry[]` method that parses enriched `index.md` entries using regex: `^- (.+\.md) \[tags:([^\]]*) related:([^\]]*)\] -- (.+)$`
- For each match, construct `IndexEntry` with `path` and `text` (concatenation of summary, tags, related page names for BM25 scoring). Pass raw tags and related strings directly — the BM25 tokenizer splits on non-alphanumeric characters, so commas are handled naturally. Note: parseIndex assumes `[[]]` wrappers were stripped at write time (Unit 2).
- Add a public `getIndexEntries(): IndexEntry[]` that returns the cache, rebuilding from disk if null (lazy init)
- At the start of `rebuildIndex()`, set `this.cachedIndex = null` to ensure any concurrent `getIndexEntries()` call reads fresh data from disk rather than stale cache
- Parse happens on next `getIndexEntries()` call, not eagerly — avoids double-reading during ingest

**Patterns to follow:**
- `WikiSchema.cachedSchema` (line 37): nullable cache field with lazy init
- `WikiSchema.getSchema()`: reads from disk only when cache is null

**Test scenarios:**
- Happy path: After `rebuildIndex()`, `getIndexEntries()` returns parsed entries with correct paths and text
- Happy path: Subsequent calls to `getIndexEntries()` return cached result without re-reading disk
- Edge case: Cache is null on first call — reads from disk and caches
- Integration: After `rebuildIndex()` completes, cache is invalidated and next call re-parses

**Verification:**
- `getIndexEntries()` returns the correct number of entries matching wiki pages on disk
- No disk read on repeated calls (cache hit)

---

- [ ] **Unit 4: Wire BM25 into findRelevantPages() with LLM fallback**

**Goal:** Modify `findRelevantPages()` to use BM25 scoring first and fall back to the existing LLM path when BM25 returns no results.

**Requirements:** R1, R3, R4

**Dependencies:** Units 1, 2, 3

**Files:**
- Modify: `src/WikiService.ts` (findRelevantPages method, lines 408-445)
- No changes to `main.ts` — BM25Scorer is instantiated lazily inside WikiService

**Approach:**
- In `findRelevantPages()`:
  1. Get entries via `this.getIndexEntries()`
  2. If entries are empty, fall through to LLM retrieval path (not return `[]` — empty entries may mean pre-enrichment index format; the LLM can still select pages from raw index.md)
  3. Build BM25 index from entries and score the query (BM25Scorer instantiated inline from cached entries — no separate scorer cache to synchronize)
  4. If top score > 0, return the top 5 paths
  5. If BM25Scorer.score() returns empty array (zero-term query) or top score == 0, log "BM25 fallback" via `console.log` and proceed to existing LLM retrieval path
- The existing LLM retrieval code stays in place as the fallback body — no deletion
- Update the LLM system prompt in the fallback path to describe the enriched entry format so the model correctly extracts file paths from bracketed entries

**Patterns to follow:**
- Current `findRelevantPages()` structure (lines 408-445)
- Error handling: wrap BM25 scoring in try/catch — on any error, fall back to LLM path with a warning log

**Test scenarios:**
- Happy path: Query with term overlap returns BM25-scored pages without LLM call
- Happy path: Query with zero term overlap triggers LLM fallback and returns LLM-selected pages
- Edge case: Empty index returns `[]` immediately (no BM25, no LLM call)
- Error path: BM25Scorer throws an error — falls back to LLM path gracefully
- Edge case: Query tokenizes to zero terms — falls back to LLM path
- Integration: End-to-end from ChatView.sendMessage() through BM25 scoring to context building
- Integration: LLM fallback with enriched index.md correctly extracts file paths from bracketed entries

**Verification:**
- For queries with obvious keyword matches, `findRelevantPages()` returns results without calling `callLLMRaw()`
- For queries with no keyword matches, `findRelevantPages()` falls back and returns LLM-selected results
- Console shows fallback log entries when fallback fires

---

- [ ] **Unit 5: Build verification and manual testing**

**Goal:** Verify the full implementation builds cleanly and produces correct behavior in a real Obsidian vault.

**Requirements:** All (R1-R5)

**Dependencies:** Units 1-4

**Files:**
- No new files — verification only

**Approach:**
- Run `yarn build` to verify TypeScript compilation passes
- Copy output to test vault plugin directory
- Test with a wiki that has 10+ pages across sources/entities/concepts/queries
- Verify: keyword queries return relevant pages without delay, vague queries trigger fallback, console logs show BM25 vs fallback routing

**Test expectation: none** — this is a manual verification unit, not a code change.

**Verification:**
- `yarn build` succeeds with no type errors
- Plugin loads in Obsidian without errors
- Chat queries return relevant results
- Console shows BM25 scoring path for keyword queries and fallback path for vague queries

## System-Wide Impact

- **Interaction graph:** `findRelevantPages()` is called by `ChatView.sendMessage()` only. No other callers. The change is contained to WikiService internals.
- **Error propagation:** BM25 errors are caught within `findRelevantPages()` and trigger the existing LLM fallback. No new error types propagate to ChatView.
- **State lifecycle risks:** The in-memory index cache could be stale if wiki pages are edited externally while the plugin is running and no ingest/rebuild occurs. This is an accepted risk for this iteration — the cache refreshes on any operation that calls `rebuildIndex()`: `ingest()`, `processUpdateQueue()`, and `saveQueryResult()`.
- **API surface parity:** `findRelevantPages()` signature is unchanged (`Promise<string[]>`). No breaking changes.
- **Integration coverage:** The critical cross-layer scenario is: user sends chat message → BM25 scores → pages returned → context built → LLM answers. This must be verified end-to-end.
- **Unchanged invariants:** `getPageContents()`, `chatStream()`, `callLLMRaw()` (for non-retrieval uses), ingest, lint, and auto-update are all untouched.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| BM25 retrieval quality worse than LLM for non-keyword queries | Conservative fallback (score == 0 triggers LLM); LLM path fully preserved |
| Enriched index format breaks existing LLM fallback prompt parsing | Fallback sends raw index.md content; LLM prompt updated to note the enriched format so path extraction still works |
| In-memory cache stale during concurrent operations | `findRelevantPages()` does not acquire `isBusy`; accepts stale reads during ingest (index refreshes at ingest completion) |
| No test framework means BM25Scorer correctness is unverifiable automatically | Unit 5 includes manual verification; BM25 algorithm is well-understood and unit tests can be added when a test framework is introduced |
| Frontmatter parsing failures during enriched rebuild | Per-page try/catch with fallback to current first-line summary extraction |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-10-local-index-scoring-requirements.md](docs/brainstorms/2026-04-10-local-index-scoring-requirements.md)
- **Ideation context:** [docs/ideation/2026-04-10-askvault-open-ideation.md](docs/ideation/2026-04-10-askvault-open-ideation.md)
- Related code: `src/WikiService.ts` (findRelevantPages, rebuildIndex, readIndex), `src/WikiSchema.ts` (caching pattern), `src/LLMService.ts` (callLLMRaw)
- BM25 reference: Robertson & Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond" (2009)
