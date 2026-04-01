const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vault', 'google-credentials.json'), 'utf-8'));
const token = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vault', 'google-token.json'), 'utf-8'));
const oauth2 = new google.auth.OAuth2(creds.web.client_id, creds.web.client_secret);
oauth2.setCredentials(token);

oauth2.on('tokens', (t) => {
  const updated = { ...token, ...t };
  fs.writeFileSync(path.join(__dirname, '..', 'vault', 'google-token.json'), JSON.stringify(updated, null, 2));
});

const drive = google.drive({ version: 'v3', auth: oauth2 });
const FOLDER_ID = '1foACiW4XuNRJDlLC4-oAE9b2ekfoxTxM';
const OUT_DIR = path.join(__dirname, 'pgo-books');

async function downloadFile(fileId, fileName) {
  const destPath = path.join(OUT_DIR, fileName);
  if (fs.existsSync(destPath)) {
    console.log('  ⏭️  ' + fileName + ' (вже є)');
    return;
  }
  const dest = fs.createWriteStream(destPath);
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  return new Promise((resolve, reject) => {
    res.data.pipe(dest);
    dest.on('finish', () => { console.log('  ✅ ' + fileName); resolve(); });
    dest.on('error', reject);
  });
}

async function run() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and mimeType='application/vnd.ms-xpsdocument'`,
    fields: 'files(id,name,size)',
    pageSize: 50,
  });

  console.log(`Знайдено ${res.data.files.length} XPS файлів. Завантажую...\n`);

  for (const f of res.data.files) {
    const safeName = f.name.replace(/[<>:"|?*]/g, '_');
    try {
      await downloadFile(f.id, safeName);
    } catch (e) {
      console.log('  ❌ ' + f.name + ': ' + e.message);
    }
  }

  console.log('\nГотово! Файли у ' + OUT_DIR);
}

run().catch(e => console.error(e.message));
