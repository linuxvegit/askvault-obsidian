import { Vault, TFile, TAbstractFile, Platform, parseYaml } from 'obsidian';
import { AskVaultSettings } from './Settings';
import { LLMService } from './LLMService';
import { WikiSchema } from './WikiSchema';
import { IndexEntry } from './BM25Scorer';

export interface IngestResult {
	summary: string;
	entities: Array<{ name: string; description: string; facts: string[]; relationships: string[] }>;
	concepts: Array<{ name: string; description: string; examples: string[] }>;
	crossReferences: Array<{ from: string; to: string; relationship: string }>;
}

export interface LintIssue {
	type: 'contradiction' | 'orphan' | 'missing_entity' | 'missing_crossref' | 'stale' | 'gap';
	description: string;
	page?: string;
	suggestedFix?: string;
}

export interface WikiProgress {
	current: number;
	total: number;
	fileName: string;
	status: string;
	errorCount?: number;
}

type ProgressCallback = (progress: WikiProgress) => void;

export class WikiService {
	private vault: Vault;
	private settings: AskVaultSettings;
	private llmService: LLMService;
	private wikiSchema: WikiSchema;
	private isBusy: boolean = false;
	private ingestCancelled: boolean = false;
	private cachedIndex: IndexEntry[] | null = null;
	private updateQueue: Set<string> = new Set();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private eventRefs: Array<ReturnType<typeof setTimeout>> = [];
	private vaultEventRefs: any[] = [];

	constructor(vault: Vault, settings: AskVaultSettings, llmService: LLMService, wikiSchema: WikiSchema) {
		this.vault = vault;
		this.settings = settings;
		this.llmService = llmService;
		this.wikiSchema = wikiSchema;
	}

	// --- File Utilities ---

	private get wikiFolder(): string {
		return this.settings.wikiFolder || 'wiki';
	}

	private async ensureWikiStructure(): Promise<void> {
		const dirs = [
			this.wikiFolder,
			`${this.wikiFolder}/sources`,
			`${this.wikiFolder}/entities`,
			`${this.wikiFolder}/concepts`,
			`${this.wikiFolder}/queries`
		];
		for (const dir of dirs) {
			if (!this.vault.getAbstractFileByPath(dir)) {
				await this.vault.createFolder(dir);
			}
		}
	}

	private async readWikiFile(relativePath: string): Promise<string | null> {
		const fullPath = `${this.wikiFolder}/${relativePath}`;
		const file = this.vault.getAbstractFileByPath(fullPath);
		if (file && file instanceof TFile) {
			return await this.vault.read(file);
		}
		return null;
	}

	private async writeWikiFile(relativePath: string, content: string): Promise<void> {
		const fullPath = `${this.wikiFolder}/${relativePath}`;
		const file = this.vault.getAbstractFileByPath(fullPath);
		if (file && file instanceof TFile) {
			await this.vault.modify(file, content);
		} else {
			await this.vault.create(fullPath, content);
		}
	}

