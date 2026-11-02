/**
 * contracts.js — sub-menu Keuangan › Cicilan & Kredit: satu daftar untuk semua cicilan keluarga.
 * - Cicilan kartu kredit: dibuat dari Pengeluaran → sumber kartu kredit → Cicilan, ditagihkan ke kartu tiap bulan.
 * - Kredit kontrak: kredit di luar kartu (leasing, KPR, paylater) per nomor kontrak; pembayarannya dicatat sebagai
 *   Pengeluaran yang terhubung ke kontrak (tombol Bayar, atau pilih kontrak di form Pengeluaran).
 */
import { api, canWrite, getMaster, loadMaster } from './api.js';
import {
  escapeHtml, formatRupiah, formatDate, formatDateShort, relativeDayLabel, parseAmount, attachAmountInput, todayISO, isValidISODate,
  addMonthsISO, getPref, setPref, sum, uid, textProgress
} from './utils.js';
import { toast, toastError, openModal, confirmDialog, setButtonLoading, emptyState, progressBar, skeleton, auditNote } from './ui.js';
import { afterDataChange, openTransactionForm, openTransactionDetail } from './finance.js';

const CONTRACT_CATEGORY = 'Kredit & Cicilan';
const billingDay = () => Number(getMaster()?.settings?.INSTALLMENT_BILLING_DAY) || 16;

function dueBadge(c) {
  if (c.status === 'Lunas') return '<span class="badge-soft badge-soft-success">Lunas</span>';
  if (c.overdue) return `<span class="badge-soft badge-soft-danger">Lewat ${Math.abs(c.daysToDue)} hari</span>`;
  if (c.dueThisMonth) return `<span class="badge-soft badge-soft-warning">Jatuh tempo ${formatDateShort(c.nextDueDate)}</span>`;
  return `<span class="badge-soft badge-soft-secondary">Berikutnya ${formatDateShort(c.nextDueDate)}</span>`;
}

function billingBadge(i) {
  if (i.status === 'Lunas') return '<span class="badge-soft badge-soft-success">Lunas</span>';
  return i.nextBillingDate ? `<span class="badge-soft badge-soft-secondary">Ditagih ${formatDateShort(i.nextBillingDate)}</span>` : '';
}

/** Menyamakan cicilan kartu dan kredit kontrak menjadi baris tabel yang sama. */
function creditRows(installments, contracts) {
  const cards = getMaster()?.cards || [];
  const fromCards = installments.map((i) => {
    const card = cards.find((c) => c.id === i.cardId);
    return {
      kind: 'card', id: i.id, ref: i, status: i.status, title: i.cardName, sub: card?.cardNumber ? `•••• ${card.cardNumber}` : 'Kartu kredit',
      item: i.description, tenor: i.tenor, done: i.paidMonths, monthly: i.monthlyPayment, endDate: i.endDate,
      remaining: i.remainingAmount, badge: billingBadge(i), progress: i.progressPercent, overdue: false
    };
  });
  const fromContracts = contracts.map((c) => ({
    kind: 'contract', id: c.id, ref: c, status: c.status, title: c.contractNo, sub: c.lender || 'Kredit kontrak',
    item: c.item, tenor: c.tenor, done: c.paidMonths, monthly: c.monthlyPayment, endDate: c.endDate,
    remaining: c.remainingAmount, badge: dueBadge(c), progress: c.progressPercent, overdue: c.overdue
  }));
  return [...fromContracts, ...fromCards].sort((a, b) => (a.status === b.status ? (a.endDate < b.endDate ? -1 : 1) : (a.status === 'Aktif' ? -1 : 1)));
}

