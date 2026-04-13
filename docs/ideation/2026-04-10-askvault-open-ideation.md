---
title: AskVault Open-Ended Ideation
date: 2026-04-10
focus: open-ended
status: complete
survivors: 7
candidates: 38
session_model: claude-opus-4-6
---

# AskVault Open-Ended Ideation

## Codebase Context

**Project:** AskVault — Obsidian plugin providing wiki-powered LLM chat grounded in vault content.
**Stack:** TypeScript, Obsidian Plugin API, esbuild, no runtime deps.
**Architecture:** 6 modules (main.ts, ChatView, LLMService, WikiService, WikiSchema, WikiView, Settings). Two-step retrieval: index.md → LLM picks pages → read pages → stream response. Wiki pages as plain markdown with YAML frontmatter.

**Key observations:**
- No tests, no linter — zero safety net
- `isBusy` mutex serializes all wiki operations, blocking chat during ingest
- LLM JSON parsing is fragile (retry once on failure)
- `queries/` pages exist but are not included in retrieval
- Entity/concept merge quality depends entirely on LLM prompt quality
- No preview, undo, or visibility into wiki changes
- Schema infrastructure exists (`_schema.md`) but is underutilized
- Auto-update exists but is rudimentary (5s debounce + full re-process)

**Past learnings:** No `docs/solutions/` directory. Design spec and implementation plan exist in `docs/superpowers/` from the wiki architecture migration (2026-04-07).

---

## Ranked Survivors

### 1. Query-Aware Retrieval Flywheel

**Description:** Include `queries/` pages in the retrieval pool. Every saved chat answer becomes context for future queries. Add lightweight telemetry (which pages contributed, optional thumbs-up/down) to weight retrieval over time.

**Rationale:** Highest leverage change in the codebase. The infrastructure already exists — `queries/` dir, "Save to Wiki" button, `index.md` rebuild logic. Closing this loop turns every conversation into compounding knowledge with minimal code change.

**Downsides:** Query pages could add noise if low-quality answers are saved. Needs a quality gate or user-controlled save (which already exists via the button).

**Confidence:** High | **Complexity:** Low

---

### 2. Local Index Scoring (Kill the Retrieval LLM Call)

**Description:** Replace the first LLM call (send `index.md` → LLM picks pages) with local BM25/TF-IDF scoring over index metadata. The LLM is invoked only once — to answer the question with retrieved context.

**Rationale:** Cuts per-query latency roughly in half, halves per-query API cost, removes a fragile LLM dependency from the hot path. BM25 is ~100 lines of TypeScript with no external deps. Scales to thousands of wiki pages without index.md hitting context limits.

**Downsides:** Semantic understanding is weaker than LLM selection for ambiguous queries. Could be a hybrid (local scoring with LLM fallback for low-confidence matches).

**Confidence:** High | **Complexity:** Medium

---

### 3. Structured LLM Output (Kill Fragile JSON Parsing)

**Description:** Use OpenAI's `response_format: { type: "json_schema" }` and Claude's tool-use with `input_schema` to guarantee well-formed JSON from all extraction and retrieval calls. Eliminate the retry-on-parse-failure path.

**Rationale:** Removes the most fragile part of the pipeline. Both providers now natively support structured output. This is a reliability improvement with negative complexity — you delete the retry code.

**Downsides:** Requires provider-specific implementation paths in LLMService (partially there already). Custom endpoint users may not support structured output — need a fallback.

**Confidence:** High | **Complexity:** Low-Medium

---

### 4. Background Operation Queue

**Description:** Replace the `isBusy` boolean mutex with an async job queue. Wiki operations (ingest, lint, auto-update) are enqueued and processed sequentially in the background. Chat retrieval runs independently. Progress events stream to WikiView.

**Rationale:** Unblocks the most common user frustration: "I can't chat while ingesting." Foundational improvement that enables progress UI, graceful error handling, and future parallelism.

**Downsides:** Adds state management complexity (queue, progress events, cancellation). Needs careful handling of concurrent read/write to wiki files.

**Confidence:** High | **Complexity:** Medium

---

