import { Vault, TFile } from 'obsidian';
import { AskVaultSettings } from './Settings';

interface VectorDocument {
	path: string;
	content: string;
	summary: string;
	embedding: number[];
	hash: string;
}

export class VectorService {
	private vault: Vault;
	private settings: AskVaultSettings;
	private documents: VectorDocument[] = [];

	constructor(vault: Vault, settings: AskVaultSettings) {
		this.vault = vault;
		this.settings = settings;
	}

	/**
	 * Add a document to the vector database
	 */
	async addDocument(path: string, content: string, summary: string, hash: string): Promise<void> {
		// Generate embedding for the summary
		const embedding = await this.generateEmbedding(summary);

		// Remove existing document with same path if exists
		this.documents = this.documents.filter(doc => doc.path !== path);

		// Add new document
		this.documents.push({
			path,
			content,
			summary,
			embedding,
			hash
		});
	}

	/**
	 * Check if a document exists and has the same hash
	 */
	hasDocumentWithHash(path: string, hash: string): boolean {
		const doc = this.documents.find(doc => doc.path === path);
		return doc !== undefined && doc.hash === hash;
	}

	/**
	 * Search for similar documents using cosine similarity
	 */
	async search(query: string, topK: number = 3): Promise<Array<{ path: string; content: string; score: number }>> {
		if (this.documents.length === 0) {
			return [];
		}

		// Generate embedding for query
		const queryEmbedding = await this.generateEmbedding(query);

		// Calculate similarity scores
		const results = this.documents.map(doc => ({
			path: doc.path,
			content: doc.content,
			score: this.cosineSimilarity(queryEmbedding, doc.embedding)
		}));

		// Sort by score (descending) and return top K
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, topK);
	}

	/**
	 * Generate embedding using OpenAI API or fallback to simple hash-based method
	 */
	private async generateEmbedding(text: string): Promise<number[]> {
		// Try to use OpenAI embeddings if API key is available and provider is OpenAI
		if (this.settings.provider === 'openai' && this.settings.apiKey) {
			try {
				return await this.generateOpenAIEmbedding(text);
			} catch (error) {
				console.warn('Failed to generate OpenAI embedding, falling back to simple method:', error);
			}
		}

		// Fallback to simple hash-based embedding
		return this.generateSimpleEmbedding(text);
	}

	/**
	 * Generate embedding using OpenAI API
	 */
	private async generateOpenAIEmbedding(text: string): Promise<number[]> {
		const endpoint = this.settings.openaiEndpoint || 'https://api.openai.com/v1';
		
		const response = await fetch(`${endpoint}/embeddings`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: 'text-embedding-3-small', // Using smaller, cheaper model
				input: text.substring(0, 8000) // Limit input size
			})
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.statusText}`);
		}

		const data = await response.json();
		return data.data[0].embedding;
	}

	/**
	 * Generate a simple embedding using TF-IDF-like approach
	 */
	private generateSimpleEmbedding(text: string): number[] {
		// Simple bag-of-words embedding (300 dimensions)
		const words = text.toLowerCase().split(/\s+/);
		const embedding = new Array(300).fill(0);
		
		// Simple hash-based embedding with better distribution
		for (const word of words) {
			const hash = this.hashCode(word);
			// Use multiple hash functions to improve distribution
			for (let i = 0; i < 5; i++) {
				const index = Math.abs(hash + i * 997) % 300;
				embedding[index] += 1;
			}
		}

		// Normalize the embedding
		const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
		if (magnitude > 0) {
			for (let i = 0; i < embedding.length; i++) {
				embedding[i] /= magnitude;
			}
		}

		return embedding;
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error('Vectors must have the same length');
		}

		let dotProduct = 0;
		let magnitudeA = 0;
		let magnitudeB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			magnitudeA += a[i] * a[i];
			magnitudeB += b[i] * b[i];
		}

		magnitudeA = Math.sqrt(magnitudeA);
		magnitudeB = Math.sqrt(magnitudeB);

		if (magnitudeA === 0 || magnitudeB === 0) {
			return 0;
		}

		return dotProduct / (magnitudeA * magnitudeB);
	}

	/**
	 * Simple hash function for strings
	 */
	private hashCode(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return hash;
	}

	/**
	 * Get total number of indexed documents
	 */
	getDocumentCount(): number {
		return this.documents.length;
	}

	/**
	 * Save indexed documents to storage
	 */
	async save(): Promise<any> {
		return {
			documents: this.documents,
			version: '1.0',
			timestamp: Date.now()
		};
	}

	/**
	 * Load indexed documents from storage
	 */
	async load(data: any): Promise<void> {
		if (data && data.documents && Array.isArray(data.documents)) {
			this.documents = data.documents;
			console.log(`Loaded ${this.documents.length} indexed documents from storage`);
		}
	}

	/**
	 * Clear all documents from the database
	 */
	async clear(): Promise<void> {
		this.documents = [];
	}

	/**
	 * Clean up resources
	 */
	async cleanup(): Promise<void> {
		// Save before cleanup
		await this.clear();
	}
}
