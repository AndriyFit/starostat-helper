const fs = require('fs');
const path = require('path');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');

const TEMPLATES_DIR = path.join(__dirname, '..', 'kb', 'templates');

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
