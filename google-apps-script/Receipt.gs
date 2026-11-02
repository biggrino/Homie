/**
 * Receipt.gs — membaca gambar struk / bukti transfer menjadi isian transaksi memakai Google Gemini (AI vision).
 *
 * API key Gemini disimpan di Script Properties (HOMIE_AI_KEY), BUKAN di sheet Settings dan bukan di website,
 * sehingga tidak ikut export/backup dan tidak pernah dikirim ke browser.
 * Key gratis dibuat di https://aistudio.google.com/apikey lalu ditempel Admin di menu Pengaturan.
 */

const AI_KEY_PROPERTY = 'HOMIE_AI_KEY';
const AI_DEFAULT_MODEL = 'gemini-flash-latest';
const AI_MAX_IMAGE_CHARS = 6 * 1024 * 1024; // base64 ±4,5 MB
const AI_SCAN_LIMIT_PER_HOUR = 60;
const AI_PAYMENT_METHODS = ['Tunai', 'Transfer', 'Kartu Debit', 'Kartu Kredit', 'QRIS', 'E-Wallet', 'Autodebet'];

/**
 * Jalankan sekali dari editor Apps Script (hanya untuk instalasi manual tanpa Homie Loader) agar Google meminta
 * izin "Connect to an external service" yang dipakai untuk menghubungi Gemini. Pengguna Loader tidak perlu.
 */
function aktifkanBacaStruk() {
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com/', { muteHttpExceptions: true });
  Logger.log('Izin akses layanan luar aktif. Admin dapat menyimpan API key Gemini di menu Pengaturan aplikasi.');
}

/** UrlFetchApp dengan pesan yang jelas bila script belum diberi izin layanan luar. */
function aiFetch_(url, options) {
  try {
    return UrlFetchApp.fetch(url, options);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/permission|izin|authorization|script\.external_request/i.test(msg)) {
      throw appError_('Script belum diberi izin menghubungi layanan luar. Pemilik spreadsheet: buka Apps Script, jalankan fungsi ' +
        'aktifkanBacaStruk sekali, izinkan, lalu deploy versi baru.', 'AI_ERROR');
    }
    throw appError_('Gagal menghubungi Gemini: ' + msg, 'AI_ERROR');
  }
}

function aiKey_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(AI_KEY_PROPERTY) || '';
  } catch (err) {
    return '';
  }
}

function aiModel_() {
  const model = String(getSetting_('AI_MODEL', AI_DEFAULT_MODEL) || AI_DEFAULT_MODEL).trim();
  return /^[A-Za-z0-9._-]{3,60}$/.test(model) ? model : AI_DEFAULT_MODEL;
}

/** Status fitur baca struk untuk publicSettings_ (tanpa membocorkan key). */
function aiStatus_() {
  const key = aiKey_();
  return { AI_ENABLED: Boolean(key), AI_MODEL: aiModel_(), AI_KEY_HINT: key ? '••••' + key.slice(-4) : '' };
}

/** Admin: simpan / hapus API key Gemini dan nama model. Key dicoba dulu sebelum disimpan. */
function saveAiSettings(data) {
  data = data || {};
  const props = PropertiesService.getScriptProperties();
  if (data.removeKey) {
    props.deleteProperty(AI_KEY_PROPERTY);
    return ok_(publicSettings_(), 'API key Gemini dihapus. Baca struk memakai OCR di perangkat.');
  }
  if (typeof UrlFetchApp === 'undefined') throw appError_('Pengaturan AI tidak tersedia di Mode Demo.');
  const model = String(data.model || '').trim() || AI_DEFAULT_MODEL;
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(model)) throw appError_('Nama model tidak valid. Contoh: ' + AI_DEFAULT_MODEL);
  const key = String(data.apiKey || '').trim() || aiKey_();
  if (!key) throw appError_('Tempel API key Gemini terlebih dahulu.');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(key)) throw appError_('Format API key tidak dikenali. Salin ulang dari Google AI Studio.');

  const res = aiFetch_('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model), {
    method: 'get', headers: { 'x-goog-api-key': key }, muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) throw appError_(aiHttpMessage_(code, res.getContentText(), model));

  props.setProperty(AI_KEY_PROPERTY, key);
  withLock_(function () { setSetting_('AI_MODEL', model, 'Model Google Gemini untuk membaca gambar struk'); });
  return ok_(publicSettings_(), 'API key Gemini tersimpan dan berhasil dicoba.');
}

function aiHttpMessage_(code, body, model) {
  let detail = '';
  try { detail = (JSON.parse(body).error || {}).message || ''; } catch (err) { /* abaikan */ }
  if (code === 400 && /api key/i.test(detail)) return 'API key Gemini tidak valid. Buat atau salin ulang key di Google AI Studio.';
  if (code === 401 || code === 403) return 'API key Gemini ditolak (' + code + '). Pastikan Generative Language API aktif untuk key ini.';
  if (code === 404) return 'Model "' + model + '" tidak ditemukan. Admin dapat mengganti nama model di Pengaturan (contoh: ' + AI_DEFAULT_MODEL + ').';
  if (code === 429) return 'Kuota Gemini sedang habis (batas gratis per menit/hari). Coba lagi sebentar lagi.';
  if (code >= 500) return 'Layanan Gemini sedang gangguan (' + code + '). Coba lagi nanti.';
  return 'Gemini menolak permintaan (' + code + ')' + (detail ? ': ' + detail : '.');
}

