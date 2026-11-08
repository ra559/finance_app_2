function parseCsvLine(line) {
  const cells = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(value.trim()); value = ''; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

const normalizedHeader = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const pick = (headers, names) => headers.findIndex((header) => names.includes(normalizedHeader(header)));
const parseDate = (value) => {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

export function parseCsv(buffer) {
  const lines = buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const dateIndex = pick(headers, ['date', 'transactiondate', 'posteddate', 'transdate']);
  const descriptionIndex = pick(headers, ['description', 'payee', 'name', 'merchant', 'memo', 'details']);
  const amountIndex = pick(headers, ['amount', 'transactionamount', 'value']);
  const debitIndex = pick(headers, ['debit', 'withdrawal', 'withdrawals', 'charge']);
  const creditIndex = pick(headers, ['credit', 'deposit', 'deposits']);
  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new Error('CSV needs a date, description, and amount (or debit and credit) column.');
  }
  return lines.slice(1).map(parseCsvLine).map((cells) => {
    const date = parseDate(cells[dateIndex]);
    const description = (cells[descriptionIndex] || '').trim();
    const parseAmount = (value) => Number(String(value || '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
    let amount = amountIndex >= 0 ? parseAmount(cells[amountIndex]) : 0;
    if (amountIndex < 0) {
      const debit = parseAmount(cells[debitIndex]);
      const credit = parseAmount(cells[creditIndex]);
      amount = (Number.isFinite(credit) ? credit : 0) - (Number.isFinite(debit) ? Math.abs(debit) : 0);
    }
    if (!date || !description || !Number.isFinite(amount)) return null;
    return { date, description, amount, source: 'csv' };
  }).filter(Boolean);
}

function ofxValue(block, tag) {
  const match = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i').exec(block);
  return match?.[1]?.trim() || '';
}

export function parseOfx(buffer) {
  const text = buffer.toString('utf8');
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) || [];
  return blocks.map((block) => {
    const dateText = ofxValue(block, 'DTPOSTED').slice(0, 8);
    const date = dateText.length === 8 ? `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}` : null;
    const amount = Number(ofxValue(block, 'TRNAMT'));
    const name = ofxValue(block, 'NAME');
    const memo = ofxValue(block, 'MEMO');
    const description = [name, memo].filter(Boolean).join(' — ') || 'Imported transaction';
    if (!date || !Number.isFinite(amount)) return null;
    return { date, description, amount, external_id: ofxValue(block, 'FITID'), source: 'ofx' };
  }).filter(Boolean);
}

export function parseImport(filename, buffer) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'csv') return parseCsv(buffer);
  if (ext === 'ofx' || ext === 'qfx') return parseOfx(buffer);
  throw new Error('Upload a CSV, OFX, or QFX file.');
}
