/**
 * Генерація embeddings для семантичного пошуку по погосподарських книгах
 * Використовує multilingual-e5-small (384 dim) локально через transformers.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vault', 'neon-config.json'), 'utf-8'));
const pool = new Pool({ connectionString: cfg.database_url });

const BATCH_SIZE = 10;
const MAX_TEXT_LENGTH = 500; // e5-small optimal ~512 tokens

async function main() {
  const { pipeline } = await import('@huggingface/transformers');
  console.log('Завантажую модель multilingual-e5-small...');
  const embedder = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'fp32' });
  console.log('Модель готова!\n');

  // Отримуємо записи без embeddings
  const { rows: records } = await pool.query(
    'SELECT id, content FROM household_search WHERE embedding IS NULL ORDER BY id'
  );
  console.log(`Записів для обробки: ${records.length}\n`);

  let processed = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    for (const rec of batch) {
      // Обрізаємо текст + додаємо prefix для e5
      const text = 'passage: ' + rec.content.substring(0, MAX_TEXT_LENGTH);
      try {
        const result = await embedder(text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(result.data);
        const vecStr = '[' + embedding.join(',') + ']';

        await pool.query(
          'UPDATE household_search SET embedding = $1 WHERE id = $2',
          [vecStr, rec.id]
        );
        processed++;
      } catch (e) {
        console.error(`  Помилка id=${rec.id}: ${e.message}`);
      }
    }

    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= records.length) {
      console.log(`  Оброблено: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
    }
  }

  console.log(`\n✅ Готово! Embeddings згенеровано: ${processed}`);

  // Тест семантичного пошуку
  console.log('\n=== Тест семантичного пошуку ===');
  const query = 'query: сім\'я що живе на вулиці Зарічній у Ременеві';
  const qResult = await embedder(query, { pooling: 'mean', normalize: true });
  const qVec = '[' + Array.from(qResult.data).join(',') + ']';

  const { rows: results } = await pool.query(`
    SELECT h.book_num, h.owner_name, h.address, h.village,
           1 - (s.embedding <=> $1::vector) as similarity
    FROM household_search s
    JOIN households h ON h.id = s.household_id
    WHERE s.embedding IS NOT NULL
    ORDER BY s.embedding <=> $1::vector
    LIMIT 5
  `, [qVec]);

  results.forEach(r => {
    console.log(`  sim=${r.similarity.toFixed(3)} | Книга ${r.book_num} | ${r.owner_name} | ${r.address} | ${r.village}`);
  });

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
