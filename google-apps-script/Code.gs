/**
 * Homie (Manajemen Rumah Tangga) — Backend Google Apps Script
 * File ini berisi: konfigurasi, entry point Web App (doGet/doPost), router aksi,
 * autentikasi PIN sederhana, pengaturan, dan helper respons/validasi umum.
 */

const APP_NAME = 'Homie';
const APP_TIMEZONE = 'Asia/Jakarta';

// Kosongkan jika script ini dibuat dari menu Extensions → Apps Script pada spreadsheet database
// (bound script). Isi dengan ID spreadsheet jika script dibuat terpisah (standalone).
const SPREADSHEET_ID = '';

const SESSION_TTL_SECONDS = 21600; // 6 jam (batas maksimum CacheService)
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_SECONDS = 900;
const WRITE_ROLES = ['Admin', 'Bapak', 'Ibu'];
const ALL_ROLES = ['Admin', 'Bapak', 'Ibu', 'Viewer'];

/**
 * Daftar aksi API.
 * public: tidak perlu login. write: mengubah data (butuh role Admin/Bapak/Ibu). admin: khusus Admin.
 */
const ROUTES = {
  ping: { public: true, fn: apiPing_ },
  getUsers: { public: true, fn: apiGetUsers_ },
  login: { public: true, fn: apiLogin_ },
  logout: { fn: apiLogout_ },
  changePin: { fn: apiChangePin_ },
  updateProfile: { fn: apiUpdateProfile_ },
  getMasterData: { fn: getMasterData },

  getDashboard: { fn: getDashboard },
  getSummary: { fn: getSummary },
  getTransactions: { fn: getTransactions },
  getAccounts: { fn: getAccounts },
  getBudgets: { fn: getBudgets },
  getCreditCards: { fn: getCreditCards },
  getInstallments: { fn: getInstallments },
  getCategories: { fn: getCategories },
  getReport: { fn: getReport },
  getShopping: { fn: getShopping },
  getAgenda: { fn: getAgenda },
  getDocuments: { fn: getDocuments },
  getSettings: { fn: getSettings },
  exportAll: { fn: exportAll },

  addTransaction: { write: true, fn: addTransaction },
  updateTransaction: { write: true, fn: updateTransaction },
  deleteTransaction: { write: true, fn: deleteTransaction },
  payCreditCard: { write: true, fn: payCreditCard },
  saveAccount: { write: true, fn: saveAccount },
  saveCreditCard: { write: true, fn: saveCreditCard },
  saveCategory: { write: true, fn: saveCategory },
  deleteCategory: { write: true, fn: deleteCategory },
  saveBudget: { write: true, fn: saveBudget },
  copyBudget: { write: true, fn: copyBudget },

  addShopping: { write: true, fn: addShopping },
  updateShopping: { write: true, fn: updateShopping },
  deleteShopping: { write: true, fn: deleteShopping },
  copyShopping: { write: true, fn: copyShopping },
  checkoutShopping: { write: true, fn: checkoutShopping },

  addAgenda: { write: true, fn: addAgenda },
  updateAgenda: { write: true, fn: updateAgenda },
  deleteAgenda: { write: true, fn: deleteAgenda },

  addDocument: { write: true, fn: addDocument },
  updateDocument: { write: true, fn: updateDocument },
  deleteDocument: { write: true, fn: deleteDocument },

  recordBackup: { write: true, fn: recordBackup },
  updateSettings: { write: true, admin: true, fn: updateSettings },
  saveUser: { write: true, admin: true, fn: saveUser },
  deleteSampleData: { write: true, admin: true, fn: deleteSampleData }
};

// Aksi yang boleh dipanggil lewat GET (hanya baca).
const GET_ALLOWED = ['ping', 'getUsers'];

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || 'ping';
  if (GET_ALLOWED.indexOf(action) === -1) {
    return jsonOutput_(fail_('Gunakan metode POST untuk aksi "' + action + '".'));
  }
  return jsonOutput_(handleRequest_({ action: action, data: params }));
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOutput_(fail_('Format permintaan tidak valid (bukan JSON).'));
  }
  return jsonOutput_(handleRequest_(body));
}

