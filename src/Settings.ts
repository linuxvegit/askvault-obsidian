import { App, PluginSettingTab, Setting } from 'obsidian';
import AskVaultPlugin from '../main';

export interface AskVaultSettings {
	provider: 'openai' | 'claude';
	apiKey: string;
	model: string;
	customModel: string;
	openaiEndpoint: string;
	claudeEndpoint: string;
	// Indexing filters
	whitelistFolders: string[];
	whitelistExtensions: string[];
	blacklistFiles: string[];
}

export const DEFAULT_SETTINGS: AskVaultSettings = {
	provider: 'openai',
	apiKey: '',
	model: 'gpt-3.5-turbo',
	customModel: '',
	openaiEndpoint: 'https://api.openai.com/v1',
	claudeEndpoint: 'https://api.anthropic.com/v1',
	whitelistFolders: [],
	whitelistExtensions: ['.md'],
	blacklistFiles: []
};

export class AskVaultSettingTab extends PluginSettingTab {
	plugin: AskVaultPlugin;

	constructor(app: App, plugin: AskVaultPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'askvault Settings' });

		// Provider selection
		new Setting(containerEl)
			.setName('LLM Provider')
			.setDesc('Choose your LLM provider (OpenAI or Claude)')
			.addDropdown(dropdown => dropdown
				.addOption('openai', 'OpenAI')
				.addOption('claude', 'Claude (Anthropic)')
				.setValue(this.plugin.settings.provider)
				.onChange(async (value) => {
					this.plugin.settings.provider = value as 'openai' | 'claude';
					
					// Update default model based on provider
					if (value === 'openai') {
						this.plugin.settings.model = 'gpt-3.5-turbo';
					} else {
						this.plugin.settings.model = 'claude-3-sonnet-20240229';
					}
					
					await this.plugin.saveSettings();
					this.display(); // Refresh to show updated model options
				})
			);

		// Endpoint
		const endpointSetting = new Setting(containerEl)
			.setName('API Endpoint')
			.setDesc('Custom API endpoint URL (leave default if using official API)')
			.addText(text => text
				.setPlaceholder('https://api.openai.com/v1')
				.setValue(this.plugin.settings.provider === 'openai' 
					? this.plugin.settings.openaiEndpoint 
					: this.plugin.settings.claudeEndpoint)
				.onChange(async (value) => {
					if (this.plugin.settings.provider === 'openai') {
						this.plugin.settings.openaiEndpoint = value || DEFAULT_SETTINGS.openaiEndpoint;
					} else {
						this.plugin.settings.claudeEndpoint = value || DEFAULT_SETTINGS.claudeEndpoint;
					}
					await this.plugin.saveSettings();
				})
			);

		// API Key
		const apiKeyDesc = this.plugin.settings.apiKey 
			? 'API key is set. Enter a new key to update it.'
			: 'Enter your API key for the selected provider';
			
		new Setting(containerEl)
			.setName('API Key')
			.setDesc(apiKeyDesc)
			.addText(text => {
				text
					.setPlaceholder(this.plugin.settings.apiKey ? '••••••••••••••••' : 'Enter your API key')
					.onChange(async (value) => {
						if (value) {  // Only update if a value is entered
							this.plugin.settings.apiKey = value;
							await this.plugin.saveSettings();
						}
					});
				
				// Set input type to password to hide the key
				text.inputEl.type = 'password';
				
				// Prevent copying
				text.inputEl.addEventListener('copy', (e) => {
					e.preventDefault();
					return false;
				});
				
				// Prevent cutting
				text.inputEl.addEventListener('cut', (e) => {
					e.preventDefault();
					return false;
				});
				
				// Prevent context menu (right-click)
				text.inputEl.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					return false;
				});
			});

		// Model selection
		const modelSetting = new Setting(containerEl)
			.setName('Model')
			.setDesc('Choose the AI model to use');

		if (this.plugin.settings.provider === 'openai') {
			modelSetting.addDropdown(dropdown => dropdown
				.addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
				.addOption('gpt-4', 'GPT-4')
				.addOption('gpt-4-turbo-preview', 'GPT-4 Turbo')
				.addOption('gpt-4o', 'GPT-4o')
				.addOption('custom', 'Custom Model')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide custom model input
				})
			);
		} else {
			modelSetting.addDropdown(dropdown => dropdown
				.addOption('claude-3-opus-20240229', 'Claude 3 Opus')
				.addOption('claude-3-sonnet-20240229', 'Claude 3 Sonnet')
				.addOption('claude-3-haiku-20240307', 'Claude 3 Haiku')
				.addOption('custom', 'Custom Model')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide custom model input
				})
			);
		}

		// Custom model name input (only show if 'custom' is selected)
		if (this.plugin.settings.model === 'custom') {
			new Setting(containerEl)
				.setName('Custom Model Name')
				.setDesc('Enter the exact model name (e.g., gpt-4o-mini, claude-3-5-sonnet-20241022)')
				.addText(text => text
					.setPlaceholder('Enter model name')
					.setValue(this.plugin.settings.customModel)
					.onChange(async (value) => {
						this.plugin.settings.customModel = value;
						await this.plugin.saveSettings();
					})
				);
		}

		// Indexing Filters Section
		containerEl.createEl('h2', { text: 'Indexing Filters' });

		// Whitelist Folders
		new Setting(containerEl)
			.setName('Whitelist Folders')
			.setDesc('Only index files in these folders (comma-separated paths, e.g., "folder1, folder2/subfolder"). Leave empty to index all folders.')
			.addTextArea(text => text
				.setPlaceholder('e.g., Notes, Projects/Work')
				.setValue(this.plugin.settings.whitelistFolders.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.whitelistFolders = value
						.split(',')
						.map(f => f.trim())
						.filter(f => f.length > 0);
					await this.plugin.saveSettings();
				})
			);

		// Whitelist Extensions
		new Setting(containerEl)
			.setName('Whitelist File Extensions')
			.setDesc('Only index files with these extensions (comma-separated, e.g., ".md, .txt"). Include the dot.')
			.addText(text => text
				.setPlaceholder('.md, .txt')
				.setValue(this.plugin.settings.whitelistExtensions.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.whitelistExtensions = value
						.split(',')
						.map(ext => ext.trim())
						.filter(ext => ext.length > 0);
					await this.plugin.saveSettings();
				})
			);

		// Blacklist Files
		new Setting(containerEl)
			.setName('Blacklist Files')
			.setDesc('Exclude specific files from indexing. Supports wildcards: * (any characters), ? (single character). Examples: "*.template.md, Private/*, README.md"')
			.addTextArea(text => text
				.setPlaceholder('e.g., *.template.md, Templates/*, README.md')
				.setValue(this.plugin.settings.blacklistFiles.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.blacklistFiles = value
						.split(',')
						.map(f => f.trim())
						.filter(f => f.length > 0);
					await this.plugin.saveSettings();
				})
			);

		// Info section
		containerEl.createEl('h3', { text: 'How to use' });
		containerEl.createEl('p', { 
			text: '1. Configure your API key above' 
		});
		containerEl.createEl('p', { 
			text: '2. Click "Index Vault" button in the chat view to index your markdown files' 
		});
		containerEl.createEl('p', { 
			text: '3. Ask questions about your vault content in the chat interface' 
		});

		// Link to get API keys
		containerEl.createEl('h3', { text: 'Get API Keys' });
		const linksDiv = containerEl.createDiv();
		linksDiv.createEl('a', { 
			text: 'Get OpenAI API Key',
			href: 'https://platform.openai.com/api-keys'
		});
		linksDiv.createEl('br');
		linksDiv.createEl('a', { 
			text: 'Get Claude API Key',
			href: 'https://console.anthropic.com/settings/keys'
		});
	}
}
