/**
 * Homie Loader — pasang SEKALI di Apps Script, setelah itu server Homie ikut diperbarui otomatis.
 *
 * Cara kerja: kode server Homie (Code.gs, Database.gs, dst.) diambil dari situs GitHub Pages Anda,
 * disimpan di Script Properties, lalu dijalankan. Setiap beberapa menit Loader memeriksa
 * google-apps-script/versi.json di situs tersebut; jika versinya berubah, kode baru diunduh dan langsung dipakai.
 * Jadi setelah file di GitHub diperbarui, Anda tidak perlu menyalin file .gs atau membuat deployment baru lagi.
 *
 * Keamanan: kode server berjalan dengan izin akun Google Anda (Sheets & Drive). Siapa pun yang bisa mengubah
 * repository GitHub Anda bisa mengubah perilaku server, jadi jaga akun GitHub Anda (aktifkan 2FA).
 * Loader hanya mengambil kode dari alamat HOMIE_SOURCE_URL di bawah, bukan dari alamat yang dikirim browser.
 */

// Alamat situs GitHub Pages Homie Anda, diakhiri garis miring. Contoh: 'https://namaanda.github.io/Homie/'
const HOMIE_SOURCE_URL = 'https://biggrino.github.io/Homie/';

// Kosongkan jika script ini dibuat dari menu Extensions → Apps Script pada spreadsheet database (bound script).
// Isi dengan ID spreadsheet jika script dibuat terpisah (standalone).
const HOMIE_SPREADSHEET_ID = '';

// Seberapa sering (menit) Loader memeriksa versi baru di GitHub.
const HOMIE_CHECK_MINUTES = 5;

const HOMIE_LOADER_VERSION = '1';
const HOMIE_CHUNK_CHARS = 2800; // satu nilai Script Properties maksimal 9 KB

/* ---------------- Entry point Web App & fungsi yang dijalankan dari editor ---------------- */

function doGet(e) { return homieApp_().doGet(e); }

function doPost(e) { return homieApp_().doPost(e); }

/** Membuat/melengkapi sheet database (sama seperti setupDatabase versi biasa). */
function setupDatabase() { return homieApp_().setupDatabase(); }

/**
 * Jalankan sekali setelah memasang Loader agar Google meminta semua izin yang dibutuhkan
 * (Google Sheets, Google Drive untuk backup, dan akses ke situs GitHub Pages Anda).
 */
function izinkanAkses() {
  const db = HOMIE_SPREADSHEET_ID ? SpreadsheetApp.openById(HOMIE_SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!db) throw new Error('Spreadsheet tidak ditemukan. Isi HOMIE_SPREADSHEET_ID atau buat script dari menu Extensions → Apps Script di spreadsheet.');
  DriveApp.getRootFolder().getName();
  const version = perbaruiSekarang();
  Logger.log('Izin aktif. Database: ' + db.getName() + '. Kode server Homie versi ' + version + ' siap dipakai.');
}

/** Memaksa Loader mengambil ulang kode server dari GitHub Pages sekarang juga. Mengembalikan versi yang terpasang. */
function perbaruiSekarang() {
  const manifest = homieFetchManifest_();
  homieInstall_(manifest);
  CacheService.getScriptCache().put('homie_checked', manifest.version, HOMIE_CHECK_MINUTES * 60);
  Logger.log('Kode server Homie versi ' + manifest.version + ' terpasang dari ' + homieSource_());
  return manifest.version;
}

/** Aksi API "aktifkanBackupDrive" versi Loader: cukup jalankan izinkanAkses. */
function aktifkanBackupDrive() { izinkanAkses(); }

/* ---------------- Internal ---------------- */

function homieApp_() {
  const code = homieCode_();
  // Kode server dijalankan dalam satu fungsi; layanan Apps Script (SpreadsheetApp, DriveApp, dll.) tetap tersedia.
  const factory = new Function(code + '\n;return { doGet: doGet, doPost: doPost, setupDatabase: setupDatabase };');
  return factory();
}

