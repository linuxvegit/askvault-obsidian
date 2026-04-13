# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AskVault is an Obsidian plugin that provides a wiki-powered chat interface. Users ask questions and get streaming LLM responses grounded in their vault content via a structured wiki of extracted entities and concepts. Supports OpenAI and Claude providers.

## Build Commands

```bash
yarn install          # Install dependencies (requires Node.js 24+, use Yarn not npm)
yarn dev              # Dev build with watch mode (esbuild watch, no tsc)
yarn build            # Production build (tsc check + esbuild + copy manifest/styles to output/)
yarn version          # Bump version in manifest.json and versions.json
```

Build output goes to `output/` (main.js, manifest.json, styles.css). To test, copy output files to `<vault>/.obsidian/plugins/askvault-obsidian/` and reload Obsidian.

`yarn dev` runs esbuild in watch mode only (no type check). `yarn build` runs `tsc -noEmit -skipLibCheck` first, then esbuild in production mode, then `copy-files.mjs` to copy manifest.json and styles.css into output/.

No test framework or linter is configured.

## Architecture

Six source modules connected through the plugin entry point:

- **`main.ts`** — Plugin lifecycle (`AskVaultPlugin`). Initializes LLMService, WikiSchema, WikiService, and registers both views (ChatView, WikiView). Registers vault events for auto-update triggers. Handles data persistence via `loadData()`/`saveData()`.

- **`src/ChatView.ts`** — Chat UI as an Obsidian `ItemView` (type: `askvault-view`). Manages threaded conversations (create/switch/rename/delete), streams LLM responses into markdown-rendered message elements, appends source wiki-links. Two-step retrieval: WikiService reads `index.md` to find relevant wiki pages, then reads those pages to build context for the LLM.

- **`src/LLMService.ts`** — LLM provider abstraction. Implements SSE streaming for both OpenAI and Claude APIs with `onChunk` callbacks. Exposes `callLLMRaw(system, user, maxTokens)` for wiki operations (ingest, lint, query retrieval) and `chatStream()` for the chat UI. Handles custom endpoints and model selection.

- **`src/WikiService.ts`** — Wiki engine. Handles ingest, query, lint, and auto-update operations. Reads source vault files, calls LLMService to extract entities and concepts as JSON, writes structured wiki pages to `sources/`, `entities/`, `concepts/`, `queries/` subdirectories, and maintains `index.md` and `log.md`. Uses `isBusy` guard to serialize operations. Supports cancellation via `cancelIngest()`. Existing entity/concept pages trigger an LLM merge call rather than overwrite.

- **`src/WikiSchema.ts`** — Schema loader. Loads and caches `_schema.md` from the wiki folder on startup and provides defaults when the file is absent. Defines the structure and frontmatter conventions wiki pages must follow.

- **`src/WikiView.ts`** — Wiki sidebar panel as an Obsidian `ItemView` (type: `askvault-wiki-view`). Provides UI controls for ingest, update, lint, and viewing the wiki index. Displays operation progress with cancel button and recent activity log.

- **`src/Settings.ts`** — Settings tab UI. Configures provider, API key, model, custom endpoints, wiki folder location, and file filtering (folder include/exclude, extension whitelist, suffix include/exclude patterns, auto-update mode).

### Data Flow

**Ingest:** User triggers (or vault event fires) → filter source files by folder/extension/suffix patterns → skip already-ingested files via `log.md` timestamps → read file content → LLM extracts entities and concepts as JSON → write/merge structured wiki pages → batch-append log entries → rebuild `index.md`.

**Chat:** User message → `WikiService.findRelevantPages()` sends `index.md` to LLM → LLM returns JSON array of relevant wiki paths → `getPageContents()` reads those pages → build context string → `LLMService.chatStream()` streams response with `onChunk` callbacks → append source wiki-links → optionally save answer to `queries/` → save thread history.

### Persistence

Settings and chat thread history are stored in `data.json` via Obsidian's plugin data API (`loadData()`/`saveData()`; the settings live under a `settings` key, threads under a `threads` key). Wiki content (pages, `index.md`, `log.md`, `_schema.md`) lives as plain markdown files in the configured wiki folder inside the vault — no binary vector index.

### Wiki Folder Structure

```
<wikiFolder>/
├── _schema.md          # Wiki schema/conventions (auto-created with defaults)
├── index.md            # Auto-generated page index grouped by type
├── log.md              # Append-only operation log (ingest, lint, query-save)
├── sources/            # One summary page per ingested source file
├── entities/           # One page per extracted entity (merged on re-ingest)
├── concepts/           # One page per extracted concept (merged on re-ingest)
└── queries/            # Filed chat answers (saved via "Save to Wiki" button)
```

## Key Conventions

- CSS classes use `askvault-*` namespace prefix
- Plugin ID: `askvault-obsidian`; view types: `askvault-view` (chat), `askvault-wiki-view` (wiki)
- Wiki pages use YAML frontmatter with at minimum `type`, `created`, `updated`, `tags`, and `related` fields as defined by `_schema.md`
- Wiki filenames are lowercased, hyphen-separated via `toFileName()`: `name.toLowerCase().replace(/[^a-z0-9]+/g, '-')`
- LLM responses for wiki operations must be raw JSON (no markdown fences); parsing retries once with a stricter prompt on failure
- esbuild bundles to CJS targeting ES2018; obsidian, electron, and codemirror packages are external
- TypeScript strict null checks enabled, `noImplicitAny` enabled
- No runtime dependencies — only Obsidian API and browser fetch
- The README is outdated (still references VectorService/vector search); the codebase uses wiki-based retrieval
