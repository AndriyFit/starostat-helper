const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const http = require('http');

const VAULT_KEY = '0pYJRSvF3w0HcDB3Bx38jGvoFukUS20pfYsNhW2nS_s';

async function getVaultSecret(key) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8400/api/secrets/${key}`, {
      headers: { 'X-API-Key': VAULT_KEY },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        resolve(parsed.value);
      });
    }).on('error', reject);
  });
}

const FOLDER_ID = '1ElhwAvHf23uPDArqhc9MxzsWYVTTxQjf';
const OUT_DIR = path.join(__dirname, 'pgo-books');

async function downloadFile(drive, fileId, fileName) {
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
  const creds = JSON.parse(await getVaultSecret('starostat/google_credentials'));
  const token = JSON.parse(await getVaultSecret('starostat/google_token'));

  const oauth2 = new google.auth.OAuth2(creds.web.client_id, creds.web.client_secret);
  oauth2.setCredentials(token);

  oauth2.on('tokens', async (t) => {
    const updated = { ...token, ...t };
    // Update token in Vault
    const body = JSON.stringify({ value: JSON.stringify(updated), project: 'starostat', description: 'Google OAuth token (auto-refreshed)' });
    const req = http.request('http://127.0.0.1:8400/api/secrets/starostat/google_token', {
      method: 'PUT',
      headers: { 'X-API-Key': VAULT_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    });
    req.write(body);
    req.end();
  });

  const drive = google.drive({ version: 'v3', auth: oauth2 });

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and (mimeType='application/vnd.ms-xpsdocument' or name contains '.xps')`,
      fields: 'nextPageToken, files(id,name,size)',
      pageSize: 100,
      pageToken,
    });
    files = files.concat(res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  console.log(`Знайдено ${files.length} XPS файлів. Завантажую...\n`);

  for (const f of files) {
    const safeName = f.name.replace(/[<>:"|?*]/g, '_');
    try {
      await downloadFile(drive, f.id, safeName);
    } catch (e) {
      console.log('  ❌ ' + f.name + ': ' + e.message);
    }
  }

  console.log('\nГотово! Файли у ' + OUT_DIR);
}

run().catch(e => console.error(e.message));
