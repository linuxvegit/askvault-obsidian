import { ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import AskVaultPlugin from '../main';

export const VIEW_TYPE_CHAT = 'askvault-view';

interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

interface ChatThread {
	id: string;
	name: string;
	history: ChatMessage[];
	createdAt: number;
	updatedAt: number;
}

export class ChatView extends ItemView {
	plugin: AskVaultPlugin;
	private chatContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private messageInput: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private messagesContainer: HTMLElement;
	private progressContainer: HTMLElement | null = null;
	private progressBar: HTMLElement | null = null;
	private progressText: HTMLElement | null = null;
	private cancelButton: HTMLButtonElement | null = null;
	private threadsContainer: HTMLElement | null = null;
	private threadsList: HTMLElement | null = null;
	private threads: ChatThread[] = [];
	private currentThreadId: string | null = null;
	private showThreads: boolean = false;
	private headerTitle: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AskVaultPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		const currentThread = this.getCurrentThread();
		if (currentThread) {
			return `Ask Vault - ${currentThread.name}`;
		}
		return 'Ask Vault';
	}

	getIcon(): string {
		return 'message-square';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('askvault-container');

		// Create header
		const header = container.createDiv({ cls: 'askvault-header' });
		this.headerTitle = header.createEl('h4', { text: 'Ask Vault' });

		const headerButtons = header.createDiv({ cls: 'askvault-header-buttons' });

		// Create copy thread button
		const copyThreadButton = headerButtons.createEl('button', { 
			text: '📋 Copy',
			cls: 'askvault-copy-thread-button'
		});
		copyThreadButton.onclick = () => {
			this.copyThreadContent();
		};

		// Create threads button
		const threadsButton = headerButtons.createEl('button', { 
			text: 'Threads',
			cls: 'askvault-threads-button'
		});
		threadsButton.onclick = () => {
			this.toggleThreads();
		};

		// Create index button
		const indexButton = headerButtons.createEl('button', { 
			text: 'Index Vault',
			cls: 'askvault-index-button'
		});
		indexButton.onclick = async () => {
			this.startIndexing();
		};

		// Create threads container (initially hidden)
		this.threadsContainer = container.createDiv({ cls: 'askvault-threads-container askvault-threads-hidden' });
		
		const threadsHeader = this.threadsContainer.createDiv({ cls: 'askvault-threads-header' });
		threadsHeader.createEl('h5', { text: 'Chat Threads' });
		
		const newThreadButton = threadsHeader.createEl('button', {
			text: '+ New',
			cls: 'askvault-new-thread-button'
		});
		newThreadButton.onclick = async () => {
			await this.createNewThread();
		};

		this.threadsList = this.threadsContainer.createDiv({ cls: 'askvault-threads-list' });

		// Create messages container
		this.messagesContainer = container.createDiv({ cls: 'askvault-messages' });

		// Create input container
		this.inputContainer = container.createDiv({ cls: 'askvault-input-container' });

		// Create text input
		this.messageInput = this.inputContainer.createEl('textarea', {
			cls: 'askvault-input',
			attr: {
				placeholder: 'Ask a question about your vault...',
				rows: '3'
			}
		});

		this.messageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		// Create send button
		this.sendButton = this.inputContainer.createEl('button', {
			text: 'Send',
			cls: 'askvault-send-button'
		});

		this.sendButton.onclick = () => this.sendMessage();

		// Load threads from plugin data
		await this.loadThreads();
		
		// Render threads list
		this.renderThreadsList();

		// Add welcome message
		const docCount = this.plugin.vectorService.getDocumentCount();
		if (docCount > 0) {
			this.addSystemMessage(`Welcome to Aks Vault! ${docCount} documents loaded from previous index. Ask me anything about your vault.`);
		} else {
			this.addSystemMessage('Welcome to Aks Vault! Click "Index Vault" to get started, then ask me anything about your vault.');
		}
	}

	async sendMessage() {
		const message = this.messageInput.value.trim();
		if (!message) return;

		// Check if we have a valid thread
		const currentThread = this.getCurrentThread();
		if (!currentThread) {
			this.addSystemMessage('No active thread. Please create a new thread first.');
			return;
		}

		// Add user message to chat
		this.addUserMessage(message);

		// Auto-rename thread if it's the first message and has default name
		const isFirstMessage = currentThread.history.length === 0;
		const hasDefaultName = /^Chat \d+$/.test(currentThread.name);
		if (isFirstMessage && hasDefaultName) {
			// Use first 50 characters of the message as thread name
			const newName = message.length > 50 ? message.substring(0, 47) + '...' : message;
			currentThread.name = newName;
			this.updateTitle();
			this.renderThreadsList();
		}

		// Clear input
		this.messageInput.value = '';

		// Disable input while processing
		this.messageInput.disabled = true;
		this.sendButton.disabled = true;

		// Add loading message
		const loadingMessage = this.addLoadingMessage();

		try {
			// Search vector database for relevant documents
			const relevantDocs = await this.plugin.vectorService.search(message, 3);

			if (relevantDocs.length === 0) {
				this.removeLoadingMessage(loadingMessage);
				this.addAssistantMessage("I couldn't find any relevant information in your vault. Try indexing your files first.");
				return;
			}

			// Prepare context from relevant documents
			let context = 'Relevant documents:\n\n';
			for (const doc of relevantDocs) {
				context += `File: ${doc.path}\n${doc.content}\n\n---\n\n`;
			}

			// Get current thread's history
			const chatHistory = currentThread.history;

			// Get response from LLM with chat history
			const response = await this.plugin.llmService.chat(message, context, chatHistory);

			// Add messages to chat history (without sources in text)
			currentThread.history.push({ role: 'user', content: message });
			currentThread.history.push({ role: 'assistant', content: response });
			currentThread.updatedAt = Date.now();
			await this.saveThreads();

			// Remove loading message and add actual response with sources
			this.removeLoadingMessage(loadingMessage);
			this.addAssistantMessage(response, relevantDocs);

		} catch (error) {
			console.error('Error sending message:', error);
			this.removeLoadingMessage(loadingMessage);
			this.addSystemMessage('Error: ' + error.message);
		} finally {
			// Re-enable input
			this.messageInput.disabled = false;
			this.sendButton.disabled = false;
			this.messageInput.focus();
		}
	}

	addUserMessage(text: string) {
		const messageDiv = this.messagesContainer.createDiv({ cls: 'askvault-message askvault-user-message' });
		messageDiv.createDiv({ cls: 'askvault-message-label', text: 'You' });
		messageDiv.createDiv({ cls: 'askvault-message-text', text });
		this.scrollToBottom();
	}

	addAssistantMessage(text: string, sources?: Array<{path: string, content: string}>) {
		const messageDiv = this.messagesContainer.createDiv({ cls: 'askvault-message askvault-assistant-message' });
		
		const labelContainer = messageDiv.createDiv({ cls: 'askvault-message-label-container' });
		labelContainer.createDiv({ cls: 'askvault-message-label', text: 'Assistant' });
		
		// Add copy button
		const copyBtn = labelContainer.createEl('button', {
			text: '📋',
			cls: 'askvault-copy-btn',
			attr: { 'aria-label': 'Copy message' }
		});
		copyBtn.onclick = () => {
			this.copyToClipboard(text);
		};
		
		const contentDiv = messageDiv.createDiv({ cls: 'askvault-message-text askvault-markdown-content' });
		
		// Render markdown content with proper source path for link resolution
		MarkdownRenderer.render(this.plugin.app, text, contentDiv, '', this.plugin);
		
		// Add sources section if provided
		if (sources && sources.length > 0) {
			const sourcesDiv = messageDiv.createDiv({ cls: 'askvault-sources-container' });
			
			// Add separator
			sourcesDiv.createEl('hr', { cls: 'askvault-sources-separator' });
			
			// Add "Sources:" label
			const sourcesLabel = sourcesDiv.createEl('div', { 
				text: 'Sources:',
				cls: 'askvault-sources-label'
			});
			
			// Create list of clickable links
			const sourcesList = sourcesDiv.createEl('ul', { cls: 'askvault-sources-list' });
			
			for (const doc of sources) {
				const listItem = sourcesList.createEl('li');
				const link = listItem.createEl('a', {
					text: doc.path.replace(/\.md$/, ''),
					cls: 'askvault-source-link internal-link'
				});
				
				// Add click handler to open the file
				link.onclick = async (e) => {
					e.preventDefault();
					try {
						// Try to open using openLinkText (handles various path formats)
						await this.app.workspace.openLinkText(
							doc.path.replace(/\.md$/, ''),
							'',
							false,
							{ active: true }
						);
					} catch (error) {
						console.error('Failed to open file:', doc.path, error);
					}
				};
			}
		}
		
		this.scrollToBottom();
	}

	addSystemMessage(text: string) {
		const messageDiv = this.messagesContainer.createDiv({ cls: 'askvault-message askvault-system-message' });
		messageDiv.createDiv({ cls: 'askvault-message-text', text });
		this.scrollToBottom();
	}

	addLoadingMessage(): HTMLElement {
		const messageDiv = this.messagesContainer.createDiv({ cls: 'askvault-message askvault-assistant-message askvault-loading-message' });
		messageDiv.createDiv({ cls: 'askvault-message-label', text: 'Assistant' });
		const contentDiv = messageDiv.createDiv({ cls: 'askvault-message-text' });
		
		// Create loading animation
		const loadingDots = contentDiv.createDiv({ cls: 'askvault-loading-dots' });
		loadingDots.createSpan({ cls: 'askvault-loading-dot' });
		loadingDots.createSpan({ cls: 'askvault-loading-dot' });
		loadingDots.createSpan({ cls: 'askvault-loading-dot' });
		
		this.scrollToBottom();
		return messageDiv;
	}

	removeLoadingMessage(element: HTMLElement) {
		if (element && element.parentNode) {
			element.remove();
		}
	}

	scrollToBottom() {
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	copyToClipboard(text: string) {
		navigator.clipboard.writeText(text).then(() => {
			// Show success message
			const notice = document.body.createDiv({ cls: 'askvault-copy-notice' });
			notice.setText('✓ Copied to clipboard');
			setTimeout(() => notice.remove(), 2000);
		}).catch(err => {
			console.error('Failed to copy:', err);
		});
	}

	copyThreadContent() {
		const currentThread = this.getCurrentThread();
		if (!currentThread) return;
		
		let content = `# ${currentThread.name}\n\n`;
		
		for (const msg of currentThread.history) {
			if (msg.role === 'user') {
				content += `**You:** ${msg.content}\n\n`;
			} else {
				content += `**Assistant:** ${msg.content}\n\n`;
			}
			content += '---\n\n';
		}
		
		this.copyToClipboard(content);
	}

	clearChat() {
		const currentThread = this.getCurrentThread();
		if (currentThread) {
			currentThread.history = [];
			currentThread.updatedAt = Date.now();
			this.saveThreads();
		}
		this.messagesContainer.empty();
		this.addSystemMessage('Chat history cleared. Ask me anything about your vault.');
		
		// Ensure input is enabled and focused
		if (this.messageInput) {
			this.messageInput.disabled = false;
			this.messageInput.removeAttribute('disabled');
			this.messageInput.focus();
		}
		if (this.sendButton) {
			this.sendButton.disabled = false;
			this.sendButton.removeAttribute('disabled');
		}
	}

	getCurrentThread(): ChatThread | null {
		if (!this.currentThreadId) return null;
		return this.threads.find(t => t.id === this.currentThreadId) || null;
	}

	updateTitle() {
		const currentThread = this.getCurrentThread();
		if (this.headerTitle) {
			if (currentThread) {
				this.headerTitle.setText(`Ask Vault - ${currentThread.name}`);
			} else {
				this.headerTitle.setText('Ask Vault');
			}
		}
	}

	showConfirmDialog(message: string, onConfirm: () => void) {
		// Create overlay
		const overlay = document.body.createDiv({ cls: 'askvault-confirm-overlay' });
		
		// Create dialog
		const dialog = overlay.createDiv({ cls: 'askvault-confirm-dialog' });
		
		// Message
		dialog.createDiv({ cls: 'askvault-confirm-message', text: message });
		
		// Buttons container
		const buttonsDiv = dialog.createDiv({ cls: 'askvault-confirm-buttons' });
		
		const cancelBtn = buttonsDiv.createEl('button', {
			text: 'Cancel',
			cls: 'askvault-confirm-btn askvault-confirm-cancel'
		});
		
		const confirmBtn = buttonsDiv.createEl('button', {
			text: 'Delete',
			cls: 'askvault-confirm-btn askvault-confirm-delete'
		});
		
		// Close dialog function
		const closeDialog = () => {
			overlay.remove();
		};
		
		cancelBtn.onclick = closeDialog;
		
		confirmBtn.onclick = () => {
			onConfirm();
			closeDialog();
		};
		
		// Close on overlay click
		overlay.onclick = (e) => {
			if (e.target === overlay) {
				closeDialog();
			}
		};
		
		// Close on ESC key
		const escHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeDialog();
				document.removeEventListener('keydown', escHandler);
			}
		};
		document.addEventListener('keydown', escHandler);
	}

	showInputDialog(message: string, defaultValue: string, onConfirm: (value: string) => void) {
		// Create overlay
		const overlay = document.body.createDiv({ cls: 'askvault-confirm-overlay' });
		
		// Create dialog
		const dialog = overlay.createDiv({ cls: 'askvault-confirm-dialog' });
		
		// Message
		dialog.createDiv({ cls: 'askvault-confirm-message', text: message });
		
		// Input
		const input = dialog.createEl('input', {
			cls: 'askvault-confirm-input',
			type: 'text',
			value: defaultValue
		});
		
		// Buttons container
		const buttonsDiv = dialog.createDiv({ cls: 'askvault-confirm-buttons' });
		
		const cancelBtn = buttonsDiv.createEl('button', {
			text: 'Cancel',
			cls: 'askvault-confirm-btn askvault-confirm-cancel'
		});
		
		const confirmBtn = buttonsDiv.createEl('button', {
			text: 'OK',
			cls: 'askvault-confirm-btn askvault-confirm-ok'
		});
		
		// Close dialog function
		const closeDialog = () => {
			overlay.remove();
		};
		
		const handleConfirm = () => {
			const value = input.value.trim();
			if (value) {
				onConfirm(value);
				closeDialog();
			}
		};
		
		cancelBtn.onclick = closeDialog;
		confirmBtn.onclick = handleConfirm;
		
		// Handle Enter key in input
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				handleConfirm();
			}
		});
		
		// Close on overlay click
		overlay.onclick = (e) => {
			if (e.target === overlay) {
				closeDialog();
			}
		};
		
		// Close on ESC key
		const escHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeDialog();
				document.removeEventListener('keydown', escHandler);
			}
		};
		document.addEventListener('keydown', escHandler);
		
		// Focus input
		setTimeout(() => input.focus(), 100);
	}

	async loadThreads() {
		const data = await this.plugin.loadData();
		if (data && data.threads) {
			this.threads = data.threads;
		}
		
		// Create default thread if none exists
		if (this.threads.length === 0) {
			this.createNewThread();
		} else {
			// Load the most recently updated thread
			const sorted = [...this.threads].sort((a, b) => b.updatedAt - a.updatedAt);
			this.switchToThread(sorted[0].id);
		}
	}

	async saveThreads() {
		const data = await this.plugin.loadData() || {};
		data.threads = this.threads;
		await this.plugin.saveData(data);
	}

	async createNewThread() {
		const now = Date.now();
		const newThread: ChatThread = {
			id: `thread-${now}`,
			name: `Chat ${this.threads.length + 1}`,
			history: [],
			createdAt: now,
			updatedAt: now
		};
		
		this.threads.push(newThread);
		this.switchToThread(newThread.id);
		await this.saveThreads();
		this.renderThreadsList();
		this.updateTitle();
	}

	switchToThread(threadId: string) {
		this.currentThreadId = threadId;
		
		const thread = this.getCurrentThread();
		
		if (!thread) {
			console.error('Thread not found:', threadId);
			return;
		}
		
		// Clear and reload messages
		this.messagesContainer.empty();
		
		// Restore messages from thread history
		for (const msg of thread.history) {
			if (msg.role === 'user') {
				this.addUserMessage(msg.content);
			} else {
				this.addAssistantMessage(msg.content);
			}
		}
		
		// Update active state in UI
		this.renderThreadsList();
		
		// Update title
		this.updateTitle();
		
		// Ensure input is enabled and focusable
		if (this.messageInput) {
			this.messageInput.disabled = false;
			this.messageInput.removeAttribute('disabled');
			this.messageInput.removeAttribute('readonly');
			setTimeout(() => {
				if (this.messageInput) {
					this.messageInput.focus();
				}
			}, 100);
		}
		if (this.sendButton) {
			this.sendButton.disabled = false;
			this.sendButton.removeAttribute('disabled');
		}
	}

	async deleteThread(threadId: string) {
		this.threads = this.threads.filter(t => t.id !== threadId);
		
		// If deleting current thread, switch to another
		if (this.currentThreadId === threadId) {
			if (this.threads.length > 0) {
				this.switchToThread(this.threads[0].id);
			} else {
				await this.createNewThread();
			}
		}
		
		await this.saveThreads();
		this.renderThreadsList();
	}

	async renameThread(threadId: string, newName: string) {
		const thread = this.threads.find(t => t.id === threadId);
		if (thread) {
			thread.name = newName;
			thread.updatedAt = Date.now();
			await this.saveThreads();
			this.renderThreadsList();
			this.updateTitle();
		}
	}

	toggleThreads() {
		this.showThreads = !this.showThreads;
		if (this.threadsContainer) {
			if (this.showThreads) {
				this.threadsContainer.removeClass('askvault-threads-hidden');
			} else {
				this.threadsContainer.addClass('askvault-threads-hidden');
			}
		}
	}

	renderThreadsList() {
		if (!this.threadsList) return;
		
		this.threadsList.empty();
		
		// Sort threads by update time
		const sortedThreads = [...this.threads].sort((a, b) => b.updatedAt - a.updatedAt);
		
		for (const thread of sortedThreads) {
			const threadItem = this.threadsList.createDiv({ 
				cls: `askvault-thread-item ${thread.id === this.currentThreadId ? 'active' : ''}` 
			});
			
			const threadInfo = threadItem.createDiv({ cls: 'askvault-thread-info' });
			threadInfo.onclick = () => {
				this.switchToThread(thread.id);
			};
			
			threadInfo.createDiv({ cls: 'askvault-thread-name', text: thread.name });
			
			const time = new Date(thread.updatedAt);
			const timeStr = time.toLocaleString();
			threadInfo.createDiv({ cls: 'askvault-thread-time', text: timeStr });
			
			const threadActions = threadItem.createDiv({ cls: 'askvault-thread-actions' });
			
			const renameBtn = threadActions.createEl('button', { 
				text: '✏️',
				cls: 'askvault-thread-action-btn',
				attr: { 'aria-label': 'Rename' }
			});
			renameBtn.onclick = async (e) => {
				e.stopPropagation();
				this.showInputDialog('Enter new name:', thread.name, async (newName) => {
					await this.renameThread(thread.id, newName);
				});
			};
			
			const deleteBtn = threadActions.createEl('button', { 
				text: '🗑️',
				cls: 'askvault-thread-action-btn',
				attr: { 'aria-label': 'Delete' }
			});
			deleteBtn.onclick = async (e) => {
				e.stopPropagation();
				this.showConfirmDialog(`Delete thread "${thread.name}"?`, async () => {
					await this.deleteThread(thread.id);
				});
			};
		}
	}

	async startIndexing() {
		// Create progress container
		this.progressContainer = this.messagesContainer.createDiv({ cls: 'askvault-progress-container' });
		
		const progressHeader = this.progressContainer.createDiv({ cls: 'askvault-progress-header' });
		progressHeader.createEl('span', { text: 'Indexing Vault', cls: 'askvault-progress-title' });
		
		this.cancelButton = progressHeader.createEl('button', { 
			text: 'Cancel',
			cls: 'askvault-cancel-button'
		});
		this.cancelButton.onclick = () => {
			this.plugin.cancelIndexing();
			if (this.cancelButton) {
				this.cancelButton.disabled = true;
				this.cancelButton.setText('Cancelling...');
			}
		};

		const progressBarContainer = this.progressContainer.createDiv({ cls: 'askvault-progress-bar-container' });
		this.progressBar = progressBarContainer.createDiv({ cls: 'askvault-progress-bar' });
		this.progressBar.style.width = '0%';
		
		this.progressText = this.progressContainer.createDiv({ cls: 'askvault-progress-text' });
		this.progressText.setText('Starting...');

		this.scrollToBottom();

		// Start indexing with progress callback
		const startTime = Date.now();
		await this.plugin.indexVaultFiles((current, total, fileName) => {
			const percentage = Math.round((current / total) * 100);
			if (this.progressBar) {
				this.progressBar.style.width = `${percentage}%`;
			}
			if (this.progressText) {
				const elapsed = Math.round((Date.now() - startTime) / 1000);
				this.progressText.setText(`${current}/${total} - ${fileName} (${elapsed}s)`);
			}
		});

		// Clean up progress UI
		if (this.progressContainer) {
			this.progressContainer.remove();
			this.progressContainer = null;
			this.progressBar = null;
			this.progressText = null;
			this.cancelButton = null;
		}

		const totalDocs = this.plugin.vectorService.getDocumentCount();
		this.addSystemMessage(`Vault indexing complete! ${totalDocs} documents indexed.`);
	}

	async onClose() {
		// Clean up
	}
}
