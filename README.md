# askvault - Obsidian Plugin

An intelligent chat interface plugin for Obsidian that uses Large Language Models (LLM) to answer questions based on your vault content.

## Features

- 🤖 **AI-Powered Chat Interface**: Chat with an AI assistant in a dedicated sidebar view
- 📚 **Vault Indexing**: Automatically index all markdown files in your vault with AI-generated summaries
- 🔍 **Vector Search**: Uses vector embeddings to find the most relevant documents for your questions
- 💬 **Context-Aware Responses**: Provides answers based on the top 3 most relevant documents from your vault
- 🔑 **Multiple LLM Providers**: Supports both OpenAI (GPT-3.5, GPT-4) and Anthropic Claude

## Installation

### From Release (Recommended)

1. Download the latest release from the [Releases page](https://github.com/yourusername/askvault-obsidian/releases)
2. Extract the files to your vault's plugins folder: `<vault>/.obsidian/plugins/askvault-obsidian/`
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

### Manual Installation

1. Clone this repository into your vault's plugins folder:
   ```bash
   cd <vault>/.obsidian/plugins/
   git clone https://github.com/yourusername/askvault-obsidian.git
   cd askvault-obsidian
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Reload Obsidian and enable the plugin

## Development

### Prerequisites

- Node.js 16+ 
- npm or yarn

### Build for Development

```bash
npm install
npm run dev
```

This will start the build process in watch mode, automatically rebuilding when you make changes.

### Build for Production

```bash
npm run build
```

## Usage

### 1. Configure API Settings

1. Go to Settings → askvault
2. Choose your LLM provider (OpenAI or Claude)
3. Enter your API key
4. Select the model you want to use

**Getting API Keys:**
- [OpenAI API Key](https://platform.openai.com/api-keys)
- [Claude API Key](https://console.anthropic.com/settings/keys)

### 2. Index Your Vault

1. Open the askvault sidebar (click the message icon in the left ribbon)
2. Click the "Index Vault" button
3. Wait for the indexing process to complete (you'll see progress in the console)

This will:
- Read all `.md` files in your vault
- Generate 500-word summaries using the LLM
- Create vector embeddings for semantic search

### 3. Start Chatting

Ask questions about your vault content in the chat interface. The plugin will:
1. Search for the top 3 most relevant documents
2. Use their content as context
3. Generate an answer using the LLM

## How It Works

1. **Indexing**: When you click "Index Vault", the plugin:
   - Reads each markdown file
   - Sends the content to the LLM for summarization (500 words max)
   - Creates vector embeddings from the summaries
   - Stores them in an in-memory vector database

2. **Searching**: When you ask a question:
   - The question is converted to a vector embedding
   - The system finds the 3 most similar documents using cosine similarity
   - The full content of these documents is used as context

3. **Answering**: The LLM receives:
   - The context from the 3 most relevant documents
   - Your question
   - A prompt to answer based on the provided context

## Architecture

```
ObsidianChat/
├── main.ts                 # Plugin entry point
├── src/
│   ├── ChatView.ts        # Chat interface UI
│   ├── VectorService.ts   # Vector database & search
│   ├── LLMService.ts      # LLM API integration
│   └── Settings.ts        # Plugin settings
├── styles.css             # UI styles
├── manifest.json          # Plugin metadata
└── package.json           # Dependencies
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Credits

Built with:
- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [OpenAI API](https://platform.openai.com/)
- [Anthropic Claude API](https://www.anthropic.com/)

## Support

If you encounter any issues or have questions, please [open an issue](https://github.com/yourusername/askvault-obsidian/issues) on GitHub.