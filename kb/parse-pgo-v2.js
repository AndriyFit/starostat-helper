/**
 * Парсер погосподарських книг XPS → Supabase
 * v3: Supabase REST API замість Neon Postgres
 */
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const VAULT_KEY = '0pYJRSvF3w0HcDB3Bx38jGvoFukUS20pfYsNhW2nS_s';
const BOOKS_DIR = path.join(__dirname, 'pgo-books');

let SUPA_URL, SUPA_KEY;

async function getVaultSecret(key) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8400/api/secrets/${key}`, {
      headers: { 'X-API-Key': VAULT_KEY },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(JSON.parse(data).value));
    }).on('error', reject);
  });
}

function supabasePost(table, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(`${SUPA_URL}/rest/v1/${table}`);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${body}`));
        resolve(JSON.parse(body));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function supabaseDelete(table) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPA_URL}/rest/v1/${table}?id=gt.0`);
    const req = https.request(url, {
      method: 'DELETE',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.end();
  });
}

// ========== XPS PARSING (unchanged logic) ==========

function extractTexts(zip, pageNum) {
  try {
    const xml = zip.readAsText(`Documents/1/Pages/${pageNum}.fpage`);
    const matches = xml.match(/UnicodeString="([^"]+)"/g);
    if (!matches) return [];
    return matches.map(m => {
      let t = m.match(/UnicodeString="([^"]+)"/)[1];
      return t.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
    });
  } catch { return []; }
}

function getPageCount(zip) {
  return zip.getEntries().filter(e => e.entryName.match(/Documents\/1\/Pages\/\d+\.fpage$/)).length;
}

function extractCaseNum(texts) {
  for (const t of texts) {
    const m = t.match(/(\d{2})\s*-\s*(\d{4})/);
    if (m) return m[1] + '-' + m[2];
  }
  return null;
}

function extractNames(texts) {
  const NOISE = new Set([
    'Відмітка', 'Адреса', 'Місце', 'Прізвище', 'Стать', 'Число', 'Родинні',
    'Наявність', 'Загальна', 'Житлова', 'Кількість', 'Хутрові', 'Кролі',
    'Додаткова', 'Матеріал', 'Площа', 'Домогосподарство', 'Інвалід',
    'Пенсіонер', 'Запов', 'Спеціальні', 'Відомості', 'Інформація',
    'Розділ', 'Примітка', 'Реєстрації', 'Підпис', 'Землеволодіння',
    'Закинутий', 'Птиця', 'Свині', 'Коні', 'Вівці', 'Кози',
    'Попереднє', 'Нюються', 'Нено', 'Маються',
  ]);
  const namePattern = /^[А-ЯІЇЄҐ][а-яіїєґ']+$/;
  return texts.map(t => t.trim()).filter(t => namePattern.test(t) && t.length > 2 && !NOISE.has(t));
}

function extractAddress(texts) {
  const fullText = texts.join(' ');
  const fullMatch = fullText.match(/вул\.\s*([А-ЯІЇЄҐа-яіїєґ'.А-Яа-я\s-]+?)(?:,\s*буд\.\s*(\d+))?(?:\s|$)/);
  if (fullMatch) {
    const street = 'вул. ' + fullMatch[1].trim();
    const house = fullMatch[2] ? ', буд. ' + fullMatch[2] : '';
    return street + house;
  }
  for (const t of texts) {
    const m = t.match(/(вул\.\s*[А-ЯІЇЄҐа-яіїєґ'.\s-]+(?:,\s*буд\.\s*\d+)?)/);
    if (m) return m[1].trim();
  }
  return null;
}

function extractDates(texts) {
  return texts.filter(t => /^\d{2}\.\d{2}\.\d{4}$/.test(t.trim()));
}

function extractRelations(texts) {
  const rels = [];
  const relPatterns = ['голова', 'дружина', 'чоловік', 'син', 'дочка', 'донька',
    'мати', 'батько', 'зять', 'невістка', 'онук', 'онука', 'теща', 'тесть',
    'свекруха', 'свекор', 'бабуся', 'дідусь', 'брат', 'сестра', 'інший'];
  for (const t of texts) {
    const lower = t.toLowerCase().trim();
    for (const rel of relPatterns) {
      if (lower === rel || lower.startsWith(rel + ' ')) { rels.push(rel); break; }
    }
  }
  return rels;
}

function extractLandInfo(texts) {
  const landParts = [];
  for (const t of texts) {
    if (t.match(/\d+[.,]\d{4}/) || t.match(/га$/i)) landParts.push(t.trim());
    if (t.match(/присадибн|селянськ|город|сіножат|пасовищ|рілля|паї/i)) landParts.push(t.trim());
  }
  return landParts.join('; ');
}

function extractProperty(texts) {
  const props = [];
  const propPatterns = ['ВРХ', 'свині', 'кролі', 'вівці', 'кози', 'коні', 'птиця',
    'бджоли', 'хутрові', 'будинок', 'гараж', 'сарай', 'погріб'];
  for (const t of texts) {
    for (const p of propPatterns) {
      if (t.toLowerCase().includes(p.toLowerCase())) { props.push(t.trim()); break; }
    }
  }
  return props;
}

function isPatronymic(w) {
  return /(?:вна|вич|ович|івна|ївна|овна|ївни)$/i.test(w);
}

function isRelation(w) {
  const rels = ['голова', 'дружина', 'чоловік', 'син', 'дочка', 'донька',
    'мати', 'батько', 'зять', 'невістка', 'онук', 'онука', 'теща', 'тесть',
    'свекруха', 'свекор', 'бабуся', 'дідусь', 'брат', 'сестра'];
  return rels.includes(w.toLowerCase().trim());
}

function isDate(w) {
  return /^\d{2}\.\d{2}\.\d{4}$/.test(w.trim());
}

const NAME_PATTERN = /^[А-ЯІЇЄҐ][а-яіїєґ']+$/;
const NOISE_SET = new Set([
  'Відмітка', 'Адреса', 'Місце', 'Прізвище', 'Стать', 'Число', 'Родинні',
  'Наявність', 'Загальна', 'Житлова', 'Кількість', 'Хутрові', 'Кролі',
  'Додаткова', 'Матеріал', 'Площа', 'Домогосподарство', 'Інвалід',
  'Пенсіонер', 'Запов', 'Спеціальні', 'Відомості', 'Інформація',
  'Розділ', 'Примітка', 'Реєстрації', 'Підпис', 'Землеволодіння',
  'Закинутий', 'Птиця', 'Свині', 'Коні', 'Вівці', 'Кози',
  'Попереднє', 'Нюються', 'Нено', 'Маються', 'Помер',
]);

function isNameWord(w) {
  const t = w.trim();
  return NAME_PATTERN.test(t) && t.length > 2 && !NOISE_SET.has(t) && !isRelation(t);
}

/**
 * Extract structured family members from raw XPS texts in order.
 *
 * XPS structure per household (across 4-5 pages):
 *   [Прізвище] [По-батькові] [dd.mm.yyyy]  ← голова
 *   [Прізвище] [Ім'я]                       ← ???
 *   [relation] [Ім'я] [По-батькові] [dd.mm.yyyy]  ← член сім'ї
 *   [Прізвище] [relation] [Ім'я] [По-батькові] [dd.mm.yyyy]
 *
 * Strategy: build a stream of typed tokens, then assemble persons.
 */
function extractMembers(allTexts) {
  // Step 1: Tokenize the stream
  const tokens = [];
  for (const raw of allTexts) {
    const t = raw.trim();
    if (!t || t.length < 2) continue;
    if (isDate(t)) { tokens.push({ type: 'date', value: t }); continue; }
    if (isRelation(t)) { tokens.push({ type: 'rel', value: t.toLowerCase() }); continue; }
    if (isNameWord(t)) {
      if (isPatronymic(t)) {
        tokens.push({ type: 'patronymic', value: t });
      } else {
        tokens.push({ type: 'name', value: t });
      }
      continue;
    }
  }

  // Step 2: Detect owner surname from first name token
  let ownerSurname = null;
  for (const tk of tokens) {
    if (tk.type === 'name') { ownerSurname = tk.value; break; }
  }

  // Step 3: Assemble persons by scanning tokens
  // A person = [surname?] [first_name?] [patronymic?] + [date?]
  // Boundaries: relation word, repeated owner surname, date after patronymic
  const members = [];
  let nameParts = [];
  let relation = null;
  let date = null;

  function flush() {
    if (nameParts.length === 0 && !date) return;

    let fullName;
    if (nameParts.length >= 3) {
      fullName = nameParts.slice(0, 3).join(' ');
    } else if (nameParts.length === 2) {
      fullName = nameParts.join(' ');
    } else if (nameParts.length === 1) {
      fullName = nameParts[0];
    } else {
      return;
    }

    const birthYear = date ? parseInt(date.split('.')[2]) : null;
    const rel = members.length === 0 ? 'голова' : (relation || null);
    members.push({ full_name: fullName, birth_year: birthYear, relation: rel });
    nameParts = [];
    relation = null;
    date = null;
  }

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];

    if (tk.type === 'rel') {
      flush();
      relation = tk.value;
      continue;
    }

    if (tk.type === 'date') {
      date = tk.value;
      // If we have no name parts but have a pending person (just flushed),
      // attach date to last member
      if (nameParts.length === 0 && members.length > 0 && !members[members.length - 1].birth_year) {
        members[members.length - 1].birth_year = parseInt(date.split('.')[2]);
        date = null;
      } else {
        flush();
      }
      continue;
    }

    if (tk.type === 'name') {
      // Owner surname appearing again = new person boundary
      if (ownerSurname && tk.value === ownerSurname && nameParts.length > 0) {
        flush();
      }
      // Already have 3+ name parts = start new person
      if (nameParts.length >= 3) {
        flush();
      }
      nameParts.push(tk.value);
      continue;
    }

    if (tk.type === 'patronymic') {
      // If no name parts yet, this patronymic belongs to previous person
      // (pattern: [Прізвище] [date?] [По-батькові] — surname + patronymic = one person)
      if (nameParts.length === 0 && members.length > 0) {
        const last = members[members.length - 1];
        if (last.full_name.split(' ').length <= 2) {
          // Append patronymic to last member
          last.full_name += ' ' + tk.value;
          continue;
        }
      }

      nameParts.push(tk.value);
      // Patronymic completes a name — peek ahead for date
      const next = tokens[i + 1];
      if (next && next.type === 'date') {
        date = next.value;
        i++; // consume date
      }
      flush();
      continue;
    }
  }

  flush();

  // Post-process: merge single-word entries into proper names
  // If a member has only surname = ownerSurname, it's likely just a repeat — remove
  const cleaned = members.filter(m => {
    if (m.full_name === ownerSurname && !m.birth_year && m.relation === null) return false;
    return true;
  });

  return cleaned;
}

function parseFileName(fileName) {
  const bookMatch = fileName.match(/Книга ПГО\s*-\s*(\d+)/);
  const villageMatch = fileName.match(/\(с\.\s*([^)]+)\)/);
  return {
    bookNum: bookMatch ? parseInt(bookMatch[1]) : null,
    village: villageMatch ? villageMatch[1].trim() : null,
    isAlphabet: fileName.includes('Алфавітна'),
  };
}

async function processBook(filePath) {
  const fileName = path.basename(filePath);
  const meta = parseFileName(fileName);
  if (meta.isAlphabet || !meta.bookNum) return [];

  const zip = new AdmZip(filePath);
  const pageCount = getPageCount(zip);
  const casePages = new Map();
  let lastCase = null;

  for (let p = 1; p <= pageCount; p++) {
    const texts = extractTexts(zip, p);
    const caseNum = extractCaseNum(texts);
    const currentCase = caseNum || lastCase;
    if (!currentCase) continue;
    if (!casePages.has(currentCase)) casePages.set(currentCase, []);
    casePages.get(currentCase).push({ pageNum: p, texts });
    lastCase = currentCase;
  }

  console.log(`  📄 ${fileName}: ${pageCount} стор., ${casePages.size} справ`);

  const results = [];
  for (const [caseNum, pages] of casePages) {
    const allTexts = pages.flatMap(p => p.texts);
    const allContent = allTexts.filter(t => t.trim().length > 1).join(' ');
    const members = extractMembers(allTexts);
    const address = extractAddress(allTexts);
    const landInfo = extractLandInfo(allTexts);
    const properties = extractProperty(allTexts);
    const ownerName = members.length > 0 ? members[0].full_name : null;
    const [bookPart, casePart] = caseNum.split('-');

    results.push({
      bookNum: meta.bookNum,
      caseNum: parseInt(casePart),
      village: meta.village,
      ownerName: ownerName || null,
      address: address ? `с. ${meta.village}, ${address}` : null,
      members,
      landInfo,
      properties,
      content: allContent,
    });
  }
  return results;
}

async function main() {
  SUPA_URL = await getVaultSecret('starostat/supabase_url');
  SUPA_KEY = await getVaultSecret('starostat/supabase_secret_key');

  // Очищаємо в правильному порядку (FK constraints)
  console.log('Очищаю старі дані...');
  for (const table of ['household_search', 'property', 'land_plots', 'household_members', 'households']) {
    await supabaseDelete(table);
  }
  console.log('Готово.\n');

  const files = fs.readdirSync(BOOKS_DIR).filter(f => f.endsWith('.xps'));
  console.log(`Знайдено ${files.length} XPS файлів\n`);

  let totalHouseholds = 0;
  let totalMembers = 0;

  for (const file of files.sort()) {
    const filePath = path.join(BOOKS_DIR, file);
    try {
      const households = await processBook(filePath);

      for (const h of households) {
        const [inserted] = await supabasePost('households', {
          book_num: h.bookNum,
          case_num: h.caseNum,
          owner_name: h.ownerName || 'Не розпізнано',
          address: h.address,
          village: h.village,
        });
        const hId = inserted.id;

        for (const m of h.members) {
          await supabasePost('household_members', { household_id: hId, ...m });
          totalMembers++;
        }

        if (h.landInfo) {
          await supabasePost('land_plots', { household_id: hId, plot_type: 'загальна', notes: h.landInfo });
        }

        for (const prop of h.properties) {
          await supabasePost('property', { household_id: hId, property_type: prop, description: prop });
        }

        await supabasePost('household_search', { household_id: hId, content: h.content });
        totalHouseholds++;
      }

      if (households.length > 0) {
        const withNames = households.filter(h => h.ownerName).length;
        const withMembers = households.reduce((s, h) => s + h.members.length, 0);
        console.log(`    → ${households.length} справ (${withNames} з ПІБ, ${withMembers} членів)\n`);
      }
    } catch (e) {
      console.error(`  ❌ ${file}: ${e.message}`);
    }
  }

  console.log(`\n✅ Завершено! Домогосподарств: ${totalHouseholds}, Членів: ${totalMembers}`);
}

main().catch(e => console.error(e));
