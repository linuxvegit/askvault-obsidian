import { App, PluginSettingTab, Setting } from 'obsidian';
import AskVaultPlugin from '../main';

export interface AskVaultSettings {
	provider: 'openai' | 'claude';
	apiKey: string;
	model: string;
	customModel: string;
	openaiEndpoint: string;
	claudeEndpoint: string;
	// Wiki settings
	wikiFolder: string;
	sourceIncludeFolders: string[];
	sourceExcludeFolders: string[];
	sourceExtensions: string[];
	autoUpdate: 'enabled' | 'disabled' | 'desktop-only' | 'mobile-only';
}

export const DEFAULT_SETTINGS: AskVaultSettings = {
	provider: 'openai',
	apiKey: '',
	model: 'gpt-3.5-turbo',
	customModel: '',
	openaiEndpoint: 'https://api.openai.com/v1',
	claudeEndpoint: 'https://api.anthropic.com/v1',
	wikiFolder: 'wiki',
	sourceIncludeFolders: [],
	sourceExcludeFolders: [],
	sourceExtensions: ['.md'],
	autoUpdate: 'enabled'
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

		// Wiki Settings Section
		containerEl.createEl('h2', { text: 'Wiki Settings' });

		// Wiki Folder
		new Setting(containerEl)
			.setName('Wiki Folder')
			.setDesc('Folder within your vault where wiki pages are generated. Will be created if it does not exist.')
			.addText(text => text
				.setPlaceholder('wiki')
				.setValue(this.plugin.settings.wikiFolder)
				.onChange(async (value) => {
					this.plugin.settings.wikiFolder = value.trim() || 'wiki';
					await this.plugin.saveSettings();
				})
			);

		// Source Include Folders
		new Setting(containerEl)
			.setName('Source Include Folders')
			.setDesc('Only ingest files from these folders (comma-separated). Leave empty to ingest all folders except the wiki folder.')
			.addTextArea(text => text
				.setPlaceholder('e.g., Notes, Projects/Work')
				.setValue(this.plugin.settings.sourceIncludeFolders.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.sourceIncludeFolders = value
						.split(',')
						.map(f => f.trim())
						.filter(f => f.length > 0);
					await this.plugin.saveSettings();
				})
			);

		// Source Exclude Folders
		new Setting(containerEl)
			.setName('Source Exclude Folders')
			.setDesc('Skip these folders during ingestion (comma-separated). The wiki folder is always excluded.')
			.addTextArea(text => text
				.setPlaceholder('e.g., Templates, Archive')
				.setValue(this.plugin.settings.sourceExcludeFolders.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.sourceExcludeFolders = value
						.split(',')
						.map(f => f.trim())
						.filter(f => f.length > 0);
					await this.plugin.saveSettings();
				})
			);

		// Source Extensions
		new Setting(containerEl)
			.setName('Source File Extensions')
			.setDesc('Only ingest files with these extensions (comma-separated). Include the dot.')
			.addText(text => text
				.setPlaceholder('.md, .txt')
				.setValue(this.plugin.settings.sourceExtensions.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.sourceExtensions = value
						.split(',')
						.map(ext => ext.trim())
						.filter(ext => ext.length > 0);
					await this.plugin.saveSettings();
				})
			);

		// Auto Update
		new Setting(containerEl)
			.setName('Auto Update')
			.setDesc('Automatically re-ingest source files when they are modified.')
			.addDropdown(dropdown => dropdown
				.addOption('enabled', 'Enabled (all platforms)')
				.addOption('disabled', 'Disabled')
				.addOption('desktop-only', 'Desktop only')
				.addOption('mobile-only', 'Mobile only')
				.setValue(this.plugin.settings.autoUpdate)
				.onChange(async (value) => {
					this.plugin.settings.autoUpdate = value as AskVaultSettings['autoUpdate'];
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
