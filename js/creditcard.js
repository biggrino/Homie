/**
 * creditcard.js — kartu kredit, pembayaran kartu, dan daftar cicilan.
 */
import { api, canWrite, loadMaster, getMaster } from './api.js';
import { escapeHtml, formatRupiah, formatCompactRupiah, formatDate, formatDateShort, relativeDayLabel, parseAmount, attachAmountInput, textProgress, getPref, setPref, sum } from './utils.js';
import { toast, toastError, openModal, setButtonLoading, emptyState, progressBar, skeleton } from './ui.js';
import { openTransactionForm, afterDataChange } from './finance.js';

const billingDay = () => Number(getMaster()?.settings?.INSTALLMENT_BILLING_DAY) || 16;

function cardVisual(c) {
  return `<div class="credit-card-visual ${c.active ? '' : 'inactive'}">
    <div class="d-flex justify-content-between align-items-start">
      <div><div class="cc-bank">${escapeHtml(c.bank)}</div><div class="cc-name">${escapeHtml(c.name)}</div></div>
      <i class="bi bi-credit-card-2-front fs-3 opacity-75"></i></div>
    <div class="cc-chip"></div>
    <div class="d-flex justify-content-between align-items-end">
      <div><div class="cc-label">Tagihan saat ini</div><div class="cc-amount">${formatRupiah(c.bill)}</div></div>
      <div class="text-end"><div class="cc-label">Sisa limit</div><div class="fw-semibold">${formatCompactRupiah(c.availableLimit)}</div></div>
    </div></div>`;
}

/** Rincian tagihan: belanja kartu + cicilan yang sudah ditagihkan − pembayaran = tagihan saat ini. */
function billBreakdown(c) {
  return `<ul class="bill-breakdown">
    <li><span>Belanja/pengeluaran pakai kartu</span><span>${formatRupiah(c.charges)}</span></li>
    <li><span>Cicilan yang sudah ditagihkan</span><span>${formatRupiah(c.installmentBilled)}</span></li>
    <li><span>Sudah dibayar</span><span class="text-success">−${formatRupiah(c.payments)}</span></li>
    <li class="total"><span>Tagihan saat ini</span><span>${formatRupiah(c.bill)}</span></li>
  </ul>`;
}

function installmentThisMonth(c) {
  if (!c.installmentThisMonth?.length) return '';
  return `<div class="mt-3"><div class="small fw-semibold mb-1"><i class="bi bi-calendar2-range me-1"></i>Cicilan bulan ini</div>
    <ul class="simple-list">${c.installmentThisMonth.map((i) => `
      <li class="py-1"><div class="flex-grow-1 min-w-0"><div class="text-truncate">${escapeHtml(i.description)}</div>
        <small class="text-muted">Ke-${i.no} dari ${i.tenor} · ${i.billed ? `ditagih ${formatDateShort(i.date)}` : `akan ditagih ${formatDateShort(i.date)}`}</small></div>
        <span class="text-nowrap ${i.billed ? 'fw-semibold' : 'text-muted'}">${formatRupiah(i.amount)}</span></li>`).join('')}</ul></div>`;
}

