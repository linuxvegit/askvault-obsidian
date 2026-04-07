# LLM Wiki Feature Design

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Add LLM Wiki capabilities to AskVault Obsidian plugin

## Summary

Transform AskVault from a pure RAG chat tool into an LLM-powered wiki maintainer inspired by [Karpathy's LLM Wiki pattern](https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw/ac46de1ad27f92b28ac95459c782c07f6b8c964a/llm-wiki.md). The LLM reads source files and produces a persistent, compounding wiki of interlinked markdown pages — summaries, entity pages, concept pages, cross-references, and an index. The existing RAG chat is preserved and enhanced to use wiki pages as its knowledge base instead of a vector database.

## Key User-Facing Features

1. **Wiki folder configuration** — user selects which vault folder contains the generated wiki
2. **Source folder configuration** — user selects which folders are included/excluded from wiki compilation
3. **Ingest** — process source files into wiki pages (summaries, entities, concepts, cross-references)
4. **Query with write-back** — chat answers can be saved as wiki pages
5. **Lint** — periodic health checks for contradictions, orphans, gaps
6. **Incremental update** — event-driven automatic re-ingestion when source files change

## Architecture

### Module Structure

```
main.ts (refactored — remove VectorService, add WikiService)
├── src/ChatView.ts (refactored — query via WikiService, "Save to Wiki" action)
├── src/LLMService.ts (extended — entity/concept extraction prompts)
├── src/Settings.ts (extended — wiki folder, source include/exclude config)
├── src/WikiService.ts (NEW — wiki engine: ingest, query, lint, update)
├── src/WikiSchema.ts (NEW — schema loader, page type definitions)
└── src/WikiView.ts (NEW — wiki operations UI panel)
```

**Removed:**
- `src/VectorService.ts` — deleted entirely
- Embedding generation (OpenAI text-embedding-3-small and fallback hash embeddings)
- Vector index persistence in `data.json`
- `indexVaultFiles()` batch processing in `main.ts`
- Hash-based change detection (replaced by log.md tracking)

### Service Dependencies

- `WikiService` depends on: `LLMService`, Obsidian `Vault` API, `WikiSchema`
- `WikiService` does NOT depend on VectorService (removed)
- `ChatView` references `WikiService` for "Save to Wiki" and wiki-based retrieval
- `WikiView` references `WikiService` for triggering operations and displaying progress
- `main.ts` creates all services and injects dependencies

### Retrieval Change

**Before:** user question → VectorService.search(query) → top-3 docs by cosine similarity → LLM context

**After:** user question → WikiService reads `index.md` → LLM identifies relevant wiki pages from index → WikiService reads those pages → LLM answers with citations

## Data Model

### Vault Folder Structure

```
vault/
├── <source-folders>/              # User's existing content
│   ├── notes/
│   ├── articles/
│   └── ...
└── <wiki-folder>/                 # Configurable, default: "wiki"
    ├── _schema.md                 # Wiki conventions and rules
    ├── index.md                   # Content catalog: all pages with summaries + links
    ├── log.md                     # Append-only action log
    ├── sources/                   # One summary page per ingested source file
    ├── entities/                  # Entity pages (people, tools, orgs, etc.)
    ├── concepts/                  # Concept pages (ideas, patterns, theories)
    └── queries/                   # Valuable chat answers filed back
```

### Settings

```typescript
interface AskVaultSettings {
  // Existing provider/API settings preserved
  provider: 'openai' | 'claude';
  apiKey: string;
  model: string;
  customModel: string;
  openaiEndpoint: string;
  claudeEndpoint: string;

  // New wiki settings
  wikiFolder: string;              // Path within vault, default: "wiki"
  sourceIncludeFolders: string[];  // Folders to ingest from (empty = all non-wiki)
  sourceExcludeFolders: string[];  // Folders to skip during ingest
  sourceExtensions: string[];     // File extensions to ingest, default: [".md"]
  autoUpdate: 'enabled' | 'disabled' | 'desktop-only' | 'mobile-only';  // default: "enabled"
}
```

**Removed settings:** `whitelistFolders`, `whitelistExtensions`, `blacklistFiles` (replaced by `sourceIncludeFolders`, `sourceExcludeFolders`, `sourceExtensions`).

### Frontmatter Convention

```yaml
---
type: source | entity | concept | query | overview
source: "[[original-file]]"
created: 2026-04-07
updated: 2026-04-07
tags: [topic1, topic2]
related: ["[[other-page]]"]
---
```

### Persistence

- Wiki pages are plain markdown files in the vault — version-controlled, searchable, linkable
- Plugin state (settings, thread history) uses Obsidian's `data.json`
- No vector index in `data.json` (significant storage reduction)
- `log.md` tracks ingest history, replacing hash-based change detection

### Log Entry Format

Each `log.md` entry is a markdown heading with structured fields:

```markdown
## [2026-04-07T10:32:00] ingest | notes/article.md
- **mtime:** 2026-04-07T09:15:00
- **pages touched:** sources/article.md, entities/typescript.md, concepts/rag-pattern.md
- **status:** success
```

Change detection: WikiService parses `log.md` to find the latest ingest entry for each source file path, compares the logged `mtime` against the file's current `mtime`. If different (or no entry exists), the file is queued for re-ingest.

## Core Operations

### Ingest

**Trigger:** User clicks "Ingest All" in WikiView, or runs "Ingest Vault" command.

**Flow:**

1. Read `_schema.md` from wiki folder for conventions
2. Scan source folders (respecting include/exclude/extensions config)
3. Check `log.md` for already-ingested files + their timestamps
4. For each new or modified source file:
   a. Read file content
   b. Call LLMService with structured prompt returning JSON:
      ```json
      {
        "summary": "...",
        "entities": [{"name": "...", "description": "...", "facts": [...], "relationships": [...]}],
        "concepts": [{"name": "...", "description": "...", "examples": [...]}],
        "crossReferences": [{"from": "...", "to": "...", "relationship": "..."}]
      }
      ```
   c. Write/update source summary page in `wiki/sources/`
   d. Create or update entity pages in `wiki/entities/`
   e. Create or update concept pages in `wiki/concepts/`
   f. Update `index.md` with new entries
   g. Append to `log.md`
5. Report progress via callback (for UI progress bar)

**Processing:** Sequential per file (not parallel) since each file's entities may affect pages created by previous files. The LLM sees the current `index.md` to avoid duplicates.

**Entity/concept merging:** When an entity or concept page already exists, the ingest reads the existing page and asks the LLM to merge new information rather than overwrite. This is how the wiki compounds.

### Query (with Write-Back)

**Flow:**

1. User asks a question in ChatView
2. WikiService reads `index.md` to get the full page catalog
3. LLMService receives the question + index content, returns `{"relevantPages": ["sources/x.md", "entities/y.md", ...]}`
4. WikiService reads those pages
5. LLMService generates answer with pages as context, streams to ChatView
6. A "Save to Wiki" button appears on assistant messages
7. Clicking it creates a page in `wiki/queries/` and updates `index.md`

### Lint

**Trigger:** User clicks "Lint" in WikiView, or runs "Lint Wiki" command.

**Flow:**

1. Read all wiki pages
2. Call LLMService with wiki content (page-by-page for large wikis)
3. LLM checks for: contradictions, stale claims, orphan pages, missing cross-references, pages that should exist but don't, gaps
4. Returns structured lint report
5. WikiView displays results with actionable items
6. User can approve fixes, WikiService applies them
7. Append lint action to `log.md`

### Incremental Update (Event-Driven)

**Trigger:** Automatic — fires when source files are modified (editor loses focus / file saved). Also available as manual "Update" command in WikiView.

**Controlled by `autoUpdate` setting:**
- `enabled` — event listeners active on all platforms (default)
- `disabled` — no automatic updates; user must click "Update" manually
- `desktop-only` — event listeners active only when `Platform.isDesktop` is true
- `mobile-only` — event listeners active only when `Platform.isMobile` is true

WikiService checks this setting on plugin load and registers/skips vault event listeners accordingly. The manual "Update" button in WikiView always works regardless of this setting.

**Event handling (when active):**

- `vault.on('modify', file)` — file in source folder modified → queue for re-ingest
- `vault.on('create', file)` — new file in source folder → queue for ingest
- `vault.on('delete', file)` — source file deleted → mark wiki pages as orphaned
- `vault.on('rename', file)` — source file renamed → update wiki page references

**Debounce:** 5-second delay after the last modification event before processing the queue. Prevents thrashing during active editing.

**Processing:** Re-ingest queued files using the same flow as full ingest. Updates affected summary, entity, and concept pages. Updates `index.md` and `log.md`.

## WikiView UI

WikiView is an Obsidian `ItemView` sidebar panel.

```
┌─────────────────────────────────┐
│  Wiki Manager           [gear] │  Header with settings link
├─────────────────────────────────┤
│  Status: 142 sources | 87 pages│  Quick stats
├─────────────────────────────────┤
│  [Ingest All]  [Update]        │  Action buttons
│  [Lint]        [Index]         │
├─────────────────────────────────┤
│  Progress bar                   │  During operations
│  Processing: notes/article.md   │
│  12 / 42 files                  │
├─────────────────────────────────┤
│  Recent Activity                │  Last N log entries from log.md
│  * 10:32 ingest  article.md     │
│  * 10:30 update  index.md       │
│  * 09:15 lint    3 issues found │
├─────────────────────────────────┤
│  Lint Results (if any)          │  Expandable lint report
│  ! Missing entity: "React"     │
│  ! Orphan page: old-note.md    │
│  [Fix Selected]                 │
└─────────────────────────────────┘
```

**Buttons:**
- **Ingest All** — Full ingest of all source folders (skip unchanged files)
- **Update** — Manual incremental update
- **Lint** — Run lint check
- **Index** — Open `index.md` in the editor

## WikiSchema (`_schema.md`)

The schema file lives in the wiki folder root. WikiService reads it as a system prompt prefix for all LLM operations. If missing, WikiService creates it with defaults on first operation.

**Default content defines:**
- Page types: source, entity, concept, query, overview
- Frontmatter fields and conventions
- Cross-reference rules (Obsidian wiki-links)
- Directory structure
- Naming conventions (lowercase, hyphens)
- Index format

Users can customize the schema to change page types, add new conventions, or adjust the LLM's behavior. The schema is co-evolved by user and LLM over time.

## LLM Prompt Strategy

### Ingest Prompt

- **System:** schema content + current `index.md`
- **User:** source file content
- **Response format:** JSON with summary, entities, concepts, crossReferences
- **One LLM call per source file** to minimize API usage

### Query-Retrieval Prompt (Two-Step)

1. **Page selection:** question + `index.md` → LLM returns relevant page paths
2. **Answer generation:** question + selected page contents → LLM streams answer

### Lint Prompt

- **System:** schema
- **User:** all wiki page paths + summaries from index.md
- **Response format:** structured list of issues with types and suggested fixes

## Error Handling

### LLM JSON Parsing Failures
- Retry once with more explicit prompt
- If still fails, log error in `log.md`, skip file, continue
- All failures appear in WikiView activity feed

### Large Files
- Files exceeding LLM context window are chunked by headings or ~2000-word sections
- Each chunk processed separately, results merged
- Entity/concept lists deduplicated across chunks

### Deleted Source Files
- Source summary page in `wiki/sources/` marked with `status: orphaned` frontmatter
- Entity/concept pages are NOT auto-deleted (may reference multiple sources)
- Lint operation surfaces orphaned pages for user review

### Concurrent Operations
- Only one wiki operation runs at a time (mutex in WikiService)
- Additional operations are queued

### API Errors
- Exponential backoff on 429, 500, 503 errors
- Max 3 retries per file
- Progress bar shows "Retrying..." status

### Missing Wiki Infrastructure
- `_schema.md` created with defaults if missing
- Wiki folder and subdirectories created on first ingest

## Migration

### From Current AskVault

- Existing settings (provider, API key, model, endpoints) are preserved
- `whitelistFolders` → `sourceIncludeFolders`, `whitelistExtensions` → `sourceExtensions`, `blacklistFiles` → `sourceExcludeFolders`
- Vector index in `data.json` is ignored (no migration needed, just unused)
- Chat thread history is preserved
- Users run an initial full ingest to populate the wiki

### VectorService Removal

- `src/VectorService.ts` deleted
- All VectorService references removed from `main.ts` and `ChatView.ts`
- `indexVaultFiles()` and related methods removed from `main.ts`
- Vector-related data in `data.json` becomes inert (not read or written)
