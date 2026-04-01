/**
 * RSS/News Monitor for server (without direct access to gromada.org.ua)
 * Strategy: uses SSH tunnel to local PC to fetch RSS,
 * OR receives pushed updates from local RSS monitor
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const DOCS_DIR = path.join(__dirname, 'docs');
const STATE_PATH = path.join(__dirname, 'index', 'rss-state.json');
const TG_CONFIG_PATH = path.join(__dirname, '..', 'vault', 'telegram-config.json');
const PORT = 3457;

function getState() {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  return { seenIds: [], lastCheck: null };
}
function saveState(state) { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); }

function escapeHtml(t) { return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function sendTelegram(text) {
  const config = JSON.parse(fs.readFileSync(TG_CONFIG_PATH, 'utf-8'));
  const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) chunks.push(text.substring(i, i + 4000));
  for (const chunk of chunks) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat_id, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  }
}

function slugify(text) {
  return text.toLowerCase().replace(/[^\wа-яіїєґ]/gi, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').substring(0, 60);
}

function saveToKB(item) {
  const id = `rss-${slugify(item.title || 'news')}-${Date.now().toString(36)}`;
  const doc = {
    id, category: 'news',
    tags: ['новини', 'RSS', 'оновлення'],
    title: item.title || '(без назви)',
    content: item.content || '',
    metadata: { source: item.link, date: item.date || new Date().toISOString().split('T')[0], updated: new Date().toISOString().split('T')[0] },
  };
  if (doc.content.length < 30) return null;
  const filename = `news-rss-${slugify(item.title || 'update')}.json`;
  fs.writeFileSync(path.join(DOCS_DIR, filename), JSON.stringify(doc, null, 2));
  return doc;
}

function rebuildIndex() {
  try {
    const { execSync } = require('child_process');
    execSync('node kb/search.js build', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    console.log('  Індекс оновлено.');
  } catch (e) { console.error('  Index error:', e.message); }
}

// HTTP server to receive pushed updates from local PC
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/push-news') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const items = JSON.parse(body);
        const state = getState();
        let newCount = 0;

        for (const item of items) {
          const itemId = item.guid || item.link || item.title;
          if (state.seenIds.includes(itemId)) continue;

          saveToKB(item);

          let tgText = `📰 <b>Нова публікація</b>\n\n`;
          tgText += `<b>${escapeHtml(item.title)}</b>\n`;
          if (item.date) tgText += `📅 ${item.date}\n`;
          if (item.link) tgText += `🔗 ${item.link}\n\n`;
          tgText += escapeHtml((item.content || '').substring(0, 800));
          await sendTelegram(tgText);

          state.seenIds.push(itemId);
          newCount++;
        }

        state.seenIds = state.seenIds.slice(-500);
        state.lastCheck = new Date().toISOString();
        saveState(state);
        if (newCount > 0) rebuildIndex();

        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, new: newCount }));
        console.log(`[${new Date().toLocaleString('uk-UA')}] Отримано ${items.length} записів, нових: ${newCount}`);
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.url === '/status') {
    const state = getState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ lastCheck: state.lastCheck, seenCount: state.seenIds.length }));
    return;
  }

  res.writeHead(200);
  res.end('RSS Push Receiver OK');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RSS Push Receiver запущено на порту ${PORT}`);
});