	private toFileName(name: string): string {
		return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	private isSourceFile(file: TAbstractFile): boolean {
		if (!(file instanceof TFile)) return false;
		const path = file.path.replace(/\\/g, '/');

		// Never ingest wiki folder
		if (path.startsWith(this.wikiFolder + '/')) return false;

		// Check extension
		if (this.settings.sourceExtensions.length > 0) {
			const ext = '.' + file.extension;
			if (!this.settings.sourceExtensions.includes(ext)) return false;
		}

		// Check include folders
		if (this.settings.sourceIncludeFolders.length > 0) {
			const inIncluded = this.settings.sourceIncludeFolders.some(f =>
				path.startsWith(f.replace(/\\/g, '/') + '/')
			);
			if (!inIncluded) return false;
		}

		// Check exclude folders
		if (this.settings.sourceExcludeFolders.length > 0) {
			const inExcluded = this.settings.sourceExcludeFolders.some(f =>
				path.startsWith(f.replace(/\\/g, '/') + '/')
			);
			if (inExcluded) return false;
		}

		// Check include suffixes
		const fileName = file.name;
		if (this.settings.sourceIncludeSuffixes.length > 0) {
			const matchesInclude = this.settings.sourceIncludeSuffixes.some(s =>
				fileName.endsWith(s)
			);
			if (!matchesInclude) return false;
		}

		// Check exclude suffixes
		if (this.settings.sourceExcludeSuffixes.length > 0) {
			const matchesExclude = this.settings.sourceExcludeSuffixes.some(s =>
				fileName.endsWith(s)
			);
			if (matchesExclude) return false;
		}

		return true;
	}

	// --- Log Parsing ---

	async hasIngestLog(): Promise<boolean> {
		const logContent = await this.readWikiFile('log.md');
		return !!logContent && logContent.includes('ingest');
	}

	private async getIngestLog(): Promise<Map<string, number>> {
		const logContent = await this.readWikiFile('log.md');
		const entries = new Map<string, number>();
		if (!logContent) return entries;

		// Split by log entries and only track successful ingests
		const blocks = logContent.split('\n## ');
		for (const block of blocks) {
			const headerMatch = block.match(/^\[(.+?)\] ingest \| (.+)/);
			if (!headerMatch) continue;

			// Check if this entry was successful
			if (!block.includes('**status:** success')) continue;

			const path = headerMatch[2].trim();
			const mtime = new Date(headerMatch[1]).getTime();
			const existing = entries.get(path);
			if (!existing || mtime > existing) {
				entries.set(path, mtime);
			}
		}
		return entries;
	}

	private async appendLog(action: string, target: string, pagesTouched: string[], status: string): Promise<void> {
		const now = new Date().toISOString();
		const entry = `\n## [${now}] ${action} | ${target}\n- **pages touched:** ${pagesTouched.join(', ')}\n- **status:** ${status}\n`;

		const logContent = await this.readWikiFile('log.md');
		if (logContent) {
			await this.writeWikiFile('log.md', logContent + entry);
		} else {
			await this.writeWikiFile('log.md', `# Wiki Log\n${entry}`);
		}
	}

	// --- Index Management ---

	private async readIndex(): Promise<string> {
		const content = await this.readWikiFile('index.md');
		return content || '';
	}

	private parseIndex(content: string): IndexEntry[] {
		const entries: IndexEntry[] = [];
		const regex = /^- (.+\.md) \[tags:([^\]]*) related:([^\]]*)\] -- (.+)$/gm;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const path = match[1];
			const tags = match[2];
			const related = match[3];
			const summary = match[4];
			const text = summary + ' ' + tags.replace(/,/g, ' ') + ' ' + related.replace(/,/g, ' ');
			entries.push({ path, text: text.trim() });
		}
		return entries;
	}

	async getIndexEntries(): Promise<IndexEntry[]> {
		if (this.cachedIndex !== null) {
			return this.cachedIndex;
		}
		const content = await this.readIndex();
		this.cachedIndex = this.parseIndex(content);
		return this.cachedIndex;
	}

	private async rebuildIndex(): Promise<void> {
		this.cachedIndex = null;
		const sections: Record<string, string[]> = {
			sources: [],
			entities: [],
			concepts: [],
			queries: []
		};

		for (const type of Object.keys(sections)) {
			const dirPath = `${this.wikiFolder}/${type}`;
			const dir = this.vault.getAbstractFileByPath(dirPath);
			if (!dir) continue;

			const files = this.vault.getFiles().filter(f => f.path.startsWith(dirPath + '/'));
			for (const file of files) {
				const content = await this.vault.read(file);
				const relPath = `${type}/${file.name}`;

				let tags: string[] = [];
				let related: string[] = [];
				let summary = file.basename;

				try {
					// Split content to isolate frontmatter between the two --- delimiters
					const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
					if (fmMatch) {
						const fmBlock = fmMatch[1];
						const parsed = parseYaml(fmBlock);
						if (parsed) {
							tags = Array.isArray(parsed.tags) ? parsed.tags : [];
							const rawRelated: unknown[] = Array.isArray(parsed.related) ? parsed.related : [];
							related = rawRelated.map((r: unknown) =>
								String(r).replace(/^\[\[/, '').replace(/\]\]$/, '')
							);
						}

						// Body is everything after the closing ---
						const body = content.substring(fmMatch[0].length);
						const bodyLines = body.split('\n');
						const firstBodyLine = bodyLines.find(l => l.trim() !== '');
						if (firstBodyLine) {
							summary = firstBodyLine.replace(/^#+\s*/, '').trim() || file.basename;
						}
					} else {
						// No frontmatter found — fall back to legacy first-line extraction
						const firstLine = content.split('\n').find(l =>
							l.trim() && !l.startsWith('---') && !l.startsWith('type:')
						);
						summary = firstLine?.replace(/^#+\s*/, '').trim() || file.basename;
					}
				} catch {
					// Frontmatter parse failed — fall back to legacy first-line extraction
					const firstLine = content.split('\n').find(l =>
						l.trim() && !l.startsWith('---') && !l.startsWith('type:')
					);
					summary = firstLine?.replace(/^#+\s*/, '').trim() || file.basename;
				}

				const tagsStr = tags.join(',');
				const relatedStr = related.join(',');
				sections[type].push(`- ${relPath} [tags:${tagsStr} related:${relatedStr}] -- ${summary}`);
			}
		}

		let index = '# Wiki Index\n\n';
		for (const [type, entries] of Object.entries(sections)) {
			if (entries.length > 0) {
				index += `## ${type.charAt(0).toUpperCase() + type.slice(1)}\n\n${entries.join('\n')}\n\n`;
			}
		}

		await this.writeWikiFile('index.md', index);
	}

	// --- Ingest Operation ---

	async ingest(progressCallback?: ProgressCallback, forceAll: boolean = false): Promise<void> {
		if (this.isBusy) {
			throw new Error('A wiki operation is already in progress.');
		}
		this.isBusy = true;
		this.ingestCancelled = false;

		try {
			await this.ensureWikiStructure();
			const schema = await this.wikiSchema.getSchema();
			const ingestLog = forceAll ? new Map<string, number>() : await this.getIngestLog();

			const allFiles = this.vault.getFiles();
			const sourceFiles = allFiles.filter(f => this.isSourceFile(f));

			const filesToProcess: TFile[] = [];
			for (const file of sourceFiles) {
				const loggedMtime = ingestLog.get(file.path);
				if (!loggedMtime || file.stat.mtime > loggedMtime) {
					filesToProcess.push(file);
				}
			}

			const total = filesToProcess.length;
			if (total === 0) {
				this.isBusy = false;
				return;
			}

			// Read index once for the entire run, update in memory as we go
			let cachedIndex = await this.readIndex();
			// Batch log entries to avoid reading/writing log.md per file
			const logEntries: string[] = [];

			let errorCount = 0;

			for (let i = 0; i < filesToProcess.length; i++) {
				if (this.ingestCancelled) {
					progressCallback?.({ current: i, total, fileName: '', status: 'Cancelled', errorCount });
					break;
				}

				const file = filesToProcess[i];
				progressCallback?.({ current: i + 1, total, fileName: file.path, status: 'Processing', errorCount });

				try {
					const logEntry = await this.ingestFile(file, schema, cachedIndex);
					logEntries.push(logEntry);
				} catch (error) {
					errorCount++;
					console.error(`Failed to ingest ${file.path}:`, error);
					progressCallback?.({ current: i + 1, total, fileName: file.path, status: `Error: ${error.message}`, errorCount });
					const now = new Date().toISOString();
					logEntries.push(`\n## [${now}] ingest | ${file.path}\n- **pages touched:** \n- **status:** error: ${error.message}\n`);
				}
			}

			// Flush batched log entries
			if (logEntries.length > 0) {
				const logContent = await this.readWikiFile('log.md');
				const combined = logEntries.join('');
				if (logContent) {
					await this.writeWikiFile('log.md', logContent + combined);
				} else {
					await this.writeWikiFile('log.md', `# Wiki Log\n${combined}`);
				}
			}

			await this.rebuildIndex();

			// Report final status
			progressCallback?.({ current: total, total, fileName: '', status: errorCount > 0 ? `Done with ${errorCount} error(s)` : 'Done', errorCount });
		} finally {
			this.isBusy = false;
			this.ingestCancelled = false;
		}
	}

	cancelIngest(): void {
		if (this.isBusy) {
			this.ingestCancelled = true;
		}
	}

	private async ingestFile(file: TFile, schema: string, cachedIndex: string): Promise<string> {
		const content = await this.vault.read(file);

		const systemPrompt = `${schema}\n\n## Current Wiki Index\n${cachedIndex}\n\nYou are a wiki maintainer. Analyze the following source document and extract structured information. Return ONLY valid JSON with no markdown fences.`;

		const userPrompt = `Source file: ${file.path}\n\n${content.substring(0, 50000)}\n\nReturn JSON in this exact format:\n{"summary":"<500 word summary>","entities":[{"name":"<name>","description":"<description>","facts":["<fact1>"],"relationships":["<relationship1>"]}],"concepts":[{"name":"<name>","description":"<description>","examples":["<example1>"]}],"crossReferences":[{"from":"<page>","to":"<page>","relationship":"<how they relate>"}]}`;

		let result: IngestResult;
		try {
			const raw = await this.llmService.callLLMRaw(systemPrompt, userPrompt, 4000);
			result = this.parseIngestResult(raw);
		} catch (error) {
			try {
				const retryPrompt = userPrompt + '\n\nIMPORTANT: Return ONLY raw JSON. No markdown code fences. No explanatory text.';
				const raw = await this.llmService.callLLMRaw(systemPrompt, retryPrompt, 4000);
				result = this.parseIngestResult(raw);
			} catch (retryError) {
				throw new Error(`JSON parse failed after retry: ${retryError.message}`);
			}
		}

		const pagesTouched: string[] = [];
		const now = new Date().toISOString().split('T')[0];

		const sourceFileName = this.toFileName(file.basename);
		const sourcePage = `---\ntype: source\nsource: "[[${file.path}]]"\ncreated: ${now}\nupdated: ${now}\ntags: [${file.extension}]\nrelated: []\n---\n\n# ${file.basename}\n\n${result.summary}`;
		await this.writeWikiFile(`sources/${sourceFileName}.md`, sourcePage);
		pagesTouched.push(`sources/${sourceFileName}.md`);

		// Process entity and concept merges in parallel
		const mergePromises: Promise<void>[] = [];

		for (const entity of result.entities) {
			const entityFileName = this.toFileName(entity.name);
			const entityPath = `entities/${entityFileName}.md`;
			pagesTouched.push(entityPath);

			mergePromises.push((async () => {
				const existing = await this.readWikiFile(entityPath);
				if (existing) {
					const mergePrompt = `Existing entity page:\n${existing}\n\nNew information from "${file.path}":\nDescription: ${entity.description}\nFacts: ${entity.facts.join('; ')}\nRelationships: ${entity.relationships.join('; ')}\n\nMerge the new information into the existing page. Keep the YAML frontmatter format. Update the "updated" date to ${now}. Add "[[${file.basename}]]" to related if not already present. Return the complete updated markdown page.`;
					const merged = await this.llmService.callLLMRaw('You are a wiki editor. Return only the complete markdown page.', mergePrompt, 3000);
					await this.writeWikiFile(entityPath, merged);
				} else {
					const related = [`[[sources/${sourceFileName}]]`];
					const entityTags = [entity.name.toLowerCase(), 'entity'];
					const entityPage = `---\ntype: entity\ncreated: ${now}\nupdated: ${now}\ntags: [${entityTags.join(', ')}]\nrelated: [${related.map(r => `"${r}"`).join(', ')}]\n---\n\n# ${entity.name}\n\n${entity.description}\n\n## Key Facts\n${entity.facts.map(f => `- ${f}`).join('\n')}\n\n## Relationships\n${entity.relationships.map(r => `- ${r}`).join('\n')}`;
					await this.writeWikiFile(entityPath, entityPage);
				}
			})());
		}

		for (const concept of result.concepts) {
			const conceptFileName = this.toFileName(concept.name);
			const conceptPath = `concepts/${conceptFileName}.md`;
			pagesTouched.push(conceptPath);

			mergePromises.push((async () => {
				const existing = await this.readWikiFile(conceptPath);
				if (existing) {
					const mergePrompt = `Existing concept page:\n${existing}\n\nNew information from "${file.path}":\nDescription: ${concept.description}\nExamples: ${concept.examples.join('; ')}\n\nMerge the new information into the existing page. Keep the YAML frontmatter format. Update the "updated" date to ${now}. Return the complete updated markdown page.`;
					const merged = await this.llmService.callLLMRaw('You are a wiki editor. Return only the complete markdown page.', mergePrompt, 3000);
					await this.writeWikiFile(conceptPath, merged);
				} else {
					const related = [`[[sources/${sourceFileName}]]`];
					const conceptTags = [concept.name.toLowerCase(), 'concept'];
					const conceptPage = `---\ntype: concept\ncreated: ${now}\nupdated: ${now}\ntags: [${conceptTags.join(', ')}]\nrelated: [${related.map(r => `"${r}"`).join(', ')}]\n---\n\n# ${concept.name}\n\n${concept.description}\n\n## Examples\n${concept.examples.map(e => `- ${e}`).join('\n')}`;
					await this.writeWikiFile(conceptPath, conceptPage);
				}
			})());
		}

		await Promise.all(mergePromises);

		const logTimestamp = new Date().toISOString();
		return `\n## [${logTimestamp}] ingest | ${file.path}\n- **pages touched:** ${pagesTouched.join(', ')}\n- **status:** success\n`;
	}

	private parseIngestResult(raw: string): IngestResult {
		let cleaned = raw.trim();
		if (cleaned.startsWith('```')) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
		}
		const parsed = JSON.parse(cleaned);

		return {
			summary: parsed.summary || '',
			entities: Array.isArray(parsed.entities) ? parsed.entities.map((e: any) => ({
				name: e.name || '',
				description: e.description || '',
				facts: Array.isArray(e.facts) ? e.facts : [],
				relationships: Array.isArray(e.relationships) ? e.relationships : []
			})) : [],
			concepts: Array.isArray(parsed.concepts) ? parsed.concepts.map((c: any) => ({
				name: c.name || '',
				description: c.description || '',
				examples: Array.isArray(c.examples) ? c.examples : []
			})) : [],
			crossReferences: Array.isArray(parsed.crossReferences) ? parsed.crossReferences : []
		};
	}

	// --- Query Retrieval ---

	async findRelevantPages(question: string): Promise<string[]> {
		const index = await this.readIndex();
		if (!index.trim()) {
			console.log('[AskVault] findRelevantPages: index is empty');
			return [];
		}

		// Try BM25 local scoring first
		try {
			const entries = await this.getIndexEntries();
			if (entries.length > 0) {
				const { BM25Scorer } = await import('./BM25Scorer');
				const scorer = new BM25Scorer();
				scorer.buildIndex(entries);
				const results = scorer.score(question);
				if (results.length > 0 && results[0].score > 0) {
					console.log('[AskVault] BM25 scored pages:', results.map(r => r.path));
					return results.map(r => r.path);
				}
				console.log('[AskVault] BM25 fallback: no term overlap, using LLM retrieval');
			} else {
				console.log('[AskVault] BM25 fallback: no parsed index entries, using LLM retrieval');
			}
		} catch (bm25Error) {
			console.warn('[AskVault] BM25 scoring failed, falling back to LLM:', bm25Error);
		}

		// LLM fallback path
		const schema = await this.wikiSchema.getSchema();
		const systemPrompt = `${schema}\n\nYou are a wiki search engine. Given the wiki index and a user question, identify the most relevant wiki pages. The index uses an enriched format where each entry looks like: "- path.md [tags:... related:...] -- summary". Return ONLY a JSON array of the file paths (the part before the brackets, e.g., ["sources/my-article.md", "entities/react.md"]). Return at most 5 pages. If no pages are relevant, return [].`;

		const userPrompt = `Wiki Index:\n${index}\n\nQuestion: ${question}`;

		try {
			const raw = await this.llmService.callLLMRaw(systemPrompt, userPrompt, 500);
			console.log('[AskVault] findRelevantPages LLM raw response:', raw);
			let cleaned = raw.trim();
			if (cleaned.startsWith('```')) {
				cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
			}
			const paths = JSON.parse(cleaned);
			if (!Array.isArray(paths)) {
				console.warn('[AskVault] findRelevantPages: LLM did not return an array:', paths);
				return [];
			}

			// Normalize paths: strip [[ ]], ensure .md extension
			const normalized = paths.map((p: string) => {
				let clean = p.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
				if (!clean.endsWith('.md')) clean += '.md';
				return clean;
			});
			console.log('[AskVault] findRelevantPages LLM normalized paths:', normalized);
			return normalized;
		} catch (error) {
			console.error('[AskVault] findRelevantPages LLM failed:', error);
			return [];
		}
	}

	async getPageContents(relativePaths: string[]): Promise<Array<{ path: string; content: string }>> {
		const results: Array<{ path: string; content: string }> = [];
		for (const relPath of relativePaths) {
			const content = await this.readWikiFile(relPath);
			if (content) {
				results.push({ path: `${this.wikiFolder}/${relPath}`, content });
			} else {
				console.warn(`[AskVault] getPageContents: file not found: ${this.wikiFolder}/${relPath}`);
			}
		}
		console.log(`[AskVault] getPageContents: ${results.length}/${relativePaths.length} pages loaded`);
		return results;
	}

	// --- Save Query to Wiki ---

	async saveQueryResult(question: string, answer: string): Promise<void> {
		await this.ensureWikiStructure();
		const now = new Date().toISOString().split('T')[0];
		const fileName = this.toFileName(question.substring(0, 60));
		const queryPage = `---\ntype: query\ncreated: ${now}\nupdated: ${now}\ntags: [query]\nrelated: []\n---\n\n# ${question}\n\n${answer}`;

		await this.writeWikiFile(`queries/${fileName}.md`, queryPage);
		await this.rebuildIndex();
		await this.appendLog('query-save', `queries/${fileName}.md`, [`queries/${fileName}.md`], 'success');
	}

	// --- Lint Operation ---

	async lint(): Promise<LintIssue[]> {
		if (this.isBusy) {
			throw new Error('A wiki operation is already in progress.');
		}
		this.isBusy = true;

		try {
			const schema = await this.wikiSchema.getSchema();
			const index = await this.readIndex();

			if (!index.trim()) return [];

			const systemPrompt = `${schema}\n\nYou are a wiki quality checker. Analyze the wiki index for issues. Return ONLY a JSON array of issues.`;

			const userPrompt = `Wiki Index:\n${index}\n\nCheck for:\n1. Orphan pages (referenced but don't exist, or exist but not in index)\n2. Missing entities (mentioned in summaries but no entity page)\n3. Missing cross-references between related pages\n4. Stale or contradictory information\n5. Gaps (topics that should have pages but don't)\n\nReturn JSON array: [{"type":"orphan|missing_entity|missing_crossref|stale|gap|contradiction","description":"...","page":"optional path","suggestedFix":"optional fix"}]`;

			const raw = await this.llmService.callLLMRaw(systemPrompt, userPrompt, 3000);
			let cleaned = raw.trim();
			if (cleaned.startsWith('```')) {
				cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
			}

			const issues: LintIssue[] = JSON.parse(cleaned);
			await this.appendLog('lint', 'wiki', [], `${issues.length} issues found`);
			return Array.isArray(issues) ? issues : [];
		} catch (error) {
			console.error('Lint failed:', error);
			return [];
		} finally {
			this.isBusy = false;
		}
	}

	// --- Event-Driven Incremental Update ---

	registerAutoUpdate(): void {
		this.unregisterAutoUpdate();

		const setting = this.settings.autoUpdate;
		if (setting === 'disabled') return;
		if (setting === 'desktop-only' && !Platform.isDesktop) return;
		if (setting === 'mobile-only' && !Platform.isMobile) return;

		const handleEvent = (file: TAbstractFile) => {
			if (!this.isSourceFile(file)) return;
			this.updateQueue.add(file.path);
			this.scheduleUpdate();
		};

		const handleDelete = (file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			const sourceFileName = this.toFileName(file.basename);
			this.markOrphaned(`sources/${sourceFileName}.md`);
		};

		const handleRename = (file: TAbstractFile, oldPath: string) => {
			if (!this.isSourceFile(file)) return;
			this.updateQueue.add(file.path);
			const oldBasename = oldPath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
			const oldFileName = this.toFileName(oldBasename);
			this.markOrphaned(`sources/${oldFileName}.md`);
			this.scheduleUpdate();
		};

		this.vaultEventRefs.push(
			this.vault.on('modify', handleEvent),
			this.vault.on('create', handleEvent),
			this.vault.on('delete', handleDelete),
			this.vault.on('rename', handleRename)
		);
	}

	unregisterAutoUpdate(): void {
		for (const ref of this.vaultEventRefs) {
			this.vault.offref(ref);
		}
		this.vaultEventRefs = [];
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private scheduleUpdate(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.processUpdateQueue();
		}, 5000);
	}

	private async processUpdateQueue(): Promise<void> {
		if (this.isBusy || this.updateQueue.size === 0) return;

		this.isBusy = true;
		const paths = [...this.updateQueue];
		this.updateQueue.clear();

		try {
			const schema = await this.wikiSchema.getSchema();
			const cachedIndex = await this.readIndex();
			for (const path of paths) {
				const file = this.vault.getAbstractFileByPath(path);
				if (file && file instanceof TFile) {
					try {
						await this.ingestFile(file, schema, cachedIndex);
					} catch (error) {
						console.error(`Auto-update failed for ${path}:`, error);
					}
				}
			}
			await this.rebuildIndex();
		} finally {
			this.isBusy = false;
		}
	}

	private async markOrphaned(wikiRelPath: string): Promise<void> {
		const content = await this.readWikiFile(wikiRelPath);
		if (content && !content.includes('status: orphaned')) {
			const updated = content.replace(/^---\n/, '---\nstatus: orphaned\n');
			await this.writeWikiFile(wikiRelPath, updated);
		}
	}

	// --- Stats ---

	async getStats(): Promise<{ sourceCount: number; pageCount: number }> {
		const sourceFiles = this.vault.getFiles().filter(f => this.isSourceFile(f));
		const wikiFiles = this.vault.getFiles().filter(f => f.path.startsWith(this.wikiFolder + '/') && f.extension === 'md');
		return { sourceCount: sourceFiles.length, pageCount: wikiFiles.length };
	}

	// --- Manual Update ---

	async manualUpdate(progressCallback?: ProgressCallback): Promise<void> {
		await this.ingest(progressCallback);
	}
}