/** Router utama. Dipakai oleh doGet/doPost dan juga oleh mode demo di browser. */
function handleRequest_(body) {
  clearTableCache_();
  try {
    body = body || {};
    const action = String(body.action || '');
    const route = ROUTES[action];
    if (!route) return fail_('Aksi "' + action + '" tidak dikenal.');

    if (!isDatabaseReady_()) {
      withLock_(function () { if (!isDatabaseReady_()) setupDatabase(); });
    } else if (getSetting_('DB_VERSION', '1') !== DB_VERSION) {
      withLock_(function () { clearTableCache_(); if (getSetting_('DB_VERSION', '1') !== DB_VERSION) migrateDatabase_(); });
    }

    let user = null;
    if (!route.public) {
      user = getSessionUser_(body.token);
      if (!user) return fail_('Sesi Anda sudah berakhir. Silakan masuk kembali.', 'AUTH_REQUIRED');
      if (route.write && WRITE_ROLES.indexOf(user.role) === -1) {
        return fail_('Akun ' + user.name + ' (Viewer) hanya dapat melihat data.', 'FORBIDDEN');
      }
      if (route.admin && user.role !== 'Admin') {
        return fail_('Hanya Admin yang dapat melakukan aksi ini.', 'FORBIDDEN');
      }
    }

    const data = body.data || {};
    if (route.write) {
      return withLock_(function () { return route.fn(data, user); });
    }
    return route.fn(data, user);
  } catch (err) {
    if (err && err.isAppError) return fail_(err.message, err.code);
    console.error(err && err.stack ? err.stack : err);
    return fail_('Terjadi kesalahan pada server: ' + (err && err.message ? err.message : String(err)));
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw appError_('Server sedang sibuk memproses data lain. Coba lagi beberapa detik lagi.', 'BUSY');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* =========================== RESPONS & ERROR =========================== */

function ok_(data, message) {
  return { success: true, message: message || 'Berhasil', data: data === undefined ? {} : data };
}

function fail_(message, code) {
  const res = { success: false, message: message || 'Terjadi kesalahan' };
  if (code) res.code = code;
  return res;
}

function appError_(message, code) {
  const err = new Error(message);
  err.isAppError = true;
  err.code = code || 'VALIDATION';
  return err;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiPing_() {
  return ok_({ app: APP_NAME, time: nowStr_(), timezone: APP_TIMEZONE }, 'API aktif');
}

/* =========================== AUTENTIKASI =========================== */

function apiGetUsers_() {
  const users = readTable_('Users')
    .filter(function (u) { return isTrue_(u.Active); })
    .map(function (u) { return { id: u.ID, name: u.Name, role: u.Role }; });
  return ok_(users);
}

function apiLogin_(data) {
  const userId = requireString_(data.userId, 'Pengguna', 50);
  const pin = requireString_(data.pin, 'PIN', 20);
  const cache = CacheService.getScriptCache();
  const failKey = 'login_fail_' + userId;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_LOGIN_ATTEMPTS) {
    throw appError_('Terlalu banyak percobaan PIN salah. Coba lagi 15 menit lagi.', 'LOCKED');
  }
  const user = readTable_('Users').filter(function (u) { return u.ID === userId && isTrue_(u.Active); })[0];
  if (!user) throw appError_('Pengguna tidak ditemukan atau sudah dinonaktifkan.');
  if (hashPin_(pin) !== String(user.PinHash)) {
    cache.put(failKey, String(fails + 1), LOGIN_LOCK_SECONDS);
    const left = MAX_LOGIN_ATTEMPTS - fails - 1;
    throw appError_(left > 0 ? 'PIN salah. Sisa percobaan: ' + left + '.' : 'PIN salah. Akun dikunci sementara 15 menit.', 'BAD_PIN');
  }
  cache.remove(failKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const session = { id: user.ID, name: user.Name, role: user.Role };
  cache.put('session_' + token, JSON.stringify(session), SESSION_TTL_SECONDS);
  return ok_({ token: token, user: Object.assign({ photo: user.Photo || '' }, session) }, 'Selamat datang, ' + user.Name + '!');
}

function apiLogout_(data, user) {
  if (data && data.token) CacheService.getScriptCache().remove('session_' + data.token);
  return ok_({}, 'Berhasil keluar');
}

/**
 * Sesi disimpan di cache, tetapi nama/role/status selalu dibaca ulang dari sheet Users
 * sehingga perubahan oleh Admin (ganti role, nonaktifkan akun) langsung berlaku.
 */
function getSessionUser_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const raw = cache.get('session_' + token);
  if (!raw) return null;
  const session = parseJsonSafe_(raw, null);
  const row = session && readTable_('Users').filter(function (u) { return u.ID === session.id; })[0];
  if (!row || !isTrue_(row.Active)) {
    cache.remove('session_' + token);
    return null;
  }
  cache.put('session_' + token, raw, SESSION_TTL_SECONDS);
  return { id: row.ID, name: row.Name, role: row.Role, photo: row.Photo || '' };
}

/** Foto profil: gambar kecil (maks ±30 KB) dalam format data URL, disimpan di sheet Users. */
const MAX_PHOTO_LENGTH = 45000;

function validatePhoto_(photo) {
  const text = String(photo || '').trim();
  if (!text) return '';
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/]+=*$/.test(text)) {
    throw appError_('Format foto tidak didukung. Gunakan foto JPG, PNG, atau WEBP.');
  }
  if (text.length > MAX_PHOTO_LENGTH) throw appError_('Ukuran foto terlalu besar. Pilih foto lain.');
  return text;
}

