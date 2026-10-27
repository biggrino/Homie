/**
 * finance.js — menu Keuangan: ringkasan, rekening, form transaksi, jurnal, anggaran & kategori.
 * Sub-menu kartu kredit/cicilan ada di creditcard.js, laporan di reports.js.
 */
import { api, ApiError, getMaster, loadMaster, canWrite, accountName } from './api.js';
import {
  TRX, escapeHtml, formatRupiah, formatCompactRupiah, formatDate, formatDateShort, parseAmount, todayISO, isValidISODate,
  calculateInstallment, calculateBudgetRemaining, attachAmountInput, uid, debounce, getPref, setPref, currentPeriod,
  monthOptions, yearOptions, monthLabel, addMonthsISO, MONTHS_SHORT, sum, firstBillingDate
} from './utils.js';
import {
  toast, toastError, openModal, confirmDialog, setButtonLoading, emptyState, progressBar, pageSkeleton, skeleton,
  moneyToggle, bindMoneyToggles, doughnutChart, chartLegend, typeBadge, trxIcon
} from './ui.js';
import { renderCards, renderCardPayment, renderInstallments } from './creditcard.js';
import { renderReports, exportExcel, exportPdf } from './reports.js';

const TABS = [
  { id: 'ringkasan', label: 'Ringkasan', icon: 'bi-speedometer2' },
  { id: 'rekening', label: 'Rekening', icon: 'bi-bank' },
  { id: 'jurnal', label: 'Jurnal', icon: 'bi-journal-text' },
  { id: 'kartu', label: 'Kartu Kredit', icon: 'bi-credit-card' },
  { id: 'bayar-kartu', label: 'Bayar Kartu', icon: 'bi-credit-card-2-back' },
  { id: 'cicilan', label: 'Cicilan', icon: 'bi-calendar2-range' },
  { id: 'anggaran', label: 'Anggaran', icon: 'bi-pie-chart' },
  { id: 'laporan', label: 'Laporan', icon: 'bi-bar-chart-line' }
];

const TYPE_OPTIONS = [
  { value: TRX.INCOME, label: 'Pemasukan', icon: 'bi-arrow-down-left' },
  { value: TRX.EXPENSE, label: 'Pengeluaran', icon: 'bi-arrow-up-right' },
  { value: TRX.TRANSFER, label: 'Transfer', icon: 'bi-arrow-left-right' },
  { value: TRX.CARD_PAYMENT, label: 'Bayar Kartu', icon: 'bi-credit-card-2-back' },
  { value: TRX.INSTALLMENT, label: 'Cicilan', icon: 'bi-calendar2-range' }
];

const PAYMENT_METHODS = ['Tunai', 'Transfer', 'Kartu Debit', 'QRIS', 'E-Wallet', 'Autodebet'];

export const refreshApp = () => window.dispatchEvent(new Event('app:refresh'));

export async function afterDataChange() {
  await loadMaster(true);
  refreshApp();
}

/* =========================== RENDER MENU KEUANGAN =========================== */

