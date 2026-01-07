import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
	fs.mkdirSync(outputDir, { recursive: true });
}

// Copy manifest.json
fs.copyFileSync(
	path.join(__dirname, 'manifest.json'),
	path.join(outputDir, 'manifest.json')
);

// Copy styles.css
fs.copyFileSync(
	path.join(__dirname, 'styles.css'),
	path.join(outputDir, 'styles.css')
);

console.log('Files copied to output directory successfully!');
