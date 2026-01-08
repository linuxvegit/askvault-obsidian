# AskVault - Obsidian AI Chat Plugin

An intelligent chat interface plugin for Obsidian that uses Large Language Models to answer questions based on your vault content. Features streaming responses, multiple chat threads, and smart source document linking.

## ✨ Key Features

### 🤖 AI-Powered Chat
- **Streaming Responses**: Real-time, word-by-word output like ChatGPT/Claude
- **Multiple LLM Providers**: Supports OpenAI (GPT-3.5/4) and Anthropic Claude
- **Custom Endpoints**: Configure custom API endpoints for self-hosted or alternative services
- **Context-Aware**: Answers based on the most relevant documents from your vault

### 📚 Smart Indexing
- **Parallel Processing**: Indexes 20 files simultaneously for faster vault processing
- **Incremental Updates**: Only re-indexes changed files using file hash tracking
- **File Filtering**: Whitelist/blacklist files with wildcard pattern support
- **Progress UI**: Real-time progress tracking with cancellation support

### 💬 Advanced Chat Management
- **Multiple Threads**: Create and manage separate conversation threads
- **Auto-Naming**: Threads automatically named from first message
- **Chat History**: Persistent conversation history across sessions
- **Thread Operations**: Rename, delete, copy, and switch between threads
- **Source Attribution**: Direct links to source documents in responses

### 🔒 Security & UX
- **Secure API Keys**: Password-protected input with copy/paste disabled
- **Custom Dialogs**: Native Obsidian-style confirm and input dialogs
- **Markdown Rendering**: Full markdown support in responses with wiki-link integration
- **Text Selection**: Selectable text in messages for easy copying
- **Status Indicators**: Visual feedback during AI response generation

### 🔍 Vector Search
- **OpenAI Embeddings**: Uses text-embedding-3-small for semantic search
- **Fallback System**: Hash-based 300D embeddings when API unavailable
- **In-Memory Storage**: Fast vector database with persistent state
- **Top-K Retrieval**: Finds the 3 most relevant documents for each query

## 🚀 Installation

### Option 1: From Release (Recommended)