export async function renderCards(container) {
  container.innerHTML = skeleton(4);
  const [{ data: cards }] = await Promise.all([api('getCreditCards'), getMaster() ? null : loadMaster()]);
  const totalBill = cards.reduce((t, c) => t + Math.max(c.bill, 0), 0);
  container.innerHTML = `
    <div class="toolbar mb-3">
      <div><h2 class="h6 mb-0 fw-bold">Kartu Kredit</h2><div class="small text-muted">Total tagihan saat ini ${formatRupiah(totalBill)}
        · limit terpakai ${formatRupiah(sum(cards, 'outstanding'))}</div></div>
      <div class="d-flex gap-2">${canWrite() ? `
        <button class="btn btn-outline-primary btn-sm" id="add-card"><i class="bi bi-plus-lg me-1"></i>Kartu</button>
        <button class="btn btn-primary btn-sm" id="pay-card"><i class="bi bi-credit-card-2-back me-1"></i>Bayar</button>` : ''}</div>
    </div>
    <div class="row g-3">${cards.length ? cards.map((c) => `
      <div class="col-md-6 col-xl-4"><div class="card app-card h-100"><div class="card-body">
        ${cardVisual(c)}
        <div class="mt-3">
          <div class="d-flex justify-content-between small mb-1"><span>Pemakaian limit</span><strong>${c.usagePercent}%</strong></div>
          ${progressBar(c.usagePercent)}
        </div>
        <dl class="mini-dl mt-3 mb-0">
          <dt>Limit</dt><dd>${formatRupiah(c.limit)}</dd>
          <dt>Limit terpakai (outstanding)</dt><dd>${formatRupiah(c.outstanding)}</dd>
          <dt>Available limit</dt><dd class="text-success">${formatRupiah(c.availableLimit)}</dd>
          <dt>Tagihan saat ini</dt><dd class="fw-bold">${formatRupiah(c.bill)}</dd>
          ${c.unbilledInstallments ? `<dt>Cicilan belum ditagih</dt><dd>${formatRupiah(c.unbilledInstallments)}</dd>` : ''}
          <dt>Minimum payment</dt><dd>${formatRupiah(c.minimumPayment)} <span class="text-muted">(${c.minimumPaymentPercent}%, min Rp50.000)</span></dd>
          <dt>Tanggal cetak tagihan</dt><dd>Tgl ${c.statementDate} · ${formatDateShort(c.nextStatementDate)}</dd>
          <dt>Jatuh tempo</dt><dd>Tgl ${c.dueDate} · ${formatDateShort(c.nextDueDate)} <span class="text-muted">(${relativeDayLabel(c.nextDueDate)})</span></dd>
          ${c.activeInstallments ? `<dt>Cicilan aktif</dt><dd>${c.activeInstallments} · ${formatRupiah(c.installmentMonthly)}/bln</dd>` : ''}
        </dl>
        ${c.bill < 0 ? '<div class="alert alert-info small mt-3 mb-0">Kartu lebih bayar (saldo kredit) — akan terpakai untuk transaksi berikutnya.</div>' : ''}
        ${canWrite() ? `<div class="d-flex gap-2 mt-3">
          <button class="btn btn-sm btn-primary flex-grow-1" data-pay="${c.id}" ${c.bill > 0 ? '' : 'disabled'}><i class="bi bi-cash-coin me-1"></i>Bayar tagihan</button>
          <button class="btn btn-sm btn-outline-secondary" data-edit-card="${c.id}" aria-label="Ubah kartu"><i class="bi bi-pencil"></i></button></div>` : ''}
      </div></div></div>`).join('') : `<div class="col-12">${emptyState('bi-credit-card', 'Belum ada kartu kredit.')}</div>`}
    </div>
    <p class="small text-muted mt-3"><i class="bi bi-calculator me-1"></i><strong>Tagihan saat ini</strong> = belanja pakai kartu + cicilan yang sudah ditagihkan − pembayaran.
      <strong>Limit terpakai</strong> juga menghitung sisa cicilan yang belum ditagih, karena bank langsung mengunci limit sebesar total cicilan.
      Cicilan ditagihkan setiap tanggal ${billingDay()}.</p>`;

  container.querySelector('#add-card')?.addEventListener('click', () => openCardForm());
  container.querySelector('#pay-card')?.addEventListener('click', () => openTransactionForm(null, { type: 'Pembayaran Kartu Kredit' }));
  container.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () =>
    openTransactionForm(null, { type: 'Pembayaran Kartu Kredit', destinationAccount: b.dataset.pay })));
  container.querySelectorAll('[data-edit-card]').forEach((b) => b.addEventListener('click', () =>
    openCardForm(cards.find((c) => c.id === b.dataset.editCard))));
}

