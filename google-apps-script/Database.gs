/**
 * Database.gs — skema Google Sheets, setup otomatis, helper baca/tulis tabel, dan data contoh.
 */

const DB_VERSION = '2';

const SCHEMA = {
  Users: ['ID', 'Name', 'Role', 'PinHash', 'Active', 'CreatedAt', 'Photo', 'UpdatedAt'],
  Accounts: ['ID', 'AccountName', 'AccountType', 'OpeningBalance', 'CurrentBalance', 'Active'],
  Transactions: ['ID', 'Date', 'Type', 'SourceAccount', 'DestinationAccount', 'Category', 'SubCategory', 'Amount',
    'Description', 'PaymentMethod', 'CreatedBy', 'CreatedAt', 'UpdatedAt', 'Attachment'],
  Categories: ['ID', 'Name', 'Type', 'SubCategories', 'Color', 'Active'],
  Budgets: ['ID', 'Month', 'Year', 'Category', 'Amount'],
  CreditCards: ['ID', 'CardName', 'Bank', 'Limit', 'Outstanding', 'AvailableLimit', 'StatementDate', 'DueDate',
    'MinimumPayment', 'Active', 'CurrentBill'],
  Installments: ['ID', 'TransactionID', 'CardID', 'Description', 'Principal', 'Interest', 'AdminFee', 'Tenor',
    'MonthlyPayment', 'TotalAmount', 'PaidMonths', 'RemainingMonths', 'StartDate', 'EndDate', 'Status', 'FirstBillingDate'],
  Shopping: ['ID', 'Month', 'Year', 'Group', 'Item', 'Category', 'Quantity', 'Unit', 'EstimatedPrice', 'ActualPrice',
    'Status', 'Notes', 'TransactionID', 'PurchaseDate'],
  Agenda: ['ID', 'Title', 'Date', 'Time', 'Category', 'Owner', 'Priority', 'Status', 'Description'],
  FamilyDocuments: ['ID', 'Owner', 'DocumentType', 'DocumentName', 'DocumentNumber', 'IssueDate', 'ExpiryDate',
    'DriveURL', 'Notes'],
  Settings: ['Key', 'Value', 'Description']
};

// Kolom yang disimpan sebagai teks murni agar tidak diubah otomatis oleh Google Sheets
// (tanggal, jam, nomor dokumen panjang seperti NIK, dll).
const TEXT_COLUMNS = ['ID', 'Date', 'Time', 'StartDate', 'EndDate', 'IssueDate', 'ExpiryDate', 'CreatedAt', 'UpdatedAt',
  'DocumentNumber', 'PinHash', 'TransactionID', 'CardID', 'SourceAccount', 'DestinationAccount', 'Key', 'Value',
  'Description', 'Notes', 'Item', 'Title', 'Name', 'AccountName', 'CardName', 'DocumentName', 'SubCategories',
  'Photo', 'FirstBillingDate', 'PurchaseDate'];

const NUMBER_COLUMNS = ['OpeningBalance', 'CurrentBalance', 'Amount', 'Limit', 'Outstanding', 'AvailableLimit',
  'StatementDate', 'DueDate', 'MinimumPayment', 'Principal', 'Interest', 'AdminFee', 'Tenor', 'MonthlyPayment',
  'TotalAmount', 'PaidMonths', 'RemainingMonths', 'Month', 'Year', 'Quantity', 'EstimatedPrice', 'ActualPrice', 'CurrentBill'];

const BOOLEAN_COLUMNS = ['Active'];

let TABLE_CACHE_ = {};

function clearTableCache_() {
  TABLE_CACHE_ = {};
}

function getDb_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  const sheet = getDb_().getSheetByName(name);
  if (!sheet) throw appError_('Sheet "' + name + '" tidak ditemukan. Jalankan fungsi setupDatabase() di Apps Script.');
  return sheet;
}

