import { AskVaultSettings } from './Settings';

export class LLMService {
	private settings: AskVaultSettings;

	constructor(settings: AskVaultSettings) {
		this.settings = settings;
	}

	/**
	 * Summarize a document using LLM
	 */
	async summarize(content: string): Promise<string> {
		// Limit content to avoid token limits
		const maxChars = 100000;
		const truncatedContent = content.length > maxChars 
			? content.substring(0, maxChars) + '...' 
			: content;

		const prompt = `Please summarize the following document in 500 words or less:\n\n${truncatedContent}`;

		try {
			return await this.callLLM(prompt, 600);
		} catch (error) {
			console.error('Error summarizing content:', error);
			// Fallback to simple truncation if LLM fails
			return truncatedContent.substring(0, 500) + '...';
		}
	}

	/**
	 * Chat with the LLM using provided context and chat history
	 */
	async chat(question: string, context: string, chatHistory: Array<{role: string, content: string}> = []): Promise<string> {
		return await this.callLLMWithHistory(question, context, chatHistory, 1000);
	}

	/**
	 * Chat with streaming support - calls onChunk for each text chunk
	 */
	async chatStream(
		question: string, 
		context: string, 
		chatHistory: Array<{role: string, content: string}> = [],
		onChunk: (chunk: string) => void
	): Promise<string> {
		if (!this.settings.apiKey) {
			throw new Error('API key not configured. Please set it in settings.');
		}

		if (this.settings.provider === 'openai') {
			return await this.callOpenAIStreamWithHistory(question, context, chatHistory, onChunk);
		} else if (this.settings.provider === 'claude') {
			return await this.callClaudeStreamWithHistory(question, context, chatHistory, onChunk);
		} else {
			throw new Error('Invalid LLM provider');
		}
	}

	/**
	 * Call the LLM API with chat history support
	 */
	private async callLLMWithHistory(
		question: string, 
		context: string, 
		chatHistory: Array<{role: string, content: string}>,
		maxTokens: number = 500
	): Promise<string> {
		if (!this.settings.apiKey) {
			throw new Error('API key not configured. Please set it in settings.');
		}

		if (this.settings.provider === 'openai') {
			return await this.callOpenAIWithHistory(question, context, chatHistory, maxTokens);
		} else if (this.settings.provider === 'claude') {
			return await this.callClaudeWithHistory(question, context, chatHistory, maxTokens);
		} else {
			throw new Error('Invalid LLM provider');
		}
	}

	/**
	 * Call the LLM API (OpenAI or Claude)
	 */
	private async callLLM(prompt: string, maxTokens: number = 500): Promise<string> {
		if (!this.settings.apiKey) {
			throw new Error('API key not configured. Please set it in settings.');
		}

		if (this.settings.provider === 'openai') {
			return await this.callOpenAI(prompt, maxTokens);
		} else if (this.settings.provider === 'claude') {
			return await this.callClaude(prompt, maxTokens);
		} else {
			throw new Error('Invalid LLM provider');
		}
	}

	/**
	 * Call OpenAI API with streaming support
	 */
	private async callOpenAIStreamWithHistory(
		question: string,
		context: string,
		chatHistory: Array<{role: string, content: string}>,
		onChunk: (chunk: string) => void
	): Promise<string> {
		const endpoint = this.settings.openaiEndpoint || 'https://api.openai.com/v1';
		const model = this.settings.model === 'custom' 
			? this.settings.customModel 
			: (this.settings.model || 'gpt-3.5-turbo');

		if (!model) {
			throw new Error('Model name is required. Please configure a custom model name in settings.');
		}

		// Build messages array
		const messages: any[] = [
			{
				role: 'system',
				content: `You are a helpful assistant answering questions about the user's Obsidian vault.\n\nContext from relevant documents:\n${context}\n\nPlease provide helpful and accurate answers based on the context and conversation history. If the context doesn't contain enough information to answer the question, please say so.`
			}
		];

		// Add chat history
		for (const msg of chatHistory) {
			messages.push({
				role: msg.role,
				content: msg.content
			});
		}

		// Add current question
		messages.push({
			role: 'user',
			content: question
		});

		const response = await fetch(`${endpoint}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: model,
				messages: messages,
				max_tokens: 1000,
				temperature: 0.7,
				stream: true
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI API error: ${error}`);
		}

		if (!response.body) {
			throw new Error('Response body is null');
		}

		// Read the stream
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let fullText = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				const lines = chunk.split('\n');

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						if (data === '[DONE]') continue;

						try {
							const parsed = JSON.parse(data);
							const content = parsed.choices?.[0]?.delta?.content;
							if (content) {
								fullText += content;
								onChunk(content);
							}
						} catch (e) {
							// Skip invalid JSON
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		return fullText;
	}