export async function renderCardPayment(container) {
  container.innerHTML = skeleton(3, 'list');
  const [{ data: allCards }, { data: payments }] = await Promise.all([api('getCreditCards'), api('getTransactions', { type: 'Pembayaran Kartu Kredit' }), loadMaster(true)]);
  const cards = allCards.filter((c) => c.active || c.bill !== 0);
  container.innerHTML = `
    <div class="row g-3">
      <div class="col-lg-6">
        ${cards.map((c) => `<div class="card app-card mb-3"><div class="card-body">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
            <div><h2 class="section-title mb-0"><i class="bi bi-credit-card"></i>${escapeHtml(c.name)}</h2>
              <small class="text-muted">Jatuh tempo ${formatDateShort(c.nextDueDate)} (${relativeDayLabel(c.nextDueDate)}) · minimum ${formatRupiah(c.minimumPayment)}</small></div>
            ${canWrite() ? `<button class="btn btn-sm btn-primary text-nowrap flex-shrink-0" data-pay="${c.id}" ${c.bill > 0 ? '' : 'disabled'}><i class="bi bi-cash-coin me-1"></i>Bayar</button>` : ''}</div>
          ${billBreakdown(c)}
          ${installmentThisMonth(c)}
          ${c.unbilledInstallments ? `<div class="small text-muted mt-2"><i class="bi bi-hourglass-split me-1"></i>Cicilan belum ditagih ${formatRupiah(c.unbilledInstallments)} — akan masuk tagihan
            satu per satu setiap tanggal ${billingDay()}, belum perlu dibayar sekarang.</div>` : ''}
        </div></div>`).join('') || emptyState('bi-credit-card', 'Belum ada kartu kredit.')}
        <p class="small text-muted"><i class="bi bi-info-circle me-1"></i>Pembayaran mengurangi saldo rekening sumber dan tagihan kartu, lalu mengembalikan limit.
          Pembayaran <strong>tidak</strong> dihitung sebagai pengeluaran lagi, karena belanja dan cicilannya sudah tercatat sebagai pengeluaran.</p>
      </div>
      <div class="col-lg-6">
        <div class="card app-card"><div class="card-body">
          <h2 class="section-title mb-3"><i class="bi bi-clock-history"></i>Riwayat Pembayaran</h2>
          ${payments.length ? `<ul class="simple-list">${payments.slice(0, 30).map((p) => `
            <li><div class="icon-circle icon-sm icon-primary"><i class="bi bi-check2"></i></div>
              <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${escapeHtml(p.destinationName)}</div>
                <small class="text-muted">${formatDate(p.date)} · dari ${escapeHtml(p.sourceName)}${p.description ? ' · ' + escapeHtml(p.description) : ''}</small></div>
              <strong>${formatRupiah(p.amount)}</strong></li>`).join('')}</ul>` : emptyState('bi-receipt', 'Belum ada pembayaran kartu kredit.')}
        </div></div>
      </div>
    </div>`;
  container.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () =>
    openTransactionForm(null, { type: 'Pembayaran Kartu Kredit', destinationAccount: b.dataset.pay })));
}

export async function renderInstallments(container) {
  const status = getPref('installmentStatus', 'Aktif');
  container.innerHTML = skeleton(3, 'list');
  const [{ data }] = await Promise.all([api('getInstallments'), getMaster() ? null : loadMaster()]);
  const list = status ? data.filter((i) => i.status === status) : data;
  const active = data.filter((i) => i.status === 'Aktif');
  container.innerHTML = `
    <div class="toolbar mb-3">
      <div><h2 class="h6 mb-0 fw-bold">Daftar Cicilan</h2>
        <div class="small text-muted">${active.length} aktif · ${formatRupiah(sum(active, 'monthlyPayment'))}/bulan · belum ditagih ${formatRupiah(sum(active, 'remainingAmount'))}</div></div>
      <div class="btn-group btn-group-sm" role="group">${['Aktif', 'Lunas', ''].map((s) => `
        <button class="btn ${s === status ? 'btn-primary' : 'btn-outline-primary'}" data-status="${s}">${s || 'Semua'}</button>`).join('')}</div>
    </div>
    <div class="row g-3">${list.length ? list.map((i) => `
      <div class="col-md-6 col-xl-4"><div class="card app-card h-100"><div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div class="min-w-0"><div class="fw-bold text-truncate">${escapeHtml(i.description)}</div>
            <div class="small text-muted">${escapeHtml(i.cardName)} · dibeli ${formatDate(i.startDate)}</div></div>
          <span class="badge-soft badge-soft-${i.status === 'Lunas' ? 'success' : 'warning'}">${i.status}</span></div>
        <div class="d-flex justify-content-between align-items-baseline">
          <span class="fs-5 fw-bold">${formatRupiah(i.monthlyPayment)}<small class="text-muted fs-6">/bln</small></span>
          <span class="fw-semibold">${i.paidMonths} / ${i.tenor} ditagih</span></div>
        <div class="text-progress" aria-hidden="true">${textProgress(i.paidMonths, i.tenor)}</div>
        ${progressBar(i.progressPercent, { tone: i.status === 'Lunas' ? 'success' : 'primary' })}
        <dl class="mini-dl mt-3 mb-2">
          <dt>Harga barang</dt><dd>${formatRupiah(i.principal)}</dd>
          <dt>Bunga / admin</dt><dd>${i.interestRate}%/bln · ${formatRupiah(i.adminFee)}</dd>
          <dt>Total cicilan</dt><dd>${formatRupiah(i.totalAmount)}</dd>
          <dt>Sudah ditagihkan</dt><dd>${formatRupiah(i.paidAmount)}</dd>
          <dt>Belum ditagih</dt><dd class="fw-semibold">${formatRupiah(i.remainingAmount)}</dd>
          <dt>Tagihan berikutnya</dt><dd>${i.nextBillingDate ? `${formatDate(i.nextBillingDate)} <span class="text-muted">(${relativeDayLabel(i.nextBillingDate)})</span>` : '-'}</dd>
          <dt>Selesai</dt><dd>${formatDate(i.endDate)}</dd>
        </dl>
        <div class="schedule-list" title="Jadwal tagihan cicilan">${i.schedule.map((s) => `<span class="${s.billed ? 'billed' : ''}">${s.no}. ${formatDateShort(s.date)}</span>`).join('')}</div>
      </div></div></div>`).join('') : `<div class="col-12">${emptyState('bi-calendar2-check', status ? `Tidak ada cicilan berstatus ${status}.` : 'Belum ada cicilan.',
        canWrite() ? '<button class="btn btn-primary btn-sm" id="add-inst">Tambah cicilan</button>' : '')}</div>`}
    </div>
    <p class="small text-muted mt-3"><i class="bi bi-info-circle me-1"></i>Cicilan dibuat dari Tambah Transaksi → Pengeluaran pakai kartu kredit → Cicilan.
      Setiap tanggal ${billingDay()} satu bulan cicilan masuk ke tagihan kartu (biaya admin ikut tagihan pertama) dan dicatat sebagai pengeluaran bulan itu.
      Pembelian tanggal ${billingDay() + 1} ke atas mulai ditagih tanggal ${billingDay()} bulan berikutnya. Pembayarannya lewat menu Bayar Kartu.</p>`;
  container.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    setPref('installmentStatus', b.dataset.status);
    renderInstallments(container);
  }));
  container.querySelector('#add-inst')?.addEventListener('click', () => openTransactionForm(null, { type: 'Cicilan' }));
}

