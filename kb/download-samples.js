const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vault', 'google-credentials.json'), 'utf-8'));
const token = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vault', 'google-token.json'), 'utf-8'));
const oauth2 = new google.auth.OAuth2(creds.web.client_id, creds.web.client_secret);
oauth2.setCredentials(token);

oauth2.on('tokens', (newTokens) => {
  const updated = { ...token, ...newTokens };
  fs.writeFileSync(path.join(__dirname, '..', 'vault', 'google-token.json'), JSON.stringify(updated, null, 2));
});

const drive = google.drive({ version: 'v3', auth: oauth2 });
const SAMPLES_DIR = path.join(__dirname, 'samples');

const SAMPLE_FILES = [
  // Соціальні бланки
  'АКТ обстеження житлових умов заявника',
  'Акт обстеження мат.-побут. умов',
  'акт проживання без реєстрації',
  'Нові акти з довідкою',
  'Заява старости',
  'ЗАЯВА сільському голові',
  'Заява на обстеження МПУ',
  'Заява на факт обстеження проживання',
  'Заява на факт обстеження не проживання',
  'Заява на факт обстеження (догляд)',
  // Довідки
  'Довідка  ДРОБІТ І забудови відсутні',
  'про те що ніхто не зареєстрований',
  'Виписка з погосподарської книги',
  'Відповідь по',
  'ДОВІДКА ПРО СІМ',
  // Реєстрація
  'ПОВІДОМЛЕННЯ',
  'ЦНАП про скасування реєстрації',
  // Військовий
  'Медична характеристика',
  'Лист-прохання у Військову адм',
];

async function downloadFile(fileId, fileName) {
  const destPath = path.join(SAMPLES_DIR, fileName);
  const dest = fs.createWriteStream(destPath);

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    res.data.pipe(dest);
    dest.on('finish', () => { console.log('  ✅ ' + fileName); resolve(); });
    dest.on('error', reject);
  });
}

async function run() {
  console.log('Шукаю зразки документів на Google Drive...\n');

  const downloaded = new Set();

  for (const name of SAMPLE_FILES) {
    if (downloaded.has(name)) continue;

    const res = await drive.files.list({
      q: `name contains '${name.replace(/'/g, "\\'")}' and (mimeType='application/msword' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document')`,
      pageSize: 1,
      fields: 'files(id,name,mimeType)',
      orderBy: 'modifiedTime desc',
    });

    if (res.data.files.length > 0) {
      const f = res.data.files[0];
      const ext = f.mimeType.includes('openxml') ? '.docx' : '.doc';
      const safeName = f.name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
      try {
        await downloadFile(f.id, safeName + (safeName.endsWith(ext) ? '' : ext));
        downloaded.add(name);
      } catch (e) {
        console.log('  ❌ ' + f.name + ': ' + e.message);
      }
    } else {
      console.log('  ⏭️  Не знайдено: ' + name);
    }
  }

  console.log('\nЗавантажено: ' + downloaded.size + ' зразків у ' + SAMPLES_DIR);
}

run().catch(e => console.error(e.message));
