const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, 'docs');
const INDEX_PATH = path.join(__dirname, 'index', 'search-index.json');

// ============ INDEX BUILD ============

function loadAllDocs() {
  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(DOCS_DIR, f), 'utf-8');
    return JSON.parse(raw);
  });
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\wа-яіїєґ'ʼ]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function buildIndex() {
  const docs = loadAllDocs();
  const invertedIndex = {};

  for (const doc of docs) {
    const allText = [doc.title, doc.content, ...doc.tags].join(' ');
    const tokens = tokenize(allText);
    const uniqueTokens = [...new Set(tokens)];

    for (const token of uniqueTokens) {
      if (!invertedIndex[token]) invertedIndex[token] = [];
      // Count frequency for ranking
      const freq = tokens.filter(t => t === token).length;
      invertedIndex[token].push({ id: doc.id, freq });
    }
  }

  const index = {
    docs: docs.map(d => ({ id: d.id, title: d.title, category: d.category, tags: d.tags })),
    invertedIndex,
    built: new Date().toISOString(),
  };

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  console.log(`Індекс побудовано: ${docs.length} документів, ${Object.keys(invertedIndex).length} токенів`);
  return index;
}

// ============ SEARCH ============

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.log('Індекс не знайдено, будую...');
    return buildIndex();
  }
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
}

function search(query, options = {}) {
  const index = loadIndex();
  const docs = loadAllDocs();
  const queryTokens = tokenize(query);
  const scores = {};

  for (const token of queryTokens) {
    // Exact match
    if (index.invertedIndex[token]) {
      for (const entry of index.invertedIndex[token]) {
        scores[entry.id] = (scores[entry.id] || 0) + entry.freq * 2;
      }
    }

    // Partial match (prefix)
    for (const indexToken of Object.keys(index.invertedIndex)) {
      if (indexToken.startsWith(token) || token.startsWith(indexToken)) {
        for (const entry of index.invertedIndex[indexToken]) {
          scores[entry.id] = (scores[entry.id] || 0) + entry.freq * 0.5;
        }
      }
    }
  }

  // Boost for tag matches
  for (const doc of docs) {
    for (const tag of doc.tags) {
      const tagLower = tag.toLowerCase();
      for (const qt of queryTokens) {
        if (tagLower.includes(qt) || qt.includes(tagLower)) {
          scores[doc.id] = (scores[doc.id] || 0) + 5;
        }
      }
    }
  }

  // Sort by score
  const results = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, options.limit || 5)
    .map(([id, score]) => {
      const doc = docs.find(d => d.id === id);
      return { ...doc, score };
    });

  return results;
}

function formatResult(doc, verbose = false) {
  let out = `\n📄 ${doc.title} [${doc.category}] (score: ${doc.score.toFixed(1)})\n`;
  out += `   Теги: ${doc.tags.join(', ')}\n`;
  if (verbose) {
    out += `\n${doc.content}\n`;
    out += `\n   Джерело: ${doc.metadata?.source || 'н/д'}\n`;
  }
  return out;
}

// ============ CLI ============

const cmd = process.argv[2];
const arg = process.argv.slice(3).join(' ');

switch (cmd) {
  case 'build':
    buildIndex();
    break;

  case 'find':
  case 'search':
    if (!arg) {
      console.log('Використання: node search.js search "запит"');
      break;
    }
    const results = search(arg);
    if (results.length === 0) {
      console.log('Нічого не знайдено.');
    } else {
      console.log(`\nЗнайдено ${results.length} результатів для "${arg}":\n`);
      results.forEach(r => console.log(formatResult(r, true)));
    }
    break;

  case 'list':
    const allDocs = loadAllDocs();
    console.log(`\nБаза знань: ${allDocs.length} документів\n`);
    const byCategory = {};
    allDocs.forEach(d => {
      if (!byCategory[d.category]) byCategory[d.category] = [];
      byCategory[d.category].push(d);
    });
    for (const [cat, catDocs] of Object.entries(byCategory)) {
      console.log(`\n📁 ${cat.toUpperCase()}:`);
      catDocs.forEach(d => console.log(`   • ${d.title} (${d.tags.length} тегів)`));
    }
    break;

  case 'get':
    if (!arg) {
      console.log('Використання: node search.js get <id>');
      break;
    }
    const allD = loadAllDocs();
    const found = allD.find(d => d.id === arg);
    if (found) {
      console.log(JSON.stringify(found, null, 2));
    } else {
      console.log(`Документ "${arg}" не знайдено.`);
    }
    break;

  case 'api':
    // JSON output for programmatic use (telegram bot, etc)
    if (!arg) {
      console.log(JSON.stringify({ error: 'query required' }));
      break;
    }
    const apiResults = search(arg, { limit: 3 });
    console.log(JSON.stringify(apiResults, null, 2));
    break;

  default:
    console.log('База знань Ременівського старостинського округу');
    console.log('');
    console.log('Команди:');
    console.log('  node search.js build          — побудувати/оновити індекс');
    console.log('  node search.js search "запит"  — пошук в базі знань');
    console.log('  node search.js list            — список всіх документів');
    console.log('  node search.js get <id>        — отримати документ за ID');
    console.log('  node search.js api "запит"     — JSON вивід для API');
}