function isDatabaseReady_() {
  const db = getDb_();
  if (!db) throw appError_('Spreadsheet database tidak ditemukan. Periksa SPREADSHEET_ID di Code.gs.');
  const settings = db.getSheetByName('Settings');
  return !!settings && settings.getLastRow() > 1 && !!db.getSheetByName('Transactions');
}

/* =========================== SETUP =========================== */

/**
 * Membuat semua sheet + header jika belum ada, lalu mengisi data default & data contoh.
 * Aman dijalankan berulang kali: data yang sudah ada tidak ditimpa.
 */
function setupDatabase() {
  const db = getDb_();
  const created = [];
  Object.keys(SCHEMA).forEach(function (name) {
    let sheet = db.getSheetByName(name);
    if (!sheet) {
      sheet = db.insertSheet(name);
      created.push(name);
    }
    ensureHeaders_(sheet, SCHEMA[name]);
  });
  const defaultSheet = db.getSheetByName('Sheet1') || db.getSheetByName('Sheet 1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && db.getSheets().length > 1) db.deleteSheet(defaultSheet);
  clearTableCache_();

  seedSettings_();
  seedUsers_();
  seedAccounts_();
  seedCreditCards_();
  seedCategories_();
  if (getSetting_('SAMPLE_LOADED', '') !== 'TRUE') {
    insertSampleData_();
    setSetting_('SAMPLE_LOADED', 'TRUE', 'Data contoh sudah pernah dibuat');
  }
  recalculateStoredValues_();
  const message = 'Database siap. Sheet baru: ' + (created.length ? created.join(', ') : '-');
  Logger.log(message);
  return ok_({ created: created }, message);
}

/**
 * Pembaruan struktur database versi lama (dijalankan otomatis sekali saat DB_VERSION berubah).
 * Kolom baru selalu ditambahkan di ujung kanan, data lama tidak diubah.
 */
function migrateDatabase_() {
  const db = getDb_();
  Object.keys(SCHEMA).forEach(function (name) {
    const sheet = db.getSheetByName(name) || db.insertSheet(name);
    ensureHeaders_(sheet, SCHEMA[name]);
  });
  clearTableCache_();
  seedSettings_();
  if (getSetting_('APP_NAME', '') === 'Manajemen Rumah Tangga') setSetting_('APP_NAME', APP_NAME);
  setSetting_('DB_VERSION', DB_VERSION, 'Versi struktur database');
  recalculateStoredValues_();
  Logger.log('Database diperbarui ke versi ' + DB_VERSION);
}

function ensureHeaders_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  headers.forEach(function (header, i) {
    if (current[i] !== header) {
      if (current[i]) throw new Error('Header sheet "' + sheet.getName() + '" kolom ' + (i + 1) +
        ' seharusnya "' + header + '" tetapi berisi "' + current[i] + '". Perbaiki header secara manual.');
      sheet.getRange(1, i + 1).setValue(header);
    }
  });
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) {
    headers.forEach(function (header, i) {
      const format = columnFormat_(header);
      if (format) sheet.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat(format);
    });
  }
}

function columnFormat_(header) {
  if (TEXT_COLUMNS.indexOf(header) !== -1) return '@';
  if (header === 'Month' || header === 'Year' || header === 'Tenor' || header === 'StatementDate' ||
    header === 'DueDate' || header === 'PaidMonths' || header === 'RemainingMonths' || header === 'Quantity' ||
    header === 'Interest' || header === 'MinimumPayment') return '0.##';
  if (NUMBER_COLUMNS.indexOf(header) !== -1) return '#,##0';
  return null;
}

/* =========================== BACA / TULIS TABEL =========================== */

function readTable_(name) {
  if (!TABLE_CACHE_[name]) {
    const sheet = getSheet_(name);
    const headers = SCHEMA[name];
    const lastRow = sheet.getLastRow();
    const rows = [];
    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      values.forEach(function (raw, index) {
        if (raw[0] === '' || raw[0] === null) return;
        const obj = { _row: index + 2 };
        headers.forEach(function (h, i) { obj[h] = normalizeCell_(h, raw[i]); });
        rows.push(obj);
      });
    }
    TABLE_CACHE_[name] = rows;
  }
  return TABLE_CACHE_[name].map(function (r) { return Object.assign({}, r); });
}

