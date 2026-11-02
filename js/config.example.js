/**
 * CONTOH KONFIGURASI
 * 1. Salin file ini menjadi js/config.js (di folder yang sama).
 * 2. Ganti API_URL dengan Web App URL dari Google Apps Script (diakhiri /exec).
 * 3. Simpan, lalu muat ulang aplikasi.
 *
 * Jika js/config.js tidak ada atau API_URL belum diisi, aplikasi berjalan dalam Mode Demo
 * (data contoh di browser, tidak tersimpan ke Google Sheets).
 *
 * JANGAN menaruh password, token, API key, atau kredensial rahasia apa pun di file ini.
 */
const CONFIG = {
  API_URL: "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL",

  // true = paksa Mode Demo walaupun API_URL sudah diisi (untuk mencoba tampilan saja).
  DEMO_MODE: false
};
