/**
 * Google OAuth flow — отримати токен з Drive scope
 * Запустити: node scripts/google-auth.js
 * Відкрити URL в браузері, авторизуватися, вставити код
 */
const { google } = require('googleapis');
const http = require('http');
const readline = require('readline');

const VAULT_KEY = '0pYJRSvF3w0HcDB3Bx38jGvoFukUS20pfYsNhW2nS_s';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
];

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

function saveVaultSecret(key, value, description) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ value, project: 'starostat', description });
    const req = http.request(`http://127.0.0.1:8400/api/secrets/${key}`, {
      method: 'PUT',
      headers: { 'X-API-Key': VAULT_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const creds = JSON.parse(await getVaultSecret('starostat/google_credentials'));
  const { client_id, client_secret } = creds.web;

  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'urn:ietf:wg:oauth:2.0:oob');

  const url = oauth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

  console.log('\n🔗 Відкрий це посилання в браузері:\n');
  console.log(url);
  console.log('\nАвторизуйся та скопіюй код сюди:\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Код: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oauth2.getToken(code.trim());
      console.log('\n✅ Токен отримано!');
      console.log('Scopes:', tokens.scope);

      await saveVaultSecret('starostat/google_drive_token', JSON.stringify(tokens), 'Google Drive OAuth token');
      console.log('💾 Збережено в Vault: starostat/google_drive_token');
    } catch (e) {
      console.error('❌ Помилка:', e.message);
    }
  });
}

main().catch(e => console.error(e));
