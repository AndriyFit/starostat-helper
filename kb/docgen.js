const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ============ Шаблони як JS-об'єкти ============

const TEMPLATES = {
  'dovidka-sklad-simji': {
    name: 'Довідка про склад сім\'ї',
    generate: (data) => generateFromDocx('dovidka-sklad-simji.docx', data),
  },
  'akt-mpu': {
    name: 'Акт обстеження матеріально-побутових умов',
    generate: (data) => generateFromDocx('akt-mpu.docx', data),
  },
  'akt-prozhyvannya': {
    name: 'Акт підтвердження факту проживання (рішення №79)',
    generate: (data) => generateFromDocx('akt-prozhyvannya.docx', data),
  },
  'akt-prozhyvannya-bagato': {
    name: 'Акт факту проживання — масовий (кілька осіб)',
    generate: (data) => generateFromDocx('akt-prozhyvannya-bagato.docx', data),
  },
  'akt-doglyad': {
    name: 'Акт підтвердження факту догляду (рішення №80)',
    generate: (data) => generateFromDocx('akt-doglyad.docx', data),
  },
  'akt-ne-prozhyvannya': {
    name: 'Акт про непроживання особи',
    generate: (data) => generateFromDocx('akt-ne-prozhyvannya.docx', data),
  },
  'dovidka-ne-zareyestrovani': {
    name: 'Довідка що ніхто не зареєстрований',
    generate: (data) => generateFromDocx('dovidka-ne-zareyestrovani.docx', data),
  },
  'vidpovid-zapyt': {
    name: 'Відповідь на запит мешканця',
    generate: (data) => generateFromDocx('vidpovid-zapyt.docx', data),
  },
  'vypyska-pgo': {
    name: 'Виписка з погосподарської книги',
    generate: (data) => generateFromDocx('vypyska-pgo.docx', data),
  },
  'dovidka-vidsutnist-zabudov': {
    name: 'Довідка про відсутність забудов',
    generate: (data) => generateFromDocx('dovidka-vidsutnist-zabudov.docx', data),
  },
  'zayava-mpu': {
    name: 'Заява на обстеження МПУ',
    generate: (data) => generateFromDocx('zayava-mpu.docx', data),
  },
  'povidomlennya-znyattya': {
    name: 'Повідомлення про зняття з реєстрації',
    generate: (data) => generateFromDocx('povidomlennya-znyattya.docx', data),
  },
  'lyst-prohannya': {
    name: 'Лист-прохання',
    generate: (data) => generateFromDocx('lyst-prohannya.docx', data),
  },
  'dovidka-sim-vijskomat': {
    name: 'Довідка про склад сім\'ї (військкомат)',
    generate: (data) => generateFromDocx('dovidka-sim-vijskomat.docx', data),
  },
};

function generateFromDocx(templateFile, data) {
  const templatePath = path.join(TEMPLATES_DIR, templateFile);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Шаблон ${templateFile} не знайдено в ${TEMPLATES_DIR}`);
  }
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
  });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer' });
}

function today() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// ============ CLI ============

const cmd = process.argv[2];
const dataArg = process.argv[3];

switch (cmd) {
  case 'list':
    console.log('\nДоступні шаблони документів:\n');
    for (const [id, tpl] of Object.entries(TEMPLATES)) {
      const exists = fs.existsSync(path.join(TEMPLATES_DIR, id + '.docx'));
      console.log(`  ${exists ? '✅' : '⏳'} ${id} — ${tpl.name}`);
    }
    console.log('\nВикористання: node docgen.js generate <id> \'{"ПІБ":"Іванов І.І.",...}\'');
    break;

  case 'generate':
    const templateId = process.argv[3];
    const jsonData = process.argv[4];
    if (!templateId || !jsonData) {
      console.log('Використання: node docgen.js generate <template-id> \'<json-data>\'');
      break;
    }
    const tpl = TEMPLATES[templateId];
    if (!tpl) {
      console.log(`Шаблон "${templateId}" не знайдено. Використайте "list" для переліку.`);
      break;
    }
    try {
      const data = JSON.parse(jsonData);
      data.date = data.date || today();
      const buf = tpl.generate(data);
      const outName = `${templateId}_${Date.now()}.docx`;
      const outPath = path.join(OUTPUT_DIR, outName);
      fs.writeFileSync(outPath, buf);
      console.log(`✅ Документ створено: ${outPath}`);
    } catch (e) {
      console.error('Помилка:', e.message);
    }
    break;

  default:
    console.log('Генератор документів Ременівського старостинського округу');
    console.log('');
    console.log('Команди:');
    console.log('  node docgen.js list                           — перелік шаблонів');
    console.log('  node docgen.js generate <id> \'<json>\'         — створити документ');
    console.log('');
    console.log('Приклади:');
    console.log('  node docgen.js generate dovidka-sklad-simji \'{"PIB":"Іванов І.І.","address":"вул. Львівська, 5"}\'');
}