function ensureUniqueUserName_(name, exceptId) {
  const clash = readTable_('Users').some(function (u) { return u.Name.toLowerCase() === name.toLowerCase() && u.ID !== exceptId; });
  if (clash) throw appError_('Nama "' + name + '" sudah dipakai pengguna lain.');
}

function publicUser_(u) {
  return { id: u.ID, name: u.Name, role: u.Role, active: isTrue_(u.Active), photo: u.Photo || '', createdAt: u.CreatedAt, updatedAt: u.UpdatedAt };
}

/** Akun Saya: setiap pengguna (termasuk Viewer) boleh mengubah nama dan foto profilnya sendiri. */
function apiUpdateProfile_(data, user) {
  return withLock_(function () {
    clearTableCache_();
    const patch = { UpdatedAt: nowStr_() };
    if (data.name !== undefined) {
      patch.Name = requireString_(data.name, 'Nama', 40);
      ensureUniqueUserName_(patch.Name, user.id);
    }
    if (data.photo !== undefined) patch.Photo = validatePhoto_(data.photo);
    const updated = updateRow_('Users', user.id, patch);
    const out = publicUser_(updated);
    return ok_({ id: out.id, name: out.name, role: out.role, photo: out.photo }, 'Profil berhasil diperbarui');
  });
}

function apiChangePin_(data, user) {
  const oldPin = requireString_(data.oldPin, 'PIN lama', 20);
  const newPin = validatePin_(data.newPin);
  return withLock_(function () {
    const row = readTable_('Users').filter(function (u) { return u.ID === user.id; })[0];
    if (!row) throw appError_('Pengguna tidak ditemukan.');
    if (hashPin_(oldPin) !== String(row.PinHash)) throw appError_('PIN lama tidak sesuai.');
    updateRow_('Users', user.id, { PinHash: hashPin_(newPin) });
    return ok_({}, 'PIN berhasil diganti');
  });
}

/** Admin: tambah pengguna atau ubah akun pengguna mana pun (nama, role, foto, status aktif, reset PIN). */
function saveUser(data, admin) {
  const name = requireString_(data.name, 'Nama pengguna', 40);
  const role = requireEnum_(data.role, ALL_ROLES, 'Role');
  const active = data.active === undefined ? true : isTrue_(data.active);
  const users = readTable_('Users');
  ensureUniqueUserName_(name, data.id);

  if (data.id) {
    const existing = users.filter(function (u) { return u.ID === data.id; })[0];
    if (!existing) throw appError_('Pengguna tidak ditemukan.');
    if (admin && admin.id === data.id && !active) throw appError_('Anda tidak dapat menonaktifkan akun Anda sendiri.');
    const patch = { Name: name, Role: role, Active: active, UpdatedAt: nowStr_() };
    if (data.pin) patch.PinHash = hashPin_(validatePin_(data.pin));
    if (data.photo !== undefined) patch.Photo = validatePhoto_(data.photo);
    const admins = users.filter(function (u) { return u.Role === 'Admin' && isTrue_(u.Active) && u.ID !== data.id; });
    if (admins.length === 0 && (role !== 'Admin' || !active)) {
      throw appError_('Minimal harus ada satu Admin yang aktif.');
    }
    updateRow_('Users', data.id, patch);
    return ok_({ id: data.id }, 'Pengguna berhasil diperbarui');
  }
  const pin = validatePin_(data.pin);
  const id = nextSimpleId_('Users', 'USR');
  const now = nowStr_();
  insertRow_('Users', { ID: id, Name: name, Role: role, PinHash: hashPin_(pin), Active: active, CreatedAt: now,
    Photo: validatePhoto_(data.photo), UpdatedAt: now });
  return ok_({ id: id }, 'Pengguna berhasil ditambahkan');
}

