const fs = require('fs');
const path = require('path');

const DOC_FORMS_DIR = path.join(__dirname, '..', 'kb', 'doc-forms');

module.exports = (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const files = fs.readdirSync(DOC_FORMS_DIR).filter(f => f.endsWith('.json'));
  const templates = files
    .map(f => JSON.parse(fs.readFileSync(path.join(DOC_FORMS_DIR, f), 'utf-8')))
    .sort((a, b) => a.id.localeCompare(b.id));

  res.json({ success: true, templates });
};