function normalizeCell_(header, value) {
  if (value instanceof Date) {
    if (header === 'Time') return Utilities.formatDate(value, APP_TIMEZONE, 'HH:mm');
    if (header === 'CreatedAt' || header === 'UpdatedAt') return Utilities.formatDate(value, APP_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    return Utilities.formatDate(value, APP_TIMEZONE, 'yyyy-MM-dd');
  }
  if (NUMBER_COLUMNS.indexOf(header) !== -1) {
    const num = Number(value);
    return value === '' || !isFinite(num) ? 0 : num;
  }
  if (BOOLEAN_COLUMNS.indexOf(header) !== -1) return isTrue_(value);
  return value === null || value === undefined ? '' : String(value);
}

function toSheetValue_(header, value) {
  if (value === undefined || value === null) return '';
  if (BOOLEAN_COLUMNS.indexOf(header) !== -1) return isTrue_(value);
  if (NUMBER_COLUMNS.indexOf(header) !== -1) return value === '' ? '' : Number(value);
  const text = String(value);
  // Cegah formula injection: teks yang diawali = + - @ disimpan sebagai teks biasa.
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function rowValues_(name, obj) {
  return SCHEMA[name].map(function (h) { return toSheetValue_(h, obj[h]); });
}

function rowFormats_(name) {
  return [SCHEMA[name].map(function (h) { return columnFormat_(h) || 'General'; })];
}

function ensureRowCapacity_(sheet, neededLastRow) {
  const maxRows = sheet.getMaxRows();
  if (neededLastRow > maxRows) sheet.insertRowsAfter(maxRows, Math.max(100, neededLastRow - maxRows));
}

function insertRow_(name, obj) {
  insertRows_(name, [obj]);
  return obj;
}

function insertRows_(name, objs) {
  if (!objs.length) return;
  const sheet = getSheet_(name);
  const start = Math.max(sheet.getLastRow(), 1) + 1;
  ensureRowCapacity_(sheet, start + objs.length - 1);
  const width = SCHEMA[name].length;
  const range = sheet.getRange(start, 1, objs.length, width);
  const format = rowFormats_(name)[0];
  range.setNumberFormats(objs.map(function () { return format; }));
  range.setValues(objs.map(function (o) { return rowValues_(name, o); }));
  delete TABLE_CACHE_[name];
}

function findRow_(name, id) {
  return readTable_(name).filter(function (r) { return String(r[SCHEMA[name][0]]) === String(id); })[0] || null;
}

function updateRow_(name, id, patch) {
  const existing = findRow_(name, id);
  if (!existing) throw appError_('Data dengan ID ' + id + ' tidak ditemukan.', 'NOT_FOUND');
  const merged = Object.assign({}, existing, patch);
  const sheet = getSheet_(name);
  const range = sheet.getRange(existing._row, 1, 1, SCHEMA[name].length);
  range.setNumberFormats(rowFormats_(name));
  range.setValues([rowValues_(name, merged)]);
  delete TABLE_CACHE_[name];
  return merged;
}

function deleteRowById_(name, id) {
  const existing = findRow_(name, id);
  if (!existing) throw appError_('Data dengan ID ' + id + ' tidak ditemukan.', 'NOT_FOUND');
  getSheet_(name).deleteRow(existing._row);
  delete TABLE_CACHE_[name];
  return existing;
}

function deleteRowsWhere_(name, predicate) {
  const rows = readTable_(name).filter(predicate).sort(function (a, b) { return b._row - a._row; });
  const sheet = getSheet_(name);
  rows.forEach(function (r) { sheet.deleteRow(r._row); });
  delete TABLE_CACHE_[name];
  return rows.length;
}

/** Menulis ulang nilai beberapa kolom untuk banyak baris sekaligus (satu kali setValues). */
function rewriteColumns_(name, updatesById) {
  const rows = readTable_(name);
  if (!rows.length) return;
  const idKey = SCHEMA[name][0];
  let changed = false;
  const values = rows.map(function (row) {
    const patch = updatesById[row[idKey]];
    if (patch) {
      Object.keys(patch).forEach(function (k) {
        if (row[k] !== patch[k]) { row[k] = patch[k]; changed = true; }
      });
    }
    return row;
  });
  if (!changed) return;
  const sheet = getSheet_(name);
  // Baris tabel selalu berurutan mulai baris 2 karena baris kosong tidak pernah disisakan oleh helper ini.
  const firstRow = values[0]._row;
  const lastRow = values[values.length - 1]._row;
  if (lastRow - firstRow + 1 !== values.length) {
    values.forEach(function (row) {
      sheet.getRange(row._row, 1, 1, SCHEMA[name].length).setValues([rowValues_(name, row)]);
    });
  } else {
    sheet.getRange(firstRow, 1, values.length, SCHEMA[name].length).setValues(values.map(function (r) { return rowValues_(name, r); }));
  }
  delete TABLE_CACHE_[name];
}

/** ID berurutan, contoh: nextSimpleId_('Agenda', 'AGD', 4) → AGD-0007. */
function nextSimpleId_(name, prefix, width) {
  const size = width || 3;
  let max = 0;
  const pattern = new RegExp('^' + prefix + '-(\\d+)$');
  readTable_(name).forEach(function (r) {
    const m = pattern.exec(String(r[SCHEMA[name][0]]));
    if (m) max = Math.max(max, Number(m[1]));
  });
  const next = String(max + 1);
  return prefix + '-' + (next.length >= size ? next : ('0000000000' + next).slice(-size));
}

/* =========================== SETTINGS =========================== */

function getSettingsMap_() {
  const map = {};
  readTable_('Settings').forEach(function (r) { map[r.Key] = r.Value; });
  return map;
}

function getSetting_(key, fallback) {
  const value = getSettingsMap_()[key];
  return value === undefined || value === '' ? fallback : value;
}

function setSetting_(key, value, description) {
  const existing = readTable_('Settings').filter(function (r) { return r.Key === key; })[0];
  if (existing) {
    updateRow_('Settings', key, { Value: String(value), Description: description || existing.Description });
  } else {
    insertRow_('Settings', { Key: key, Value: String(value), Description: description || '' });
  }
}

/* =========================== DATA DEFAULT =========================== */

function seedSettings_() {
  const defaults = [
    ['APP_NAME', APP_NAME, 'Nama aplikasi'],
    ['DB_VERSION', DB_VERSION, 'Versi struktur database'],
    ['AUTH_SALT', Utilities.getUuid(), 'Salt untuk hash PIN. JANGAN diubah (semua PIN akan tidak berlaku).'],
    ['ALLOW_BANK_TO_BANK', 'TRUE', 'Izinkan transfer antar rekening bank'],
    ['ALLOW_CASH_TRANSFER', 'FALSE', 'Izinkan transfer dari kas tunai (setor tunai / antar dompet)'],
    ['SHOPPING_BUDGET_CATEGORY', 'Belanja Bahan Makanan', 'Kategori anggaran yang dipakai sebagai budget menu Belanja'],
    ['INSTALLMENT_BILLING_DAY', '16', 'Tanggal cicilan kartu kredit ditagihkan setiap bulan (berlaku untuk cicilan baru)'],
    ['LAST_BACKUP', '', 'Tanggal backup terakhir'],
    ['LAST_BACKUP_BY', '', 'Pengguna yang terakhir melakukan backup'],
    ['SAMPLE_IDS', '[]', 'Daftar ID data contoh (dipakai fitur Hapus Data Contoh)']
  ];
  const existing = getSettingsMap_();
  const missing = defaults.filter(function (d) { return existing[d[0]] === undefined; })
    .map(function (d) { return { Key: d[0], Value: d[1], Description: d[2] }; });
  insertRows_('Settings', missing);
}

function seedUsers_() {
  if (readTable_('Users').length) return;
  const pinHash = hashPin_('1234');
  const now = nowStr_();
  insertRows_('Users', [
    { ID: 'USR-001', Name: 'Admin', Role: 'Admin', PinHash: pinHash, Active: true, CreatedAt: now },
    { ID: 'USR-002', Name: 'Bapak', Role: 'Bapak', PinHash: pinHash, Active: true, CreatedAt: now },
    { ID: 'USR-003', Name: 'Ibu', Role: 'Ibu', PinHash: pinHash, Active: true, CreatedAt: now },
    { ID: 'USR-004', Name: 'Tamu', Role: 'Viewer', PinHash: pinHash, Active: true, CreatedAt: now }
  ]);
}

function seedAccounts_() {
  if (readTable_('Accounts').length) return;
  insertRows_('Accounts', [
    ['ACC-001', 'Mandiri', 'Bank', 10000000],
    ['ACC-002', 'BRI', 'Bank', 5000000],
    ['ACC-003', 'BCA', 'Bank', 7500000],
    ['ACC-004', 'BLU', 'Bank', 2000000],
    ['ACC-005', 'Cash Bapak', 'Tunai', 500000],
    ['ACC-006', 'Cash Ibu', 'Tunai', 750000]
  ].map(function (a) {
    return { ID: a[0], AccountName: a[1], AccountType: a[2], OpeningBalance: a[3], CurrentBalance: a[3], Active: true };
  }));
}

function seedCreditCards_() {
  if (readTable_('CreditCards').length) return;
  insertRows_('CreditCards', [
    { ID: 'CC-001', CardName: 'Mandiri Visa', Bank: 'Bank Mandiri', Limit: 20000000, Outstanding: 0, AvailableLimit: 20000000,
      StatementDate: 17, DueDate: 5, MinimumPayment: 10, Active: true },
    { ID: 'CC-002', CardName: 'Tokopedia Card', Bank: 'Bank Mandiri', Limit: 10000000, Outstanding: 0, AvailableLimit: 10000000,
      StatementDate: 25, DueDate: 12, MinimumPayment: 10, Active: true }
  ]);
}

const DEFAULT_EXPENSE_CATEGORIES = [
  ['Rumah', 'Sewa/KPR,Perbaikan,Perabot,Kebersihan', '#0f766e'],
  ['Transportasi', 'Bensin,Parkir,Tol,Servis Kendaraan,Ojek Online', '#2563eb'],
  ['Pendidikan', 'SPP,Buku,Les,Seragam,Kegiatan Sekolah', '#7c3aed'],
  ['Belanja Bahan Makanan', 'Bahan Pokok,Sayur & Buah,Lauk,Bumbu', '#16a34a'],
  ['Jajan', 'Makan di Luar,Snack,Kopi', '#f59e0b'],
  ['Tagihan', 'Listrik,Air,Internet,Pulsa,Asuransi', '#dc2626'],
  ['Kesehatan', 'Obat,Dokter,Vitamin', '#db2777'],
  ['Lainnya', 'Hadiah,Donasi,Lain-lain', '#64748b']
];

const DEFAULT_INCOME_CATEGORIES = [
  ['Gaji', 'Gaji Bapak,Gaji Ibu', '#059669'],
  ['Bonus', 'THR,Bonus Kerja', '#0891b2'],
  ['Pendapatan Lain', 'Usaha,Bunga Bank,Lain-lain', '#4f46e5']
];

function seedCategories_() {
  if (readTable_('Categories').length) return;
  const rows = [];
  DEFAULT_EXPENSE_CATEGORIES.forEach(function (c, i) {
    rows.push({ ID: 'CAT-' + ('00' + (i + 1)).slice(-3), Name: c[0], Type: 'Pengeluaran', SubCategories: c[1], Color: c[2], Active: true });
  });
  DEFAULT_INCOME_CATEGORIES.forEach(function (c, i) {
    rows.push({ ID: 'CAT-' + ('00' + (i + 101)).slice(-3), Name: c[0], Type: 'Pemasukan', SubCategories: c[1], Color: c[2], Active: true });
  });
  insertRows_('Categories', rows);
}

/* =========================== DATA CONTOH =========================== */

function insertSampleData_() {
  const today = parseDateStr_(todayStr_());
  const cur = { y: today.y, m: today.m };
  const prev = previousMonth_(today.m, today.y);
  const d = function (period, day) {
    const y = period.y || period.year, m = period.m || period.month;
    const maxDay = (y === today.y && m === today.m) ? today.d : daysInMonth_(y, m);
    return dateStr_(y, m, Math.min(day, maxDay));
  };
  const now = nowStr_();
  const ids = [];
  let seq = {};
  const trxId = function (date) {
    const key = date.replace(/-/g, '');
    seq[key] = (seq[key] || 0) + 1;
    return 'TRX-' + key + '-' + ('000' + seq[key]).slice(-4);
  };
  const trx = function (date, type, src, dst, cat, sub, amount, desc, method) {
    const id = trxId(date);
    ids.push(id);
    return { ID: id, Date: date, Type: type, SourceAccount: src, DestinationAccount: dst || '', Category: cat,
      SubCategory: sub || '', Amount: amount, Description: desc, PaymentMethod: method, CreatedBy: 'Contoh',
      CreatedAt: now, UpdatedAt: now, Attachment: '' };
  };

  const installmentStart = d(prev, 15);
  const transactions = [
    trx(d(prev, 25), 'Pemasukan', 'ACC-001', '', 'Gaji', 'Gaji Bapak', 15000000, 'Gaji Bapak bulan lalu', 'Transfer'),
    trx(d(prev, 10), 'Pengeluaran', 'CC-001', '', 'Kesehatan', 'Dokter', 350000, 'Periksa dokter anak', 'Kartu Kredit'),
    trx(d(prev, 5), 'Pengeluaran', 'ACC-006', '', 'Belanja Bahan Makanan', 'Bahan Pokok', 467000, 'Belanja bulanan: 8 item dari daftar belanja', 'Tunai'),
    trx(installmentStart, 'Cicilan', 'CC-002', '', 'Rumah', 'Perabot', 6000000, 'Kulkas 2 pintu (cicilan 6 bulan)', 'Kartu Kredit'),
    trx(d(cur, 1), 'Pemasukan', 'ACC-003', '', 'Gaji', 'Gaji Ibu', 8000000, 'Gaji Ibu', 'Transfer'),
    trx(d(cur, 2), 'Transfer', 'ACC-001', 'ACC-005', 'Transfer', '', 1000000, 'Uang saku Bapak', 'Transfer'),
    trx(d(cur, 2), 'Transfer', 'ACC-003', 'ACC-006', 'Transfer', '', 1500000, 'Uang belanja Ibu', 'Transfer'),
    trx(d(cur, 3), 'Pengeluaran', 'ACC-006', '', 'Belanja Bahan Makanan', 'Bahan Pokok', 650000, 'Belanja pasar', 'Tunai'),
    trx(d(cur, 5), 'Pengeluaran', 'ACC-002', '', 'Tagihan', 'Listrik', 450000, 'Token listrik', 'Transfer'),
    trx(d(cur, 6), 'Pengeluaran', 'CC-001', '', 'Belanja Bahan Makanan', 'Bahan Pokok', 1200000, 'Belanja bulanan supermarket', 'Kartu Kredit'),
    trx(d(cur, 7), 'Pengeluaran', 'ACC-005', '', 'Transportasi', 'Bensin', 300000, 'Isi bensin mobil', 'Tunai'),
    trx(d(cur, 8), 'Pembayaran Kartu Kredit', 'ACC-001', 'CC-001', 'Kartu Kredit', '', 350000, 'Bayar tagihan Mandiri Visa', 'Transfer'),
    trx(d(cur, 10), 'Pengeluaran', 'ACC-001', '', 'Pendidikan', 'SPP', 750000, 'SPP sekolah anak', 'Transfer'),
    trx(d(cur, 12), 'Pengeluaran', 'ACC-006', '', 'Jajan', 'Snack', 85000, 'Jajan anak', 'Tunai'),
    trx(d(cur, 13), 'Pengeluaran', 'ACC-004', '', 'Tagihan', 'Internet', 350000, 'Internet rumah', 'Transfer')
  ];
  insertRows_('Transactions', transactions);

  const inst = buildInstallment_({
    id: 'INS-001', transactionId: transactions[3].ID, cardId: 'CC-002', description: 'Kulkas 2 pintu',
    principal: 6000000, interestRate: 0, adminFee: 0, tenor: 6, startDate: installmentStart
  });
  insertRow_('Installments', inst);
  ids.push(inst.ID);

  const budgetAmounts = { 'Rumah': 1500000, 'Transportasi': 800000, 'Pendidikan': 1000000, 'Belanja Bahan Makanan': 3000000,
    'Jajan': 500000, 'Tagihan': 1200000, 'Kesehatan': 500000, 'Lainnya': 500000 };
  const budgets = [];
  [prev, { month: cur.m, year: cur.y }].forEach(function (p, pi) {
    Object.keys(budgetAmounts).forEach(function (cat, ci) {
      const id = 'BGT-' + p.year + ('0' + p.month).slice(-2) + '-' + ('0' + (ci + 1)).slice(-2);
      ids.push(id);
      budgets.push({ ID: id, Month: p.month, Year: p.year, Category: cat, Amount: budgetAmounts[cat] });
    });
  });
  insertRows_('Budgets', budgets);

  const shopping = [];
  const shop = function (group, item, cat, qty, unit, est, actual, status, notes) {
    const id = 'SHP-' + ('000' + (shopping.length + 1)).slice(-4);
    ids.push(id);
    shopping.push({ ID: id, Month: prev.month, Year: prev.year, Group: group, Item: item, Category: cat, Quantity: qty,
      Unit: unit, EstimatedPrice: est, ActualPrice: actual, Status: status, Notes: notes || '',
      TransactionID: status === 'Sudah dibeli' ? transactions[2].ID : '', PurchaseDate: status === 'Sudah dibeli' ? transactions[2].Date : '' });
  };
  shop('MANDATORY', 'Beras', 'Bahan Pokok', 10, 'kg', 150000, 148000, 'Sudah dibeli');
  shop('MANDATORY', 'Minyak goreng', 'Bahan Pokok', 2, 'liter', 40000, 38000, 'Sudah dibeli');
  shop('MANDATORY', 'Telur', 'Bahan Pokok', 1, 'kg', 30000, 29000, 'Sudah dibeli');
  shop('MANDATORY', 'Susu UHT', 'Minuman', 4, 'kotak', 60000, 62000, 'Sudah dibeli');
  shop('MANDATORY', 'Air mineral galon', 'Minuman', 4, 'galon', 80000, 80000, 'Sudah dibeli');
  shop('MANDATORY', 'Sabun mandi', 'Kebersihan', 3, 'pcs', 25000, 24000, 'Sudah dibeli');
  shop('MANDATORY', 'Detergen', 'Kebersihan', 1, 'pak', 30000, 31000, 'Sudah dibeli');
  shop('COMPLEMENTARY', 'Buah-buahan', 'Sayur & Buah', 1, 'kg', 50000, 55000, 'Sudah dibeli', 'Untuk bekal anak');
  shop('COMPLEMENTARY', 'Camilan anak', 'Camilan', 2, 'pak', 35000, 0, 'Belum dibeli');
  insertRows_('Shopping', shopping);

  const todayText = todayStr_();
  const agenda = [
    ['Antar anak ke sekolah', 0, '06:30', 'Sekolah', 'Bapak', 'Sedang', 'Belum', 'Berangkat sebelum 06.30'],
    ['Belanja mingguan', 0, '16:00', 'Belanja', 'Ibu', 'Sedang', 'Proses', 'Cek daftar belanja di aplikasi'],
    ['Bayar SPP bulan depan', 2, '09:00', 'Keuangan', 'Bapak', 'Tinggi', 'Belum', ''],
    ['Kontrol gigi anak', 5, '10:00', 'Kesehatan', 'Ibu', 'Sedang', 'Belum', 'Klinik dekat rumah'],
    ['Rapat RT', -1, '19:30', 'Keluarga', 'Bapak', 'Rendah', 'Selesai', ''],
    ['Perpanjang SIM Bapak', 10, '08:00', 'Lainnya', 'Bapak', 'Tinggi', 'Belum', 'Bawa KTP asli']
  ].map(function (a, i) {
    const id = 'AGD-' + ('000' + (i + 1)).slice(-4);
    ids.push(id);
    return { ID: id, Title: a[0], Date: addDaysStr_(todayText, a[1]), Time: a[2], Category: a[3], Owner: a[4],
      Priority: a[5], Status: a[6], Description: a[7] };
  });
  insertRows_('Agenda', agenda);

  const docs = [
    ['Kartu Keluarga', 'Kartu Keluarga', 'Kartu Keluarga', 'CONTOH-KK-0001', -1500, null],
    ['Bapak', 'KTP', 'KTP Bapak', 'CONTOH-KTP-0001', -2000, null],
    ['Bapak', 'SIM', 'SIM A Bapak', 'CONTOH-SIM-0001', -1800, 20],
    ['Bapak', 'NPWP', 'NPWP Bapak', 'CONTOH-NPWP-0001', -3000, null],
    ['Ibu', 'Paspor', 'Paspor Ibu', 'CONTOH-PSP-0001', -1750, 75],
    ['Ibu', 'BPJS', 'BPJS Kesehatan Ibu', 'CONTOH-BPJS-0001', -1000, null],
    ['Anak', 'Akta kelahiran', 'Akta Kelahiran Anak', 'CONTOH-AKTA-0001', -2500, null],
    ['Anak', 'KIA', 'KIA Anak', 'CONTOH-KIA-0001', -1500, -10]
  ].map(function (x, i) {
    const id = 'DOC-' + ('000' + (i + 1)).slice(-4);
    ids.push(id);
    return { ID: id, Owner: x[0], DocumentType: x[1], DocumentName: x[2], DocumentNumber: x[3],
      IssueDate: addDaysStr_(todayText, x[4]), ExpiryDate: x[5] === null ? '' : addDaysStr_(todayText, x[5]),
      DriveURL: '', Notes: 'Data contoh — boleh dihapus' };
  });
  insertRows_('FamilyDocuments', docs);

  setSetting_('SAMPLE_IDS', JSON.stringify(ids));
}

/** Menghapus semua data contoh (transaksi, anggaran, belanja, agenda, dokumen, cicilan). */
function deleteSampleData() {
  const ids = parseJsonSafe_(getSetting_('SAMPLE_IDS', '[]'), []);
  if (!ids.length) return ok_({ deleted: 0 }, 'Tidak ada data contoh yang tersisa');
  const set = {};
  ids.forEach(function (id) { set[id] = true; });
  let deleted = 0;
  ['Transactions', 'Installments', 'Budgets', 'Shopping', 'Agenda', 'FamilyDocuments'].forEach(function (name) {
    deleted += deleteRowsWhere_(name, function (r) { return set[r.ID]; });
  });
  setSetting_('SAMPLE_IDS', '[]');
  recalculateStoredValues_();
  return ok_({ deleted: deleted }, deleted + ' data contoh berhasil dihapus');
}

function addSampleIds_(newIds) {
  const ids = parseJsonSafe_(getSetting_('SAMPLE_IDS', '[]'), []);
  setSetting_('SAMPLE_IDS', JSON.stringify(ids.concat(newIds)));
}

function isSampleId_(id) {
  return parseJsonSafe_(getSetting_('SAMPLE_IDS', '[]'), []).indexOf(id) !== -1;
}
