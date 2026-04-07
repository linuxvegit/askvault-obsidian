import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ChatView, VIEW_TYPE_CHAT } from './src/ChatView';
import { AskVaultSettings, DEFAULT_SETTINGS, AskVaultSettingTab } from './src/Settings';
import { LLMService } from './src/LLMService';
import { WikiSchema } from './src/WikiSchema';
import { WikiService } from './src/WikiService';
import { WikiView, VIEW_TYPE_WIKI } from './src/WikiView';

export default class AskVaultPlugin extends Plugin {
	settings: AskVaultSettings;
	llmService: LLMService;
	wikiSchema: WikiSchema;
	wikiService: WikiService;

	async onload() {
		await this.loadSettings();

		// Initialize services
		this.llmService = new LLMService(this.settings);
		this.wikiSchema = new WikiSchema(this.app.vault, this.settings.wikiFolder);
		this.wikiService = new WikiService(
			this.app.vault,
			this.settings,
			this.llmService,
			this.wikiSchema
		);

		// Register the chat view
		this.registerView(
			VIEW_TYPE_CHAT,
			(leaf) => new ChatView(leaf, this)
		);

		// Register the wiki view
		this.registerView(
			VIEW_TYPE_WIKI,
			(leaf) => new WikiView(leaf, this)
		);

		// Add ribbon icon to open chat view
		this.addRibbonIcon('message-square', 'Ask Vault Chat', () => {
			this.activateView();
		});

		// Add ribbon icon to open wiki view
		this.addRibbonIcon('book-open', 'Wiki Manager', () => {
			this.activateWikiView();
		});

		// Add commands
		this.addCommand({
			id: 'open-askvault-view',
			name: 'Open Ask Vault Chat',
			callback: () => this.activateView()
		});

		this.addCommand({
			id: 'open-wiki-view',
			name: 'Open Wiki Manager',
			callback: () => this.activateWikiView()
		});

		this.addCommand({
			id: 'ingest-vault',
			name: 'Ingest vault into wiki',
			callback: async () => {
				await this.wikiService.ingest();
			}
		});

		this.addCommand({
			id: 'lint-wiki',
			name: 'Lint wiki',
			callback: async () => {
				const issues = await this.wikiService.lint();
				console.log(`Lint found ${issues.length} issues`);
			}
		});

		// Add settings tab
		this.addSettingTab(new AskVaultSettingTab(this.app, this));

		// Register auto-update after layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.wikiService.registerAutoUpdate();
		});
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_CHAT, active: true });
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateWikiView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_WIKI);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_WIKI, active: true });
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || data || {});
	}

	async saveSettings() {
		const currentData = await this.loadData() || {};
		currentData.settings = this.settings;
		await this.saveData(currentData);
	}

	onunload() {
		this.wikiService.unregisterAutoUpdate();
	}
}
