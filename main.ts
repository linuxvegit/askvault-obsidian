import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ChatView, VIEW_TYPE_CHAT } from './src/ChatView';
import { AskVaultSettings, DEFAULT_SETTINGS, AskVaultSettingTab } from './src/Settings';
import { VectorService } from './src/VectorService';
import { LLMService } from './src/LLMService';

export default class AskVaultPlugin extends Plugin {
	settings: AskVaultSettings;
	vectorService: VectorService;
	llmService: LLMService;
	private indexingCancelled: boolean = false;
	private isIndexing: boolean = false;

	async onload() {
		await this.loadSettings();

		// Initialize services
		this.vectorService = new VectorService(this.app.vault, this.settings);
		this.llmService = new LLMService(this.settings);

		// Load indexed data
		await this.loadIndexData();

		// Register the chat view
		this.registerView(
			VIEW_TYPE_CHAT,
			(leaf) => new ChatView(leaf, this)
		);

		// Add ribbon icon to open chat view
		this.addRibbonIcon('message-square', 'askvault', () => {
			this.activateView();
		});

		// Add command to open chat view
		this.addCommand({
			id: 'open-askvault-view',
			name: 'Open askvault',
			callback: () => {
				this.activateView();
			}
		});

		// Add command to index all markdown files
		this.addCommand({
			id: 'index-vault-files',
			name: 'Index all vault files',
			callback: async () => {
				await this.indexVaultFiles();
			}
		});

		// Add settings tab
		this.addSettingTab(new AskVaultSettingTab(this.app, this));
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf in the right sidebar
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_CHAT, active: true });
		}

		// Reveal the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async indexVaultFiles(progressCallback?: (current: number, total: number, fileName: string) => void): Promise<void> {
		if (this.isIndexing) {
			console.log('Indexing already in progress');
			return;
		}

		this.isIndexing = true;
		this.indexingCancelled = false;

		const allFiles = this.app.vault.getFiles();
		
		// Filter files based on whitelist and blacklist settings
		const files = allFiles.filter(file => this.shouldIndexFile(file.path, file.extension));
		
		const totalFiles = files.length;
		const batchSize = 20; // Process 20 files in parallel
		
		console.log(`Starting to index ${totalFiles} files in batches of ${batchSize}...`);
		
		let indexed = 0;
		let skipped = 0;
		let unchanged = 0;

		// Process files in batches
		for (let i = 0; i < files.length; i += batchSize) {
			// Check if indexing was cancelled
			if (this.indexingCancelled) {
				console.log('Indexing cancelled by user');
				break;
			}

			const batch = files.slice(i, i + batchSize);
			
			// Process batch in parallel
			const batchPromises = batch.map(async (file) => {
				try {
					const content = await this.app.vault.read(file);
					const hash = await this.calculateFileHash(content);
					
					// Check if file content has changed
					if (this.vectorService.hasDocumentWithHash(file.path, hash)) {
						console.log(`Skipping unchanged file: ${file.path}`);
						return { success: true, file, unchanged: true };
					}
					
					// Use LLM to summarize the content
					const summary = await this.llmService.summarize(content);
					
					// Add to vector database
					await this.vectorService.addDocument(file.path, content, summary, hash);
					
					return { success: true, file, unchanged: false };
				} catch (error) {
					console.error(`Error indexing ${file.path}:`, error);
					return { success: false, file, error };
				}
			});

			// Wait for all files in batch to complete
			const results = await Promise.all(batchPromises);

			// Update counters and report progress
			for (const result of results) {
				if (result.success) {
					if (result.unchanged) {
						unchanged++;
					} else {
						indexed++;
						console.log(`Indexed ${indexed}/${totalFiles}: ${result.file.path}`);
					}
				} else {
					skipped++;
				}
				
				// Report progress after each file completes
				if (progressCallback) {
					progressCallback(indexed + skipped + unchanged, totalFiles, result.file.name);
				}
			}
		}
		
		this.isIndexing = false;
		const status = this.indexingCancelled ? 'cancelled' : 'complete';
		console.log(`Indexing ${status}! Indexed ${indexed} new/modified files, ${unchanged} unchanged, ${skipped} failed.`);
		
		// Save indexed data to storage
		if (indexed > 0) {
			await this.saveIndexData();
		}
	}

	/**
	 * Cancel ongoing indexing operation
	 */
	cancelIndexing(): void {
		if (this.isIndexing) {
			this.indexingCancelled = true;
		}
	}

	/**
	 * Check if a file should be indexed based on whitelist/blacklist settings
	 */
	private shouldIndexFile(filePath: string, extension: string): boolean {
		// Check blacklist first - if file is blacklisted, always skip
		if (this.settings.blacklistFiles.length > 0) {
			for (const blacklistPattern of this.settings.blacklistFiles) {
				if (this.matchesPattern(filePath, blacklistPattern)) {
					return false;
				}
			}
		}

		// Check extension whitelist
		if (this.settings.whitelistExtensions.length > 0) {
			const fileExt = '.' + extension;
			if (!this.settings.whitelistExtensions.includes(fileExt)) {
				return false;
			}
		}

		// Check folder whitelist
		if (this.settings.whitelistFolders.length > 0) {
			let inWhitelistedFolder = false;
			for (const folder of this.settings.whitelistFolders) {
				const normalizedFolder = folder.replace(/\\/g, '/');
				const normalizedPath = filePath.replace(/\\/g, '/');
				
				// Check if file is in the folder or its subfolders
				if (normalizedPath.startsWith(normalizedFolder + '/') || 
					normalizedPath.startsWith(normalizedFolder + '\\') ||
					normalizedFolder === normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))) {
					inWhitelistedFolder = true;
					break;
				}
			}
			if (!inWhitelistedFolder) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Calculate hash of file content for change detection
	 */
	private async calculateFileHash(content: string): Promise<string> {
		// Simple hash function for content
		let hash = 0;
		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return hash.toString(36);
	}

	/**
	 * Match a file path against a pattern with wildcard support
	 * Supports * (any characters) and ? (single character)
	 */
	private matchesPattern(filePath: string, pattern: string): boolean {
		// Normalize paths to use forward slashes
		const normalizedPath = filePath.replace(/\\/g, '/');
		const normalizedPattern = pattern.replace(/\\/g, '/');

		// If pattern has no wildcards, do exact match or suffix match
		if (!normalizedPattern.includes('*') && !normalizedPattern.includes('?')) {
			return normalizedPath === normalizedPattern || 
				   normalizedPath.endsWith('/' + normalizedPattern);
		}

		// Convert glob pattern to regex
		const regexPattern = normalizedPattern
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars except * and ?
			.replace(/\*/g, '.*')                    // * matches any characters
			.replace(/\?/g, '.');                    // ? matches single character

		const regex = new RegExp('^' + regexPattern + '$');
		return regex.test(normalizedPath);
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

	async loadIndexData() {
		try {
			const indexData = await this.loadData();
			if (indexData && indexData.vectorIndex) {
				await this.vectorService.load(indexData.vectorIndex);
				console.log('Vector index loaded successfully');
			}
		} catch (error) {
			console.error('Error loading vector index:', error);
		}
	}

	async saveIndexData() {
		try {
			const currentData = await this.loadData() || {};
			const vectorIndex = await this.vectorService.save();
			currentData.vectorIndex = vectorIndex;
			await this.saveData(currentData);
			console.log('Vector index saved successfully');
		} catch (error) {
			console.error('Error saving vector index:', error);
		}
	}

	onunload() {
		// Clean up resources
		this.vectorService.cleanup();
	}
}