1. Download the latest release from the [Releases page](https://github.com/linuxvegit/askvault-obsidian/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` to: `<vault>/.obsidian/plugins/askvault-obsidian/`
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

### Option 2: Manual Build

1. Clone this repository:
   ```bash
   cd <vault>/.obsidian/plugins/
   git clone https://github.com/linuxvegit/askvault-obsidian.git
   cd askvault-obsidian
   ```

2. Install dependencies (requires Node.js 24+ with Yarn):
   ```bash
   yarn install
   ```

3. Build the plugin:
   ```bash
   yarn build
   ```
   Files will be output to the `output/` directory.

4. Copy files from `output/` to the plugin folder, reload Obsidian, and enable the plugin.

## 🛠️ Development

### Prerequisites

- Node.js 24+ (npm has compatibility issues, use Yarn)
- Yarn 1.22+

### Development Build

```bash
yarn install
yarn build
```

The build process:
1. Compiles TypeScript with `tsc` (type checking)
2. Bundles with `esbuild` to `output/main.js`
3. Copies `manifest.json` and `styles.css` to `output/`

### Tech Stack

- **TypeScript 5.7.0**: Type-safe development
- **esbuild 0.24.0**: Fast bundling
- **Obsidian API 1.5.0+**: Plugin framework
- **MarkdownRenderer**: For rendering responses with wiki-link support

## 📖 Usage

### 1. Configure Settings

Go to **Settings → AskVault** and configure:

#### API Provider
- **Provider**: Choose OpenAI or Claude
- **API Key**: Enter your API key (securely stored)
- **Model**: Select pre-configured model or use custom model name

#### Custom Endpoints (Optional)
- **OpenAI Endpoint**: Default is `https://api.openai.com/v1`
- **Claude Endpoint**: Default is `https://api.anthropic.com/v1`
- Useful for self-hosted models or API proxies

#### File Filtering (Optional)
- **Whitelist**: Only index matching files (e.g., `docs/**/*.md`)
- **Blacklist**: Exclude matching files (e.g., `*.excalidraw.md, private/**`)
- Supports wildcards: `*` (any chars), `**` (any dirs), `?` (single char)

**Getting API Keys:**
- [OpenAI API Key](https://platform.openai.com/api-keys)
- [Claude API Key](https://console.anthropic.com/settings/keys)

### 2. Index Your Vault

1. Open the AskVault sidebar (click the message icon in the left ribbon)
2. Click the **"Index Vault"** button
3. Watch real-time progress as files are indexed
   - Progress bar shows completion percentage
   - Current file name and elapsed time displayed
   - Click "Cancel" to stop at any time

**What happens during indexing:**
- Filters files based on whitelist/blacklist rules
- Processes 20 files in parallel for speed
- Generates vector embeddings using OpenAI API
- Calculates file hashes for change detection
- Stores everything persistently in `.obsidian/plugins/askvault-obsidian/data.json`

**Incremental updates:**
- Re-indexing only processes new or modified files
- Unchanged files are skipped automatically
- Much faster than full re-index

### 3. Chat with Your Vault

#### Starting a Conversation
1. Type your question in the input box
2. Press **Enter** or click **Send**
3. Watch the AI response stream in real-time
4. Source documents appear as clickable wiki-links at the bottom

#### Managing Threads
- Click **"Threads"** to show/hide the threads panel
- Click **"+ New"** to create a new conversation thread
- Click on any thread to switch to it
- Each thread maintains its own independent chat history

#### Thread Operations
- **Rename**: Click ✏️ to rename a thread
- **Delete**: Click 🗑️ to delete a thread (with confirmation)
- **Copy**: Click 📋 Copy (header) to copy entire thread as markdown

#### Message Features
- **Copy Message**: Click 📋 next to any assistant message to copy
- **Select Text**: All message text is selectable for copying
- **Click Sources**: Click [[wiki-links]] to jump to source documents
- **Markdown Support**: Full markdown rendering in responses

#### During Streaming
- Input box shows "AI is responding..." while generating
- Input is disabled until response completes
- Each thread tracks its own streaming state independently
- Switch threads safely during generation

### 4. Understanding Responses

When you ask a question, the plugin:

1. **Searches**: Finds the 3 most relevant documents using vector similarity
2. **Retrieves**: Gets the full content of those documents
3. **Generates**: Streams an AI response using the documents as context
4. **Attributes**: Lists source documents as wiki-links at the bottom

Example response format:
```
[AI response text here...]

---

**Sources:**

- [[Document Name 1]]
- [[Document Name 2]]
- [[Document Name 3]]
```

## 🏗️ Architecture

### Project Structure

```
ObsidianChat/
├── output/                 # Build output directory
│   ├── main.js            # Bundled plugin code
│   ├── manifest.json      # Plugin metadata (copied)
│   └── styles.css         # UI styles (copied)
├── src/
│   ├── ChatView.ts        # Chat UI with thread management
│   ├── VectorService.ts   # Vector database & semantic search
│   ├── LLMService.ts      # OpenAI/Claude API with streaming
│   └── Settings.ts        # Configuration UI
├── main.ts                # Plugin entry point & indexing orchestration
├── styles.css             # Complete UI styling (askvault-* classes)
├── manifest.json          # Plugin metadata (id: askvault-obsidian)
├── package.json           # Dependencies (managed via Yarn)
├── esbuild.config.mjs     # Build configuration
└── copy-files.mjs         # Post-build file copying
```

### Core Components

#### 1. AskVaultPlugin (main.ts)
- Plugin lifecycle management (load/unload)
- Vault file indexing orchestration
- Parallel batch processing (20 files per batch)
- File filtering with wildcard matching
- Progress tracking and cancellation
- Data persistence (settings + index + threads)

#### 2. ChatView (src/ChatView.ts)
- Main chat interface UI
- Thread management (create, switch, rename, delete)
- Streaming message rendering with markdown
- Event delegation for wiki-link clicks
- Custom confirm/input dialogs
- Copy functionality for messages and threads
- Input state management per thread

#### 3. LLMService (src/LLMService.ts)
- Dual provider support (OpenAI + Claude)
- Streaming API calls with SSE parsing
- Chat history management
- Custom endpoint configuration
- Error handling and retries

#### 4. VectorService (src/VectorService.ts)
- In-memory vector storage
- OpenAI embeddings API integration
- Fallback hash-based embeddings (300D)
- Cosine similarity search
- File hash tracking for incremental updates
- Document persistence

#### 5. Settings (src/Settings.ts)
- Plugin configuration UI
- Secure API key input (password field, no copy)
- Provider and model selection
- Custom endpoint configuration
- File filtering rules

### Data Flow

#### Indexing Flow
```
User clicks "Index Vault"
  → Filter files (whitelist/blacklist)
  → Split into 20-file batches
  → For each file:
      → Calculate file hash
      → Skip if hash unchanged
      → Read file content
      → Generate vector embedding (OpenAI API)
      → Store in VectorService
  → Save index to disk
  → Update UI with completion status
```

#### Chat Flow
```
User sends message
  → Set thread streaming state
  → Disable input (show "AI is responding...")
  → Search VectorService for top 3 docs
  → Build context from document content
  → Stream LLM response:
      → Receive chunk → Update UI → Repeat
  → Append sources as wiki-links
  → Save to thread history
  → Clear streaming state
  → Re-enable input
```

### Storage

All data persists in `.obsidian/plugins/askvault-obsidian/data.json`:

```json
{
  "apiKey": "sk-...",
  "provider": "openai",
  "model": "gpt-4",
  "openaiEndpoint": "https://api.openai.com/v1",
  "claudeEndpoint": "https://api.anthropic.com/v1",
  "customModel": "",
  "whitelist": "",
  "blacklist": "*.excalidraw.md",
  "vectorIndex": {
    "documents": [...],
    "fileHashes": {...}
  },
  "threads": [
    {
      "id": "thread-1234567890",
      "name": "Chat about project",
      "history": [...],
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    }
  ]
}
```

## 🎨 UI/UX Highlights

- **Native Obsidian Design**: Custom CSS with `askvault-*` class namespace
- **Responsive Layout**: Sidebar chat view with collapsible threads panel
- **Loading Animations**: Animated dots during AI response generation
- **Progress Feedback**: Real-time indexing progress with file names and timing
- **Custom Dialogs**: No browser alerts - native Obsidian-style modals
- **Keyboard Shortcuts**: Enter to send, Shift+Enter for new line
- **Auto-scroll**: Messages automatically scroll into view
- **Status Indicators**: Visual feedback for all async operations

## 🔧 Advanced Configuration

### Custom Model Names

When selecting "Custom" model:
- Enter any model identifier your endpoint supports
- Examples: `gpt-4-turbo`, `claude-3-opus-20240229`, `llama-3-70b`
- Useful for testing new models or self-hosted deployments

### File Filtering Examples

**Whitelist only documentation:**
```
docs/**/*.md, reference/*.md
```

**Blacklist templates and private notes:**
```
templates/**, private/**, *.excalidraw.md, daily/*.md
```

**Complex filtering:**
```
Whitelist: content/**/*.md
Blacklist: content/drafts/**, *.template.md
```

### API Endpoint Customization

For self-hosted or alternative providers:

**OpenAI-compatible APIs:**
```
Endpoint: http://localhost:11434/v1
Model: llama3
```

**Reverse proxies:**
```
Endpoint: https://my-proxy.example.com/v1
Model: gpt-4
```

## ❓ Troubleshooting

### Indexing Issues

**"No documents indexed"**
- Check whitelist/blacklist filters
- Ensure `.md` files exist in vault
- Verify file permissions

**Slow indexing**
- First index takes longer (generates embeddings)
- Subsequent indexes are incremental (only changed files)
- Consider adding blacklist patterns for unused folders

### API Errors

**"API key not configured"**
- Open Settings → AskVault
- Enter valid API key
- Key is stored securely in data.json

**"OpenAI/Claude API error"**
- Verify API key is valid and has credits
- Check custom endpoint URL format
- Ensure model name is correct

**Network/timeout errors**
- Check internet connection
- Verify endpoint is accessible
- Some models may be slower - wait longer

### UI Issues

**Links not clickable**
- Wiki-links should work automatically
- Event delegation handles dynamic content
- Check browser console for errors

**Input disabled**
- Wait for streaming response to complete
- Each thread tracks state independently
- Switching threads preserves correct state

**Threads not loading**
- Check `.obsidian/plugins/askvault-obsidian/data.json` exists
- Try creating new thread
- Restart Obsidian if needed

## 🤝 Contributing

Contributions are welcome! Areas for improvement:

- **Performance**: Optimize vector search for large vaults
- **Features**: Add support for more LLM providers
- **UI**: Enhanced thread organization and search
- **Export**: Save conversations as markdown files
- **RAG**: Improved retrieval strategies and chunking

Please submit Pull Requests or open Issues on GitHub.

## 📝 License

MIT License - see LICENSE file for details

## 🙏 Credits

Built with:
- [Obsidian API](https://github.com/obsidianmd/obsidian-api) - Plugin framework
- [OpenAI API](https://platform.openai.com/) - GPT models and embeddings
- [Anthropic Claude API](https://www.anthropic.com/) - Claude models
- [esbuild](https://esbuild.github.io/) - Fast JavaScript bundler

## 💡 Inspiration

This plugin is inspired by AI chat interfaces like ChatGPT and Claude, but deeply integrated with Obsidian's vault and linking system. It brings the power of RAG (Retrieval-Augmented Generation) directly into your personal knowledge base.

## 📧 Support

- **Issues**: [GitHub Issues](https://github.com/linuxvegit/askvault-obsidian/issues)
- **Discussions**: [GitHub Discussions](https://github.com/linuxvegit/askvault-obsidian/discussions)
- **Documentation**: This README and inline code comments

---

**Note**: This plugin requires active API keys and makes network requests to LLM providers. Ensure you understand the pricing and data privacy policies of your chosen provider.