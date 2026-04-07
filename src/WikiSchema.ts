import { Vault } from 'obsidian';

const DEFAULT_SCHEMA = `# Wiki Schema

## Page Types
- **source**: Summary of an ingested source file. One per source.
- **entity**: A named thing (person, tool, framework, organization, place).
- **concept**: An idea, pattern, theory, or methodology.
- **query**: A question and its synthesized answer, filed from chat.
- **overview**: A high-level synthesis across multiple sources/entities.

## Conventions
- All pages use YAML frontmatter with: type, source (if applicable), created, updated, tags, related
- Cross-references use Obsidian wiki-links: [[Page Name]]
- Entity pages should include: definition, key facts, relationships, sources
- Concept pages should include: definition, context, examples, related concepts
- Source summaries should include: key takeaways, entities mentioned, concepts discussed

## Directory Structure
- sources/ — one summary per ingested file
- entities/ — one page per extracted entity
- concepts/ — one page per extracted concept
- queries/ — filed chat answers

## Naming
- Filenames: lowercase, hyphens for spaces (e.g., vector-search.md)
- Page titles: title case in frontmatter

## Index
- index.md contains all pages grouped by type with one-line summary each
- Updated after every ingest/lint/query-save operation
`;

export class WikiSchema {
	private vault: Vault;
	private wikiFolder: string;
	private cachedSchema: string | null = null;

	constructor(vault: Vault, wikiFolder: string) {
		this.vault = vault;
		this.wikiFolder = wikiFolder;
	}

	updateWikiFolder(wikiFolder: string): void {
		this.wikiFolder = wikiFolder;
		this.cachedSchema = null;
	}

	async getSchema(): Promise<string> {
		if (this.cachedSchema) return this.cachedSchema;

		const schemaPath = `${this.wikiFolder}/_schema.md`;
		const file = this.vault.getAbstractFileByPath(schemaPath);

		if (file) {
			this.cachedSchema = await this.vault.read(file as any);
			return this.cachedSchema;
		}

		// Create default schema
		await this.ensureFolder(this.wikiFolder);
		await this.vault.create(schemaPath, DEFAULT_SCHEMA);
		this.cachedSchema = DEFAULT_SCHEMA;
		return this.cachedSchema;
	}

	invalidateCache(): void {
		this.cachedSchema = null;
	}

	private async ensureFolder(path: string): Promise<void> {
		const folder = this.vault.getAbstractFileByPath(path);
		if (!folder) {
			await this.vault.createFolder(path);
		}
	}
}
