const fs = require('fs');
const path = require('path');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');

const TEMPLATES_DIR = path.join(__dirname, '..', 'kb', 'templates');
const DOC_FORMS_DIR = path.join(__dirname, '..', 'kb', 'doc-forms');

function getTemplatePlaceholders(templateId) {
  const files = fs.readdirSync(DOC_FORMS_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const form = JSON.parse(fs.readFileSync(path.join(DOC_FORMS_DIR, f), 'utf-8'));
    if (form.id === templateId) {
      return Object.keys(form.required_data);
    }
  }
  return [];
}

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { templateId, data } = req.body;

  if (!templateId || !data) {
    return res.status(400).json({ success: false, error: 'templateId та data обов\'язкові' });
  }

  const templatePath = path.join(TEMPLATES_DIR, templateId + '.docx');
  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ success: false, error: `Шаблон ${templateId}.docx не знайдено` });
  }

  try {
    const now = new Date();
    const months = [
      'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
      'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
    ];

    if (!data.day) data.day = String(now.getDate()).padStart(2, '0');
    if (!data.month) data.month = months[now.getMonth()];
    if (!data.year) data.year = String(now.getFullYear());
    if (!data.date) data.date = `${data.day} ${data.month} ${data.year} року`;

    const placeholders = getTemplatePlaceholders(templateId);
    for (const key of placeholders) {
      if (data[key] === undefined || data[key] === null) {
        data[key] = '';
      }
    }

    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    });

    doc.render(data);

    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    const filename = `${templateId}_${Date.now()}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
