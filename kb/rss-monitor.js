const RSSParser = require('rss-parser');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const RSS_URL = 'https://gromada.org.ua/rss/5948/';
const STATE_PATH = path.join(__dirname, 'index', 'rss-state.json');
const DOCS_DIR = path.join(__dirname, 'docs');
const TG_CONFIG_PATH = path.join(__dirname, '..', 'vault', 'telegram-config.json');
const SERVER_PUSH_URL = 'http://185.218.125.37:3457/push-news';

const parser = new RSSParser();

// ============ State ============

function getState() {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  }
  return { seenIds: [], lastCheck: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ============ Telegram ============

async function sendTelegram(text) {
  const config = JSON.parse(fs.readFileSync(TG_CONFIG_PATH, 'utf-8'));
  const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.substring(i, i + 4000));
  }
  for (const chunk of chunks) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chat_id,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============ Fetch & Parse Page ============

async function fetchPageContent(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ZhovtanetskaBot/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header').remove();

    const mainSelectors = ['.page-content', '.content', '.article-content', 'article', 'main'];
    for (const sel of mainSelectors) {
      if ($(sel).length) {
        return $(sel).first().text().trim()
          .replace(/\t/g, ' ')
          .replace(/ {2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
    }
    return $('body').text().trim().substring(0, 5000);
  } catch (err) {
    return '';
  }
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^\wа-яіїєґ]/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

function saveToKB(item, content) {
  const id = `rss-${slugify(item.title || 'news')}-${Date.now().toString(36)}`;
  const doc = {
    id,
    category: 'news',
    tags: ['новини', 'RSS', 'оновлення'],
    title: item.title || '(без назви)',
    content: content || item.contentSnippet || item.content || '',
    metadata: {
      source: item.link,
      date: item.isoDate ? item.isoDate.split('T')[0] : new Date().toISOString().split('T')[0],
      updated: new Date().toISOString().split('T')[0],
      author: item.creator || item.author || '',
    },
  };

  if (doc.content.length < 30) return null;

  const filename = `news-rss-${slugify(item.title || 'update')}.json`;
  fs.writeFileSync(path.join(DOCS_DIR, filename), JSON.stringify(doc, null, 2));
  return doc;
}

// ============ Main ============

async function checkRSS() {
  const state = getState();

  console.log(`[${new Date().toLocaleString('uk-UA')}] Перевіряю RSS...`);

  let feed;
  try {
    // Fetch RSS manually to handle encoding issues
    const res = await fetch(RSS_URL, {
      headers: { 'User-Agent': 'ZhovtanetskaBot/1.0' },
    });
    const xml = await res.text();
    feed = await parser.parseString(xml);
  } catch (err) {
    // Try alternate fetch
    try {
      feed = await parser.parseURL(RSS_URL);
    } catch (err2) {
      console.error('Помилка RSS:', err2.message);
      return;
    }
  }

  console.log(`  Назва: ${feed.title}`);
  console.log(`  Записів у фіді: ${feed.items.length}`);

  const newItems = feed.items.filter(item => {
    const itemId = item.guid || item.link || item.title;
    return !state.seenIds.includes(itemId);
  });

  if (newItems.length === 0) {
    console.log('  Нових записів немає.');
    state.lastCheck = new Date().toISOString();
    saveState(state);
    return;
  }

  console.log(`  Нових записів: ${newItems.length}`);

  for (const item of newItems) {
    const itemId = item.guid || item.link || item.title;

    // Fetch full content
    let fullContent = '';
    if (item.link) {
      fullContent = await fetchPageContent(item.link);
    }

    // Save to KB
    const doc = saveToKB(item, fullContent);

    // Send Telegram notification
    const date = item.pubDate ? new Date(item.pubDate).toLocaleString('uk-UA') : '';
    let tgText = `📰 <b>Нова публікація на сайті громади</b>\n\n`;
    tgText += `<b>${escapeHtml(item.title || '')}</b>\n`;
    if (date) tgText += `📅 ${date}\n`;
    if (item.link) tgText += `🔗 ${item.link}\n`;
    tgText += `\n`;

    const snippet = (fullContent || item.contentSnippet || '').substring(0, 800);
    if (snippet) {
      tgText += escapeHtml(snippet);
      if (snippet.length >= 800) tgText += '\n\n... (читати далі на сайті)';
    }

    await sendTelegram(tgText);
    console.log(`  ✅ ${(item.title || '').substring(0, 60)}`);

    state.seenIds.push(itemId);
  }

  // Push to server
  try {
    const pushData = newItems.map(item => ({
      title: item.title,
      link: item.link,
      guid: item.guid,
      date: item.isoDate || item.pubDate || '',
      content: item.contentSnippet || '',
    }));
    await fetch(SERVER_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushData),
    });
    console.log('  Pushed to server.');
  } catch (e) {
    console.log('  Server push failed:', e.message);
  }

  // Keep last 500 IDs
  state.seenIds = state.seenIds.slice(-500);
  state.lastCheck = new Date().toISOString();
  saveState(state);

  // Rebuild search index
  console.log('  Оновлюю пошуковий індекс...');
  try {
    const { execSync } = require('child_process');
    execSync('node kb/search.js build', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    console.log('  Індекс оновлено.');
  } catch (e) {
    console.error('  Помилка оновлення індексу:', e.message);
  }
}

// ============ Run ============

const INTERVAL = process.argv.includes('--once') ? 0 : 30 * 60 * 1000; // 30 min

checkRSS().catch(err => {
  console.error('Критична помилка:', err.message);
});

if (INTERVAL > 0) {
  console.log(`RSS монітор запущено (кожні 30 хв)...\n`);
  setInterval(() => {
    checkRSS().catch(err => console.error('Помилка:', err.message));
  }, INTERVAL);
}
