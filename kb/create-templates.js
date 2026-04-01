const PizZip = require('pizzip');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

// ============ OOXML helpers ============

/**
 * Маркери форматування рядків шаблону:
 *   >>>text      — центрування
 *   <<<text      — вирівнювання вправо
 *   ---text      — абзац (по ширині + відступ 1.25 см)
 *   ~~~Ліво|Право — рядок підпису (таблиця без рамок)
 *   **text**     — жирний (комбінується з маркерами вище)
 *   (без маркера) — ліве вирівнювання, без відступу
 */

const TWIPS = {
  A4_W: 11906,    // 210 мм
  A4_H: 16838,    // 297 мм
  TOP: 1134,      // 20 мм
  BOTTOM: 1134,   // 20 мм
  LEFT: 1701,     // 30 мм
  RIGHT: 851,     // 15 мм
  INDENT: 709,    // 1.25 см
  LINE_SP: 276,   // 1.15 інтервал
};

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults>' +
      '<w:rPrDefault><w:rPr>' +
        '<w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' +
        '<w:sz w:val="28"/>' +     // 14pt
        '<w:szCs w:val="28"/>' +
        '<w:lang w:val="uk-UA" w:eastAsia="uk-UA" w:bidi="ar-SA"/>' +
      '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr>' +
        `<w:spacing w:after="0" w:line="${TWIPS.LINE_SP}" w:lineRule="auto"/>` +
      '</w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
      '<w:name w:val="Normal"/>' +
    '</w:style>' +
    '</w:styles>';
}

function sectPr() {
  return '<w:sectPr>' +
    `<w:pgSz w:w="${TWIPS.A4_W}" w:h="${TWIPS.A4_H}"/>` +
    `<w:pgMar w:top="${TWIPS.TOP}" w:right="${TWIPS.RIGHT}" w:bottom="${TWIPS.BOTTOM}" w:left="${TWIPS.LEFT}" w:header="709" w:footer="709" w:gutter="0"/>` +
    '</w:sectPr>';
}