export async function renderFinance(container, sub) {
  const active = TABS.some((t) => t.id === sub) ? sub : 'ringkasan';
  container.innerHTML = `
    <nav class="sub-tabs mb-3" aria-label="Sub menu keuangan">${TABS.map((t) => `
      <a href="#/keuangan/${t.id}" class="sub-tab ${t.id === active ? 'active' : ''}"><i class="bi ${t.icon}"></i>${t.label}</a>`).join('')}
    </nav><div id="finance-content"></div>`;
  container.querySelector('.sub-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  const content = container.querySelector('#finance-content');
  const renderers = {
    ringkasan: renderSummary, rekening: renderAccounts, jurnal: renderJournal, kartu: renderCards,
    'bayar-kartu': renderCardPayment, cicilan: renderInstallments, anggaran: renderBudgets, laporan: renderReports
  };
  await renderers[active](content);
}

/** Pilihan bulan & tahun yang disimpan sebagai preferensi filter terakhir. */
export function periodFilter(prefKey, onChange) {
  const saved = getPref(prefKey, currentPeriod());
  const html = `<div class="period-filter">
      <button class="btn btn-icon" data-shift="-1" aria-label="Bulan sebelumnya"><i class="bi bi-chevron-left"></i></button>
      <select class="form-select form-select-sm" data-period="month" aria-label="Bulan">${monthOptions(saved.month)}</select>
      <select class="form-select form-select-sm" data-period="year" aria-label="Tahun">${yearOptions(saved.year)}</select>
      <button class="btn btn-icon" data-shift="1" aria-label="Bulan berikutnya"><i class="bi bi-chevron-right"></i></button>
    </div>`;
  const bind = (root) => {
    const month = root.querySelector('[data-period="month"]');
    const year = root.querySelector('[data-period="year"]');
    const emit = () => {
      const value = { month: Number(month.value), year: Number(year.value) };
      setPref(prefKey, value);
      onChange(value);
    };
    month.addEventListener('change', emit);
    year.addEventListener('change', emit);
    root.querySelectorAll('[data-shift]').forEach((btn) => btn.addEventListener('click', () => {
      let m = Number(month.value) + Number(btn.dataset.shift);
      let y = Number(year.value);
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      if (![...year.options].some((o) => Number(o.value) === y)) year.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`);
      month.value = m;
      year.value = y;
      emit();
    }));
  };
  return { html, bind, value: saved };
}

/* =========================== RINGKASAN =========================== */

async function renderSummary(container) {
  const filter = periodFilter('summaryPeriod', (p) => load(p));
  container.innerHTML = `<div class="toolbar mb-3"><h2 class="h6 mb-0 fw-bold">Ringkasan Keuangan</h2>${filter.html}</div><div id="summary-body"></div>`;
  filter.bind(container);
  const body = container.querySelector('#summary-body');

  async function load(period) {
    body.innerHTML = skeleton(8);
    const { data } = await api('getSummary', period);
    const totalExpense = sum(data.expenseByCategory, 'amount');
    const card = (label, value, icon, tone, note = '') => `<div class="col-6 col-lg-3"><div class="card app-card stat-card h-100" data-toggle-money role="button">
      <div class="card-body"><div class="stat-icon icon-${tone}"><i class="bi ${icon}"></i></div><div class="stat-label">${label}</div>
      <div class="stat-value">${moneyToggle(value)}</div>${note ? `<div class="stat-note">${note}</div>` : ''}</div></div></div>`;
    body.innerHTML = `
      <div class="row g-3 mb-3">
        ${card('Total aset kas', data.totalCash, 'bi-safe2', 'primary', `Per akhir ${monthLabel(period.month, period.year)}`)}
        ${card('Saldo rekening', data.bankBalance, 'bi-bank', 'info')}
        ${card('Saldo tunai', data.cashBalance, 'bi-cash-stack', 'success')}
        ${card('Tagihan kartu', data.cardBill, 'bi-credit-card', 'warning', `Limit terpakai ${formatCompactRupiah(data.cardOutstanding)}`)}
        ${card('Cicilan belum ditagih', data.activeInstallments.remaining, 'bi-calendar2-range', 'secondary', `${data.activeInstallments.count} cicilan · ${formatCompactRupiah(data.activeInstallments.monthly)}/bln`)}
        ${card('Pemasukan', data.income, 'bi-arrow-down-left', 'success')}
        ${card('Pengeluaran', data.expense, 'bi-arrow-up-right', 'danger', data.expenseViaCard ? `${formatCompactRupiah(data.expenseViaCard)} via kartu` : '')}
        ${card('Cash flow', data.cashFlow, 'bi-graph-up-arrow', data.cashFlow >= 0 ? 'success' : 'danger', 'Pemasukan − pengeluaran')}
      </div>
      <div class="row g-3">
        <div class="col-lg-5"><div class="card app-card h-100"><div class="card-body">
          <h3 class="section-title mb-3"><i class="bi bi-pie-chart-fill"></i>Pengeluaran per Kategori</h3>
          ${totalExpense ? `<div class="chart-wrap chart-doughnut"><canvas id="summary-chart"></canvas>
            <div class="chart-center"><small>Total</small><strong>${formatCompactRupiah(totalExpense)}</strong></div></div>${chartLegend(data.expenseByCategory, totalExpense)}`
            : emptyState('bi-pie-chart', 'Belum ada pengeluaran pada periode ini.')}
        </div></div></div>
        <div class="col-lg-7"><div class="card app-card h-100"><div class="card-body">
          <h3 class="section-title mb-3"><i class="bi bi-bank"></i>Saldo per Rekening</h3>
          <ul class="simple-list">${data.accounts.map((a) => `<li>
            <div class="icon-circle icon-sm icon-${a.type === 'Tunai' ? 'success' : 'info'}"><i class="bi ${a.type === 'Tunai' ? 'bi-cash-stack' : 'bi-bank'}"></i></div>
            <div class="flex-grow-1">${escapeHtml(a.name)}<div class="small text-muted">${a.type}</div></div>
            <strong class="${a.balance < 0 ? 'text-danger' : ''}">${formatRupiah(a.balance)}</strong></li>`).join('')}</ul>
          <div class="d-flex justify-content-between mt-3 pt-3 border-top small">
            <span class="text-muted">Transfer internal periode ini</span><strong>${formatRupiah(data.transfer)}</strong></div>
          <div class="d-flex justify-content-between mt-1 small">
            <span class="text-muted">Pembayaran kartu kredit</span><strong>${formatRupiah(data.cardPayment)}</strong></div>
          <p class="small text-muted mt-2 mb-0"><i class="bi bi-info-circle me-1"></i>Transfer dan pembayaran kartu hanya memindahkan kas, tidak dihitung sebagai pengeluaran.
            Belanja pakai kartu dihitung pengeluaran saat transaksi; cicilan dihitung per bulan saat ditagihkan.</p>
        </div></div></div>
      </div>`;
    bindMoneyToggles(body);
    if (totalExpense) doughnutChart(body.querySelector('#summary-chart'), data.expenseByCategory);
  }
  await load(filter.value);
}

/* =========================== REKENING =========================== */

async function renderAccounts(container) {
  container.innerHTML = skeleton(6);
  const master = await loadMaster(true);
  const accounts = master.accounts;
  const total = sum(accounts.filter((a) => a.active), 'balance');
  container.innerHTML = `
    <div class="toolbar mb-3">
      <div><h2 class="h6 mb-0 fw-bold">Rekening & Cash</h2><div class="small text-muted">Total saldo aktif ${formatRupiah(total)}</div></div>
      ${canWrite() ? '<button class="btn btn-primary btn-sm" id="add-account"><i class="bi bi-plus-lg me-1"></i>Rekening</button>' : ''}
    </div>
    <div class="row g-3">${accounts.map((a) => `
      <div class="col-md-6 col-xl-4"><div class="card app-card h-100 ${a.active ? '' : 'opacity-50'}"><div class="card-body">
        <div class="d-flex align-items-center gap-3 mb-3">
          <div class="icon-circle icon-${a.type === 'Tunai' ? 'success' : 'info'}"><i class="bi ${a.type === 'Tunai' ? 'bi-cash-stack' : 'bi-bank'}"></i></div>
          <div class="min-w-0 flex-grow-1"><div class="fw-bold">${escapeHtml(a.name)}</div>
            <div class="small text-muted">${a.type} · ${a.active ? '<span class="text-success">Aktif</span>' : 'Nonaktif'}</div></div>
          ${canWrite() ? `<button class="btn btn-icon" data-edit-account="${a.id}" aria-label="Ubah ${escapeHtml(a.name)}"><i class="bi bi-pencil"></i></button>` : ''}
        </div>
        <div class="account-big ${a.balance < 0 ? 'text-danger' : ''}">${formatRupiah(a.balance)}</div>
        <dl class="mini-dl mt-3 mb-0">
          <dt>Saldo awal</dt><dd>${formatRupiah(a.openingBalance)}</dd>
          <dt>Total pemasukan</dt><dd class="text-success">+${formatRupiah(a.income)}</dd>
          <dt>Total pengeluaran</dt><dd class="text-danger">−${formatRupiah(a.expense)}</dd>
          <dt>Transfer masuk</dt><dd>+${formatRupiah(a.transferIn)}</dd>
          <dt>Transfer keluar</dt><dd>−${formatRupiah(a.transferOut)}</dd>
          ${a.cardPayment ? `<dt>Bayar kartu kredit</dt><dd>−${formatRupiah(a.cardPayment)}</dd>` : ''}
        </dl>
        <a href="#/keuangan/jurnal" class="small d-inline-block mt-2" data-journal-account="${a.id}">Lihat transaksi <i class="bi bi-arrow-right"></i></a>
      </div></div></div>`).join('')}
    </div>
    <p class="small text-muted mt-3"><i class="bi bi-calculator me-1"></i>Saldo dihitung otomatis:
      Saldo Akhir = Saldo Awal + Pemasukan − Pengeluaran + Transfer Masuk − Transfer Keluar (termasuk pembayaran kartu).</p>`;
  container.querySelector('#add-account')?.addEventListener('click', () => openAccountForm());
  container.querySelectorAll('[data-edit-account]').forEach((btn) => btn.addEventListener('click', () =>
    openAccountForm(accounts.find((a) => a.id === btn.dataset.editAccount))));
  container.querySelectorAll('[data-journal-account]').forEach((link) => link.addEventListener('click', () => {
    setPref('journalFilter', { ...getPref('journalFilter', {}), account: link.dataset.journalAccount, month: '', year: '' });
  }));
}

export function openAccountForm(account = null) {
  const a = account || { name: '', type: 'Bank', openingBalance: 0, active: true };
  const modal = openModal({
    title: account ? `Ubah ${escapeHtml(a.name)}` : 'Tambah rekening',
    body: `<form id="account-form" novalidate><div class="row g-3">
      <div class="col-12"><label class="form-label">Nama rekening</label><input name="name" class="form-control" maxlength="40" required value="${escapeHtml(a.name)}"></div>
      <div class="col-6"><label class="form-label">Jenis</label><select name="type" class="form-select">
        <option value="Bank" ${a.type === 'Bank' ? 'selected' : ''}>Bank</option><option value="Tunai" ${a.type === 'Tunai' ? 'selected' : ''}>Tunai</option></select></div>
      <div class="col-6"><label class="form-label">Saldo awal</label><div class="input-group"><span class="input-group-text">Rp</span>
        <input name="openingBalance" class="form-control" inputmode="numeric" value="${a.openingBalance || ''}"></div></div>
      <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="acc-active" ${a.active ? 'checked' : ''}>
        <label class="form-check-label" for="acc-active">Rekening aktif</label></div></div>
      <div class="col-12 small text-muted">Saldo saat ini tidak diisi manual — dihitung dari saldo awal dan seluruh transaksi.</div>
    </div></form>`,
    footer: '<button class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary" id="account-save">Simpan</button>'
  });
  const form = modal.el.querySelector('#account-form').elements;
  attachAmountInput(form.openingBalance);
  modal.el.querySelector('#account-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!form.name.value.trim()) return toast('Nama rekening wajib diisi.', 'warning');
    setButtonLoading(btn, true);
    try {
      const res = await api('saveAccount', { id: account?.id, name: form.name.value, type: form.type.value,
        openingBalance: parseAmount(form.openingBalance.value), active: form.active.checked });
      toast(res.message);
      modal.close();
      await afterDataChange();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });
}

/* =========================== DAFTAR & DETAIL TRANSAKSI =========================== */

const trxCache = new Map();

function amountDisplay(t) {
  if (t.type === TRX.INCOME) return { sign: '+', tone: 'text-success' };
  if (t.type === TRX.EXPENSE) return { sign: '−', tone: 'text-danger' };
  return { sign: '', tone: 'text-body' };
}

function trxTone(type) {
  return { Pemasukan: 'success', Pengeluaran: 'danger', Transfer: 'info', 'Pembayaran Kartu Kredit': 'primary', Cicilan: 'warning' }[type] || 'secondary';
}

export function transactionListItem(t) {
  trxCache.set(t.id, t);
  const { sign, tone } = amountDisplay(t);
  const route = t.destinationName ? `${escapeHtml(t.sourceName)} → ${escapeHtml(t.destinationName)}` : escapeHtml(t.sourceName);
  return `<button type="button" class="trx-item" data-trx-id="${escapeHtml(t.id)}">
    <span class="icon-circle icon-sm icon-${trxTone(t.type)}"><i class="bi ${trxIcon(t.type)}"></i></span>
    <span class="trx-main"><span class="trx-title">${escapeHtml(t.description || t.subCategory || t.category)}</span>
      <span class="trx-sub">${formatDateShort(t.date)} · ${route} · ${escapeHtml(t.category)}${t.shoppingItems ? ` · <i class="bi bi-cart-check"></i> ${t.shoppingItems.length} item` : ''}</span></span>
    <span class="trx-amount ${tone}">${sign}${formatCompactRupiah(t.amount)}${t.installment ? `<small class="d-block text-muted fw-normal">${formatCompactRupiah(t.installment.monthlyPayment)} × ${t.installment.tenor}</small>` : ''}</span>
  </button>`;
}

export function bindTransactionList(root) {
  root.querySelectorAll('[data-trx-id]').forEach((el) => el.addEventListener('click', () => {
    const t = trxCache.get(el.dataset.trxId);
    if (t) openTransactionDetail(t);
  }));
}

export function openTransactionDetail(t) {
  const { sign, tone } = amountDisplay(t);
  const row = (label, value) => (value ? `<dt>${label}</dt><dd>${value}</dd>` : '');
  const inst = t.installment;
  const modal = openModal({
    title: 'Detail transaksi',
    body: `<div class="text-center mb-3">${typeBadge(t.type)}
        <div class="detail-amount ${tone}">${sign}${formatRupiah(t.amount)}</div>
        <div class="text-muted">${escapeHtml(t.description || '-')}</div></div>
      <dl class="detail-dl">
        ${row('ID', `<code>${escapeHtml(t.id)}</code>`)}
        ${row('Tanggal', formatDate(t.date))}
        ${row(t.type === TRX.INCOME ? 'Masuk ke' : 'Sumber', escapeHtml(t.sourceName))}
        ${row('Tujuan', escapeHtml(t.destinationName))}
        ${row('Kategori', escapeHtml(t.category + (t.subCategory ? ' › ' + t.subCategory : '')))}
        ${row('Metode', escapeHtml(t.paymentMethod))}
        ${inst ? row('Cicilan', `${formatRupiah(inst.monthlyPayment)} × ${inst.tenor} bulan<br><small class="text-muted">Pokok ${formatRupiah(inst.principal)} · bunga ${inst.interestRate}%/bln · admin ${formatRupiah(inst.adminFee)}</small>
          <br><small class="text-muted">Ditagihkan ke kartu mulai ${formatDate(inst.firstBillingDate)}, lalu setiap bulan pada tanggal yang sama.</small>`) : ''}
        ${t.shoppingItems ? row('Dari daftar belanja', `<ul class="list-unstyled mb-0 small">${t.shoppingItems.map((s) => `<li class="d-flex justify-content-between gap-2"><span>${escapeHtml(s.item)}</span><span>${formatRupiah(s.amount)}</span></li>`).join('')}</ul>`) : ''}
        ${row('Lampiran', t.attachment ? `<a href="${escapeHtml(t.attachment)}" target="_blank" rel="noopener">Buka lampiran <i class="bi bi-box-arrow-up-right"></i></a>` : '')}
        ${row('Dicatat oleh', escapeHtml(t.createdBy))}
        ${row('Dibuat', escapeHtml(t.createdAt))}
        ${row('Diperbarui', t.updatedAt !== t.createdAt ? escapeHtml(t.updatedAt) : '')}
      </dl>`,
    footer: canWrite()
      ? `<button class="btn btn-outline-danger me-auto" id="trx-delete"><i class="bi bi-trash me-1"></i>Hapus</button>
         <button class="btn btn-primary" id="trx-edit"><i class="bi bi-pencil me-1"></i>Edit</button>`
      : '<button class="btn btn-light" data-bs-dismiss="modal">Tutup</button>'
  });
  modal.el.querySelector('#trx-edit')?.addEventListener('click', () => {
    modal.close();
    setTimeout(() => openTransactionForm(t), 250);
  });
  modal.el.querySelector('#trx-delete')?.addEventListener('click', async (e) => {
    const ok = await confirmDialog({
      title: 'Hapus transaksi?',
      message: `Transaksi ${t.id} (${formatRupiah(t.amount)}) akan dihapus permanen dan saldo dihitung ulang.${t.shoppingItems ? ` ${t.shoppingItems.length} item belanja akan kembali berstatus "belum dicatat".` : ''}`,
      confirmText: 'Hapus', danger: true
    });
    if (!ok) return;
    setButtonLoading(e.target.closest('button'), true, 'Menghapus…');
    try {
      const res = await api('deleteTransaction', { id: t.id });
      toast(res.message);
      modal.close();
      await afterDataChange();
    } catch (err) {
      toastError(err);
      setButtonLoading(e.target.closest('button'), false);
    }
  });
}

/* =========================== FORM TRANSAKSI =========================== */

/**
 * Form tambah/edit transaksi. `preset` dapat berisi { type, sourceAccount, destinationAccount, amount }.
 */
export async function openTransactionForm(existing = null, preset = {}) {
  if (!canWrite()) return toast('Akun Viewer hanya dapat melihat data.', 'warning');
  const master = getMaster() || await loadMaster();
  const t = existing || {};
  const inst = t.installment || {};
  const allowCash = master.settings.ALLOW_CASH_TRANSFER === 'TRUE';
  const allowBank = master.settings.ALLOW_BANK_TO_BANK !== 'FALSE';
  const activeAccounts = master.accounts.filter((a) => a.active || a.id === t.sourceAccount || a.id === t.destinationAccount);
  const activeCards = master.cards.filter((c) => c.active || c.id === t.sourceAccount || c.id === t.destinationAccount);
  const isCard = (id) => master.cards.some((c) => c.id === id);
  const initialType = t.type || preset.type || TRX.EXPENSE;
  const billingDay = Number(master.settings.INSTALLMENT_BILLING_DAY) || 16;

  const modal = openModal({
    title: existing ? `Edit transaksi <small class="text-muted fs-6">${escapeHtml(t.id)}</small>` : 'Tambah transaksi',
    size: 'modal-lg',
    body: `<form id="trx-form" novalidate autocomplete="off">
      <div class="type-switch mb-3" role="radiogroup" aria-label="Jenis transaksi">${TYPE_OPTIONS.map((o) => `
        <input type="radio" class="btn-check" name="type" id="type-${o.label.replace(/\s/g, '')}" value="${o.value}" ${o.value === initialType ? 'checked' : ''}>
        <label class="btn" for="type-${o.label.replace(/\s/g, '')}"><i class="bi ${o.icon}"></i><span>${o.label}</span></label>`).join('')}
      </div>
      <div class="row g-3">
        <div class="col-6"><label class="form-label" for="trx-date">Tanggal</label>
          <input type="date" id="trx-date" name="date" class="form-control" required value="${escapeHtml(t.date || preset.date || todayISO())}"></div>
        <div class="col-6"><label class="form-label" for="trx-method">Metode pembayaran</label>
          <select id="trx-method" name="paymentMethod" class="form-select"></select></div>
        <div class="col-12 col-md-6"><label class="form-label" for="trx-source" id="src-label">Rekening/kartu sumber</label>
          <select id="trx-source" name="sourceAccount" class="form-select" required></select>
          <div class="form-text" id="src-info"></div></div>
        <div class="col-12 col-md-6"><label class="form-label" for="trx-dest" id="dst-label">Rekening/kartu tujuan</label>
          <select id="trx-dest" name="destinationAccount" class="form-select"></select>
          <div class="form-text" id="dst-info"></div></div>
        <div class="col-12" id="mode-wrap" hidden>
          <label class="form-label d-block">Transaksi kartu kredit</label>
          <div class="btn-group w-100" role="group">
            <input type="radio" class="btn-check" name="cardMode" id="mode-normal" value="normal">
            <label class="btn btn-outline-primary" for="mode-normal"><i class="bi bi-bag me-1"></i>Transaksi biasa</label>
            <input type="radio" class="btn-check" name="cardMode" id="mode-installment" value="installment">
            <label class="btn btn-outline-primary" for="mode-installment"><i class="bi bi-calendar2-range me-1"></i>Cicilan</label>
          </div></div>
        <div class="col-6"><label class="form-label" for="trx-category">Kategori</label>
          <select id="trx-category" name="category" class="form-select"></select></div>
        <div class="col-6"><label class="form-label" for="trx-sub">Subkategori</label>
          <select id="trx-sub" name="subCategory" class="form-select"></select></div>
        <div class="col-12" id="amount-wrap"><label class="form-label" for="trx-amount">Nominal</label>
          <div class="input-group input-group-lg"><span class="input-group-text">Rp</span>
            <input id="trx-amount" name="amount" class="form-control fw-bold" inputmode="numeric" placeholder="0" value="${t.type !== TRX.INSTALLMENT ? (t.amount || preset.amount || '') : ''}"></div>
          <div class="quick-amounts mt-2" id="pay-shortcuts" hidden></div></div>
        <div class="col-12" id="installment-wrap" hidden>
          <div class="installment-box">
            <div class="row g-3">
              <div class="col-12 col-md-6"><label class="form-label" for="inst-principal">Harga barang</label>
                <div class="input-group"><span class="input-group-text">Rp</span><input id="inst-principal" name="principal" class="form-control" inputmode="numeric" value="${inst.principal || ''}"></div></div>
              <div class="col-6 col-md-3"><label class="form-label" for="inst-tenor">Tenor (bulan)</label>
                <select id="inst-tenor" name="tenor" class="form-select">${[3, 6, 9, 12, 18, 24, 36].map((n) => `<option ${Number(inst.tenor || 6) === n ? 'selected' : ''}>${n}</option>`).join('')}
                ${inst.tenor && ![3, 6, 9, 12, 18, 24, 36].includes(inst.tenor) ? `<option selected>${inst.tenor}</option>` : ''}</select></div>
              <div class="col-6 col-md-3"><label class="form-label" for="inst-rate">Bunga %/bulan</label>
                <input id="inst-rate" name="interestRate" type="number" step="0.01" min="0" max="10" class="form-control" value="${inst.interestRate ?? 0}"></div>
              <div class="col-12 col-md-6"><label class="form-label" for="inst-admin">Biaya administrasi</label>
                <div class="input-group"><span class="input-group-text">Rp</span><input id="inst-admin" name="adminFee" class="form-control" inputmode="numeric" value="${inst.adminFee || ''}"></div></div>
              <div class="col-12 col-md-6"><div class="installment-preview" id="inst-preview"></div></div>
            </div></div></div>
        <div class="col-12"><label class="form-label" for="trx-desc">Keterangan</label>
          <input id="trx-desc" name="description" class="form-control" maxlength="200" placeholder="Contoh: Belanja sayur di pasar" value="${escapeHtml(t.description || '')}"></div>
        <div class="col-12"><label class="form-label" for="trx-attach">Lampiran <span class="text-muted">(opsional, link Google Drive)</span></label>
          <input id="trx-attach" name="attachment" type="url" class="form-control" placeholder="https://drive.google.com/…" value="${escapeHtml(t.attachment || '')}"></div>
      </div></form>`,
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">Batal</button>
      <button class="btn btn-primary px-4" id="trx-save"><i class="bi bi-check2 me-1"></i>${existing ? 'Simpan perubahan' : 'Simpan'}</button>`
  });

  const form = modal.el.querySelector('#trx-form');
  const el = (name) => form.elements[name];
  ['amount', 'principal', 'adminFee'].forEach((n) => attachAmountInput(el(n)));
  const selectedType = () => form.querySelector('input[name="type"]:checked').value;
  let source = t.sourceAccount || preset.sourceAccount || '';
  let destination = t.destinationAccount || preset.destinationAccount || '';
  let category = t.category || '';
  let subCategory = t.subCategory || '';

  const accountOption = (a, selected) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${escapeHtml(a.name)} · ${formatRupiah(a.balance)}</option>`;
  const cardOption = (c, selected) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escapeHtml(c.name)} · limit ${formatCompactRupiah(c.availableLimit)}</option>`;

  function sourceOptions(type) {
    const banks = activeAccounts.filter((a) => a.type === 'Bank');
    const cash = activeAccounts.filter((a) => a.type === 'Tunai');
    if (type === TRX.INCOME) return { label: 'Masuk ke rekening', list: activeAccounts, html: activeAccounts.map((a) => accountOption(a, source)).join('') };
    if (type === TRX.TRANSFER) {
      const list = allowCash ? activeAccounts : banks;
      return { label: 'Rekening sumber', list, html: list.map((a) => accountOption(a, source)).join('') };
    }
    if (type === TRX.CARD_PAYMENT) return { label: 'Rekening sumber pembayaran', list: banks, html: banks.map((a) => accountOption(a, source)).join('') };
    if (type === TRX.INSTALLMENT) return { label: 'Kartu kredit', list: activeCards, html: activeCards.map((c) => cardOption(c, source)).join('') };
    return {
      label: 'Rekening/kartu sumber',
      list: [...activeAccounts, ...activeCards],
      html: `<optgroup label="Rekening bank">${banks.map((a) => accountOption(a, source)).join('')}</optgroup>
        <optgroup label="Tunai">${cash.map((a) => accountOption(a, source)).join('')}</optgroup>
        <optgroup label="Kartu kredit">${activeCards.map((c) => cardOption(c, source)).join('')}</optgroup>`
    };
  }

  function destinationOptions(type) {
    if (type === TRX.TRANSFER) {
      const src = activeAccounts.find((a) => a.id === source);
      const list = activeAccounts.filter((a) => a.id !== source && (a.type === 'Tunai' || allowBank || src?.type !== 'Bank'));
      return list.map((a) => accountOption(a, destination)).join('');
    }
    if (type === TRX.CARD_PAYMENT) {
      return activeCards.map((c) => `<option value="${c.id}" ${c.id === destination ? 'selected' : ''}>${escapeHtml(c.name)} · tagihan ${formatCompactRupiah(c.bill)}</option>`).join('');
    }
    return '<option value="">Tidak diperlukan</option>';
  }

  function updateInstallmentPreview() {
    const principal = parseAmount(el('principal').value);
    const tenor = Number(el('tenor').value);
    const calc = calculateInstallment({ principal, tenor, interestRate: Number(el('interestRate').value) || 0, adminFee: parseAmount(el('adminFee').value) });
    const date = el('date').value || todayISO();
    const firstBill = isValidISODate(date) ? firstBillingDate(date, billingDay) : '';
    const endDate = firstBill ? addMonthsISO(firstBill, calc.tenor - 1) : '';
    const endLabel = endDate ? `${MONTHS_SHORT[Number(endDate.slice(5, 7)) - 1]} ${endDate.slice(0, 4)}` : '-';
    el('amount').value = calc.total ? calc.total.toLocaleString('id-ID') : '';
    form.querySelector('#inst-preview').innerHTML = principal
      ? `<div class="d-flex justify-content-between"><span>Cicilan per bulan</span><strong>${formatRupiah(calc.monthly)}</strong></div>
         <div class="d-flex justify-content-between small"><span>Total bunga</span><span>${formatRupiah(calc.interestTotal)}</span></div>
         <div class="d-flex justify-content-between small"><span>Total tagihan (+admin)</span><span>${formatRupiah(calc.total)}</span></div>
         <div class="d-flex justify-content-between small"><span>Tagihan pertama</span><span>${firstBill ? formatDate(firstBill) : '-'}</span></div>
         <div class="d-flex justify-content-between small"><span>Tenor</span><span>${calc.tenor} bulan · selesai ${endLabel}</span></div>
         <div class="small text-muted mt-1">Limit kartu langsung terpakai sebesar total cicilan. Tagihan masuk ${formatRupiah(calc.monthly)} setiap tanggal ${billingDay}.</div>`
      : '<span class="text-muted small">Isi harga barang untuk menghitung cicilan otomatis.</span>';
  }

  function updateInfo() {
    const type = selectedType();
    const acc = activeAccounts.find((a) => a.id === source);
    const card = activeCards.find((c) => c.id === source);
    form.querySelector('#src-info').innerHTML = acc ? `Saldo saat ini: <strong>${formatRupiah(acc.balance)}</strong>`
      : card ? `Limit tersedia: <strong>${formatRupiah(card.availableLimit)}</strong> dari ${formatCompactRupiah(card.limit)}` : '';
    const dstCard = type === TRX.CARD_PAYMENT ? activeCards.find((c) => c.id === destination) : null;
    form.querySelector('#dst-info').innerHTML = dstCard
      ? `Tagihan saat ini <strong>${formatRupiah(dstCard.bill)}</strong> · minimum ${formatRupiah(dstCard.minimumPayment)}
        ${dstCard.unbilledInstallments ? `<br>Cicilan belum ditagih ${formatRupiah(dstCard.unbilledInstallments)} belum perlu dibayar.` : ''}` : '';
    const shortcuts = form.querySelector('#pay-shortcuts');
    shortcuts.hidden = !dstCard || dstCard.bill <= 0;
    if (dstCard) {
      shortcuts.innerHTML = `<button type="button" class="btn btn-sm btn-outline-secondary" data-fill="${dstCard.bill}">Bayar penuh</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-fill="${dstCard.minimumPayment}">Bayar minimum</button>`;
      shortcuts.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {
        el('amount').value = Number(b.dataset.fill).toLocaleString('id-ID');
      }));
    }
  }

  function update() {
    const type = selectedType();
    const src = sourceOptions(type);
    form.querySelector('#src-label').textContent = src.label;
    el('sourceAccount').innerHTML = src.html || '<option value="">Tidak ada pilihan</option>';
    if (!src.list.some((a) => a.id === source)) source = src.list[0]?.id || '';
    el('sourceAccount').value = source;

    const needsDest = type === TRX.TRANSFER || type === TRX.CARD_PAYMENT;
    form.querySelector('#dst-label').textContent = type === TRX.CARD_PAYMENT ? 'Kartu kredit yang dibayar' : 'Rekening/kartu tujuan';
    el('destinationAccount').innerHTML = destinationOptions(type);
    el('destinationAccount').disabled = !needsDest;
    if (needsDest) {
      if (![...el('destinationAccount').options].some((o) => o.value === destination)) destination = el('destinationAccount').options[0]?.value || '';
      el('destinationAccount').value = destination;
    }

    const cardSource = isCard(source);
    const modeWrap = form.querySelector('#mode-wrap');
    modeWrap.hidden = !((type === TRX.EXPENSE || type === TRX.INSTALLMENT) && cardSource);
    form.querySelector('#mode-normal').checked = type !== TRX.INSTALLMENT;
    form.querySelector('#mode-installment').checked = type === TRX.INSTALLMENT;

    const fixedCategory = type === TRX.TRANSFER ? 'Transfer' : type === TRX.CARD_PAYMENT ? 'Kartu Kredit' : null;
    const catType = type === TRX.INCOME ? 'Pemasukan' : 'Pengeluaran';
    const categories = master.categories.filter((c) => c.type === catType && (c.active || c.name === category));
    if (fixedCategory) {
      el('category').innerHTML = `<option>${fixedCategory}</option>`;
      el('category').disabled = true;
    } else {
      if (!categories.some((c) => c.name === category)) category = categories[0]?.name || '';
      el('category').innerHTML = categories.map((c) => `<option ${c.name === category ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
      el('category').disabled = false;
    }
    const subs = fixedCategory ? [] : (categories.find((c) => c.name === category)?.subCategories || []);
    el('subCategory').innerHTML = `<option value="">— Tanpa subkategori —</option>${subs.map((s) => `<option ${s === subCategory ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
      ${subCategory && !subs.includes(subCategory) && !fixedCategory ? `<option selected>${escapeHtml(subCategory)}</option>` : ''}`;
    el('subCategory').disabled = Boolean(fixedCategory);

    const methodValue = el('paymentMethod').value || t.paymentMethod || '';
    if (cardSource) {
      el('paymentMethod').innerHTML = '<option>Kartu Kredit</option>';
      el('paymentMethod').disabled = true;
    } else {
      const acc = activeAccounts.find((a) => a.id === source);
      const fallback = acc?.type === 'Tunai' && type !== TRX.TRANSFER ? 'Tunai' : 'Transfer';
      const chosen = PAYMENT_METHODS.includes(methodValue) ? methodValue : fallback;
      el('paymentMethod').innerHTML = PAYMENT_METHODS.map((m) => `<option ${m === chosen ? 'selected' : ''}>${m}</option>`).join('');
      el('paymentMethod').disabled = false;
    }

    const isInstallment = type === TRX.INSTALLMENT;
    form.querySelector('#installment-wrap').hidden = !isInstallment;
    el('amount').readOnly = isInstallment;
    form.querySelector('#amount-wrap label').textContent = isInstallment ? 'Total tagihan cicilan (otomatis)' : 'Nominal';
    if (isInstallment) updateInstallmentPreview();
    updateInfo();
  }

  form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', () => {
    if (selectedType() !== TRX.INSTALLMENT && el('amount').readOnly) el('amount').value = '';
    update();
  }));
  form.querySelectorAll('input[name="cardMode"]').forEach((r) => r.addEventListener('change', () => {
    const target = r.value === 'installment' ? TRX.INSTALLMENT : TRX.EXPENSE;
    form.querySelector(`input[name="type"][value="${target}"]`).checked = true;
    if (target === TRX.INSTALLMENT && !el('principal').value && el('amount').value) el('principal').value = el('amount').value;
    if (target === TRX.EXPENSE) el('amount').value = '';
    update();
  }));
  el('sourceAccount').addEventListener('change', () => { source = el('sourceAccount').value; update(); });
  el('destinationAccount').addEventListener('change', () => { destination = el('destinationAccount').value; updateInfo(); });
  el('category').addEventListener('change', () => { category = el('category').value; subCategory = ''; update(); });
  el('subCategory').addEventListener('change', () => { subCategory = el('subCategory').value; });
  ['principal', 'tenor', 'interestRate', 'adminFee', 'date'].forEach((n) => el(n).addEventListener('input', () => {
    if (selectedType() === TRX.INSTALLMENT) updateInstallmentPreview();
  }));
  update();

  const requestId = uid();
  const saveButton = modal.el.querySelector('#trx-save');

  function collect() {
    const type = selectedType();
    const payload = {
      id: existing?.id, type, date: el('date').value, sourceAccount: el('sourceAccount').value,
      destinationAccount: el('destinationAccount').disabled ? '' : el('destinationAccount').value,
      category: el('category').disabled ? '' : el('category').value, subCategory: el('subCategory').value,
      amount: parseAmount(el('amount').value), description: el('description').value.trim(),
      paymentMethod: el('paymentMethod').value, attachment: el('attachment').value.trim(), requestId
    };
    if (type === TRX.INSTALLMENT) {
      payload.installment = { principal: parseAmount(el('principal').value), tenor: Number(el('tenor').value),
        interestRate: Number(el('interestRate').value) || 0, adminFee: parseAmount(el('adminFee').value) };
    }
    return payload;
  }

  function validate(p) {
    if (!isValidISODate(p.date)) return 'Tanggal wajib diisi dengan benar.';
    if (!p.sourceAccount) return 'Pilih rekening/kartu sumber.';
    if ((p.type === TRX.TRANSFER || p.type === TRX.CARD_PAYMENT) && !p.destinationAccount) return 'Pilih rekening/kartu tujuan.';
    if (p.type === TRX.TRANSFER && p.sourceAccount === p.destinationAccount) return 'Rekening sumber dan tujuan tidak boleh sama.';
    if ([TRX.INCOME, TRX.EXPENSE, TRX.INSTALLMENT].includes(p.type) && !p.category) return 'Pilih kategori.';
    if (p.type === TRX.INSTALLMENT) {
      if (!(p.installment.principal > 0)) return 'Harga barang harus lebih dari 0.';
      if (!(p.installment.tenor > 0)) return 'Tenor cicilan harus lebih dari 0.';
      if (p.installment.interestRate < 0) return 'Bunga tidak boleh negatif.';
    } else if (!(p.amount > 0)) {
      return 'Nominal harus lebih dari 0.';
    }
    if (p.attachment && !/^https:\/\//i.test(p.attachment)) return 'Lampiran harus berupa link yang diawali https://';
    if (!existing) {
      const acc = activeAccounts.find((a) => a.id === p.sourceAccount);
      const card = activeCards.find((c) => c.id === p.sourceAccount);
      const amount = p.type === TRX.INSTALLMENT ? calculateInstallment(p.installment).total : p.amount;
      if (acc && p.type !== TRX.INCOME && amount > acc.balance) return `Saldo ${acc.name} tidak mencukupi untuk transaksi ini (saldo ${formatRupiah(acc.balance)}).`;
      if (card && amount > card.availableLimit) return `Transaksi melebihi limit tersedia ${card.name} (${formatRupiah(card.availableLimit)}).`;
      if (p.type === TRX.CARD_PAYMENT) {
        const target = activeCards.find((c) => c.id === p.destinationAccount);
        if (target && target.bill <= 0) return `${target.name} tidak memiliki tagihan yang perlu dibayar saat ini.`;
        if (target && amount > target.bill) return `Nominal melebihi tagihan ${target.name} saat ini (${formatRupiah(target.bill)}).`;
      }
    }
    return '';
  }

  async function submit(allowDuplicate = false) {
    const payload = collect();
    const problem = validate(payload);
    if (problem) return toast(problem, 'warning');
    setButtonLoading(saveButton, true);
    try {
      const res = await api(existing ? 'updateTransaction' : 'addTransaction', { ...payload, allowDuplicate });
      toast(res.message);
      modal.close();
      await afterDataChange();
    } catch (err) {
      setButtonLoading(saveButton, false);
      if (err instanceof ApiError && err.code === 'DUPLICATE') {
        const ok = await confirmDialog({ title: 'Transaksi ganda?', message: err.message, confirmText: 'Tetap simpan' });
        if (ok) submit(true);
        return;
      }
      toastError(err);
    }
  }
  saveButton.addEventListener('click', () => submit());
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

/* =========================== JURNAL =========================== */

const PAGE_SIZE = 20;

function journalColumns(t, accountFilter) {
  let masuk = 0;
  let keluar = 0;
  if (accountFilter) {
    if (t.destinationAccount === accountFilter) masuk = t.amount;
    else if (t.type === TRX.INCOME) masuk = t.amount;
    else keluar = t.amount;
  } else if (t.type === TRX.INCOME) masuk = t.amount;
  else keluar = t.amount;
  return { masuk, keluar };
}

async function renderJournal(container) {
  const master = await loadMaster();
  const now = currentPeriod();
  const filter = { month: now.month, year: now.year, dateFrom: '', dateTo: '', account: '', category: '', type: '', search: '', sort: 'date-desc',
    ...getPref('journalFilter', {}) };
  let rows = [];
  let page = 1;
  const categories = [...new Set(master.categories.map((c) => c.name).concat(['Transfer', 'Kartu Kredit']))];

  container.innerHTML = `
    <div class="card app-card mb-3"><div class="card-body">
      <div class="journal-toolbar">
        <div class="input-group search-box"><span class="input-group-text"><i class="bi bi-search"></i></span>
          <input class="form-control" id="j-search" placeholder="Cari keterangan, ID, kategori…" value="${escapeHtml(filter.search)}"></div>
        <button class="btn btn-outline-secondary" data-bs-toggle="collapse" data-bs-target="#j-filters" aria-expanded="false"><i class="bi bi-funnel me-1"></i>Filter</button>
        <div class="dropdown">
          <button class="btn btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-download me-1"></i>Export</button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><button class="dropdown-item" id="j-excel"><i class="bi bi-file-earmark-excel me-2 text-success"></i>Export Excel</button></li>
            <li><button class="dropdown-item" id="j-pdf"><i class="bi bi-file-earmark-pdf me-2 text-danger"></i>Export PDF</button></li>
          </ul></div>
        ${canWrite() ? '<button class="btn btn-primary" id="j-add"><i class="bi bi-plus-lg me-1"></i>Transaksi</button>' : ''}
      </div>
      <div class="collapse" id="j-filters"><div class="row g-2 mt-1">
        <div class="col-6 col-md-2"><label class="form-label small">Bulan</label><select class="form-select form-select-sm" data-f="month">
          <option value="">Semua</option>${monthOptions(filter.month)}</select></div>
        <div class="col-6 col-md-2"><label class="form-label small">Tahun</label><select class="form-select form-select-sm" data-f="year">
          <option value="">Semua</option>${yearOptions(filter.year || now.year)}</select></div>
        <div class="col-6 col-md-2"><label class="form-label small">Dari tanggal</label><input type="date" class="form-control form-control-sm" data-f="dateFrom" value="${filter.dateFrom}"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Sampai tanggal</label><input type="date" class="form-control form-control-sm" data-f="dateTo" value="${filter.dateTo}"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Rekening</label><select class="form-select form-select-sm" data-f="account">
          <option value="">Semua</option>${[...master.accounts, ...master.cards].map((a) => `<option value="${a.id}" ${a.id === filter.account ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></div>
        <div class="col-6 col-md-2"><label class="form-label small">Kategori</label><select class="form-select form-select-sm" data-f="category">
          <option value="">Semua</option>${categories.map((c) => `<option ${c === filter.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div>
        <div class="col-6 col-md-3"><label class="form-label small">Jenis transaksi</label><select class="form-select form-select-sm" data-f="type">
          <option value="">Semua</option>${Object.values(TRX).map((t) => `<option ${t === filter.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="col-6 col-md-3"><label class="form-label small">Urutkan</label><select class="form-select form-select-sm" data-f="sort">
          <option value="date-desc">Tanggal terbaru</option><option value="date-asc">Tanggal terlama</option>
          <option value="amount-desc">Nominal terbesar</option><option value="amount-asc">Nominal terkecil</option></select></div>
        <div class="col-12 col-md-3 d-flex align-items-end"><button class="btn btn-sm btn-link" id="j-reset">Reset filter</button></div>
      </div></div>
    </div></div>
    <div id="j-summary" class="journal-summary mb-2"></div>
    <div class="card app-card"><div class="card-body p-0" id="j-table">${skeleton(6, 'list')}</div></div>
    <nav id="j-pages" class="d-flex justify-content-between align-items-center mt-3"></nav>`;

  const sortSelect = container.querySelector('[data-f="sort"]');
  sortSelect.value = filter.sort;
  container.querySelector('#j-add')?.addEventListener('click', () => openTransactionForm());

  function sorted() {
    const list = [...rows];
    const [key, dir] = filter.sort.split('-');
    list.sort((a, b) => {
      const diff = key === 'amount' ? a.amount - b.amount : (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date));
      return dir === 'asc' ? diff : -diff;
    });
    return list;
  }

  function renderTable() {
    const list = sorted();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    page = Math.min(page, pages);
    const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const totals = list.reduce((acc, t) => {
      const c = journalColumns(t, filter.account);
      acc.masuk += c.masuk;
      acc.keluar += c.keluar;
      return acc;
    }, { masuk: 0, keluar: 0 });
    container.querySelector('#j-summary').innerHTML = `<span><strong>${list.length}</strong> transaksi</span>
      <span class="text-success">Masuk ${formatRupiah(totals.masuk)}</span><span class="text-danger">Keluar ${formatRupiah(totals.keluar)}</span>`;
    const table = container.querySelector('#j-table');
    if (!list.length) {
      table.innerHTML = emptyState('bi-journal-x', 'Tidak ada transaksi yang cocok dengan filter.');
    } else {
      table.innerHTML = `<div class="trx-list d-md-none p-2">${slice.map(transactionListItem).join('')}</div>
        <div class="d-none d-md-block table-responsive"><table class="table table-hover align-middle mb-0 journal-table">
        <thead><tr><th>Tanggal</th><th>ID</th><th>Jenis</th><th>Rekening</th><th>Kategori</th><th>Keterangan</th><th class="text-end">Masuk</th><th class="text-end">Keluar</th></tr></thead>
        <tbody>${slice.map((t) => {
          trxCache.set(t.id, t);
          const c = journalColumns(t, filter.account);
          return `<tr data-trx-id="${escapeHtml(t.id)}" role="button">
            <td data-label="Tanggal">${formatDate(t.date)}</td>
            <td data-label="ID"><code class="small">${escapeHtml(t.id)}</code></td>
            <td data-label="Jenis">${typeBadge(t.type)}</td>
            <td data-label="Rekening">${escapeHtml(t.sourceName)}${t.destinationName ? ` <i class="bi bi-arrow-right small"></i> ${escapeHtml(t.destinationName)}` : ''}</td>
            <td data-label="Kategori">${escapeHtml(t.category)}${t.subCategory ? `<div class="small text-muted">${escapeHtml(t.subCategory)}</div>` : ''}</td>
            <td data-label="Keterangan" class="text-wrap">${escapeHtml(t.description || '-')}</td>
            <td data-label="Masuk" class="text-end text-success fw-semibold">${c.masuk ? formatRupiah(c.masuk) : '-'}</td>
            <td data-label="Keluar" class="text-end ${[TRX.TRANSFER, TRX.CARD_PAYMENT].includes(t.type) ? 'text-muted' : 'text-danger'} fw-semibold">${c.keluar ? formatRupiah(c.keluar) : '-'}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
      bindTransactionList(table.querySelector('.trx-list'));
      table.querySelectorAll('tr[data-trx-id]').forEach((tr) => tr.addEventListener('click', () => openTransactionDetail(trxCache.get(tr.dataset.trxId))));
    }
    container.querySelector('#j-pages').innerHTML = pages > 1 ? `
      <button class="btn btn-sm btn-outline-secondary" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i> Sebelumnya</button>
      <span class="small text-muted">Halaman ${page} dari ${pages}</span>
      <button class="btn btn-sm btn-outline-secondary" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>Berikutnya <i class="bi bi-chevron-right"></i></button>` : '';
    container.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.page); renderTable(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  }

  async function load() {
    setPref('journalFilter', filter);
    container.querySelector('#j-table').innerHTML = skeleton(6, 'list');
    try {
      const params = { ...filter };
      if (!params.year) params.month = '';
      const res = await api('getTransactions', params);
      rows = res.data;
      page = 1;
      renderTable();
    } catch (err) {
      container.querySelector('#j-table').innerHTML = emptyState('bi-wifi-off', err.message);
    }
  }

  container.querySelectorAll('[data-f]').forEach((input) => input.addEventListener('change', () => {
    filter[input.dataset.f] = input.value;
    if (input.dataset.f === 'sort') return renderTable();
    load();
  }));
  container.querySelector('#j-search').addEventListener('input', debounce((e) => { filter.search = e.target.value.trim(); load(); }, 400));
  container.querySelector('#j-reset').addEventListener('click', () => {
    setPref('journalFilter', {});
    refreshApp();
  });

  const exportRows = () => sorted().map((t) => {
    const c = journalColumns(t, filter.account);
    return { Tanggal: formatDate(t.date), ID: t.id, Jenis: t.type, Rekening: t.sourceName + (t.destinationName ? ' → ' + t.destinationName : ''),
      Kategori: t.category + (t.subCategory ? ' / ' + t.subCategory : ''), Keterangan: t.description, Masuk: c.masuk, Keluar: c.keluar };
  });
  const periodText = () => (filter.year ? (filter.month ? monthLabel(Number(filter.month), Number(filter.year)) : `Tahun ${filter.year}`) : 'Semua periode')
    + (filter.account ? ` · ${accountName(filter.account)}` : '');
  container.querySelector('#j-excel').addEventListener('click', async () => {
    try {
      await exportExcel([{ name: 'Jurnal', rows: exportRows() }], `jurnal-transaksi-${todayISO()}.xlsx`);
      toast('File Excel berhasil dibuat');
    } catch (err) { toastError(err); }
  });
  container.querySelector('#j-pdf').addEventListener('click', async () => {
    try {
      const data = exportRows();
      await exportPdf({
        title: 'Jurnal Transaksi', subtitle: periodText(), orientation: 'landscape',
        sections: [{ head: ['Tanggal', 'ID', 'Jenis', 'Rekening', 'Kategori', 'Keterangan', 'Masuk', 'Keluar'],
          body: data.map((r) => [r.Tanggal, r.ID, r.Jenis, r.Rekening, r.Kategori, r.Keterangan || '-', r.Masuk ? formatRupiah(r.Masuk) : '-', r.Keluar ? formatRupiah(r.Keluar) : '-']),
          foot: [['', '', '', '', '', 'Total', formatRupiah(sum(data, 'Masuk')), formatRupiah(sum(data, 'Keluar'))]] }]
      }, `jurnal-transaksi-${todayISO()}.pdf`);
      toast('File PDF berhasil dibuat');
    } catch (err) { toastError(err); }
  });

  await load();
}

/* =========================== ANGGARAN =========================== */

async function renderBudgets(container) {
  const filter = periodFilter('budgetPeriod', (p) => load(p));
  container.innerHTML = `<div class="toolbar mb-3"><h2 class="h6 mb-0 fw-bold">Anggaran Bulanan</h2>${filter.html}</div><div id="budget-body"></div>`;
  filter.bind(container);
  const body = container.querySelector('#budget-body');

  async function load(period) {
    body.innerHTML = skeleton(4, 'list');
    const { data } = await api('getBudgets', period);
    body.innerHTML = `
      <div class="card app-card mb-3"><div class="card-body">
        <div class="row g-3 text-center text-md-start budget-totals">
          <div class="col-6 col-md-3"><div class="stat-label">Anggaran</div><div class="fw-bold fs-5">${formatRupiah(data.totalBudget)}</div></div>
          <div class="col-6 col-md-3"><div class="stat-label">Realisasi</div><div class="fw-bold fs-5">${formatRupiah(data.totalActual)}</div></div>
          <div class="col-6 col-md-3"><div class="stat-label">Sisa</div><div class="fw-bold fs-5 ${data.totalRemaining < 0 ? 'text-danger' : 'text-success'}">${formatRupiah(data.totalRemaining)}</div></div>
          <div class="col-6 col-md-3"><div class="stat-label">Terpakai</div><div class="fw-bold fs-5">${data.totalPercent}%</div></div>
        </div>
        <div class="mt-3">${progressBar(data.totalPercent, { height: 10 })}</div>
        ${canWrite() ? `<div class="d-flex flex-wrap gap-2 mt-3">
          <button class="btn btn-sm btn-outline-primary" id="copy-budget"><i class="bi bi-files me-1"></i>Salin budget bulan lalu</button>
          <button class="btn btn-sm btn-outline-secondary" id="manage-categories"><i class="bi bi-tags me-1"></i>Kelola kategori</button></div>` : ''}
      </div></div>
      <div class="row g-3">${data.items.map((i) => `
        <div class="col-md-6 col-xl-4"><div class="card app-card budget-item h-100 ${canWrite() ? 'clickable' : ''}" data-category="${escapeHtml(i.category)}" data-amount="${i.budget}">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2 mb-2"><span class="dot" style="background:${i.color}"></span>
              <span class="fw-semibold flex-grow-1 text-truncate">${escapeHtml(i.category)}</span>
              <span class="badge-soft badge-soft-${i.percent >= 100 ? 'danger' : i.percent >= 80 ? 'warning' : 'success'}">${i.budget ? i.percent + '%' : 'Belum diatur'}</span></div>
            <dl class="mini-dl mb-2"><dt>Budget</dt><dd>${formatRupiah(i.budget)}</dd><dt>Realisasi</dt><dd>${formatRupiah(i.actual)}</dd>
              <dt>Sisa</dt><dd class="${i.remaining < 0 ? 'text-danger' : ''}">${formatRupiah(i.remaining)}</dd></dl>
            ${progressBar(i.percent)}
            ${canWrite() ? '<div class="small text-muted mt-2"><i class="bi bi-pencil me-1"></i>Ketuk untuk ubah budget</div>' : ''}
          </div></div></div>`).join('')}</div>`;

    if (!canWrite()) return;
    body.querySelector('#copy-budget').addEventListener('click', async (e) => {
      const ok = await confirmDialog({ title: 'Salin anggaran?', message: `Budget bulan lalu akan disalin ke ${monthLabel(period.month, period.year)} (menimpa nilai kategori yang sama).`, confirmText: 'Salin' });
      if (!ok) return;
      setButtonLoading(e.target.closest('button'), true, 'Menyalin…');
      try {
        const res = await api('copyBudget', period);
        toast(res.message);
        load(period);
      } catch (err) {
        toastError(err);
        setButtonLoading(e.target.closest('button'), false);
      }
    });
    body.querySelector('#manage-categories').addEventListener('click', () => openCategoryManager(() => load(period)));
    body.querySelectorAll('.budget-item').forEach((card) => card.addEventListener('click', () => {
      const modal = openModal({
        title: `Budget ${escapeHtml(card.dataset.category)}`,
        fullscreenMobile: false,
        body: `<label class="form-label">Anggaran ${monthLabel(period.month, period.year)}</label>
          <div class="input-group input-group-lg"><span class="input-group-text">Rp</span><input class="form-control" id="budget-amount" inputmode="numeric" value="${card.dataset.amount || ''}"></div>`,
        footer: '<button class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary" id="budget-save">Simpan</button>'
      });
      const input = modal.el.querySelector('#budget-amount');
      attachAmountInput(input);
      setTimeout(() => input.focus(), 300);
      modal.el.querySelector('#budget-save').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        setButtonLoading(btn, true);
        try {
          const res = await api('saveBudget', { ...period, category: card.dataset.category, amount: parseAmount(input.value) });
          toast(res.message);
          modal.close();
          load(period);
        } catch (err) {
          toastError(err);
          setButtonLoading(btn, false);
        }
      });
    }));
  }
  await load(filter.value);
}

/* =========================== KATEGORI =========================== */

export async function openCategoryManager(onChange) {
  const modal = openModal({ title: 'Kelola kategori', size: 'modal-lg', body: skeleton(5, 'list') });
  let changed = false;
  modal.el.addEventListener('hidden.bs.modal', async () => {
    if (!changed) return;
    await loadMaster(true);
    onChange?.();
  });

  async function draw() {
    const { data } = await api('getCategories');
    const section = (type) => `<h6 class="fw-bold mt-2">${type}</h6><ul class="list-group mb-3">${data.filter((c) => c.type === type).map((c) => `
      <li class="list-group-item d-flex align-items-center gap-2 ${c.active ? '' : 'opacity-50'}">
        <span class="dot" style="background:${c.color}"></span>
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold">${escapeHtml(c.name)} ${c.active ? '' : '<small class="text-muted">(nonaktif)</small>'}</div>
          <small class="text-muted text-truncate d-block">${escapeHtml(c.subCategories.join(', ') || 'Tanpa subkategori')}</small></div>
        <button class="btn btn-icon" data-edit-cat="${c.id}" aria-label="Ubah"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-icon text-danger" data-del-cat="${c.id}" aria-label="Hapus"><i class="bi bi-trash"></i></button>
      </li>`).join('')}</ul>`;
    modal.body.innerHTML = `
      <form id="cat-form" class="category-form mb-3" novalidate>
        <input type="hidden" name="id">
        <div class="row g-2">
          <div class="col-12 col-md-4"><input name="name" class="form-control" placeholder="Nama kategori" maxlength="40" required></div>
          <div class="col-6 col-md-3"><select name="type" class="form-select"><option>Pengeluaran</option><option>Pemasukan</option></select></div>
          <div class="col-6 col-md-2"><input name="color" type="color" class="form-control form-control-color w-100" value="#0f766e" title="Warna"></div>
          <div class="col-12 col-md-3 form-check form-switch d-flex align-items-center gap-2 ps-5"><input class="form-check-input" type="checkbox" name="active" id="cat-active" checked>
            <label class="form-check-label" for="cat-active">Aktif</label></div>
          <div class="col-12"><input name="subCategories" class="form-control" placeholder="Subkategori, pisahkan dengan koma (contoh: Listrik, Air, Internet)"></div>
          <div class="col-12 d-flex gap-2"><button class="btn btn-primary btn-sm" type="submit" id="cat-save"><i class="bi bi-plus-lg me-1"></i>Tambah kategori</button>
            <button class="btn btn-light btn-sm" type="button" id="cat-cancel" hidden>Batal edit</button></div>
        </div></form>
      ${section('Pengeluaran')}${section('Pemasukan')}`;
    const form = modal.body.querySelector('#cat-form');
    const f = form.elements;
    const resetForm = () => {
      form.reset();
      f.id.value = '';
      form.querySelector('#cat-save').innerHTML = '<i class="bi bi-plus-lg me-1"></i>Tambah kategori';
      form.querySelector('#cat-cancel').hidden = true;
    };
    form.querySelector('#cat-cancel').addEventListener('click', resetForm);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!f.name.value.trim()) return toast('Nama kategori wajib diisi.', 'warning');
      const button = form.querySelector('#cat-save');
      setButtonLoading(button, true);
      try {
        const res = await api('saveCategory', { id: f.id.value || undefined, name: f.name.value, type: f.type.value,
          color: f.color.value, active: f.active.checked, subCategories: f.subCategories.value });
        toast(res.message);
        changed = true;
        draw();
      } catch (err) {
        toastError(err);
        setButtonLoading(button, false);
      }
    });
    modal.body.querySelectorAll('[data-edit-cat]').forEach((btn) => btn.addEventListener('click', () => {
      const c = data.find((x) => x.id === btn.dataset.editCat);
      f.id.value = c.id;
      f.name.value = c.name;
      f.type.value = c.type;
      f.color.value = c.color;
      f.active.checked = c.active;
      f.subCategories.value = c.subCategories.join(', ');
      form.querySelector('#cat-save').innerHTML = '<i class="bi bi-check2 me-1"></i>Simpan perubahan';
      form.querySelector('#cat-cancel').hidden = false;
      f.name.focus();
    }));
    modal.body.querySelectorAll('[data-del-cat]').forEach((btn) => btn.addEventListener('click', async () => {
      const c = data.find((x) => x.id === btn.dataset.delCat);
      const ok = await confirmDialog({ title: 'Hapus kategori?', message: `Kategori "${c.name}" akan dihapus. Jika sudah dipakai transaksi, kategori hanya dinonaktifkan.`, confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        const res = await api('deleteCategory', { id: c.id });
        toast(res.message);
        changed = true;
        draw();
      } catch (err) {
        toastError(err);
      }
    }));
  }
  try {
    await draw();
  } catch (err) {
    modal.body.innerHTML = emptyState('bi-wifi-off', err.message);
  }
}

export { pageSkeleton };
