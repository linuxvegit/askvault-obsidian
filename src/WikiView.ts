import { ItemView, WorkspaceLeaf } from 'obsidian';
import AskVaultPlugin from '../main';
import { LintIssue, WikiProgress } from './WikiService';

export const VIEW_TYPE_WIKI = 'askvault-wiki-view';

export class WikiView extends ItemView {
	plugin: AskVaultPlugin;
	private statusEl: HTMLElement | null = null;
	private progressContainer: HTMLElement | null = null;
	private progressBar: HTMLElement | null = null;
	private progressText: HTMLElement | null = null;
	private activityEl: HTMLElement | null = null;
	private lintResultsEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AskVaultPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_WIKI;
	}

	getDisplayText(): string {
		return 'Wiki Manager';
	}

	getIcon(): string {
		return 'book-open';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('askvault-wiki-container');

		// Header
		const header = container.createDiv({ cls: 'askvault-wiki-header' });
		header.createEl('h4', { text: 'Wiki Manager' });

		// Stats
		this.statusEl = container.createDiv({ cls: 'askvault-wiki-status' });
		await this.refreshStats();

		// Action buttons
		const actions = container.createDiv({ cls: 'askvault-wiki-actions' });

		const ingestBtn = actions.createEl('button', {
			text: 'Ingest All',
			cls: 'askvault-wiki-btn'
		});
		ingestBtn.onclick = () => this.runIngest();

		const updateBtn = actions.createEl('button', {
			text: 'Update',
			cls: 'askvault-wiki-btn'
		});
		updateBtn.onclick = () => this.runUpdate();

		const lintBtn = actions.createEl('button', {
			text: 'Lint',
			cls: 'askvault-wiki-btn'
		});
		lintBtn.onclick = () => this.runLint();

		const indexBtn = actions.createEl('button', {
			text: 'Index',
			cls: 'askvault-wiki-btn'
		});
		indexBtn.onclick = () => this.openIndex();

		// Progress area
		this.progressContainer = container.createDiv({ cls: 'askvault-wiki-progress askvault-hidden' });
		const progressBarContainer = this.progressContainer.createDiv({ cls: 'askvault-progress-bar-container' });
		this.progressBar = progressBarContainer.createDiv({ cls: 'askvault-progress-bar' });
		this.progressText = this.progressContainer.createDiv({ cls: 'askvault-progress-text' });

		// Activity log
		container.createEl('h5', { text: 'Recent Activity', cls: 'askvault-wiki-section-title' });
		this.activityEl = container.createDiv({ cls: 'askvault-wiki-activity' });
		await this.loadActivity();

		// Lint results
		container.createEl('h5', { text: 'Lint Results', cls: 'askvault-wiki-section-title' });
		this.lintResultsEl = container.createDiv({ cls: 'askvault-wiki-lint-results' });
	}

	private async refreshStats(): Promise<void> {
		if (!this.statusEl) return;
		const stats = await this.plugin.wikiService.getStats();
		this.statusEl.setText(`${stats.sourceCount} sources | ${stats.pageCount} wiki pages`);
	}

	private showProgress(progress: WikiProgress): void {
		if (!this.progressContainer || !this.progressBar || !this.progressText) return;
		this.progressContainer.removeClass('askvault-hidden');
		const pct = Math.round((progress.current / progress.total) * 100);
		this.progressBar.style.width = `${pct}%`;
		this.progressText.setText(`${progress.status}: ${progress.fileName} (${progress.current}/${progress.total})`);
	}

	private hideProgress(): void {
		if (!this.progressContainer) return;
		this.progressContainer.addClass('askvault-hidden');
	}

	private async runIngest(): Promise<void> {
		try {
			await this.plugin.wikiService.ingest((progress) => this.showProgress(progress));
		} catch (error) {
			console.error('Ingest error:', error);
		} finally {
			this.hideProgress();
			await this.refreshStats();
			await this.loadActivity();
		}
	}

	private async runUpdate(): Promise<void> {
		try {
			await this.plugin.wikiService.manualUpdate((progress) => this.showProgress(progress));
		} catch (error) {
			console.error('Update error:', error);
		} finally {
			this.hideProgress();
			await this.refreshStats();
			await this.loadActivity();
		}
	}

	private async runLint(): Promise<void> {
		try {
			const issues = await this.plugin.wikiService.lint();
			this.renderLintResults(issues);
		} catch (error) {
			console.error('Lint error:', error);
		}
		await this.loadActivity();
	}

	private renderLintResults(issues: LintIssue[]): void {
		if (!this.lintResultsEl) return;
		this.lintResultsEl.empty();

		if (issues.length === 0) {
			this.lintResultsEl.createDiv({ text: 'No issues found.', cls: 'askvault-wiki-lint-clean' });
			return;
		}

		for (const issue of issues) {
			const issueEl = this.lintResultsEl.createDiv({ cls: 'askvault-wiki-lint-issue' });
			const typeLabel = issue.type.replace(/_/g, ' ');
			issueEl.createSpan({ text: `[${typeLabel}] `, cls: 'askvault-wiki-lint-type' });
			issueEl.createSpan({ text: issue.description });
			if (issue.page) {
				issueEl.createDiv({ text: `Page: ${issue.page}`, cls: 'askvault-wiki-lint-page' });
			}
			if (issue.suggestedFix) {
				issueEl.createDiv({ text: `Fix: ${issue.suggestedFix}`, cls: 'askvault-wiki-lint-fix' });
			}
		}
	}

	private async openIndex(): Promise<void> {
		const wikiFolder = this.plugin.settings.wikiFolder || 'wiki';
		const indexPath = `${wikiFolder}/index.md`;
		const file = this.app.vault.getAbstractFileByPath(indexPath);
		if (file) {
			await this.app.workspace.openLinkText(indexPath, '', false, { active: true });
		}
	}

	private async loadActivity(): Promise<void> {
		if (!this.activityEl) return;
		this.activityEl.empty();

		const wikiFolder = this.plugin.settings.wikiFolder || 'wiki';
		const logPath = `${wikiFolder}/log.md`;
		const file = this.app.vault.getAbstractFileByPath(logPath);

		if (!file) {
			this.activityEl.createDiv({ text: 'No activity yet.', cls: 'askvault-wiki-no-activity' });
			return;
		}

		const content = await this.app.vault.read(file as any);
		const entries = content.split('\n## ').slice(1).reverse().slice(0, 10);

		for (const entry of entries) {
			const firstLine = entry.split('\n')[0];
			const actItem = this.activityEl.createDiv({ cls: 'askvault-wiki-activity-item' });
			actItem.setText(firstLine);
		}
	}

	async onClose() {
		// No cleanup needed
	}
}
