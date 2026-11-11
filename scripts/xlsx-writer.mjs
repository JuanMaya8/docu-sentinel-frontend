/**
 * Tiny .xlsx WRITER used only by tests and fixtures (the app only reads .xlsx). Node stdlib only (zlib + crc32 by hand).
 *
 *   buildXlsx({ sheets: [{ name, rows: [[...], ...] }], date1904?, sharedStrings?: true, compress?: true })
 *
 * Cell values: string -> shared (or inline) string, number -> number, boolean -> t="b", Date -> date serial with a
 * date format, { formula, cached } -> t="str" cached value, null/undefined/'' -> no cell.
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files, compress = true) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const body = compress ? deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function buildXlsx({ sheets, date1904 = false, sharedStrings = true, compress = true }) {
  const strings = [];
  const index = new Map();
  const sid = (s) => {
    if (!index.has(s)) {
      index.set(s, strings.length);
      strings.push(s);
    }
    return index.get(s);
  };
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const sheetXml = sheets.map(({ rows }) => {
    const out = rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${colName(c)}${r + 1}`;
        if (v === null || v === undefined || v === '') return '';
        if (v instanceof Date) {
          const serial = (v.getTime() - epoch) / 86_400_000;
          const style = serial % 1 === 0 ? 1 : 2;
          return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
        }
        if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
        if (typeof v === 'object' && 'formula' in v) return `<c r="${ref}" t="str"><f>${esc(v.formula)}</f><v>${esc(v.cached)}</v></c>`;
        if (sharedStrings) return `<c r="${ref}" t="s"><v>${sid(String(v))}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
      });
      return `<row r="${r + 1}">${cells.join('')}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${out.join('')}</sheetData></worksheet>`;
  });
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>'],
    ...sheetXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
  ];
  if (sharedStrings) {
    files.push(['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`]);
  }
  return zip(files, compress);
}

/** Invoice-like sheet with known anomalies (row indexes are 0-based data rows). */
export function invoiceRows(n = 300) {
  const rows = [['Factura', 'Fecha', 'Cliente', 'Cantidad', 'Precio unitario', 'Total']];
  const cities = ['Bogotá', 'Medellín', 'Cali'];
  for (let i = 0; i < n; i++) {
    const qty = 1 + (i % 9);
    const price = 1000 + ((i * 37) % 500);
    rows.push([`FV-${1000 + i}`, new Date(Date.UTC(2025, i % 12, 1 + (i % 27))), cities[i % 3], qty, price, qty * price]);
  }
  rows[1 + 10][5] = 999_999_999; // absurd total (data row 10)
  rows[1 + 20][3] = -4; // negative quantity (data row 20)
  rows[1 + 30] = [...rows[1 + 29]]; // exact duplicate of data row 29
  return rows;
}