function buildRun(text, bold) {
  let rPr = '';
  if (bold) rPr = '<w:rPr><w:b/><w:bCs/></w:rPr>';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function buildParagraph(line) {
  let text = line;
  let align = null;
  let indent = false;
  let bold = false;

  // 1. Alignment prefix
  if (text.startsWith('>>>')) { align = 'center'; text = text.slice(3); }
  else if (text.startsWith('<<<')) { align = 'right'; text = text.slice(3); }
  else if (text.startsWith('---')) { align = 'both'; indent = true; text = text.slice(3); }

  // 2. Bold
  if (text.startsWith('**') && text.endsWith('**') && text.length > 4) {
    bold = true;
    text = text.slice(2, -2);
  }

  text = text.trimEnd();

  // Build pPr
  const pParts = [];
  if (align) pParts.push(`<w:jc w:val="${align}"/>`);
  if (indent) pParts.push(`<w:ind w:firstLine="${TWIPS.INDENT}"/>`);
  const pPr = pParts.length ? `<w:pPr>${pParts.join('')}</w:pPr>` : '';

  return `<w:p>${pPr}${buildRun(text, bold)}</w:p>`;
}

function buildSignatureRow(line) {
  // ~~~Ліво|Право
  const parts = line.slice(3).split('|');
  const left = (parts[0] || '').trim();
  const right = (parts[1] || '').trim();

  const noBorders =
    '<w:tblBorders>' +
      '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '</w:tblBorders>';

  return '<w:tbl>' +
    `<w:tblPr><w:tblW w:w="5000" w:type="pct"/>${noBorders}<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>' +
    '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>' +
        `<w:p>${buildRun(left, false)}</w:p>` +
      '</w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>' +
        `<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${buildRun(right, false)}</w:p>` +
      '</w:tc>' +
    '</w:tr>' +
  '</w:tbl>';
}

function buildBody(content) {
  const lines = content.split('\n');
  let body = '';
  for (const line of lines) {
    if (line.startsWith('~~~')) {
      body += buildSignatureRow(line);
    } else {
      body += buildParagraph(line);
    }
  }
  body += sectPr();
  return body;
}

function createDocx(filename, content) {
  const zip = new PizZip();

  // [Content_Types].xml
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>');

  // Relationships
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');

  zip.file('word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>');

  // Styles — Times New Roman 14pt, A4, single spacing
  zip.file('word/styles.xml', stylesXml());

  // Document body
  const body = buildBody(content);
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + body + '</w:body></w:document>');

  const buf = zip.generate({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(TEMPLATES_DIR, filename), buf);
  console.log('✅ ' + filename);
}

// ============ Шаблони ============

console.log('Створюю шаблони документів (ДСТУ 4163)...\n');

// 1. Довідка про склад сім'ї
createDocx('dovidka-sklad-simji.docx', `>>>**ЖОВТАНЕЦЬКА СІЛЬСЬКА РАДА**
>>>**ЛЬВІВСЬКОГО РАЙОНУ ЛЬВІВСЬКОЇ ОБЛАСТІ**
>>>**Ременівський старостинський округ**

>>>**Д О В І Д К А**
>>>**про склад сім'ї**

---Видана гр. {{PIB}} про те, що він/вона дійсно зареєстрований(а) та проживає за адресою: {{address}}.

---Разом з ним/нею зареєстровані та проживають:

{{members}}

---Довідка видана для подання {{purpose}}.

«{{day}}» {{month}} {{year}} року

~~~Староста {{starosta}}|Діловод {{dilovod}}`);

// 2. Акт обстеження МПУ
createDocx('akt-mpu.docx', `>>>**АКТ**
>>>**обстеження матеріально-побутових умов**
>>>**домогосподарства / фактичного місця проживання особи**

~~~{{location}}|{{date}}

---Комісією в складі:
{{commission}}

---проведено обстеження матеріально-побутових умов гр. {{PIB}}, {{birth_year}} р.н.

---Адреса: {{address}}

---Результати обстеження:
{{results}}

---Висновок комісії:
{{conclusion}}

Підписи членів комісії:
{{signatures}}`);

// 3. Акт про проживання без реєстрації (одна особа)
createDocx('akt-prozhyvannya.docx', `>>>**А К Т**
>>>**перевірки житлового будинку №{{house_num}}, по вулиці {{street}},**
>>>**в селі {{village}}, Львівського району, Львівської області**

~~~«{{day}}» {{month}} {{year}} року|с. {{village}}

---Комісією в складі: старости Ременівського старостинського округу Жовтанецької сільської ради Гордієнка Андрія Володимировича, діловода Мацюри Галини Михайлівни, {{commission_member}}

---провели перевірку житлового будинку по вул. {{street}}, буд. {{house_num}}, в селі {{village}}.

---В ході перевірки встановлено, що в даному будинку фактично проживає: {{PIB}}, {{birth_date}} р.н., без реєстрації місця проживання.

{{additional_info}}

~~~Староста|Гордієнко А.В.
~~~Діловод|Мацюра Г.М.
~~~{{commission_member_short}}|`);

// 3b. Акт про проживання — масовий (кілька осіб)
createDocx('akt-prozhyvannya-bagato.docx', `>>>**А К Т  № {{act_number}}**
>>>**перевірки фактичного проживання осіб**
>>>**на території с. {{village}}**
>>>**(відповідно до рішення виконкому №79 від 28.03.2024)**

~~~«{{day}}» {{month}} {{year}} року|с. {{village}}

---Комісією в складі: старости Ременівського старостинського округу Жовтанецької сільської ради Гордієнка Андрія Володимировича, діловода Мацюри Галини Михайлівни, {{commission_member}}

---проведено перевірку фактичного проживання осіб на території с. {{village}}.

---В ході перевірки встановлено, що за нижченаведеними адресами фактично проживають:

{{persons}}

---Дані підтверджують свідки:

---1. {{witness1_PIB}}, {{witness1_info}}

---2. {{witness2_PIB}}, {{witness2_info}}

---Акт складено {{purpose}}.

~~~Староста|Гордієнко А.В.
~~~Діловод|Мацюра Г.М.
~~~{{commission_member}}|
~~~Свідок 1: {{witness1_PIB}}|
~~~Свідок 2: {{witness2_PIB}}|`);

// 4. Акт про непроживання
createDocx('akt-ne-prozhyvannya.docx', `>>>**А К Т**
>>>**про непроживання особи за місцем реєстрації**

~~~{{location}}|«{{day}}» {{month}} {{year}} р.

---Комісією в складі:
{{commission}}

---проведено перевірку за адресою: {{address}}.

---В ході перевірки встановлено, що гр. {{PIB}}, зареєстрований(а) за вказаною адресою, фактично за даною адресою не проживає з {{date_from}}.

{{additional_info}}

Підписи членів комісії:
{{signatures}}`);

// 5. Довідка про відсутність зареєстрованих
createDocx('dovidka-ne-zareyestrovani.docx', `>>>**ЖОВТАНЕЦЬКА СІЛЬСЬКА РАДА**
>>>**ЛЬВІВСЬКОГО РАЙОНУ ЛЬВІВСЬКОЇ ОБЛАСТІ**
>>>**Ременівський старостинський округ**

>>>**Д О В І Д К А**

---Видана гр. {{PIB}} про те, що за адресою: {{address}} на даний час ніхто не зареєстрований.

{{additional_info}}

---Довідка видана для подання {{purpose}}.

«{{day}}» {{month}} {{year}} року

~~~Староста|Гордієнко А.В.`);

// 6. Відповідь на запит
createDocx('vidpovid-zapyt.docx', `>>>**ЖОВТАНЕЦЬКА СІЛЬСЬКА РАДА**
>>>**ЛЬВІВСЬКОГО РАЙОНУ ЛЬВІВСЬКОЇ ОБЛАСТІ**
>>>**Ременівський старостинський округ**

вул. Львівська, 1, с. Ременів, Львівський район, Львівська область, 80460
тел.: (03254) 3-61-22

~~~«{{day}}» {{month}} {{year}} року  № {{doc_number}}|

<<<{{recipient}}

>>>**Відповідь на запит**

---На Ваш запит від {{request_date}} повідомляємо:

---{{response_text}}

~~~Староста Ременівського старостинського округу|Гордієнко А.В.`);

// 7. Виписка з ПГО
createDocx('vypyska-pgo.docx', `>>>**ЖОВТАНЕЦЬКА СІЛЬСЬКА РАДА**
>>>**ЛЬВІВСЬКОГО РАЙОНУ ЛЬВІВСЬКОЇ ОБЛАСТІ**
>>>**Ременівський старостинський округ**

>>>**ВИПИСКА**
>>>**з погосподарської книги**

---Книга №{{book_num}}, особова справа №{{case_num}}

---Власник домогосподарства: {{PIB}}
---Адреса: {{address}}

---Склад домогосподарства:
{{members}}

---Земельна ділянка: {{land_info}}

{{additional_info}}

«{{day}}» {{month}} {{year}} року

~~~Староста|Гордієнко А.В.`);

// 8. Довідка про відсутність забудов
createDocx('dovidka-vidsutnist-zabudov.docx', `>>>**ЖОВТАНЕЦЬКА СІЛЬСЬКА РАДА**
>>>**ЛЬВІВСЬКОГО РАЙОНУ ЛЬВІВСЬКОЇ ОБЛАСТІ**
>>>**Ременівський старостинський округ**

>>>**Д О В І Д К А**

---Видана гр. {{PIB}} про те, що на земельній ділянці за адресою: {{address}} забудови відсутні.

{{additional_info}}

---Довідка видана для подання {{purpose}}.

«{{day}}» {{month}} {{year}} року

~~~Староста|Гордієнко А.В.`);

// 9. Заява на обстеження МПУ
createDocx('zayava-mpu.docx', `<<<Старості Ременівського
<<<старостинського округу
<<<Жовтанецької сільської ради
<<<Гордієнку А.В.

<<<від {{PIB}}
<<<що проживає за адресою:
<<<{{address}}
<<<тел.: {{phone}}

>>>**З А Я В А**

---Прошу провести обстеження моїх матеріально-побутових умов для {{purpose}}.

{{additional_info}}

«{{day}}» {{month}} {{year}} року

<<<Підпис ___________`);

// 10. Повідомлення про зняття з реєстрації
createDocx('povidomlennya-znyattya.docx', `>>>**ПОВІДОМЛЕННЯ**

---Про зняття з реєстрації місця проживання

---Повідомляємо, що гр. {{PIB}}, {{birth_date}} р.н., зареєстрований(а) за адресою: {{address_from}}

---знятий(а) з реєстрації місця проживання у зв'язку з {{reason}}.

---Нова адреса реєстрації: {{address_to}}

---Дата зняття: «{{day}}» {{month}} {{year}} року

~~~Староста|Гордієнко А.В.`);

// 11. Лист-прохання
createDocx('lyst-prohannya.docx', `>>>**УКРАЇНА**
>>>**ЖОВТАНЕЦЬКА СІЛЬСЬКА РАДА**
>>>**ЛЬВІВСЬКОГО РАЙОНУ ЛЬВІВСЬКОЇ ОБЛАСТІ**

вул. Львівська, 1, с. Ременів, Львівський район, Львівська область, 80460
тел.: (03254) 3-61-22, факс. 3-61-33, remeniv_zvit@ukr.net

~~~«{{day}}» {{month}} {{year}} року  № {{doc_number}}|

<<<{{recipient}}

---Шановний(а) {{recipient_name}}!

---{{body}}

З повагою,
~~~Староста Ременівського старостинського округу|Гордієнко А.В.`);

// 12. Довідка для військкомату
createDocx('dovidka-sim-vijskomat.docx', `>>>**ЖОВТАНЕЦЬКА СІЛЬСЬКА РАДА**
>>>**ЛЬВІВСЬКОГО РАЙОНУ ЛЬВІВСЬКОЇ ОБЛАСТІ**
>>>**Ременівський старостинський округ**

>>>**ДОВІДКА ПРО СКЛАД СІМ'Ї**

---Видана гр. {{PIB}}, {{birth_date}} р.н.

---Зареєстрований(а) за адресою: {{address}}

---Склад сім'ї:
{{members}}

---Довідка видана для подання до {{purpose}}.

«{{day}}» {{month}} {{year}} року

~~~Староста|Гордієнко А.В.`);

// 13. Акт підтвердження факту догляду
createDocx('akt-doglyad.docx', `>>>**А К Т**
>>>**підтвердження факту здійснення догляду**
>>>**без виплати компенсації**
>>>**(відповідно до рішення виконкому №80 від 28.03.2024)**

~~~«{{day}}» {{month}} {{year}} року|с. Ременів

---Комісією в складі: старости Ременівського старостинського округу Жовтанецької сільської ради Гордієнка Андрія Володимировича, діловода Мацюри Галини Михайлівни, {{commission_member}}

---проведено перевірку факту здійснення догляду.

---Особа, яка здійснює догляд:
---{{caregiver_PIB}}, {{caregiver_birth}} р.н.
---Адреса: {{caregiver_address}}
---{{caregiver_doc}}

---Особа, за якою здійснюється догляд:
---{{patient_PIB}}, {{patient_birth}} р.н.
---Адреса: {{patient_address}}
---Статус: {{patient_status}}

---В ході перевірки встановлено:
---{{care_description}}

---Дані підтверджують свідки:

---1. {{witness1_PIB}}, {{witness1_info}}

---2. {{witness2_PIB}}, {{witness2_info}}

~~~Староста|Гордієнко А.В.
~~~Діловод|Мацюра Г.М.
~~~{{commission_member}}|
~~~Свідок 1: {{witness1_PIB}}|
~~~Свідок 2: {{witness2_PIB}}|`);

console.log('\nСтворено 14 шаблонів у ' + TEMPLATES_DIR);
console.log('Формат: Times New Roman 14pt, A4, поля 30/15/20/20 мм');