	/**
	 * Call OpenAI API with chat history
	 */
	private async callOpenAIWithHistory(
		question: string,
		context: string,
		chatHistory: Array<{role: string, content: string}>,
		maxTokens: number
	): Promise<string> {
		const endpoint = this.settings.openaiEndpoint || 'https://api.openai.com/v1';
		const model = this.settings.model === 'custom' 
			? this.settings.customModel 
			: (this.settings.model || 'gpt-3.5-turbo');

		if (!model) {
			throw new Error('Model name is required. Please configure a custom model name in settings.');
		}

		// Build messages array with system message, history, and current question
		const messages: any[] = [
			{
				role: 'system',
				content: `You are a helpful assistant answering questions about the user's Obsidian vault.\n\nContext from relevant documents:\n${context}\n\nPlease provide helpful and accurate answers based on the context and conversation history. If the context doesn't contain enough information to answer the question, please say so.`
			}
		];

		// Add chat history
		for (const msg of chatHistory) {
			messages.push({
				role: msg.role,
				content: msg.content
			});
		}

		// Add current question
		messages.push({
			role: 'user',
			content: question
		});

		const response = await fetch(`${endpoint}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: model,
				messages: messages,
				max_tokens: maxTokens,
				temperature: 0.7
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI API error: ${error}`);
		}

		const data = await response.json();
		return data.choices[0].message.content;
	}

	/**
	 * Call OpenAI API
	 */
	private async callOpenAI(prompt: string, maxTokens: number): Promise<string> {
		const endpoint = this.settings.openaiEndpoint || 'https://api.openai.com/v1';
		const model = this.settings.model === 'custom' 
			? this.settings.customModel 
			: (this.settings.model || 'gpt-3.5-turbo');

		if (!model) {
			throw new Error('Model name is required. Please configure a custom model name in settings.');
		}

		const response = await fetch(`${endpoint}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: model,
				messages: [
					{
						role: 'user',
						content: prompt
					}
				],
				max_tokens: maxTokens,
				temperature: 0.7
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI API error: ${error}`);
		}

		const data = await response.json();
		return data.choices[0].message.content;
	}

	/**
	 * Call Claude API with streaming support
	 */
	private async callClaudeStreamWithHistory(
		question: string,
		context: string,
		chatHistory: Array<{role: string, content: string}>,
		onChunk: (chunk: string) => void
	): Promise<string> {
		const endpoint = this.settings.claudeEndpoint || 'https://api.anthropic.com/v1';
		const model = this.settings.model === 'custom' 
			? this.settings.customModel 
			: (this.settings.model || 'claude-3-sonnet-20240229');

		if (!model) {
			throw new Error('Model name is required. Please configure a custom model name in settings.');
		}

		// Build messages array
		const messages: any[] = [];

		// Add chat history
		for (const msg of chatHistory) {
			messages.push({
				role: msg.role,
				content: msg.content
			});
		}

		// Add current question
		messages.push({
			role: 'user',
			content: question
		});

		const systemPrompt = `You are a helpful assistant answering questions about the user's Obsidian vault.\n\nContext from relevant documents:\n${context}\n\nPlease provide helpful and accurate answers based on the context and conversation history. If the context doesn't contain enough information to answer the question, please say so.`;

		const response = await fetch(`${endpoint}/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.settings.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: model,
				max_tokens: 1000,
				system: systemPrompt,
				messages: messages,
				stream: true
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Claude API error: ${error}`);
		}

		if (!response.body) {
			throw new Error('Response body is null');
		}

		// Read the stream
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let fullText = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				const lines = chunk.split('\n');

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);

						try {
							const parsed = JSON.parse(data);
							
							// Handle content_block_delta events
							if (parsed.type === 'content_block_delta') {
								const content = parsed.delta?.text;
								if (content) {
									fullText += content;
									onChunk(content);
								}
							}
						} catch (e) {
							// Skip invalid JSON
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		return fullText;
	}

	/**
	 * Call Claude API with chat history
	 */
	private async callClaudeWithHistory(
		question: string,
		context: string,
		chatHistory: Array<{role: string, content: string}>,
		maxTokens: number
	): Promise<string> {
		const endpoint = this.settings.claudeEndpoint || 'https://api.anthropic.com/v1';
		const model = this.settings.model === 'custom' 
			? this.settings.customModel 
			: (this.settings.model || 'claude-3-sonnet-20240229');

		if (!model) {
			throw new Error('Model name is required. Please configure a custom model name in settings.');
		}

		// Build messages array with history and current question
		const messages: any[] = [];

		// Add chat history
		for (const msg of chatHistory) {
			messages.push({
				role: msg.role,
				content: msg.content
			});
		}

		// Add current question
		messages.push({
			role: 'user',
			content: question
		});

		const systemPrompt = `You are a helpful assistant answering questions about the user's Obsidian vault.\n\nContext from relevant documents:\n${context}\n\nPlease provide helpful and accurate answers based on the context and conversation history. If the context doesn't contain enough information to answer the question, please say so.`;

		const response = await fetch(`${endpoint}/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.settings.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: model,
				max_tokens: maxTokens,
				system: systemPrompt,
				messages: messages
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Claude API error: ${error}`);
		}

		const data = await response.json();
		return data.content[0].text;
	}

	/**
	 * Call Claude API
	 */
	private async callClaude(prompt: string, maxTokens: number): Promise<string> {
		const endpoint = this.settings.claudeEndpoint || 'https://api.anthropic.com/v1';
		const model = this.settings.model === 'custom' 
			? this.settings.customModel 
			: (this.settings.model || 'claude-3-sonnet-20240229');

		if (!model) {
			throw new Error('Model name is required. Please configure a custom model name in settings.');
		}

		const response = await fetch(`${endpoint}/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.settings.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: model,
				max_tokens: maxTokens,
				messages: [
					{
						role: 'user',
						content: prompt
					}
				]
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Claude API error: ${error}`);
		}

		const data = await response.json();
		return data.content[0].text;
	}
}