export async function renderCredits(container) {
  const status = getPref('creditStatus', 'Aktif');
  const kind = getPref('creditKind', '');
  container.innerHTML = skeleton(4, 'list');
  const [{ data: installments }, { data: contracts }] = await Promise.all([api('getInstallments'), api('getContracts'), getMaster() ? null : loadMaster()]);
  const all = creditRows(installments, contracts);
  const list = all.filter((r) => (!status || r.status === status) && (!kind || r.kind === kind));
  const active = all.filter((r) => r.status === 'Aktif');
  const writable = canWrite();
  const pill = (pref, value, label, current) => `<button class="btn ${value === current ? 'btn-primary' : 'btn-outline-primary'}" data-${pref}="${value}">${label}</button>`;
  container.innerHTML = `
    <div class="row g-3 mb-3 credit-stats">
      <div class="col-6 col-md-3"><div class="card app-card h-100"><div class="card-body"><div class="stat-label">Cicilan per bulan</div>
        <div class="fw-bold fs-5">${formatRupiah(sum(active, 'monthly'))}</div></div></div></div>
      <div class="col-6 col-md-3"><div class="card app-card h-100"><div class="card-body"><div class="stat-label">Sisa seluruh cicilan</div>
        <div class="fw-bold fs-5">${formatRupiah(sum(active, 'remaining'))}</div></div></div></div>
      <div class="col-6 col-md-3"><div class="card app-card h-100"><div class="card-body"><div class="stat-label">Lewat kartu kredit</div>
        <div class="fw-bold fs-5">${active.filter((r) => r.kind === 'card').length} aktif</div></div></div></div>
      <div class="col-6 col-md-3"><div class="card app-card h-100"><div class="card-body"><div class="stat-label">Kredit kontrak</div>
        <div class="fw-bold fs-5">${active.filter((r) => r.kind === 'contract').length} aktif</div></div></div></div>
    </div>
    <div class="toolbar mb-3">
      <div class="d-flex flex-wrap gap-2">
        <div class="btn-group btn-group-sm" role="group" aria-label="Status">${pill('status', 'Aktif', 'Aktif', status)}${pill('status', 'Lunas', 'Lunas', status)}${pill('status', '', 'Semua', status)}</div>
        <div class="btn-group btn-group-sm" role="group" aria-label="Jenis">${pill('kind', '', 'Semua jenis', kind)}${pill('kind', 'card', 'Kartu kredit', kind)}${pill('kind', 'contract', 'Kontrak', kind)}</div>
      </div>
      ${writable ? '<button class="btn btn-primary btn-sm" id="add-credit"><i class="bi bi-plus-lg me-1"></i>Catat cicilan</button>' : ''}
    </div>
    <div class="card app-card"><div class="card-body p-0">
      ${list.length ? `<div class="table-responsive"><table class="table align-middle mb-0 stack-table contract-table">
        <thead><tr><th>Kartu / Nomor Kontrak</th><th>Pembelian</th><th class="text-center">Tenor</th><th>Cicilan ke-</th>
          <th class="text-end">Nominal</th><th>Selesai pada</th>${writable ? '<th class="text-end">Aksi</th>' : ''}</tr></thead>
        <tbody>${list.map((r) => `
          <tr class="${r.overdue ? 'row-overdue' : ''}">
            <td data-label="Nomor Kontrak"><button type="button" class="btn btn-link p-0 fw-semibold text-start" data-detail="${r.kind}:${r.id}">
                <i class="bi ${r.kind === 'card' ? 'bi-credit-card' : 'bi-file-earmark-text'} me-1"></i>${escapeHtml(r.title)}</button>
              <div class="small text-muted">${escapeHtml(r.sub)}</div></td>
            <td data-label="Pembelian" class="text-wrap">${escapeHtml(r.item)}${auditNote(r.ref)}</td>
            <td data-label="Tenor" class="text-center">${r.tenor} bln</td>
            <td data-label="Cicilan ke-"><div><strong>${r.done}/${r.tenor}</strong>${r.kind === 'card' ? ' <small class="text-muted">ditagih</small>' : ''}
              <div class="mt-1">${r.badge}</div>
              <div class="mt-1 contract-progress">${progressBar(r.progress, { tone: r.status === 'Lunas' ? 'success' : 'primary', height: 5 })}</div></div></td>
            <td data-label="Nominal" class="text-end fw-semibold text-nowrap">${formatRupiah(r.monthly)}</td>
            <td data-label="Selesai pada" class="text-nowrap">${formatDate(r.endDate)}</td>
            ${writable ? `<td data-label="Aksi" class="text-end text-nowrap">${r.kind === 'contract' ? `
              <button class="btn btn-sm btn-primary" data-pay="${r.id}" ${r.status === 'Lunas' ? 'disabled' : ''}><i class="bi bi-cash-coin me-1"></i>Bayar</button>
              <button class="btn btn-sm btn-outline-secondary" data-edit="${r.id}" aria-label="Ubah kontrak ${escapeHtml(r.title)}"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger" data-delete="${r.id}" aria-label="Hapus kontrak ${escapeHtml(r.title)}"><i class="bi bi-trash"></i></button>`
              : `<span class="small text-muted me-2">Otomatis tiap tgl ${billingDay()}</span>
              <button class="btn btn-sm btn-outline-secondary" data-trx="${escapeHtml(r.ref.transactionId)}" aria-label="Ubah cicilan ${escapeHtml(r.item)}"><i class="bi bi-pencil"></i></button>`}
            </td>` : ''}
          </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4" class="fw-semibold">Total cicilan aktif per bulan</td>
          <td class="text-end fw-bold text-nowrap" data-label="Total per bulan">${formatRupiah(sum(list.filter((r) => r.status === 'Aktif'), 'monthly'))}</td>
          <td colspan="${writable ? 2 : 1}"></td></tr></tfoot>
      </table></div>` : emptyState('bi-calendar2-check', status ? `Tidak ada cicilan berstatus ${status}.` : 'Belum ada cicilan.',
        writable ? '<button class="btn btn-primary btn-sm" id="add-credit-empty">Catat cicilan</button>' : '')}
    </div></div>
    <div class="row g-3 mt-1 small text-muted">
      <div class="col-md-6"><i class="bi bi-credit-card me-1"></i><strong>Cicilan kartu kredit</strong> tidak perlu dibayar di sini: setiap tanggal ${billingDay()}
        satu bulan cicilan otomatis masuk tagihan kartu, lalu dibayar bersama tagihan kartu di menu Kartu Kredit.</div>
      <div class="col-md-6"><i class="bi bi-file-earmark-text me-1"></i><strong>Kredit kontrak</strong> dibayar dengan tombol <strong>Bayar</strong>, atau dari
        Tambah transaksi → Pengeluaran → pilih kontraknya. Cicilan ke- naik otomatis dan saldo rekening berkurang.</div>
    </div>`;

  const contractById = (id) => contracts.find((c) => c.id === id);
  container.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => { setPref('creditStatus', b.dataset.status); renderCredits(container); }));
  container.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { setPref('creditKind', b.dataset.kind); renderCredits(container); }));
  ['#add-credit', '#add-credit-empty'].forEach((sel) => container.querySelector(sel)?.addEventListener('click', () => openNewCredit()));
  container.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => {
    const [type, id] = b.dataset.detail.split(':');
    if (type === 'contract') openContractDetail(contractById(id));
    else openInstallmentDetail(installments.find((i) => i.id === id));
  }));
  container.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openContractPayment(contractById(b.dataset.pay))));
  container.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openContractForm(contractById(b.dataset.edit))));
  container.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteContract(contractById(b.dataset.delete), b)));
  container.querySelectorAll('[data-trx]').forEach((b) => b.addEventListener('click', () => openTransactionById(b.dataset.trx, true)));
}

async function openTransactionById(id, edit = false) {
  try {
    const { data } = await api('getTransactions', { id });
    if (!data[0]) return toast('Transaksi tidak ditemukan.', 'warning');
    return edit ? openTransactionForm(data[0]) : openTransactionDetail(data[0]);
  } catch (err) {
    return toastError(err);
  }
}

/** Satu pintu untuk mencatat cicilan baru: pilih lewat kartu kredit atau kredit kontrak. */
export function openNewCredit() {
  if (!canWrite()) return toast('Akun Viewer hanya dapat melihat data.', 'warning');
  const cards = (getMaster()?.cards || []).filter((c) => c.active);
  const modal = openModal({
    title: 'Catat cicilan baru',
    fullscreenMobile: false,
    body: `<p class="small text-muted">Pilih cara Anda membeli dengan cicilan.</p>
      <div class="list-group quick-actions">
        <button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-new="card" ${cards.length ? '' : 'disabled'}>
          <span class="icon-circle icon-warning"><i class="bi bi-credit-card"></i></span>
          <span class="text-start"><span class="fw-semibold d-block">Cicilan kartu kredit</span>
            <small class="text-muted">Belanja pakai kartu dengan cicilan 0% atau berbunga. Tagihan masuk kartu tiap tanggal ${billingDay()}.</small></span></button>
        <button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-new="contract">
          <span class="icon-circle icon-secondary"><i class="bi bi-file-earmark-text"></i></span>
          <span class="text-start"><span class="fw-semibold d-block">Kredit kontrak</span>
            <small class="text-muted">Leasing motor/mobil, KPR, kredit elektronik, paylater. Punya nomor kontrak dan dibayar dari rekening.</small></span></button>
      </div>`
  });
  modal.el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    modal.close();
    setTimeout(() => (b.dataset.new === 'card' ? openTransactionForm(null, { type: 'Cicilan', sourceAccount: cards[0]?.id }) : openContractForm()), 250);
  }));
  return modal;
}

function openInstallmentDetail(i) {
  const row = (label, value) => (value ? `<dt>${label}</dt><dd>${value}</dd>` : '');
  const modal = openModal({
    title: escapeHtml(i.description),
    body: `<div class="text-center mb-3"><div class="text-muted">${escapeHtml(i.cardName)} · dibeli ${formatDate(i.startDate)}</div>
        <div class="mt-2">${billingBadge(i)}</div></div>
      <div class="d-flex justify-content-between small mb-1"><span>${i.paidMonths} dari ${i.tenor} bulan sudah ditagihkan</span><strong>${i.progressPercent}%</strong></div>
      <div class="text-progress" aria-hidden="true">${textProgress(i.paidMonths, i.tenor)}</div>
      <dl class="detail-dl mt-3">
        ${row('Cicilan per bulan', formatRupiah(i.monthlyPayment))}
        ${row('Harga barang', formatRupiah(i.principal))}
        ${row('Bunga / admin', `${i.interestRate}%/bln · ${formatRupiah(i.adminFee)}`)}
        ${row('Total cicilan', formatRupiah(i.totalAmount))}
        ${row('Belum ditagih', `<strong>${formatRupiah(i.remainingAmount)}</strong>`)}
        ${row('Tagihan berikutnya', i.nextBillingDate ? `${formatDate(i.nextBillingDate)} <span class="text-muted">(${relativeDayLabel(i.nextBillingDate)})</span>` : '')}
        ${row('Selesai pada', formatDate(i.endDate))}
      </dl>
      ${auditNote(i)}
      <div class="schedule-list" title="Jadwal tagihan cicilan">${i.schedule.map((s) => `<span class="${s.billed ? 'billed' : ''}">${s.no}. ${formatDateShort(s.date)}</span>`).join('')}</div>`,
    footer: canWrite()
      ? `<button class="btn btn-outline-secondary me-auto" id="inst-trx"><i class="bi bi-receipt me-1"></i>Transaksi</button>
         <button class="btn btn-primary" id="inst-edit"><i class="bi bi-pencil me-1"></i>Ubah</button>`
      : '<button class="btn btn-light" data-bs-dismiss="modal">Tutup</button>'
  });
  modal.el.querySelector('#inst-trx')?.addEventListener('click', () => { modal.close(); setTimeout(() => openTransactionById(i.transactionId), 250); });
  modal.el.querySelector('#inst-edit')?.addEventListener('click', () => { modal.close(); setTimeout(() => openTransactionById(i.transactionId, true), 250); });
}

function openContractDetail(c) {
  const row = (label, value) => (value ? `<dt>${label}</dt><dd>${value}</dd>` : '');
  const writable = canWrite();
  const modal = openModal({
    title: `Kontrak ${escapeHtml(c.contractNo)}`,
    body: `<div class="text-center mb-3"><div class="fw-bold fs-5">${escapeHtml(c.item)}</div>
        <div class="text-muted">${escapeHtml(c.lender || '-')}</div><div class="mt-2">${dueBadge(c)}</div></div>
      <div class="d-flex justify-content-between small mb-1"><span>Cicilan ke-${c.paidMonths} dari ${c.tenor}</span><strong>${c.progressPercent}%</strong></div>
      ${progressBar(c.progressPercent, { tone: c.status === 'Lunas' ? 'success' : 'primary' })}
      <dl class="detail-dl mt-3">
        ${row('Nominal per bulan', formatRupiah(c.monthlyPayment))}
        ${row('Total kontrak', formatRupiah(c.totalAmount))}
        ${row('Sudah dibayar', `${formatRupiah(c.totalAmount - c.remainingAmount)}${c.paidBefore ? `<br><small class="text-muted">${c.paidBefore} cicilan dibayar sebelum dicatat di aplikasi, ${formatRupiah(c.paidAmount)} lewat aplikasi</small>` : ''}`)}
        ${row('Sisa', `<strong>${formatRupiah(c.remainingAmount)}</strong> (${c.remainingMonths} bulan)`)}
        ${row('Jatuh tempo pertama', formatDate(c.firstDueDate))}
        ${row('Jatuh tempo berikutnya', c.nextDueDate ? `${formatDate(c.nextDueDate)} <span class="text-muted">(${relativeDayLabel(c.nextDueDate)})</span>` : '')}
        ${row('Selesai pada', formatDate(c.endDate))}
        ${row('Rekening pembayaran', escapeHtml(c.paymentAccountName))}
        ${row('Kategori', escapeHtml(c.category))}
        ${row('Catatan', escapeHtml(c.notes))}
      </dl>
      ${auditNote(c)}
      <h3 class="section-title mt-3 mb-2"><i class="bi bi-clock-history"></i>Riwayat pembayaran di aplikasi</h3>
      ${c.payments.length ? `<ul class="simple-list">${c.payments.map((p) => `<li class="py-1">
          <div class="icon-circle icon-sm icon-success"><i class="bi bi-check2"></i></div>
          <div class="flex-grow-1 min-w-0">Cicilan ke-${p.no}<div class="small text-muted">${formatDate(p.date)} · dari ${escapeHtml(p.sourceName)}</div>${auditNote(p)}</div>
          <strong class="text-nowrap">${formatRupiah(p.amount)}</strong></li>`).join('')}</ul>`
        : '<p class="small text-muted mb-0">Belum ada pembayaran yang dicatat lewat aplikasi.</p>'}`,
    footer: writable
      ? `<button class="btn btn-outline-secondary me-auto" id="ct-edit"><i class="bi bi-pencil me-1"></i>Ubah</button>
         <button class="btn btn-primary" id="ct-pay" ${c.status === 'Lunas' ? 'disabled' : ''}><i class="bi bi-cash-coin me-1"></i>Bayar cicilan</button>`
      : '<button class="btn btn-light" data-bs-dismiss="modal">Tutup</button>'
  });
  modal.el.querySelector('#ct-edit')?.addEventListener('click', () => { modal.close(); setTimeout(() => openContractForm(c), 250); });
  modal.el.querySelector('#ct-pay')?.addEventListener('click', () => { modal.close(); setTimeout(() => openContractPayment(c), 250); });
}

export async function openContractForm(contract = null) {
  if (!canWrite()) return toast('Akun Viewer hanya dapat melihat data.', 'warning');
  const master = getMaster() || await loadMaster();
  const c = contract || { contractNo: '', lender: '', item: '', tenor: 12, monthlyPayment: '', firstDueDate: '', paidBefore: 0,
    paymentAccount: '', category: CONTRACT_CATEGORY, notes: '' };
  const accounts = master.accounts.filter((a) => a.active || a.id === c.paymentAccount);
  const categories = master.categories.filter((k) => k.type === 'Pengeluaran' && (k.active || k.name === c.category));
  const modal = openModal({
    title: contract ? `Ubah kontrak ${escapeHtml(c.contractNo)}` : 'Tambah kredit kontrak',
    size: 'modal-lg',
    body: `<form id="contract-form" novalidate autocomplete="off"><div class="row g-3">
      <div class="col-md-6"><label class="form-label" for="ct-no">Nomor kontrak</label>
        <input id="ct-no" name="contractNo" class="form-control" maxlength="40" required value="${escapeHtml(c.contractNo)}" placeholder="Contoh: 0123-4567-890"></div>
      <div class="col-md-6"><label class="form-label" for="ct-lender">Kreditur / leasing <span class="text-muted">(opsional)</span></label>
        <input id="ct-lender" name="lender" class="form-control" maxlength="60" value="${escapeHtml(c.lender)}" placeholder="Contoh: Adira Finance"></div>
      <div class="col-12"><label class="form-label" for="ct-item">Pembelian</label>
        <input id="ct-item" name="itemName" class="form-control" maxlength="80" required value="${escapeHtml(c.item)}" placeholder="Contoh: Honda Beat 2025"></div>
      <div class="col-md-6"><label class="form-label" for="ct-monthly">Nominal cicilan per bulan</label>
        <div class="input-group"><span class="input-group-text">Rp</span>
          <input id="ct-monthly" name="monthlyPayment" class="form-control fw-semibold" inputmode="numeric" value="${c.monthlyPayment || ''}"></div></div>
      <div class="col-6 col-md-3"><label class="form-label" for="ct-tenor">Tenor (bulan)</label>
        <input id="ct-tenor" name="tenor" type="number" min="1" max="360" step="1" class="form-control" value="${c.tenor}"></div>
      <div class="col-6 col-md-3"><label class="form-label" for="ct-paid">Sudah dibayar</label>
        <input id="ct-paid" name="paidBefore" type="number" min="0" max="360" step="1" class="form-control" value="${c.paidBefore || 0}">
        <div class="form-text" id="ct-paid-hint">Cicilan sebelum dicatat di aplikasi</div></div>
      <div class="col-md-6"><label class="form-label" for="ct-first">Jatuh tempo cicilan pertama</label>
        <input id="ct-first" name="firstDueDate" type="date" class="form-control" required value="${escapeHtml(c.firstDueDate || todayISO())}"></div>
      <div class="col-md-6"><div class="installment-preview h-100" id="ct-preview"></div></div>
      <div class="col-md-6"><label class="form-label" for="ct-account">Rekening pembayaran <span class="text-muted">(default saat bayar)</span></label>
        <select id="ct-account" name="paymentAccount" class="form-select"><option value="">— Pilih saat bayar —</option>
          ${accounts.map((a) => `<option value="${a.id}" ${a.id === c.paymentAccount ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></div>
      <div class="col-12"><details class="form-more" ${contract && (c.notes || c.category !== CONTRACT_CATEGORY) ? 'open' : ''}>
        <summary class="small fw-semibold">Kategori & catatan (opsional)</summary>
        <div class="row g-3 mt-0">
          <div class="col-md-6"><label class="form-label" for="ct-category">Kategori pengeluaran</label>
            <select id="ct-category" name="category" class="form-select">${categories.map((k) =>
              `<option ${k.name === (c.category || CONTRACT_CATEGORY) ? 'selected' : ''}>${escapeHtml(k.name)}</option>`).join('')}</select></div>
          <div class="col-md-6"><label class="form-label" for="ct-notes">Catatan</label>
            <input id="ct-notes" name="notes" class="form-control" maxlength="200" value="${escapeHtml(c.notes)}" placeholder="Contoh: autodebet tanggal 5"></div>
        </div></details></div>
    </div></form>`,
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">Batal</button>
      <button class="btn btn-primary px-4" id="ct-save"><i class="bi bi-check2 me-1"></i>${contract ? 'Simpan perubahan' : 'Simpan'}</button>`
  });
  const form = modal.el.querySelector('#contract-form');
  const f = form.elements;
  attachAmountInput(f.monthlyPayment);
  const linkedPayments = contract ? contract.payments.length : 0;

  function preview() {
    const tenor = Math.round(Number(f.tenor.value)) || 0;
    const monthly = parseAmount(f.monthlyPayment.value);
    const paid = Math.min(Math.round(Number(f.paidBefore.value)) || 0, tenor) + linkedPayments;
    const first = f.firstDueDate.value;
    const end = isValidISODate(first) && tenor > 0 ? addMonthsISO(first, tenor - 1) : '';
    form.querySelector('#ct-preview').innerHTML = tenor > 0 && monthly > 0
      ? `<div class="d-flex justify-content-between"><span>Total kontrak</span><strong>${formatRupiah(monthly * tenor)}</strong></div>
         <div class="d-flex justify-content-between small"><span>Cicilan ke-</span><span>${Math.min(paid, tenor)}/${tenor}</span></div>
         <div class="d-flex justify-content-between small"><span>Sisa</span><span>${formatRupiah(Math.max(tenor - paid, 0) * monthly)}</span></div>
         <div class="d-flex justify-content-between small"><span>Selesai pada</span><span>${end ? formatDate(end) : '-'}</span></div>
         ${linkedPayments ? `<div class="small text-muted mt-1">Termasuk ${linkedPayments} pembayaran yang dicatat lewat aplikasi.</div>` : ''}`
      : '<span class="text-muted small">Isi nominal dan tenor untuk melihat total dan tanggal selesai.</span>';
  }
  // Kontrak baru: perkirakan cicilan yang sudah lewat jatuh tempo (dianggap sudah dibayar) sampai pengguna mengubahnya sendiri.
  let paidTouched = Boolean(contract);
  function estimatePaid() {
    if (paidTouched) return;
    const first = f.firstDueDate.value;
    const tenor = Math.round(Number(f.tenor.value)) || 0;
    if (!isValidISODate(first) || tenor < 1) return;
    const today = todayISO();
    let count = 0;
    while (count < tenor && addMonthsISO(first, count) < today) count += 1;
    f.paidBefore.value = count;
    form.querySelector('#ct-paid-hint').textContent = count
      ? `Perkiraan dari jatuh tempo pertama (${count} sudah lewat). Ubah bila berbeda.`
      : 'Cicilan sebelum dicatat di aplikasi';
  }
  f.paidBefore.addEventListener('input', () => { paidTouched = true; });
  ['firstDueDate', 'tenor'].forEach((n) => f[n].addEventListener('input', () => { estimatePaid(); preview(); }));
  ['monthlyPayment', 'paidBefore'].forEach((n) => f[n].addEventListener('input', preview));
  preview();

  const save = modal.el.querySelector('#ct-save');
  save.addEventListener('click', async () => {
    const payload = {
      id: contract?.id, contractNo: f.contractNo.value.trim(), lender: f.lender.value.trim(), item: f.itemName.value.trim(),
      monthlyPayment: parseAmount(f.monthlyPayment.value), tenor: Number(f.tenor.value), paidBefore: Number(f.paidBefore.value) || 0,
      firstDueDate: f.firstDueDate.value, paymentAccount: f.paymentAccount.value, category: f.category.value, notes: f.notes.value.trim()
    };
    let problem = '';
    if (!payload.contractNo) problem = 'Nomor kontrak wajib diisi.';
    else if (!payload.item) problem = 'Pembelian wajib diisi.';
    else if (!(payload.monthlyPayment > 0)) problem = 'Nominal cicilan harus lebih dari 0.';
    else if (!(payload.tenor >= 1) || !Number.isInteger(payload.tenor)) problem = 'Tenor harus bilangan bulat minimal 1 bulan.';
    else if (payload.paidBefore < 0 || !Number.isInteger(payload.paidBefore)) problem = 'Jumlah cicilan yang sudah dibayar harus bilangan bulat.';
    else if (payload.paidBefore + linkedPayments > payload.tenor) problem = `Cicilan yang sudah dibayar (${payload.paidBefore + linkedPayments}) melebihi tenor.`;
    else if (!isValidISODate(payload.firstDueDate)) problem = 'Tanggal jatuh tempo pertama wajib diisi.';
    if (problem) return toast(problem, 'warning');
    setButtonLoading(save, true);
    try {
      const res = await api('saveContract', payload);
      toast(res.message);
      modal.close();
      await afterDataChange();
    } catch (err) {
      toastError(err);
      setButtonLoading(save, false);
    }
  });
}

export async function openContractPayment(c) {
  if (!canWrite()) return toast('Akun Viewer hanya dapat melihat data.', 'warning');
  const master = getMaster() || await loadMaster();
  const accounts = master.accounts.filter((a) => a.active);
  const chosen = accounts.some((a) => a.id === c.paymentAccount) ? c.paymentAccount : accounts[0]?.id;
  const modal = openModal({
    title: `Bayar cicilan ke-${c.nextInstallmentNo}`,
    body: `<div class="mb-3"><div class="fw-semibold">${escapeHtml(c.item)}</div>
        <div class="small text-muted">${escapeHtml(c.contractNo)}${c.lender ? ' · ' + escapeHtml(c.lender) : ''} · jatuh tempo ${formatDate(c.nextDueDate)}</div></div>
      <form id="ct-pay-form" novalidate><div class="row g-3">
        <div class="col-6"><label class="form-label" for="cp-date">Tanggal bayar</label>
          <input id="cp-date" name="date" type="date" class="form-control" value="${todayISO()}"></div>
        <div class="col-6"><label class="form-label" for="cp-amount">Nominal</label>
          <div class="input-group"><span class="input-group-text">Rp</span>
            <input id="cp-amount" name="amount" class="form-control fw-semibold" inputmode="numeric" value="${c.monthlyPayment.toLocaleString('id-ID')}"></div></div>
        <div class="col-12"><label class="form-label" for="cp-source">Dibayar dari</label>
          <select id="cp-source" name="sourceAccount" class="form-select">${accounts.map((a) =>
            `<option value="${a.id}" ${a.id === chosen ? 'selected' : ''}>${escapeHtml(a.name)} · ${formatRupiah(a.balance)}</option>`).join('')}</select></div>
        <div class="col-12 small text-muted">Dicatat sebagai pengeluaran kategori ${escapeHtml(c.category)} dan mengurangi saldo rekening.</div>
      </div></form>`,
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">Batal</button>
      <button class="btn btn-primary" id="cp-save"><i class="bi bi-check2 me-1"></i>Catat pembayaran</button>`
  });
  const f = modal.el.querySelector('#ct-pay-form').elements;
  attachAmountInput(f.amount);
  const requestId = uid();
  const save = modal.el.querySelector('#cp-save');
  save.addEventListener('click', async () => {
    const amount = parseAmount(f.amount.value);
    const account = accounts.find((a) => a.id === f.sourceAccount.value);
    if (!isValidISODate(f.date.value)) return toast('Tanggal bayar wajib diisi.', 'warning');
    if (!(amount > 0)) return toast('Nominal harus lebih dari 0.', 'warning');
    if (!account) return toast('Pilih rekening pembayaran.', 'warning');
    if (amount > account.balance) return toast(`Saldo ${account.name} tidak mencukupi (saldo ${formatRupiah(account.balance)}).`, 'warning');
    setButtonLoading(save, true);
    try {
      const res = await api('payContract', { contractId: c.id, date: f.date.value, amount, sourceAccount: account.id, requestId });
      toast(res.message);
      modal.close();
      await afterDataChange();
    } catch (err) {
      toastError(err);
      setButtonLoading(save, false);
    }
  });
}

async function deleteContract(c, button) {
  const ok = await confirmDialog({
    title: 'Hapus kontrak?',
    message: `Kontrak ${c.contractNo} (${c.item}) akan dihapus.${c.payments.length
      ? ` ${c.payments.length} pembayaran yang sudah dicatat tetap ada di Jurnal sebagai pengeluaran, hanya tidak lagi terhubung ke kontrak.` : ''}`,
    confirmText: 'Hapus', danger: true
  });
  if (!ok) return;
  setButtonLoading(button, true, '');
  try {
    const res = await api('deleteContract', { id: c.id });
    toast(res.message);
    await afterDataChange();
  } catch (err) {
    toastError(err);
    setButtonLoading(button, false);
  }
}
