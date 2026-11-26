import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_PATH = path.join(__dirname, 'knowledge.json');

export function loadKnowledge() {
  try {
    const raw = fs.readFileSync(KB_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveKnowledge(items) {
  fs.writeFileSync(KB_PATH, JSON.stringify(items, null, 2));
}

// Very simple retrieval: score by keyword overlap
export function retrieveRelevant(text, limit = 5) {
  const kb = loadKnowledge();
  const qTokens = tokenize(text);
  const scored = kb.map((item) => ({ item, score: overlap(qTokens, tokenize(item.text || '')) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, limit).map(s => s.item);
}

function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function overlap(aTokens, bTokens) {
  const a = new Set(aTokens);
  let c = 0;
  for (const t of bTokens) if (a.has(t)) c++;
  return c;
}

