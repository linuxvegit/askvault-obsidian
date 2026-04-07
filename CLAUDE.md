# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AskVault is an Obsidian plugin that provides a wiki-powered chat interface. Users ask questions and get streaming LLM responses grounded in their vault content via a structured wiki of extracted entities and concepts. Supports OpenAI and Claude providers.

## Build Commands

```bash
yarn install          # Install dependencies (requires Node.js 24+, use Yarn not npm)
yarn dev              # Dev build with watch mode (tsc check + esbuild + copy files)
yarn build            # Production build
yarn version          # Bump version in manifest.json and versions.json
```

Build output goes to `output/` (main.js, manifest.json, styles.css). To test, copy output files to `<vault>/.obsidian/plugins/askvault-obsidian/` and reload Obsidian.

No test framework or linter is configured.

## Architecture

Five source modules connected through the plugin entry point:

- **`main.ts`** — Plugin lifecycle (`AskVaultPlugin`). Initializes WikiService, WikiSchema, and WikiView. Registers vault events for auto-update triggers. Handles data persistence via `loadData()`/`saveData()`.

- **`src/ChatView.ts`** — Chat UI as an Obsidian `ItemView`. Manages threaded conversations (create/switch/rename/delete), streams LLM responses into markdown-rendered message elements, appends source wiki-links. Queries content via WikiService: the LLM reads `index.md` to find relevant wiki pages, then reads those pages to build context.

- **`src/LLMService.ts`** — LLM provider abstraction. Implements SSE streaming for both OpenAI and Claude APIs with `onChunk` callbacks. Also provides entity/concept extraction used during ingest. Handles custom endpoints and model selection.

- **`src/WikiService.ts`** — Wiki engine. Handles ingest, query, lint, and auto-update operations. Reads source vault files, calls LLMService to extract entities and concepts, writes structured wiki pages to the vault, and maintains `index.md` and `log.md` in the wiki folder.

- **`src/WikiSchema.ts`** — Schema loader. Loads and caches `_schema.md` from the wiki folder on startup and provides defaults when the file is absent. Defines the structure and frontmatter conventions wiki pages must follow.

- **`src/WikiView.ts`** — Wiki sidebar panel as an Obsidian `ItemView`. Provides UI controls for ingest, update, lint, and viewing the wiki index. Displays operation progress and status.

- **`src/Settings.ts`** — Settings tab UI. Configures provider, API key, model, custom endpoints, wiki folder location, and file filtering (folder whitelist, extension whitelist, blacklist patterns).

### Data Flow

**Ingest:** User triggers (or vault event fires) → filter source files by patterns → read file content → LLM extracts entities and concepts → write structured wiki pages to vault → update `index.md` → log operation to `log.md`.

**Chat:** User message → WikiService reads `index.md` → LLM selects relevant wiki pages → read selected pages → build context → stream LLM response with chunk callbacks → append source wiki-links → optionally save answer to wiki → save thread history.

### Persistence

Settings and chat thread history are stored in `data.json` via Obsidian's plugin data API. Wiki content (pages, `index.md`, `log.md`, `_schema.md`) lives as plain markdown files in the configured wiki folder inside the vault — no binary vector index.

## Key Conventions

- CSS classes use `askvault-*` namespace prefix
- Plugin ID: `askvault-obsidian`, chat view type: `askvault-chat-view`, wiki view type: `askvault-wiki-view`
- Wiki pages use YAML frontmatter with at minimum `type`, `tags`, and `updated` fields as defined by `_schema.md`
- esbuild bundles to CJS targeting ES2018; obsidian, electron, and codemirror packages are external
- TypeScript strict null checks enabled, `noImplicitAny` enabled
- No runtime dependencies — only Obsidian API and browser fetch
