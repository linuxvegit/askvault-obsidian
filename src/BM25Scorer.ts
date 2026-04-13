const K1 = 1.2;
const B = 0.75;
const TOP_K = 5;

export interface IndexEntry {
    path: string;
    text: string;
}

export interface ScoredResult {
    path: string;
    score: number;
}

export class BM25Scorer {
    private entries: ReadonlyArray<IndexEntry> = [];
    private termFreqs: Map<string, number>[] = [];
    private docLengths: number[] = [];
    private avgDocLen: number = 0;
    private docFreqs: Map<string, number> = new Map();
    private totalDocs: number = 0;

    buildIndex(entries: ReadonlyArray<IndexEntry>): void {
        this.entries = entries;
        this.totalDocs = entries.length;
        this.termFreqs = [];
        this.docLengths = [];
        this.docFreqs = new Map();

        let totalLength = 0;

        for (const entry of entries) {
            const tokens = this.tokenize(entry.text);
            const tf: Map<string, number> = new Map();

            for (const token of tokens) {
                tf.set(token, (tf.get(token) ?? 0) + 1);
            }

            this.termFreqs.push(tf);
            this.docLengths.push(tokens.length);
            totalLength += tokens.length;

            const seen = Array.from(new Set(tokens));
            for (const term of seen) {
                this.docFreqs.set(term, (this.docFreqs.get(term) ?? 0) + 1);
            }
        }

        this.avgDocLen = this.totalDocs > 0 ? totalLength / this.totalDocs : 0;
    }

    score(query: string): ScoredResult[] {
        const queryTokens = this.tokenize(query);
        if (queryTokens.length === 0) return [];

        const results: ScoredResult[] = [];

        for (let i = 0; i < this.totalDocs; i++) {
            const tf = this.termFreqs[i];
            const docLen = this.docLengths[i];
            let docScore = 0;

            for (const term of queryTokens) {
                const termFreq = tf.get(term) ?? 0;
                if (termFreq === 0) continue;

                const df = this.docFreqs.get(term) ?? 0;
                const idf = Math.log((this.totalDocs - df + 0.5) / (df + 0.5) + 1);
                const numerator = termFreq * (K1 + 1);
                const denominator = termFreq + K1 * (1 - B + B * (docLen / this.avgDocLen));

                docScore += idf * (numerator / denominator);
            }

            if (docScore > 0) {
                results.push({ path: this.entries[i].path, score: docScore });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, TOP_K);
    }

    private tokenize(text: string): string[] {
        return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 0);
    }
}
