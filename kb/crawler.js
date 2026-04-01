const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, 'docs');
const CRAWL_STATE = path.join(__dirname, 'index', 'crawl-state.json');
const BASE_URL = 'https://zhovtanetska-gromada.gov.ua';

// Delay between requests (be nice to the server)
const DELAY_MS = 1500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getCrawlState() {
  if (fs.existsSync(CRAWL_STATE)) {
    return JSON.parse(fs.readFileSync(CRAWL_STATE, 'utf-8'));
  }
  return { crawled: {}, lastFullCrawl: null };
}

function saveCrawlState(state) {
  fs.writeFileSync(CRAWL_STATE, JSON.stringify(state, null, 2));
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ZhovtanetskaBot/1.0 (community knowledge base)' },
      redirect: 'follow',
      timeout: 15000,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.error(`  Помилка: ${url} — ${err.message}`);
    return null;
  }
}

function extractContent(html, url) {
  const $ = cheerio.load(html);

  // Remove scripts, styles, navigation, footer
  $('script, style, nav, footer, header, .breadcrumbs, .sidebar, .menu, .navigation').remove();

  // Get page title
  const title = $('h1').first().text().trim()
    || $('title').text().trim().replace(' | Жовтанецька громада', '')
    || '';

  // Get main content area
  let content = '';
  const mainSelectors = ['.page-content', '.content', '.article-content', 'article', '.main-content', 'main', '.field-item'];
  for (const sel of mainSelectors) {
    if ($(sel).length) {
      content = $(sel).first().text().trim();
      break;
    }
  }

  // Fallback: get body text
  if (!content) {
    content = $('body').text().trim();
  }

  // Clean up whitespace
  content = content
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Extract all links on page
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.startsWith('/') && !href.startsWith('//')) {
      links.push(BASE_URL + href);
    } else if (href && href.startsWith(BASE_URL)) {
      links.push(href);
    }
  });

  // Extract tables
  const tables = [];
  $('table').each((_, table) => {
    const rows = [];
    $(table).find('tr').each((_, tr) => {
      const cells = [];
      $(tr).find('td, th').each((_, cell) => {
        cells.push($(cell).text().trim());
      });
      if (cells.length) rows.push(cells.join(' | '));
    });
    if (rows.length) tables.push(rows.join('\n'));
  });

  // Extract documents/files links
  const files = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar)$/i)) {
      files.push({ name: $(el).text().trim(), url: href });
    }
  });

  return { title, content, links: [...new Set(links)], tables, files };
}

function categorize(url, title) {
  const u = url.toLowerCase();
  const t = (title || '').toLowerCase();

  if (u.includes('news/') || u.includes('/news')) return 'news';
  if (u.includes('cnap') || u.includes('poslugi')) return 'services';
  if (u.includes('docs/') || u.includes('regulyatorn')) return 'regulations';
  if (u.includes('bjudzhet') || u.includes('ekonomik') || u.includes('openbudget')) return 'budget';
  if (u.includes('osvita') || u.includes('education')) return 'education';
  if (u.includes('ohorona-zdorov') || u.includes('medich')) return 'healthcare';
  if (u.includes('kulturi') || u.includes('sport')) return 'culture';
  if (u.includes('deputat') || u.includes('vikonavch') || u.includes('komisii') || u.includes('komisiy')) return 'structure';
  if (u.includes('strategiy') || u.includes('plan-social')) return 'strategy';
  if (u.includes('vpo') || u.includes('pereselenni')) return 'idp';
  if (u.includes('civilnij-zahist') || u.includes('pozhezhna')) return 'emergency';
  if (u.includes('zvernennya') || u.includes('feedback') || u.includes('petitions')) return 'appeals';
  if (u.includes('kontakti') || u.includes('grafik') || u.includes('struktura')) return 'contacts';
  if (t.includes('вакансі')) return 'vacancies';
  return 'info';
}

function generateTags(title, content, category) {
  const tags = [category];
  const text = `${title} ${content}`.toLowerCase().substring(0, 2000);

  const tagMap = {
    'цнап': 'ЦНАП', 'послуг': 'послуги', 'реєстрац': 'реєстрація',
    'бюджет': 'бюджет', 'депутат': 'депутати', 'виконавч': 'виконком',
    'освіт': 'освіта', 'медич': 'медицина', 'здоров': 'здоров\'я',
    'культур': 'культура', 'спорт': 'спорт', 'земел': 'земля',
    'будівництв': 'будівництво', 'містобудівн': 'містобудування',
    'вакансі': 'вакансії', 'конкурс': 'конкурс', 'тендер': 'тендер',
    'стратегі': 'стратегія', 'впо': 'ВПО', 'переселен': 'переселенці',
    'соціальн': 'соціальне', 'захист': 'захист', 'дітей': 'діти',
    'молод': 'молодь', 'ветеран': 'ветерани', 'пожеж': 'пожежна',
    'поліц': 'поліція', 'комунальн': 'комунальне', 'відход': 'відходи',
    'правнич': 'правова допомога', 'нотаріальн': 'нотаріус',
    'шлюб': 'шлюб', 'народжен': 'народження', 'смерт': 'смерть',
  };

  for (const [key, tag] of Object.entries(tagMap)) {
    if (text.includes(key)) tags.push(tag);
  }

  return [...new Set(tags)];
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\wа-яіїєґ]/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

