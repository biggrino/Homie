/**
 * receipt.js — mengubah gambar struk / nota / screenshot bukti transfer menjadi isian form transaksi.
 *
 * Dua cara membaca gambar:
 * 1. AI (Google Gemini) lewat server Apps Script — paling akurat (total, tanggal, kategori, daftar barang).
 *    Aktif bila Admin sudah menyimpan API key Gemini di Pengaturan. Key tidak pernah sampai ke browser.
 * 2. OCR di perangkat (Tesseract.js) — cadangan tanpa setup apa pun. Hanya menebak total, tanggal,
 *    metode bayar, rekening, dan kategori dari teks yang terbaca.
 */
import { api, isDemo, getMaster, ApiError } from './api.js';
import { TRX, escapeHtml, formatRupiah, formatDate, todayISO, isValidISODate } from './utils.js';

const MAX_SIDE = 1600;
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const AI_TIMEOUT_MS = 90000;

/* =========================== Gambar =========================== */

/** Mengambil file gambar pertama dari event paste / drop. */
export function imageFromTransfer(dataTransfer) {
  if (!dataTransfer) return null;
  const files = [...(dataTransfer.files || [])];
  const file = files.find((f) => /^image\//.test(f.type));
  if (file) return file;
  const item = [...(dataTransfer.items || [])].find((i) => i.kind === 'file' && /^image\//.test(i.type));
  return item ? item.getAsFile() : null;
}

/** Memperkecil gambar (sisi terpanjang 1600 px) dan mengubahnya ke JPEG agar ringan dikirim. */
export function prepareImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || 'image/')) return reject(new Error('File harus berupa gambar (JPG, PNG, WEBP, HEIC).'));
    if (file.size > 25 * 1024 * 1024) return reject(new Error('Ukuran gambar maksimal 25 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', canvas });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gambar tidak dapat dibuka. Coba gambar lain atau screenshot ulang.'));
    };
    img.src = url;
  });
}

/* =========================== Membaca gambar =========================== */

export function aiEnabled() {
  return !isDemo() && Boolean(getMaster()?.settings?.AI_ENABLED);
}

/**
 * Membaca gambar dan mengembalikan usulan isian:
 * { source: 'ai'|'ocr', type, date, amount, description, merchant, category, subCategory, paymentMethod,
 *   sourceAccount, destinationAccount, items, confidence, notes, notice }
 */
export async function readReceipt(prepared, { onProgress = () => {} } = {}) {
  let notice = '';
  if (aiEnabled()) {
    onProgress('Membaca gambar dengan AI…');
    try {
      const res = await api('scanReceipt', { image: prepared.base64, mimeType: prepared.mimeType }, { timeout: AI_TIMEOUT_MS });
      return res.data;
    } catch (err) {
      if (err instanceof ApiError && ['AUTH_REQUIRED', 'FORBIDDEN'].includes(err.code)) throw err;
      notice = `AI tidak berhasil (${err.message}) — memakai OCR di perangkat.`;
    }
  }
  const text = await ocrText(prepared.canvas, onProgress);
  return { ...parseReceiptText(text, getMaster()), notice };
}

let tesseractPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR gagal dimuat.')));
      s.onerror = () => { tesseractPromise = null; reject(new Error('OCR gagal dimuat. Periksa koneksi internet.')); };
      document.head.appendChild(s);
    });
  }
  return tesseractPromise;
}

async function ocrText(canvas, onProgress) {
  onProgress('Memuat OCR (pertama kali ±5 MB)…');
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker(['ind', 'eng'], 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(`Membaca teks… ${Math.round((m.progress || 0) * 100)}%`);
      else if (/load/i.test(m.status || '')) onProgress('Menyiapkan OCR…');
    }
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally {
    worker.terminate();
  }
}

/* =========================== Parser teks OCR =========================== */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };

/** "Rp 125.500" / "125,500" / "125.500,00" → 125500 */
export function parseRupiahToken(token) {
  let t = String(token).replace(/rp\.?/i, '').replace(/\s/g, '');
  if (/[.,]\d{2}$/.test(t) && /[.,]\d{3}[.,]\d{2}$/.test(t)) t = t.slice(0, -3); // buang desimal sen
  else if (/^\d{1,3},\d{2}$/.test(t) || /^\d+\.\d{2}$/.test(t)) t = t.slice(0, -3);
  const n = Number(t.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const AMOUNT_RE = /(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{4,10}(?:[.,]\d{2})?)(?![\d/:-])/gi;

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const digits = m[1].replace(/\D/g, '');
    if (/^0\d{7,}/.test(digits)) continue; // nomor telepon / rekening
    const value = parseRupiahToken(m[1]);
    if (value >= 100 && value < 1e10) out.push(value);
  }
  return out;
}

function findTotal(lines) {
  const skip = /(sub\s*-?\s*total|kembali|change|diskon|disc|hemat|ppn|pajak|tax|item|qty|poin|point|saldo|admin|biaya)/i;
  const rules = [
    [/(grand\s*total|total\s*(bayar|belanja|pembayaran|tagihan|harga|transaksi)|jumlah\s*(transfer|bayar|tagihan|pembayaran)|nominal\s*(transfer|transaksi)?|total\s*amount)/i, 3],
    [/\b(total|jumlah|amount|tagihan|dibayar|netto|nominal)\b/i, 2],
    [/\b(tunai|cash|debit|qris)\b/i, 1]
  ];
  let best = null;
  lines.forEach((line, i) => {
    for (const [re, score] of rules) {
      if (!re.test(line) || (score < 3 && skip.test(line))) continue;
      const values = amountsIn(line).length ? amountsIn(line) : amountsIn(lines[i + 1] || '');
      if (!values.length) continue;
      const value = Math.max(...values);
      if (!best || score > best.score || (score === best.score && score > 1 && value > best.value)) best = { score, value };
      break;
    }
  });
  if (best) return best.value;
  const all = lines.filter((l) => !/(telp|tel\.|phone|npwp|no\.?\s*ref|ref\b|kode|kembali|rekening|no\.?\s*rek)/i.test(l)).flatMap(amountsIn);
  return all.length ? Math.max(...all) : 0;
}

function findDate(text) {
  const candidates = [];
  const push = (y, m, d) => {
    y = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (y >= 2000 && isValidISODate(iso) && iso <= todayISO()) candidates.push(iso);
  };
  for (const m of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) push(m[1], m[2], m[3]);
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g)) push(m[3], m[2], m[1]);
  for (const m of text.matchAll(/\b(\d{1,2})[\s-]+([a-z]{3})[a-z]*\.?[\s-]+(\d{2,4})\b/gi)) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) push(m[3], month, m[1]);
  }
  return candidates[0] || '';
}

function findPaymentMethod(text) {
  if (/\bqris\b/i.test(text)) return 'QRIS';
  if (/(gopay|go-pay|\bovo\b|shopee\s*pay|linkaja|e-?wallet)/i.test(text) || /\bDANA\b(?!\s*MASUK)/.test(text)) return 'E-Wallet';
  if (/(kartu\s*kredit|credit\s*card|\bvisa\b|master\s*card)/i.test(text)) return 'Kartu Kredit';
  if (/(\bdebit\b|\bedc\b|kartu\s*debit)/i.test(text)) return 'Kartu Debit';
  if (/(transfer|m-?banking|livin|brimo|bca\s*mobile|mybca|virtual\s*account|\bva\b|bi-?fast)/i.test(text)) return 'Transfer';
  if (/\b(tunai|cash)\b/i.test(text)) return 'Tunai';
  return '';
}

const GENERIC_WORDS = ['rekening', 'tabungan', 'cash', 'tunai', 'kartu', 'kredit', 'bapak', 'ibu', 'dompet', 'utama', 'card', 'bank'];
const ACCOUNT_ALIASES = { livin: 'mandiri', brimo: 'bri', mybca: 'bca', 'bca mobile': 'bca', 'blu by bca': 'blu' };