### 5. Relationship-First Wiki (Claims Graph)

**Description:** Extract structured triples (subject, predicate, object, source) instead of flat entities/concepts. Store claims as wiki pages. Enable relationship traversal during retrieval.

**Rationale:** Most ambitious and highest-ceiling idea. Transforms the wiki from a flat index into a navigable knowledge graph. Obsidian's native graph view visualizes it. Enables query types the current architecture cannot support.

**Downsides:** Largest implementation effort. LLM extraction quality for triples is less proven. Schema migration needed.

**Confidence:** Medium | **Complexity:** High

---

### 6. Wiki-First Browsable Interface with Inline Q&A

**Description:** Make wiki pages the primary interface — render as browsable, interlinked documents. Add inline Q&A: select text → "Ask about this" → scoped chat grounded in that page and its links.

**Rationale:** Aligns with Obsidian's core UX. Turns the wiki from a hidden backend into a first-class knowledge artifact users can verify, correct, and build on.

**Downsides:** Significant UI work. May overlap with Obsidian's native file browsing.

**Confidence:** Medium | **Complexity:** Medium-High

---

### 7. User Curation Amplification

**Description:** Detect user edits to wiki pages. Mark curated pages (`curated: true` frontmatter), boost retrieval weight, protect from overwrite during future ingests.

**Rationale:** Creates a compounding flywheel: user edits → better retrieval → more value → more curation. Solves the trust problem ("will my edits survive re-ingest?"). Small code change, outsized behavioral impact.

**Downsides:** Detecting user edits vs. plugin writes requires checking `isBusy` state during vault events.

**Confidence:** Medium-High | **Complexity:** Low-Medium

---

## Rejection Table

| Rejected Idea | Frame | Reason |
|---|---|---|
| Multi-provider retrieval ensemble | Assumption-breaking | Doubles API cost, requires two API keys, marginal benefit vs. local scoring |
| Lazy page loading / streaming context | Inversion | Requires tool-use mid-generation; fundamentally changes LLM call pattern |
| Section-level ingest with diff | Assumption-breaking | High complexity; better as v2 refinement of event-driven ingest |
| Confidence scoring + progressive refinement | Leverage | LLM confidence scores are unreliable; mechanism unvalidated |
| Schema evolution via usage patterns | Leverage | Second-order effect requiring telemetry first; premature |
| Conversation thread distillation | Leverage | Subsumed by query-aware retrieval |
| Streaming progress with file-level granularity | Pain/friction | Low leverage; natural byproduct of background queue |
| Operation diagnostics dashboard | Pain/friction | Nice-to-have observability; low leverage |
| Configurable context budget | Pain/friction | Configuration knob, not structural improvement |
| Graceful degradation / retry on failure | Pain/friction | Subsumed by transactional writes + background queue |
| Auto-heal wiki on startup | Inversion | Good hygiene, low novelty; part of transactional writes |
| Parallel ingest pipeline | Leverage | Subsumed by background queue; entity merge serialization limits real parallelism |
| Wiki diff preview before write | Pain/friction | Valuable UX but high complexity for initial version; better after curation amplification |
| Entity deduplication / alias resolution | Pain/friction | Important but better addressed by claims graph (Idea 5) which reframes the data model |
| Transactional wiki writes with rollback | Pain/friction, Inversion | Solid engineering but subsumed by background queue + event-driven approach |
| Event-driven auto-ingest | Inversion, Leverage | Good direction but subsumed by background queue as prerequisite |
| Adaptive schema / schema-driven prompts | Inversion, Assumption | Underutilized infrastructure but premature to invest before core retrieval is improved |
| Conversation-as-wiki-page | Assumption-breaking | Partially covered by query-aware retrieval; full thread migration adds complexity |
| Ingest without LLM (structural extraction) | Assumption-breaking | Interesting cold-start solution but changes the core value proposition |

## Session Log

- **2026-04-10 session:** Open-ended ideation. 4 parallel agents (pain/friction, inversion/removal, assumption-breaking, leverage/compounding). 38 raw candidates → 24 after dedupe → 7 survivors after adversarial filtering. Focus: open-ended across all dimensions.