export function openCardForm(card = null) {
  const c = card || { name: '', bank: '', limit: '', statementDate: 1, dueDate: 15, minimumPaymentPercent: 10, active: true };
  const modal = openModal({
    title: card ? `Ubah ${escapeHtml(c.name)}` : 'Tambah kartu kredit',
    body: `<form novalidate id="card-form"><div class="row g-3">
      <div class="col-md-6"><label class="form-label">Nama kartu</label><input name="name" class="form-control" maxlength="40" value="${escapeHtml(c.name)}"></div>
      <div class="col-md-6"><label class="form-label">Bank penerbit</label><input name="bank" class="form-control" maxlength="40" value="${escapeHtml(c.bank)}"></div>
      <div class="col-12"><label class="form-label">Limit</label><div class="input-group"><span class="input-group-text">Rp</span>
        <input name="limit" class="form-control" inputmode="numeric" value="${c.limit || ''}"></div></div>
      <div class="col-4"><label class="form-label">Tgl cetak</label><input name="statementDate" type="number" min="1" max="31" class="form-control" value="${c.statementDate}"></div>
      <div class="col-4"><label class="form-label">Jatuh tempo</label><input name="dueDate" type="number" min="1" max="31" class="form-control" value="${c.dueDate}"></div>
      <div class="col-4"><label class="form-label">Min. bayar %</label><input name="minimumPayment" type="number" min="0" max="100" step="0.5" class="form-control" value="${c.minimumPaymentPercent}"></div>
      <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="card-active" ${c.active ? 'checked' : ''}>
        <label class="form-check-label" for="card-active">Kartu aktif</label></div></div>
      <div class="col-12 small text-muted">Tagihan, limit terpakai, dan available limit dihitung otomatis dari transaksi.</div>
    </div></form>`,
    footer: '<button class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary" id="card-save">Simpan</button>'
  });
  const f = modal.el.querySelector('#card-form').elements;
  attachAmountInput(f.limit);
  modal.el.querySelector('#card-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!f.name.value.trim() || !f.bank.value.trim()) return toast('Nama kartu dan bank wajib diisi.', 'warning');
    if (!(parseAmount(f.limit.value) > 0)) return toast('Limit harus lebih dari 0.', 'warning');
    setButtonLoading(btn, true);
    try {
      const res = await api('saveCreditCard', { id: card?.id, name: f.name.value, bank: f.bank.value, limit: parseAmount(f.limit.value),
        statementDate: f.statementDate.value, dueDate: f.dueDate.value, minimumPayment: f.minimumPayment.value, active: f.active.checked });
      toast(res.message);
      modal.close();
      await afterDataChange();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });
}
