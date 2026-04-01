/**
 * Парсер погосподарських книг XPS → Neon Postgres
 * Витягує текст з кожної сторінки, групує по домогосподарствах,
 * зберігає у household_search для повнотекстового пошуку.
 */
const AdmZip = require('adm-zip');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const neonConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vault', 'neon-config.json'), 'utf-8'));
const pool = new Pool({ connectionString: neonConfig.database_url });

const BOOKS_DIR = path.join(__dirname, 'pgo-books');

// Витягнути весь текст зі сторінки XPS
function extractPageText(zip, pageNum) {
  const entryName = `Documents/1/Pages/${pageNum}.fpage`;
  try {
    const xml = zip.readAsText(entryName);
    const matches = xml.match(/UnicodeString="([^"]+)"/g);
    if (!matches) return '';
    return matches
      .map(m => m.match(/UnicodeString="([^"]+)"/)[1])
      .map(t => t.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"'))
      .filter(t => t.trim().length > 0)
      .join(' ');
  } catch {
    return '';
  }
}

// Парсимо метадані з імені файлу: "Книга ПГО - 7(с. Ременів) (305-355)-Bed.xps"
function parseFileName(fileName) {
  const bookMatch = fileName.match(/Книга ПГО\s*-\s*(\d+)/);
  const villageMatch = fileName.match(/\(с\.\s*([^)]+)\)/);
  const rangeMatch = fileName.match(/\((\d+)-(\d+)\)/);
  const isAlphabet = fileName.includes('Алфавітна');

  return {
    bookNum: bookMatch ? parseInt(bookMatch[1]) : null,
    village: villageMatch ? villageMatch[1].trim() : null,
    caseFrom: rangeMatch ? parseInt(rangeMatch[1]) : null,
    caseTo: rangeMatch ? parseInt(rangeMatch[2]) : null,
    isAlphabet,
  };
}

// Визначаємо кількість сторінок у XPS файлі
function getPageCount(zip) {
  return zip.getEntries().filter(e => e.entryName.match(/Documents\/1\/Pages\/\d+\.fpage$/)).length;
}

// Групуємо сторінки в "записи" (кожне домогосподарство ~4-6 сторінок)
// Для простого варіанту — збираємо текст посторінково і зберігаємо
async function processBook(filePath) {
  const fileName = path.basename(filePath);
  const meta = parseFileName(fileName);

  if (meta.isAlphabet) {
    console.log(`  📖 ${fileName} — алфавітна книга, обробляю окремо`);
  }

  const zip = new AdmZip(filePath);
  const pageCount = getPageCount(zip);
  console.log(`  📄 ${fileName}: ${pageCount} сторінок, книга ${meta.bookNum}, ${meta.village}`);

  // Збираємо текст усіх сторінок
  const pages = [];
  for (let i = 1; i <= pageCount; i++) {
    const text = extractPageText(zip, i);
    if (text.trim().length > 50) { // Пропускаємо порожні/шаблонні сторінки
      pages.push({ pageNum: i, text });
    }
  }

  // Створюємо запис для кожної книги (або набір сторінок)
  // Групуємо по ~4 сторінки (одне домогосподарство зазвичай 4-6 сторінок)
  const PAGES_PER_HOUSEHOLD = 4;
  const households = [];

  for (let i = 0; i < pages.length; i += PAGES_PER_HOUSEHOLD) {
    const chunk = pages.slice(i, i + PAGES_PER_HOUSEHOLD);
    const combinedText = chunk.map(p => p.text).join('\n');

    // Пробуємо витягнути ПІБ голови (шукаємо прізвища після характерних маркерів)
    const namePatterns = combinedText.match(/(?:голови домогосподарства|власника)\s*[-–]?\s*([А-ЯІЇЄҐа-яіїєґ']+\s+[А-ЯІЇЄҐа-яіїєґ']+\s+[А-ЯІЇЄҐа-яіїєґ']+)/);
    const addressPattern = combinedText.match(/(?:с\.\s*(?:Ременів|Вислобоки)[^,]*(?:,\s*вул\.\s*[^,]+(?:,\s*буд\.\s*\d+)?)?)/);

    households.push({
      bookNum: meta.bookNum,
      village: meta.village,
      ownerName: namePatterns ? namePatterns[1].trim() : null,
      address: addressPattern ? addressPattern[0] : null,
      content: combinedText,
      startPage: chunk[0].pageNum,
    });
  }

  return households;
}

async function main() {
  const files = fs.readdirSync(BOOKS_DIR).filter(f => f.endsWith('.xps'));
  console.log(`Знайдено ${files.length} XPS файлів\n`);

  let totalRecords = 0;

  for (const file of files.sort()) {
    const filePath = path.join(BOOKS_DIR, file);
    try {
      const households = await processBook(filePath);

      for (const h of households) {
        // Вставляємо у households таблицю
        const res = await pool.query(
          `INSERT INTO households (book_num, owner_name, address, village)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [h.bookNum, h.ownerName || 'Невідомо (стор. ' + h.startPage + ')', h.address, h.village]
        );
        const householdId = res.rows[0].id;

        // Вставляємо у household_search для повнотекстового пошуку
        await pool.query(
          `INSERT INTO household_search (household_id, content)
           VALUES ($1, $2)`,
          [householdId, h.content]
        );

        totalRecords++;
      }

      console.log(`    → ${households.length} записів додано\n`);
    } catch (e) {
      console.error(`  ❌ Помилка: ${file}: ${e.message}`);
    }
  }

  console.log(`\n✅ Завершено! Всього записів: ${totalRecords}`);

  // Статистика
  const stats = await pool.query(`
    SELECT
      (SELECT count(*) FROM households) as households,
      (SELECT count(*) FROM household_search) as search_records,
      (SELECT count(*) FROM households WHERE owner_name NOT LIKE 'Невідомо%') as with_names
  `);
  console.log('Статистика:', stats.rows[0]);

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
