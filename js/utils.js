/**
 * utils.js — fungsi bantu umum: format rupiah & tanggal, perhitungan keuangan,
 * preferensi (localStorage), dan helper DOM kecil.
 */

export const TIMEZONE = 'Asia/Jakarta';
export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export const TRX = {
  INCOME: 'Pemasukan',
  EXPENSE: 'Pengeluaran',
  TRANSFER: 'Transfer',
  CARD_PAYMENT: 'Pembayaran Kartu Kredit',
  INSTALLMENT: 'Cicilan'
};

/* ---------------------------- Angka & Rupiah ---------------------------- */

export function roundRupiah(value) {
  return Math.round(Number(value) || 0);
}

/** 15400000 → "Rp15.400.000" */
export function formatRupiah(value) {
  const amount = roundRupiah(value);
  const text = Math.abs(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (amount < 0 ? '-Rp' : 'Rp') + text;
}

/** 15400000 → "Rp15,4 Jt", 850000 → "Rp850 Rb", 2500000000 → "Rp2,5 M" */
export function formatCompactRupiah(value) {
  const amount = roundRupiah(value);
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  const units = [[1e12, 'T'], [1e9, 'M'], [1e6, 'Jt'], [1e3, 'Rb']];
  for (const [size, label] of units) {
    if (abs >= size) {
      const scaled = Math.floor((abs / size) * 10) / 10;
      return `${sign}Rp${scaled.toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${label}`;
    }
  }
  return `${sign}Rp${abs}`;
}

export function formatNumber(value) {
  return (Number(value) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

/** "1.250.000" / "Rp 1.250.000" → 1250000 */
export function parseAmount(text) {
  if (typeof text === 'number') return text;
  const digits = String(text || '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

export function percent(part, total) {
  if (!total) return part > 0 ? 100 : 0;
  return Math.round((part / total) * 1000) / 10;
}

/* ---------------------------- Tanggal ---------------------------- */

/** Tanggal hari ini di Asia/Jakarta dalam format yyyy-mm-dd. */
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function parseISO(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

export function isValidISODate(text) {
  const p = parseISO(text);
  if (!p || String(text).length !== 10) return false;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return dt.getUTCFullYear() === p.y && dt.getUTCMonth() === p.m - 1 && dt.getUTCDate() === p.d;
}

export function toISO(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "2026-09-28" → "28/09/2026" */
export function formatDate(text) {
  const p = parseISO(text);
  return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}` : '-';
}

/** "2026-09-28" → "Senin, 28 September 2026" */
export function formatDateLong(text, withDay = true) {
  const p = parseISO(text);
  if (!p) return '-';
  const day = DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return `${withDay ? day + ', ' : ''}${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

export function formatDateShort(text) {
  const p = parseISO(text);
  return p ? `${p.d} ${MONTHS_SHORT[p.m - 1]}` : '-';
}

export function monthLabel(month, year) {
  return `${MONTHS[month - 1]} ${year}`;
}

export function currentPeriod() {
  const p = parseISO(todayISO());
  return { month: p.m, year: p.y };
}

export function shiftMonth(month, year, delta) {
  const total = year * 12 + (month - 1) + delta;
  return { month: (total % 12) + 1, year: Math.floor(total / 12) };
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(text, days) {
  const p = parseISO(text);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysBetween(fromText, toText) {
  const a = parseISO(fromText);
  const b = parseISO(toText);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

export function addMonthsISO(text, months) {
  const p = parseISO(text);
  const next = shiftMonth(p.m, p.y, months);
  return toISO(next.year, next.month, Math.min(p.d, daysInMonth(next.year, next.month)));
}

export function relativeDayLabel(text) {
  const diff = daysBetween(todayISO(), text);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Besok';
  if (diff === -1) return 'Kemarin';
  if (diff > 1) return `${diff} hari lagi`;
  return `${Math.abs(diff)} hari lalu`;
}

/* ---------------------------- Perhitungan keuangan ---------------------------- */

/** Saldo Akhir = Saldo Awal + Pemasukan − Pengeluaran + Transfer Masuk − Transfer Keluar (termasuk bayar kartu). */
export function calculateAccountBalance({ openingBalance = 0, income = 0, expense = 0, transferIn = 0, transferOut = 0, cardPayment = 0 }) {
  return roundRupiah(openingBalance + income - expense + transferIn - transferOut - cardPayment);
}

/** Outstanding (limit terpakai) = belanja kartu + total cicilan − pembayaran; Available = Limit − Outstanding. */
export function calculateCreditCardOutstanding({ limit = 0, charges = 0, installments = 0, payments = 0 }) {
  const outstanding = roundRupiah(charges + installments - payments);
  return { outstanding, availableLimit: roundRupiah(limit - outstanding) };
}

export function calculateBudgetRemaining(budget, actual) {
  return { remaining: roundRupiah(budget - actual), percent: percent(actual, budget) };
}

/** Sama persis dengan calculateInstallment_ di Finance.gs (bunga flat per bulan, admin sekali di awal). */
export function calculateInstallment({ principal, tenor, interestRate = 0, adminFee = 0 }) {
  const p = roundRupiah(principal);
  const n = Math.max(1, Math.round(Number(tenor) || 1));
  const interestTotal = roundRupiah(p * (Number(interestRate) / 100) * n);
  const monthly = roundRupiah((p + interestTotal) / n);
  return { interestTotal, monthly, total: monthly * n + roundRupiah(adminFee), tenor: n };
}

/** Tanggal tagihan cicilan pertama: tanggal penagihan (default 16) pertama pada/sesudah tanggal transaksi. Sama dengan firstBillingDate_ di Finance.gs. */
export function firstBillingDate(dateText, day = 16) {
  const p = parseISO(dateText);
  if (!p) return '';
  const next = p.d > day ? shiftMonth(p.m, p.y, 1) : { month: p.m, year: p.y };
  return toISO(next.year, next.month, day);
}

/** Bar teks seperti ████░░░░ untuk progres cicilan. */
export function textProgress(done, total, width = 12) {
  const filled = total ? Math.round((done / total) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

/* ---------------------------- Preferensi (localStorage) ---------------------------- */

const PREF_KEY = 'mrt_prefs';

export function getPref(key, fallback) {
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return key in all ? all[key] : fallback;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    all[key] = value;
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch {
    /* localStorage tidak tersedia (mode privat) — preferensi tidak disimpan */
  }
}

/* ---------------------------- DOM & lainnya ---------------------------- */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function sum(list, key) {
  return list.reduce((total, item) => total + (Number(typeof key === 'function' ? key(item) : item[key]) || 0), 0);
}

export function groupBy(list, keyFn) {
  return list.reduce((map, item) => {
    const key = keyFn(item);
    (map[key] ||= []).push(item);
    return map;
  }, {});
}

const loadedScripts = {};

/** Memuat library eksternal hanya saat dibutuhkan (SheetJS, jsPDF). */
export function loadScript(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        delete loadedScripts[src];
        reject(new Error('Gagal memuat library. Periksa koneksi internet.'));
      };
      document.head.appendChild(script);
    });
  }
  return loadedScripts[src];
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Format input nominal saat diketik: 1500000 → 1.500.000 */
export function attachAmountInput(input) {
  const format = () => {
    const value = parseAmount(input.value);
    input.value = value ? value.toLocaleString('id-ID') : '';
  };
  input.addEventListener('input', format);
  format();
}

export function monthOptions(selected) {
  return MONTHS.map((name, i) => `<option value="${i + 1}" ${i + 1 === Number(selected) ? 'selected' : ''}>${name}</option>`).join('');
}

export function yearOptions(selected, span = 3) {
  const now = currentPeriod().year;
  const years = [];
  for (let y = now + 1; y >= now - span; y--) years.push(y);
  if (!years.includes(Number(selected))) years.push(Number(selected));
  return years.map((y) => `<option value="${y}" ${y === Number(selected) ? 'selected' : ''}>${y}</option>`).join('');
}
