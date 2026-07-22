import { readFile } from 'node:fs/promises';
import { extractPdfText } from '../src/lib/pdf/extract.js';

const path = process.argv[2];
const data = await readFile(path);
const { totalPages, pages } = await extractPdfText(new Uint8Array(data));
console.error(`totalPages=${totalPages}`);
// Tylko pierwsze strony (oferta), nie całe OWU
const n = Math.min(pages.length, Number(process.argv[3] || 4));
for (let i = 0; i < n; i++) {
  console.log(`\n===== STRONA ${i + 1} =====`);
  console.log(pages[i]);
}