function saveDoc(url, extracted, category) {
  const id = `crawl-${slugify(extracted.title || 'page')}-${Date.now().toString(36)}`;
  const truncatedContent = extracted.content.substring(0, 10000);

  const doc = {
    id,
    category,
    tags: generateTags(extracted.title, extracted.content, category),
    title: extracted.title || url.split('/').filter(Boolean).pop(),
    content: truncatedContent,
    metadata: {
      source: url,
      date: new Date().toISOString().split('T')[0],
      updated: new Date().toISOString().split('T')[0],
      files: extracted.files.length > 0 ? extracted.files : undefined,
      tables: extracted.tables.length > 0 ? extracted.tables.length + ' tables' : undefined,
    },
  };

  // Don't save empty pages
  if (doc.content.length < 50) return null;

  const filename = `${category}-${slugify(extracted.title || 'page')}.json`;
  const filepath = path.join(DOCS_DIR, filename);

  // Don't overwrite manually created docs
  if (fs.existsSync(filepath)) {
    const existing = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    if (!existing.id.startsWith('crawl-')) return existing.id;
  }

  fs.writeFileSync(filepath, JSON.stringify(doc, null, 2));
  return doc.id;
}

// ============ MAIN CRAWLER ============

async function crawl(urls, maxPages = 200) {
  const state = getCrawlState();
  const queue = [...urls];
  const visited = new Set(Object.keys(state.crawled));
  let crawled = 0;
  let saved = 0;

  console.log(`\n🕷️  Краулер Жовтанецької громади`);
  console.log(`   Сторінок у черзі: ${queue.length}`);
  console.log(`   Вже відвідано: ${visited.size}`);
  console.log(`   Ліміт: ${maxPages}\n`);

  while (queue.length > 0 && crawled < maxPages) {
    const url = queue.shift();

    // Normalize URL
    const normalizedUrl = url.replace(/\/$/, '');
    if (visited.has(normalizedUrl)) continue;

    // Skip external, media, search
    if (!normalizedUrl.startsWith(BASE_URL)) continue;
    if (normalizedUrl.match(/\.(jpg|png|gif|pdf|doc|mp4|mp3)$/i)) continue;
    if (normalizedUrl.includes('/search')) continue;

    visited.add(normalizedUrl);
    crawled++;

    process.stdout.write(`[${crawled}/${maxPages}] ${normalizedUrl.substring(BASE_URL.length)} ... `);

    const html = await fetchPage(normalizedUrl);
    if (!html) {
      console.log('❌');
      state.crawled[normalizedUrl] = { status: 'error', date: new Date().toISOString() };
      await sleep(DELAY_MS);
      continue;
    }

    const extracted = extractContent(html, normalizedUrl);
    const category = categorize(normalizedUrl, extracted.title);
    const docId = saveDoc(normalizedUrl, extracted, category);

    if (docId) {
      saved++;
      console.log(`✅ [${category}] ${(extracted.title || '').substring(0, 50)}`);
    } else {
      console.log('⏭️  (пусто)');
    }

    state.crawled[normalizedUrl] = {
      status: docId ? 'saved' : 'empty',
      title: extracted.title,
      category,
      date: new Date().toISOString(),
    };

    // Add discovered links to queue
    for (const link of extracted.links) {
      const norm = link.replace(/\/$/, '');
      if (!visited.has(norm) && norm.startsWith(BASE_URL)) {
        queue.push(norm);
      }
    }

    await sleep(DELAY_MS);
  }

  state.lastFullCrawl = new Date().toISOString();
  saveCrawlState(state);

  console.log(`\n✅ Завершено: ${crawled} сторінок відвідано, ${saved} документів збережено`);
  return { crawled, saved };
}

// ============ CLI ============

const cmd = process.argv[2];

