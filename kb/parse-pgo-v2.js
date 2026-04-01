/**
 * Покращений парсер погосподарських книг XPS → Neon Postgres
 * v2: точне розбиття по домогосподарствах за номером справи,
 * витягування ПІБ, членів, адреси, землі, майна
 */
const AdmZip = require('adm-zip');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const neonConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vault', 'neon-config.json'), 'utf-8'));
const pool = new Pool({ connectionString: neonConfig.database_url });

const BOOKS_DIR = path.join(__dirname, 'pgo-books');

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

// Витягнути номер справи з текстів сторінки
function extractCaseNum(texts) {
  for (const t of texts) {
    const m = t.match(/(\d{2})\s*-\s*(\d{4})/);
    if (m) return m[1] + '-' + m[2];
  }
  return null;
}

// Витягнути ПІБ (Прізвище Ім'я По-батькові)
function extractNames(texts) {
  // Слова-шаблони з форми, які НЕ є іменами
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
  const names = texts
    .map(t => t.trim())
    .filter(t => namePattern.test(t) && t.length > 2 && !NOISE.has(t));
  return names;
}

// Витягнути адресу
function extractAddress(texts) {
  let street = null, house = null;
  const fullText = texts.join(' ');
  // Шукаємо вулицю + будинок у об'єднаному тексті
  const fullMatch = fullText.match(/вул\.\s*([А-ЯІЇЄҐа-яіїєґ'.А-Яа-я\s-]+?)(?:,\s*буд\.\s*(\d+))?(?:\s|$)/);
  if (fullMatch) {
    street = 'вул. ' + fullMatch[1].trim();
    house = fullMatch[2] ? ', буд. ' + fullMatch[2] : '';
    return street + house;
  }
  // Окремо по текстах
  for (const t of texts) {
    const m = t.match(/(вул\.\s*[А-ЯІЇЄҐа-яіїєґ'.\s-]+(?:,\s*буд\.\s*\d+)?)/);
    if (m) return m[1].trim();
  }
  return null;
}

// Витягнути дати народження
function extractDates(texts) {
  return texts.filter(t => /^\d{2}\.\d{2}\.\d{4}$/.test(t.trim()));
}

// Витягнути спорідненість
function extractRelations(texts) {
  const rels = [];
  const relPatterns = ['голова', 'дружина', 'чоловік', 'син', 'дочка', 'донька',
    'мати', 'батько', 'зять', 'невістка', 'онук', 'онука', 'теща', 'тесть',
    'свекруха', 'свекор', 'бабуся', 'дідусь', 'брат', 'сестра', 'інший'];
  for (const t of texts) {
    const lower = t.toLowerCase().trim();
    for (const rel of relPatterns) {
      if (lower === rel || lower.startsWith(rel + ' ')) {
        rels.push(rel);
        break;
      }
    }
  }
  return rels;
}

// Витягнути земельні дані
function extractLandInfo(texts) {
  const landParts = [];
  for (const t of texts) {
    if (t.match(/\d+[.,]\d{4}/) || t.match(/га$/i)) {
      landParts.push(t.trim());
    }
    if (t.match(/присадибн|селянськ|город|сіножат|пасовищ|рілля|паї/i)) {
      landParts.push(t.trim());
    }
  }
  return landParts.join('; ');
}

// Витягнути майно/худобу
function extractProperty(texts) {
  const props = [];
  const propPatterns = ['ВРХ', 'свині', 'кролі', 'вівці', 'кози', 'коні', 'птиця',
    'бджоли', 'хутрові', 'кролі', 'будинок', 'гараж', 'сарай', 'погріб'];
  for (const t of texts) {
    for (const p of propPatterns) {
      if (t.toLowerCase().includes(p.toLowerCase())) {
        props.push(t.trim());
        break;
      }
    }
  }
  return props;
}

// Збирає ПІБ з окремих слів у повні імена
function assembleNames(nameWords, dates, relations) {
  // Прізвище зазвичай перше, потім ім'я, по-батькові
  const fullNames = [];
  let current = [];
  for (const w of nameWords) {
    current.push(w);
    // По-батькові закінчується на -вна, -вич, -ович, -івна, -ївна
    if (w.match(/(вна|вич|ович|івна|ївна|ївни|овна)$/i) && current.length >= 2) {
      fullNames.push(current.join(' '));
      current = [];
    }
  }
  if (current.length >= 2) {
    fullNames.push(current.join(' '));
  }
  return fullNames;
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

  // Групуємо сторінки за номером справи
  const casePages = new Map(); // caseNum -> [{pageNum, texts}]
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

    // Витягуємо структуровані дані
    const nameWords = extractNames(allTexts);
    const fullNames = assembleNames(nameWords, [], []);
    const address = extractAddress(allTexts);
    const dates = extractDates(allTexts);
    const relations = extractRelations(allTexts);
    const landInfo = extractLandInfo(allTexts);
    const properties = extractProperty(allTexts);

    // Голова домогосподарства — перше знайдене ПІБ
    const ownerName = fullNames.length > 0 ? fullNames[0] : null;

    // Члени сім'ї (решта імен)
    const members = [];
    for (let i = 0; i < fullNames.length; i++) {
      members.push({
        fullName: fullNames[i],
        birthDate: dates[i] || null,
        relation: i === 0 ? 'голова' : (relations[i] || null),
      });
    }

    // Номер книги та справи
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
      startPage: pages[0].pageNum,
    });
  }

  return results;
}

async function main() {
  // Очищаємо старі дані
  console.log('Очищаю старі дані...');
  await pool.query('DELETE FROM household_search');
  await pool.query('DELETE FROM property');
  await pool.query('DELETE FROM land_plots');
  await pool.query('DELETE FROM household_members');
  await pool.query('DELETE FROM households');
  await pool.query("ALTER SEQUENCE households_id_seq RESTART WITH 1");
  await pool.query("ALTER SEQUENCE household_members_id_seq RESTART WITH 1");
  await pool.query("ALTER SEQUENCE household_search_id_seq RESTART WITH 1");
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
        // Вставляємо домогосподарство
        const res = await pool.query(
          `INSERT INTO households (book_num, case_num, owner_name, address, village)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [h.bookNum, h.caseNum, h.ownerName || 'Не розпізнано', h.address, h.village]
        );
        const hId = res.rows[0].id;

        // Вставляємо членів
        for (const m of h.members) {
          const birthYear = m.birthDate ? parseInt(m.birthDate.split('.')[2]) : null;
          await pool.query(
            `INSERT INTO household_members (household_id, full_name, birth_year, relation)
             VALUES ($1, $2, $3, $4)`,
            [hId, m.fullName, birthYear, m.relation]
          );
          totalMembers++;
        }

        // Вставляємо земельні дані
        if (h.landInfo) {
          await pool.query(
            `INSERT INTO land_plots (household_id, plot_type, notes)
             VALUES ($1, $2, $3)`,
            [hId, 'загальна', h.landInfo]
          );
        }

        // Вставляємо майно
        for (const prop of h.properties) {
          await pool.query(
            `INSERT INTO property (household_id, property_type, description)
             VALUES ($1, $2, $3)`,
            [hId, prop, prop]
          );
        }

        // Вставляємо пошуковий запис
        await pool.query(
          `INSERT INTO household_search (household_id, content)
           VALUES ($1, $2)`,
          [hId, h.content]
        );

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

  // Фінальна статистика
  const stats = await pool.query(`
    SELECT
      (SELECT count(*) FROM households) as households,
      (SELECT count(*) FROM households WHERE owner_name != 'Не розпізнано') as with_names,
      (SELECT count(*) FROM household_members) as members,
      (SELECT count(*) FROM land_plots) as land,
      (SELECT count(*) FROM property) as props,
      (SELECT count(*) FROM household_search) as search
  `);

  console.log('\n✅ Завершено!');
  console.log('Статистика:', stats.rows[0]);
  console.log(`Домогосподарств: ${totalHouseholds}, Членів: ${totalMembers}`);

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