function findAccount(text, master, method) {
  if (!master) return '';
  let lower = text.toLowerCase();
  Object.entries(ACCOUNT_ALIASES).forEach(([alias, bank]) => { lower = lower.split(alias).join(`${alias} ${bank}`); });
  // Bukti transfer: rekening yang disebut setelah "Sumber dana" lebih diutamakan daripada bank penerima.
  const sourceAt = lower.search(/(sumber\s*dana|dari\s*rekening|rekening\s*sumber|debit\s*dari|rekening\s*anda)/);
  const list = [
    ...master.accounts.filter((a) => a.active && (a.type !== 'Tunai' || method === 'Tunai')),
    ...(method === 'Kartu Kredit' ? master.cards.filter((c) => c.active) : [])
  ];
  const search = (hay) => list.map((a) => {
    const words = a.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.includes(w));
    const pos = words.map((w) => hay.search(new RegExp(`\\b${w}\\b`))).filter((p) => p >= 0);
    return pos.length ? { id: a.id, pos: Math.min(...pos) } : null;
  }).filter(Boolean).sort((a, b) => a.pos - b.pos);
  const hits = (sourceAt >= 0 && search(lower.slice(sourceAt)).length) ? search(lower.slice(sourceAt)) : search(lower);
  if (hits.length) return hits[0].id;
  if (method === 'Tunai') return master.accounts.find((a) => a.active && a.type === 'Tunai')?.id || '';
  return '';
}

const CATEGORY_HINTS = [
  [/(indomaret|alfamart|alfamidi|superindo|hypermart|transmart|giant|lotte|hero|pasar|sayur|supermarket|minimarket|grocery|fresh)/i, ['bahan makanan', 'belanja', 'dapur', 'groceries']],
  [/(\bpln\b|listrik|token)/i, ['listrik']],
  [/(pdam|air bersih)/i, ['air']],
  [/(pertamina|spbu|shell|bensin|pertalite|pertamax|solar|bbm)/i, ['bensin', 'bbm', 'transport']],
  [/(gofood|grabfood|shopeefood|resto|restoran|rumah makan|warung|cafe|kopi|coffee|bakery|mcd|kfc|pizza)/i, ['makan di luar', 'jajan', 'kopi', 'konsumsi']],
  [/(gojek|grab|maxim|taxi|taksi|tol\b|parkir|kereta|krl|mrt|transjakarta)/i, ['ojek online', 'parkir', 'transport']],
  [/(apotek|apotik|klinik|rumah sakit|\brs\b|dokter|farma)/i, ['kesehatan', 'obat']],
  [/(telkomsel|indosat|xl|smartfren|pulsa|paket data|indihome|internet|wifi)/i, ['pulsa', 'internet', 'komunikasi']],
  [/(sekolah|spp|kursus|les\b|buku)/i, ['pendidikan', 'sekolah']],
  [/(bpjs|asuransi)/i, ['asuransi', 'bpjs', 'kesehatan']],
  [/(gaji|salary|payroll)/i, ['gaji']]
];

function findCategory(text, master, catType) {
  if (!master) return { category: '', subCategory: '' };
  const lower = text.toLowerCase();
  const cats = master.categories.filter((c) => c.type === catType && c.active);
  const match = (word) => {
    for (const c of cats) {
      const sub = c.subCategories.find((s) => s.toLowerCase().includes(word));
      if (sub) return { category: c.name, subCategory: sub };
      if (c.name.toLowerCase().includes(word)) return { category: c.name, subCategory: '' };
    }
    return null;
  };
  for (const [re, words] of CATEGORY_HINTS) {
    if (!re.test(text)) continue;
    for (const w of words) { const found = match(w); if (found) return found; }
  }
  for (const c of cats) {
    const sub = c.subCategories.find((s) => s.length >= 4 && lower.includes(s.toLowerCase()));
    if (sub) return { category: c.name, subCategory: sub };
  }
  return { category: '', subCategory: '' };
}

function findMerchant(lines) {
  const noise = /(struk|receipt|nota|invoice|transaksi|transfer|nominal|penerima|sumber|berhasil|sukses|success|bukti|tanggal|date|jam|waktu|kasir|telp|npwp|jl\.|jalan|^\W*$)/i;
  return (lines.slice(0, 6).find((l) => /[a-z]{3,}/i.test(l) && !noise.test(l) && !amountsIn(l).length && l.length <= 40) || '').trim();
}