switch (cmd) {
  case 'full':
    // Full crawl from all known URLs
    const allUrls = [
      `${BASE_URL}/`,
      `${BASE_URL}/news/`,
      `${BASE_URL}/cnap-12-57-19-06-11-2020/`,
      `${BASE_URL}/poslugi-cnapu-16-27-28-23-02-2021/`,
      `${BASE_URL}/poslugi-cnapu-u-starostinskih-okrugah-14-41-00-24-02-2021/`,
      `${BASE_URL}/deputatskij-korpus-15-36-44-12-04-2024/`,
      `${BASE_URL}/vikonavchij-komitet-15-42-11-12-04-2024/`,
      `${BASE_URL}/ekonomika-gromadi-15-18-23-29-05-2017/`,
      `${BASE_URL}/osvita-11-30-40-20-04-2017/`,
      `${BASE_URL}/ohorona-zdorovya-10-40-20-22-09-2017/`,
      `${BASE_URL}/sektor-kulturi-molodi-ta-sportu-22-30-27-03-04-2017/`,
      `${BASE_URL}/civilnij-zahist-10-32-00-01-03-2021/`,
      `${BASE_URL}/informaciya-dlya-vpo-15-29-02-01-12-2025/`,
      `${BASE_URL}/strategiya-rozvitku-zhovtaneckoi-otg-na-period-do-2027-roku-15-20-26-15-05-2020/`,
      `${BASE_URL}/kontakti-ta-rozporyadok-dnya-12-21-34-27-03-2026/`,
      `${BASE_URL}/struktura-12-20-12-27-03-2026/`,
      `${BASE_URL}/pro-organ-12-18-11-27-03-2026/`,
      `${BASE_URL}/dostup-do-publichnoi-informacii-20-10-57-03-04-2017/`,
      `${BASE_URL}/zvernennya-gromadyan-09-36-38-11-07-2017/`,
      `${BASE_URL}/telefoni-pershoi-neobhidnosti-12-30-08-01-10-2021/`,
      `${BASE_URL}/bezoplatna-pravnicha-dopomoga-10-40-55-30-05-2024/`,
      `${BASE_URL}/sluzhba-u-spravah-ditej-11-13-01-27-01-2022/`,
      `${BASE_URL}/policejskij-oficer-zhovtaneckoi-tg-17-47-13-12-04-2021/`,
      `${BASE_URL}/protidiya-domashnomu-nasilstvu-16-07-00-16-11-2023/`,
      `${BASE_URL}/kp-gospodar-09-33-47-27-06-2018/`,
      `${BASE_URL}/upravlinnya-vidhodami-15-35-13-01-12-2025/`,
      `${BASE_URL}/medichni-poslugi-yaki-nadajutsya-v-knp-cpmsd-zhovtaneckoi-silskoi-radi-15-40-04-16-02-2021/`,
      `${BASE_URL}/grafik-roboti-zakladiv-ohoroni-zdorov'ya-zhovtaneckoi-silskoi-radi-14-37-45-24-06-2021/`,
      `${BASE_URL}/mistobudivna-dokumentaciya-10-32-46-23-10-2024/`,
      `${BASE_URL}/dopomoga-zsu-11-51-42-03-06-2025/`,
      `${BASE_URL}/molodizhna-rada-16-54-55-13-12-2023/`,
      `${BASE_URL}/komunalne-majno-11-53-29-30-11-2021/`,
      `${BASE_URL}/vakansii-12-24-15-27-03-2026/`,
      `${BASE_URL}/pochesni-meshkanci-zhovtaneckoi-teritorialnoi-gromadi-14-55-22-15-04-2024/`,
      `${BASE_URL}/istorichni-pamyatki-17-01-01-11-04-2024/`,
      `${BASE_URL}/docs/`,
    ];
    crawl(allUrls, parseInt(process.argv[3]) || 200);
    break;

  case 'page':
    // Crawl single page
    const pageUrl = process.argv[3];
    if (!pageUrl) {
      console.log('Використання: node crawler.js page <url>');
    } else {
      crawl([pageUrl], 1);
    }
    break;

  case 'status':
    const st = getCrawlState();
    const total = Object.keys(st.crawled).length;
    const ok = Object.values(st.crawled).filter(v => v.status === 'saved').length;
    console.log(`Останній повний кроулінг: ${st.lastFullCrawl || 'ніколи'}`);
    console.log(`Всього відвідано: ${total}, збережено: ${ok}`);
    break;

  default:
    console.log('Краулер сайту Жовтанецької громади');
    console.log('');
    console.log('Команди:');
    console.log('  node crawler.js full [limit]  — повний кроулінг сайту');
    console.log('  node crawler.js page <url>    — спарсити одну сторінку');
    console.log('  node crawler.js status        — статус кроулінгу');
}
