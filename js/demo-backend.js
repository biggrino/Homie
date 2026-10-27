/**
 * Mode Demo — menjalankan kode Google Apps Script (folder google-apps-script/) langsung di browser
 * dengan Google Sheets tiruan di memori. Dipakai saat js/config.js belum dibuat atau API_URL belum diisi,
 * sehingga aplikasi bisa dicoba tanpa setup. Data demo hilang saat halaman dimuat ulang.
 */

export const GAS_FILES = ['Code.gs', 'Database.gs', 'Finance.gs', 'Transactions.gs', 'Shopping.gs', 'Agenda.gs', 'Documents.gs'];

class FakeRange {
  constructor(sheet, row, col, numRows = 1, numCols = 1) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const source = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = source[this.col - 1 + c];
        line.push(v === undefined || v === null ? '' : v);
      }
      out.push(line);
    }
    return out;
  }

  setValues(values) {
    values.forEach((line, r) => {
      const index = this.row - 1 + r;
      while (this.sheet.rows.length <= index) this.sheet.rows.push([]);
      line.forEach((v, c) => {
        this.sheet.rows[index][this.col - 1 + c] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
      });
    });
    return this;
  }

  setValue(value) { return this.setValues([[value]]); }
  setNumberFormat() { return this; }
  setNumberFormats() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.maxRows = 1000;
  }

  getName() { return this.name; }

  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if ((this.rows[i] || []).some((v) => v !== '' && v !== null && v !== undefined)) return i + 1;
    }
    return 0;
  }

  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, (row || []).length), 0);
  }

  getMaxRows() { return Math.max(this.maxRows, this.rows.length); }
  insertRowsAfter(after, count) { this.maxRows += count; }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows, numCols); }
  setFrozenRows() { return this; }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
}

class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet; }
  getSheets() { return [...this.sheets.values()]; }
  deleteSheet(sheet) { this.sheets.delete(sheet.getName()); }
}

function sha256Bytes(message) {
  const bytes = new TextEncoder().encode(message);
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
    0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
    0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, length * 8);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
  }
  const out = [];
  H.forEach((v) => { for (let s = 24; s >= 0; s -= 8) { const byte = (v >>> s) & 0xff; out.push(byte > 127 ? byte - 256 : byte); } });
  return out;
}

function formatDate(date, timeZone, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  const map = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (token, literal) => (literal !== undefined ? literal : map[token]));
}

function createCache() {
  const store = new Map();
  return {
    get(key) {
      const item = store.get(key);
      if (!item || item.expires < Date.now()) { store.delete(key); return null; }
      return item.value;
    },
    put(key, value, seconds = 600) { store.set(key, { value: String(value), expires: Date.now() + seconds * 1000 }); },
    remove(key) { store.delete(key); }
  };
}

/** Membuat runtime Apps Script tiruan dari teks file .gs. */
export function createGasRuntime(sources) {
  const spreadsheet = new FakeSpreadsheet();
  const cache = createCache();
  const lock = { tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true };
  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
    LockService: { getScriptLock: () => lock },
    CacheService: { getScriptCache: () => cache },
    Utilities: {
      formatDate,
      getUuid: () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
          const r = Math.floor(Math.random() * 16);
          return (ch === 'x' ? r : (r % 4) + 8).toString(16);
        })),
      computeDigest: (algorithm, text) => sha256Bytes(text),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' }
    },
    ContentService: {
      createTextOutput: (text) => ({ setMimeType() { return this; }, getContent: () => text }),
      MimeType: { JSON: 'JSON' }
    },
    Logger: { log: () => {} }
  };
  const names = Object.keys(globals);
  const code = sources.join('\n;\n') + '\nreturn { handleRequest_: handleRequest_, setupDatabase: setupDatabase };';
  // eslint-disable-next-line no-new-func
  const api = new Function(...names, code)(...names.map((n) => globals[n]));
  return {
    spreadsheet,
    handle(body) {
      return JSON.parse(JSON.stringify(api.handleRequest_(JSON.parse(JSON.stringify(body)))));
    }
  };
}

let runtimePromise = null;

/** Memuat file .gs dari folder google-apps-script/ (dipakai oleh js/api.js dalam mode demo). */
export function loadDemoRuntime(basePath = './google-apps-script/') {
  if (!runtimePromise) {
    runtimePromise = Promise.all(GAS_FILES.map(async (file) => {
      const res = await fetch(basePath + file, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Gagal memuat ' + file + ' untuk mode demo.');
      return res.text();
    })).then(createGasRuntime).catch((err) => { runtimePromise = null; throw err; });
  }
  return runtimePromise;
}