/** Menebak isian transaksi dari teks hasil OCR. */
export function parseReceiptText(text, master) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const joined = lines.join('\n');
  const income = /(dana\s*masuk|transfer\s*masuk|uang\s*masuk|diterima\s*dari|terima\s*dana|incoming|kredit\s*masuk)/i.test(joined)
    || /(gaji|salary|payroll)/i.test(joined);
  const type = income ? TRX.INCOME : TRX.EXPENSE;
  const paymentMethod = findPaymentMethod(joined);
  const recipient = joined.match(/(?:penerima|nama\s*penerima|tujuan|transfer\s*ke|kepada)\s*:?\s*\n?\s*([A-Z][A-Za-z .,'-]{2,40})/i)?.[1]?.trim();
  const sender = joined.match(/(?:pengirim|dari|diterima\s*dari)\s*:?\s*\n?\s*([A-Z][A-Za-z .,'-]{2,40})/i)?.[1]?.trim();
  const merchant = findMerchant(lines);
  let description = '';
  if (income && sender) description = `Terima dari ${sender}`;
  else if (recipient && /transfer|penerima|tujuan/i.test(joined)) description = `Transfer ke ${recipient}`;
  else if (merchant) description = `Belanja ${merchant}`;
  const { category, subCategory } = findCategory(joined, master, type === TRX.INCOME ? 'Pemasukan' : 'Pengeluaran');
  const amount = findTotal(lines);
  return {
    source: 'ocr',
    isReceipt: amount > 0,
    type,
    date: findDate(joined),
    amount,
    merchant,
    description: description.slice(0, 200),
    category,
    subCategory,
    paymentMethod,
    sourceAccount: findAccount(joined, master, paymentMethod),
    destinationAccount: '',
    items: [],
    confidence: 'rendah',
    notes: '',
    text: joined.slice(0, 4000)
  };
}

/* =========================== Kotak unggah di form transaksi =========================== */

export function scanBoxHtml() {
  const ai = aiEnabled();
  return `<div class="scan-box mb-3" id="scan-box" tabindex="0" aria-label="Isi transaksi dari gambar">
    <div class="scan-empty">
      <span class="icon-circle icon-primary flex-shrink-0"><i class="bi bi-magic"></i></span>
      <div class="flex-grow-1 min-w-0">
        <div class="fw-semibold">Isi otomatis dari gambar</div>
        <div class="small text-muted">Foto struk/nota atau screenshot bukti transfer. Bisa juga <strong>tempel (Ctrl+V)</strong> atau seret gambar ke sini.</div>
        <div class="small mt-1"><span class="badge ${ai ? 'text-bg-success' : 'text-bg-secondary'}">${ai ? '<i class="bi bi-stars me-1"></i>AI Gemini' : '<i class="bi bi-cpu me-1"></i>OCR di perangkat'}</span></div>
      </div>
      <div class="d-flex gap-2 flex-shrink-0">
        <button type="button" class="btn btn-sm btn-outline-primary d-md-none" data-scan="camera"><i class="bi bi-camera"></i><span class="visually-hidden">Kamera</span></button>
        <button type="button" class="btn btn-sm btn-primary" data-scan="file"><i class="bi bi-image me-1"></i>Pilih gambar</button>
      </div>
      <input type="file" accept="image/*" hidden data-scan-input="file">
      <input type="file" accept="image/*" capture="environment" hidden data-scan-input="camera">
    </div>
    <div class="scan-result" hidden>
      <img class="scan-thumb" alt="Gambar yang dibaca">
      <div class="flex-grow-1 min-w-0 scan-status"></div>
      <button type="button" class="btn btn-sm btn-light flex-shrink-0" data-scan="again" title="Ganti gambar"><i class="bi bi-arrow-repeat"></i></button>
    </div>
  </div>`;
}

/**
 * Menghidupkan kotak unggah: pilih file, kamera, tempel, dan seret-lepas.
 * onResult(result) dipanggil setelah gambar terbaca. Mengembalikan { scan(file), destroy() }.
 */
export function bindScanBox(box, { onResult }) {
  const empty = box.querySelector('.scan-empty');
  const resultEl = box.querySelector('.scan-result');
  const status = box.querySelector('.scan-status');
  const thumb = box.querySelector('.scan-thumb');
  let busy = false;

  const setStatus = (html) => { status.innerHTML = html; };

  async function scan(file) {
    if (busy || !file) return;
    busy = true;
    box.classList.add('is-busy');
    empty.hidden = true;
    resultEl.hidden = false;
    setStatus('<div class="d-flex align-items-center gap-2"><span class="spinner-border spinner-border-sm text-primary"></span><span data-progress>Menyiapkan gambar…</span></div>');
    const progress = (text) => { const p = status.querySelector('[data-progress]'); if (p) p.textContent = text; };
    try {
      const prepared = await prepareImage(file);
      thumb.src = prepared.dataUrl;
      const result = await readReceipt(prepared, { onProgress: progress });
      if (!result.amount && !result.isReceipt) {
        setStatus(`<div class="text-warning-emphasis small"><i class="bi bi-exclamation-triangle me-1"></i>Gambar ini tidak terbaca sebagai struk atau bukti transaksi. Coba gambar yang lebih jelas, atau isi manual.</div>
          ${result.notice ? `<div class="small text-muted mt-1">${escapeHtml(result.notice)}</div>` : ''}`);
        return;
      }
      onResult(result);
      setStatus(summaryHtml(result));
    } catch (err) {
      setStatus(`<div class="text-danger small"><i class="bi bi-x-circle me-1"></i>${escapeHtml(err.message || 'Gambar gagal dibaca.')}</div>`);
    } finally {
      busy = false;
      box.classList.remove('is-busy');
    }
  }

  box.querySelectorAll('[data-scan="file"], [data-scan="camera"]').forEach((b) => b.addEventListener('click', () => {
    box.querySelector(`[data-scan-input="${b.dataset.scan}"]`).click();
  }));
  box.querySelector('[data-scan="again"]').addEventListener('click', () => box.querySelector('[data-scan-input="file"]').click());
  box.querySelectorAll('[data-scan-input]').forEach((input) => input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    scan(file);
  }));
  ['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, () => box.classList.remove('is-drag')));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = imageFromTransfer(e.dataTransfer);
    if (file) scan(file);
  });
  const onPaste = (e) => {
    const file = imageFromTransfer(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    scan(file);
  };
  document.addEventListener('paste', onPaste);
  return { scan, destroy: () => document.removeEventListener('paste', onPaste) };
}

function summaryHtml(r) {
  const master = getMaster();
  const accName = (id) => master?.accounts.find((a) => a.id === id)?.name || master?.cards.find((c) => c.id === id)?.name || '';
  const via = r.source === 'ai' ? '<i class="bi bi-stars me-1"></i>AI Gemini' : '<i class="bi bi-cpu me-1"></i>OCR perangkat';
  const tone = r.confidence === 'tinggi' ? 'success' : r.confidence === 'sedang' ? 'warning' : 'secondary';
  const facts = [
    r.amount ? `<strong>${formatRupiah(r.amount)}</strong>` : '<span class="text-danger">total tidak terbaca</span>',
    r.date ? formatDate(r.date) : 'tanggal hari ini',
    r.category ? escapeHtml(r.category + (r.subCategory ? ' · ' + r.subCategory : '')) : '',
    r.sourceAccount ? escapeHtml(accName(r.sourceAccount)) : '',
    r.paymentMethod ? escapeHtml(r.paymentMethod) : ''
  ].filter(Boolean).join(' · ');
  const items = (r.items || []).length ? `<details class="small mt-1"><summary>${r.items.length} barang</summary>
    <ul class="list-unstyled mb-0 mt-1">${r.items.map((it) => `<li class="d-flex justify-content-between gap-2"><span class="text-truncate">${it.qty ? `${it.qty}× ` : ''}${escapeHtml(it.name)}</span>
    <span class="text-nowrap">${it.price ? formatRupiah(it.price) : ''}</span></li>`).join('')}</ul></details>` : '';
  const text = r.text ? `<details class="small mt-1"><summary>Teks terbaca</summary><pre class="scan-text mb-0">${escapeHtml(r.text)}</pre></details>` : '';
  return `<div class="small"><span class="badge text-bg-${tone} me-1">${via}${r.confidence ? ` · ${escapeHtml(r.confidence)}` : ''}</span>${r.merchant ? escapeHtml(r.merchant) : ''}</div>
    <div class="small mt-1">${facts}</div>
    <div class="small text-muted mt-1"><i class="bi bi-info-circle me-1"></i>Form sudah terisi. Periksa lagi sebelum menyimpan.</div>
    ${r.notes ? `<div class="small text-muted">${escapeHtml(r.notes)}</div>` : ''}
    ${r.notice ? `<div class="small text-warning-emphasis">${escapeHtml(r.notice)}</div>` : ''}
    ${items}${text}`;
}