function homieSource_() {
  const url = String(HOMIE_SOURCE_URL || '').trim();
  if (!/^https:\/\/[^\s/@]+\/(?:[^\s?#]*\/)?$/.test(url) || url.indexOf('USERNAME') !== -1) {
    throw new Error('HOMIE_SOURCE_URL di Loader.gs belum diisi dengan benar. Contoh: https://namaanda.github.io/Homie/ (diakhiri /).');
  }
  return url;
}

function homieCode_() {
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  let installed = props.getProperty('HOMIE_VERSION');
  if (!installed || !cache.get('homie_checked')) {
    try {
      const manifest = homieFetchManifest_();
      if (manifest.version !== installed) installed = homieInstall_(manifest);
      cache.put('homie_checked', manifest.version, HOMIE_CHECK_MINUTES * 60);
    } catch (err) {
      // GitHub Pages sedang tidak bisa dihubungi: tetap jalankan versi terakhir yang tersimpan.
      if (!installed) throw err;
      console.warn('Homie Loader: gagal memeriksa versi baru, memakai versi ' + installed + '. ' + err);
      cache.put('homie_checked', installed, 60);
    }
  }
  return homieReadCode_(props, installed);
}

function homieFetchManifest_() {
  const res = UrlFetchApp.fetch(homieSource_() + 'google-apps-script/versi.json?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Tidak bisa membaca versi.json dari ' + homieSource_() + ' (HTTP ' + res.getResponseCode() + '). Pastikan file website sudah diunggah ke GitHub.');
  }
  let manifest;
  try { manifest = JSON.parse(res.getContentText()); } catch (err) { throw new Error('versi.json tidak valid.'); }
  if (!manifest || !/^\d+\.\d+\.\d+$/.test(String(manifest.version)) || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('versi.json tidak lengkap (version / files).');
  }
  manifest.files.forEach(function (f) {
    if (!/^[A-Za-z0-9_-]+\.gs$/.test(f)) throw new Error('Nama file di versi.json tidak valid: ' + f);
  });
  return manifest;
}

/** Mengunduh semua file .gs versi baru, memeriksa isinya, lalu menyimpannya. Versi lama baru dihapus setelah versi baru lengkap. */
function homieInstall_(manifest) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Server sedang memasang pembaruan. Coba lagi beberapa detik lagi.');
  try {
    const props = PropertiesService.getScriptProperties();
    const current = props.getProperty('HOMIE_VERSION');
    if (current === manifest.version) return current;
    const base = homieSource_() + 'google-apps-script/';
    const responses = UrlFetchApp.fetchAll(manifest.files.map(function (f) {
      return { url: base + f + '?v=' + encodeURIComponent(manifest.version), muteHttpExceptions: true, followRedirects: true };
    }));
    const sources = responses.map(function (res, i) {
      if (res.getResponseCode() !== 200) throw new Error('Gagal mengunduh ' + manifest.files[i] + ' (HTTP ' + res.getResponseCode() + ').');
      return res.getContentText();
    });
    let code = sources.join('\n;\n');
    if (code.indexOf('function handleRequest_') === -1 || code.indexOf("SERVER_VERSION = '" + manifest.version + "'") === -1) {
      throw new Error('Kode server dari GitHub tidak cocok dengan versi ' + manifest.version + '. Pastikan semua file sudah terunggah.');
    }
    if (HOMIE_SPREADSHEET_ID) {
      code = code.replace(/const SPREADSHEET_ID = '[^']*';/, "const SPREADSHEET_ID = '" + String(HOMIE_SPREADSHEET_ID).replace(/[^A-Za-z0-9_-]/g, '') + "';");
    }
    new Function(code); // cek sintaks sebelum dipakai
    const chunks = {};
    let count = 0;
    for (let i = 0; i < code.length; i += HOMIE_CHUNK_CHARS) {
      chunks['HOMIE_CODE_' + manifest.version + '_' + count] = code.slice(i, i + HOMIE_CHUNK_CHARS);
      count++;
    }
    chunks['HOMIE_CODE_' + manifest.version + '_N'] = String(count);
    props.setProperties(chunks);
    props.setProperty('HOMIE_VERSION', manifest.version);
    props.setProperty('HOMIE_UPDATED_AT', new Date().toISOString());
    Object.keys(props.getProperties()).forEach(function (key) {
      if (key.indexOf('HOMIE_CODE_') === 0 && key.indexOf('HOMIE_CODE_' + manifest.version + '_') !== 0) props.deleteProperty(key);
    });
    return manifest.version;
  } finally {
    lock.releaseLock();
  }
}

function homieReadCode_(props, version) {
  const all = props.getProperties();
  const count = Number(all['HOMIE_CODE_' + version + '_N'] || 0);
  if (!count) throw new Error('Kode server Homie belum terpasang. Jalankan fungsi perbaruiSekarang dari editor Apps Script.');
  const parts = [];
  for (let i = 0; i < count; i++) {
    const part = all['HOMIE_CODE_' + version + '_' + i];
    if (part === undefined) throw new Error('Kode server Homie tidak lengkap. Jalankan fungsi perbaruiSekarang dari editor Apps Script.');
    parts.push(part);
  }
  return parts.join('');
}