function validatePin_(pin) {
  const value = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(value)) throw appError_('PIN harus 4–8 digit angka.');
  return value;
}

function hashPin_(pin) {
  const salt = getSetting_('AUTH_SALT', '');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + String(pin), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/**
 * Jalankan dari editor Apps Script untuk mengganti PIN seseorang secara manual.
 * Ubah nama & PIN di bawah, pilih fungsi ini, lalu klik Run.
 */
function gantiPinManual() {
  const namaPengguna = 'Admin';
  const pinBaru = '123456';
  setUserPin(namaPengguna, pinBaru);
}

function setUserPin(userName, newPin) {
  const pin = validatePin_(newPin);
  const user = readTable_('Users').filter(function (u) { return u.Name === userName; })[0];
  if (!user) throw new Error('Pengguna "' + userName + '" tidak ditemukan di sheet Users.');
  updateRow_('Users', user.ID, { PinHash: hashPin_(pin) });
  Logger.log('PIN untuk ' + userName + ' berhasil diganti.');
}

/* =========================== MASTER DATA & PENGATURAN =========================== */

const PUBLIC_SETTINGS = ['APP_NAME', 'ALLOW_BANK_TO_BANK', 'ALLOW_CASH_TRANSFER', 'LAST_BACKUP', 'LAST_BACKUP_BY', 'DB_VERSION',
  'SHOPPING_BUDGET_CATEGORY', 'INSTALLMENT_BILLING_DAY'];

function getMasterData(data, user) {
  const ledger = buildLedger_();
  return ok_({
    user: user,
    accounts: accountsWithBalance_(ledger),
    cards: cardsWithOutstanding_(ledger),
    categories: readTable_('Categories').map(publicCategory_),
    users: readTable_('Users').filter(function (u) { return isTrue_(u.Active); })
      .map(function (u) { return { id: u.ID, name: u.Name, role: u.Role, photo: u.Photo || '' }; }),
    settings: publicSettings_(),
    today: todayStr_()
  });
}

function publicSettings_() {
  const all = getSettingsMap_();
  const out = {};
  PUBLIC_SETTINGS.forEach(function (k) { if (all[k] !== undefined) out[k] = all[k]; });
  out.SAMPLE_COUNT = parseJsonSafe_(all.SAMPLE_IDS, []).length;
  return out;
}

function getSettings(data, user) {
  const settings = publicSettings_();
  if (user && user.role === 'Admin') {
    settings.users = readTable_('Users').map(publicUser_);
  }
  return ok_(settings);
}

function updateSettings(data) {
  const allowed = { ALLOW_BANK_TO_BANK: 'bool', ALLOW_CASH_TRANSFER: 'bool', SHOPPING_BUDGET_CATEGORY: 'text', INSTALLMENT_BILLING_DAY: 'day' };
  Object.keys(data || {}).forEach(function (key) {
    if (!allowed[key]) return;
    let value;
    if (allowed[key] === 'bool') value = isTrue_(data[key]) ? 'TRUE' : 'FALSE';
    else if (allowed[key] === 'day') value = String(Math.round(toNumber_(data[key], 'Tanggal penagihan cicilan', 1, 28)));
    else value = requireString_(data[key], key, 60);
    setSetting_(key, value);
  });
  return ok_(publicSettings_(), 'Pengaturan berhasil disimpan');
}

function recordBackup(data, user) {
  setSetting_('LAST_BACKUP', nowStr_());
  setSetting_('LAST_BACKUP_BY', user ? user.name : '-');
  return ok_(publicSettings_(), 'Tanggal backup dicatat');
}

function exportAll() {
  const tables = {};
  Object.keys(SCHEMA).forEach(function (name) {
    if (name === 'Settings') return;
    const headers = SCHEMA[name].filter(function (h) { return h !== 'PinHash' && h !== 'Photo'; });
    tables[name] = readTable_(name).map(function (row) {
      const out = {};
      headers.forEach(function (h) { out[h] = row[h]; });
      return out;
    });
  });
  return ok_({ exportedAt: nowStr_(), tables: tables });
}

/* =========================== VALIDASI UMUM =========================== */

function requireString_(value, label, maxLength) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) throw appError_(label + ' wajib diisi.');
  if (maxLength && text.length > maxLength) throw appError_(label + ' maksimal ' + maxLength + ' karakter.');
  return text;
}