/**
 * Membaca gambar struk / screenshot transfer.
 * data: { image: base64 tanpa prefix, mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }
 * Mengembalikan usulan isian form transaksi; tidak menyimpan apa pun ke database.
 */
function scanReceipt(data, user) {
  if (!user || WRITE_ROLES.indexOf(user.role) === -1) throw appError_('Akun Viewer tidak dapat menambah transaksi.', 'FORBIDDEN');
  data = data || {};
  const image = String(data.image || '').replace(/^data:[^,]+,/, '');
  const mimeType = String(data.mimeType || 'image/jpeg');
  if (!image) throw appError_('Gambar belum dipilih.');
  if (image.length > AI_MAX_IMAGE_CHARS) throw appError_('Gambar terlalu besar. Gunakan foto yang lebih kecil.');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(image)) throw appError_('Data gambar tidak valid.');
  if (['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].indexOf(mimeType) === -1) {
    throw appError_('Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
  }

  const key = aiKey_();
  if (!key) throw appError_('Baca struk dengan AI belum diaktifkan Admin.', 'AI_NOT_CONFIGURED');
  if (typeof UrlFetchApp === 'undefined') throw appError_('AI tidak tersedia di Mode Demo.', 'AI_NOT_CONFIGURED');

  const cache = CacheService.getScriptCache();
  const counterKey = 'ai_scan_' + user.id + '_' + Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyyMMddHH');
  const used = Number(cache.get(counterKey) || 0);
  if (used >= AI_SCAN_LIMIT_PER_HOUR) throw appError_('Batas baca struk tercapai (' + AI_SCAN_LIMIT_PER_HOUR + ' gambar per jam). Coba lagi nanti.', 'AI_LIMIT');
  cache.put(counterKey, String(used + 1), 3600);

  const categories = readTable_('Categories').map(publicCategory_).filter(function (c) { return c.active; });
  const accounts = readTable_('Accounts').filter(function (a) { return isTrue_(a.Active); })
    .map(function (a) { return { id: a.ID, name: a.AccountName, type: a.AccountType }; });
  const cards = readTable_('CreditCards').filter(function (c) { return isTrue_(c.Active); })
    .map(function (c) { return { id: c.ID, name: c.CardName || c.Name || c.ID, type: 'Kartu Kredit' }; });

  const model = aiModel_();
  const body = {
    contents: [{ role: 'user', parts: [{ text: aiPrompt_(categories, accounts.concat(cards)) }, { inlineData: { mimeType: mimeType, data: image.replace(/\s/g, '') } }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: AI_RECEIPT_SCHEMA }
  };
  const res = aiFetch_('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) throw appError_(aiHttpMessage_(code, res.getContentText(), model), 'AI_ERROR');

  let raw;
  try {
    const json = JSON.parse(res.getContentText());
    const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('');
    raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (err) {
    throw appError_('Gemini tidak bisa membaca gambar ini. Coba foto yang lebih jelas atau isi manual.', 'AI_ERROR');
  }
  return ok_(normalizeScan_(raw, categories, accounts.concat(cards)), 'Gambar berhasil dibaca');
}

const AI_RECEIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isReceipt: { type: 'BOOLEAN', description: 'true bila gambar berisi struk, nota, invoice, atau bukti transaksi' },
    type: { type: 'STRING', enum: ['Pengeluaran', 'Pemasukan', 'Transfer'] },
    date: { type: 'STRING', description: 'Tanggal transaksi format YYYY-MM-DD, kosong bila tidak terlihat' },
    amount: { type: 'NUMBER', description: 'Total akhir yang dibayar/diterima dalam rupiah (setelah diskon, pajak, biaya admin)' },
    merchant: { type: 'STRING', description: 'Nama toko / penerima / pengirim' },
    description: { type: 'STRING', description: 'Keterangan singkat bahasa Indonesia, maksimal 80 karakter' },
    category: { type: 'STRING' },
    subCategory: { type: 'STRING' },
    paymentMethod: { type: 'STRING', enum: AI_PAYMENT_METHODS.concat(['']) },
    account: { type: 'STRING', description: 'Nama rekening/kartu dari daftar yang paling cocok, kosong bila tidak yakin' },
    destinationAccount: { type: 'STRING', description: 'Untuk Transfer antar rekening sendiri: nama rekening tujuan dari daftar' },
    items: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER' }, price: { type: 'NUMBER' } }, required: ['name'] }
    },
    confidence: { type: 'STRING', enum: ['tinggi', 'sedang', 'rendah'] },
    notes: { type: 'STRING', description: 'Catatan singkat bila ada keraguan (misal angka buram)' }
  },
  required: ['isReceipt', 'type', 'amount', 'confidence']
};

function aiPrompt_(categories, accounts) {
  const expense = categories.filter(function (c) { return c.type === TYPE_EXPENSE; });
  const income = categories.filter(function (c) { return c.type === TYPE_INCOME; });
  const list = function (cats) {
    return cats.map(function (c) { return '- ' + c.name + (c.subCategories.length ? ' (sub: ' + c.subCategories.join(', ') + ')' : ''); }).join('\n');
  };
  return [
    'Anda membantu keluarga di Indonesia mencatat keuangan. Baca gambar (struk belanja, nota, invoice, tagihan,',
    'atau screenshot bukti transfer / m-banking / e-wallet / QRIS) lalu isi data transaksinya.',
    'Hari ini ' + todayStr_() + ' (zona waktu Asia/Jakarta).',
    '',
    'Aturan:',
    '- amount = total akhir yang benar-benar dibayar/diterima, angka rupiah tanpa titik/koma (contoh 125500). Bukan subtotal, bukan uang tunai yang diberikan, bukan kembalian.',
    '- Format angka Indonesia: titik = pemisah ribuan, koma = desimal. Bulatkan ke rupiah.',
    '- type: Pengeluaran untuk belanja/pembayaran/transfer ke orang lain; Pemasukan bila uang diterima (transfer masuk, gaji);',
    '  Transfer hanya bila jelas pindah dana antar rekening milik keluarga sendiri yang ada di daftar rekening.',
    '- date: tanggal transaksi pada gambar (YYYY-MM-DD). Tahun 2 digit berarti 20xx. Kosongkan bila tidak ada.',
    '- category dan subCategory WAJIB persis salah satu nama dari daftar di bawah, sesuai type. Kosongkan bila tidak ada yang cocok.',
    '- paymentMethod: Tunai, Transfer, Kartu Debit, Kartu Kredit, QRIS, E-Wallet (GoPay/OVO/DANA/ShopeePay/LinkAja), atau Autodebet.',
    '- account: nama rekening/kartu dari daftar yang dipakai membayar (misal logo/nama bank di screenshot). Kosongkan bila tidak yakin.',
    '- description: singkat, contoh "Belanja Indomaret", "Transfer ke Budi Santoso", "Bayar listrik PLN".',
    '- items: daftar barang beserta qty dan harga total per baris (maks 30). Kosongkan untuk bukti transfer.',
    '- Bila gambar bukan bukti transaksi, isi isReceipt=false dan amount=0.',
    '',
    'Kategori Pengeluaran:', list(expense) || '-',
    '', 'Kategori Pemasukan:', list(income) || '-',
    '', 'Rekening & kartu keluarga:',
    accounts.map(function (a) { return '- ' + a.name + ' (' + a.type + ')'; }).join('\n') || '-'
  ].join('\n');
}

/** Merapikan jawaban AI: hanya nilai yang valid untuk form yang diteruskan. */
function normalizeScan_(raw, categories, accounts) {
  raw = raw || {};
  const lower = function (s) { return String(s || '').trim().toLowerCase(); };
  const types = [TYPE_EXPENSE, TYPE_INCOME, 'Transfer'];
  const type = types.indexOf(raw.type) !== -1 ? raw.type : TYPE_EXPENSE;
  const catType = type === TYPE_INCOME ? TYPE_INCOME : TYPE_EXPENSE;
  const cat = type === 'Transfer' ? null : categories.filter(function (c) { return c.type === catType && lower(c.name) === lower(raw.category); })[0];
  const sub = cat ? cat.subCategories.filter(function (s) { return lower(s) === lower(raw.subCategory); })[0] : '';
  const findAccount = function (name) {
    const n = lower(name);
    if (!n) return '';
    const exact = accounts.filter(function (a) { return lower(a.name) === n; })[0];
    const loose = exact || accounts.filter(function (a) { return lower(a.name).indexOf(n) !== -1 || n.indexOf(lower(a.name)) !== -1; })[0];
    return loose ? loose.id : '';
  };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) && isValidDateStr_(raw.date) ? raw.date : '';
  const amount = Math.round(Math.abs(Number(raw.amount) || 0));
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 30).map(function (it) {
    return { name: String(it.name || '').slice(0, 80), qty: Number(it.qty) || 0, price: Math.round(Number(it.price) || 0) };
  }).filter(function (it) { return it.name; });
  return {
    source: 'ai',
    isReceipt: raw.isReceipt !== false,
    type: type,
    date: date,
    amount: amount,
    merchant: String(raw.merchant || '').slice(0, 80),
    description: String(raw.description || raw.merchant || '').slice(0, 200),
    category: cat ? cat.name : '',
    subCategory: sub || '',
    paymentMethod: AI_PAYMENT_METHODS.indexOf(raw.paymentMethod) !== -1 ? raw.paymentMethod : '',
    sourceAccount: findAccount(raw.account),
    destinationAccount: type === 'Transfer' ? findAccount(raw.destinationAccount) : '',
    items: items,
    confidence: ['tinggi', 'sedang', 'rendah'].indexOf(raw.confidence) !== -1 ? raw.confidence : 'sedang',
    notes: String(raw.notes || '').slice(0, 200)
  };
}

function isValidDateStr_(s) {
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