function optionalString_(value, maxLength) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function requireEnum_(value, list, label) {
  const text = String(value || '').trim();
  if (list.indexOf(text) === -1) throw appError_(label + ' tidak valid. Pilihan: ' + list.join(', ') + '.');
  return text;
}

/** Nominal rupiah: bilangan bulat, tidak negatif. */
function toAmount_(value, label, allowZero) {
  if (value === '' || value === null || value === undefined) {
    if (allowZero) return 0;
    throw appError_(label + ' wajib diisi.');
  }
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!isFinite(num)) throw appError_(label + ' harus berupa angka.');
  if (num < 0) throw appError_(label + ' tidak boleh negatif.');
  if (!allowZero && num === 0) throw appError_(label + ' harus lebih dari 0.');
  if (num > 1e13) throw appError_(label + ' terlalu besar.');
  return Math.round(num);
}

function toNumber_(value, label, min, max) {
  const num = Number(value);
  if (value === '' || value === null || value === undefined || !isFinite(num)) throw appError_(label + ' harus berupa angka.');
  if (min !== undefined && num < min) throw appError_(label + ' minimal ' + min + '.');
  if (max !== undefined && num > max) throw appError_(label + ' maksimal ' + max + '.');
  return num;
}

function requireDate_(value, label) {
  const text = String(value || '').trim();
  if (!parseDateStr_(text)) throw appError_(label + ' tidak valid. Gunakan tanggal yang benar.');
  return text;
}

function optionalDate_(value, label) {
  const text = String(value || '').trim();
  if (!text) return '';
  return requireDate_(text, label);
}

function isTrue_(value) {
  if (value === true) return true;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === 'ya' || text === 'yes' || text === '1' || text === 'aktif';
}

function parseJsonSafe_(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch (err) { return fallback; }
}

/* =========================== TANGGAL (Asia/Jakarta) =========================== */

function nowStr_() {
  return Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function todayStr_() {
  return Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyy-MM-dd');
}

function parseDateStr_(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth_(y, mo)) return null;
  return { y: y, m: mo, d: d };
}

function dateStr_(y, m, d) {
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function daysInMonth_(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonthsStr_(text, months) {
  const p = parseDateStr_(text);
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  return dateStr_(y, m, Math.min(p.d, daysInMonth_(y, m)));
}

function addDaysStr_(text, days) {
  const p = parseDateStr_(text);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return dateStr_(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function daysBetween_(fromText, toText) {
  const a = parseDateStr_(fromText), b = parseDateStr_(toText);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

function monthDiff_(fromText, toText) {
  const a = parseDateStr_(fromText), b = parseDateStr_(toText);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

function monthKey_(text) {
  return String(text).slice(0, 7);
}

/** Membaca parameter bulan/tahun; default bulan berjalan. */
function monthParam_(data) {
  const today = parseDateStr_(todayStr_());
  const month = data && data.month ? Number(data.month) : today.m;
  const year = data && data.year ? Number(data.year) : today.y;
  if (!(month >= 1 && month <= 12)) throw appError_('Bulan tidak valid.');
  if (!(year >= 2000 && year <= 2200)) throw appError_('Tahun tidak valid.');
  return {
    month: month,
    year: year,
    key: year + '-' + ('0' + month).slice(-2),
    start: dateStr_(year, month, 1),
    end: dateStr_(year, month, daysInMonth_(year, month))
  };
}

function previousMonth_(month, year) {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year: year };
}
