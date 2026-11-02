/**
 * creditcard.js — kartu kredit, pembayaran kartu, dan daftar cicilan.
 */
import { api, canWrite, loadMaster, getMaster } from './api.js';
import { escapeHtml, formatRupiah, formatCompactRupiah, formatDate, formatDateShort, relativeDayLabel, parseAmount, attachAmountInput, sum } from './utils.js';
import { toast, toastError, openModal, setButtonLoading, emptyState, progressBar, skeleton, auditNote } from './ui.js';
import { openTransactionForm, openTransactionDetail, afterDataChange } from './finance.js';

const billingDay = () => Number(getMaster()?.settings?.INSTALLMENT_BILLING_DAY) || 16;

function cardVisual(c) {
  return `<div class="credit-card-visual ${c.active ? '' : 'inactive'}">
    <div class="d-flex justify-content-between align-items-start">
      <div><div class="cc-bank">${escapeHtml(c.bank)}</div><div class="cc-name">${escapeHtml(c.name)}</div></div>
      <i class="bi bi-credit-card-2-front fs-3 opacity-75"></i></div>
    <div class="d-flex align-items-center gap-3"><div class="cc-chip"></div>
      <div class="cc-number" aria-label="Nomor kartu berakhiran ${escapeHtml(c.cardNumber || '-')}">${maskedNumber(c.cardNumber)}</div></div>
    <div class="d-flex justify-content-between align-items-end">
      <div><div class="cc-label">Tagihan saat ini</div><div class="cc-amount">${formatRupiah(c.bill)}</div></div>
      <div class="text-end"><div class="cc-label">Sisa limit</div><div class="fw-semibold">${formatCompactRupiah(c.availableLimit)}</div></div>
    </div></div>`;
}

export function maskedNumber(last4) {
  return last4 ? `•••• •••• •••• ${escapeHtml(last4)}` : '•••• •••• •••• ····';
}

/** Tabel pembelian per kartu: cicilan aktif + belanja bayar penuh bulan ini, dengan kolom tagihan bulan ini. */
function purchasesTable(c) {
  const rows = c.purchases || [];
  if (!rows.length) return '<p class="small text-muted mb-0">Belum ada pembelian bulan ini dan tidak ada cicilan aktif.</p>';
  return `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0 stack-table card-purchase-table">
    <thead><tr><th>Pembelian</th><th class="text-center">Tenor</th><th class="text-center">Cicilan ke-</th><th class="text-end">Nominal</th>
      <th>Selesai pada</th><th class="text-end">Tagihan bulan ini</th></tr></thead>
    <tbody>${rows.map((p) => `<tr data-trx="${escapeHtml(p.transactionId)}" role="button" tabindex="0">
      <td data-label="Pembelian" class="text-wrap"><div class="fw-semibold">${escapeHtml(p.description)}</div>
        <small class="text-muted">${formatDateShort(p.date)} · ${p.kind === 'installment' ? 'Cicilan' : 'Bayar penuh'}</small>${auditNote(p)}</td>
      <td data-label="Tenor" class="text-center">${p.kind === 'installment' ? `${p.tenor} bln` : '-'}</td>
      <td data-label="Cicilan ke-" class="text-center">${p.kind === 'installment' ? `${p.installmentNo}/${p.tenor}` : '-'}</td>
      <td data-label="Nominal" class="text-end text-nowrap"><span>${formatRupiah(p.amount)}${p.kind === 'installment' ? '<small class="text-muted">/bln</small>' : ''}</span></td>
      <td data-label="Selesai pada" class="text-nowrap">${p.kind === 'installment' ? formatDate(p.endDate) : '-'}</td>
      <td data-label="Tagihan bulan ini" class="text-end fw-semibold text-nowrap"><div>${p.thisMonth ? formatRupiah(p.thisMonth) : '<span class="text-muted">-</span>'}
        ${p.kind === 'installment' && p.thisMonth && !p.billed ? `<small class="d-block text-muted fw-normal">ditagih ${formatDateShort(p.billingDate)}</small>` : ''}</div></td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="5" class="fw-semibold">Tagihan bulan ini</td><td class="text-end fw-bold text-nowrap" data-label="Tagihan bulan ini">${formatRupiah(c.billThisMonth)}</td></tr></tfoot>
  </table></div>`;
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

export async function renderCards(container) {
  container.innerHTML = skeleton(4);
  const [{ data: cards }, { data: payments }] = await Promise.all([api('getCreditCards'), api('getTransactions', { type: 'Pembayaran Kartu Kredit' }),
    getMaster() ? null : loadMaster()]);
  const totalBill = cards.reduce((t, c) => t + Math.max(c.bill, 0), 0);
  container.innerHTML = `
    <div class="toolbar mb-3">
      <div><h2 class="h6 mb-0 fw-bold">Kartu Kredit</h2><div class="small text-muted">Total tagihan saat ini ${formatRupiah(totalBill)}
        · limit terpakai ${formatRupiah(sum(cards, 'outstanding'))}</div></div>
      <div class="d-flex gap-2">${canWrite() ? `
        <button class="btn btn-outline-primary btn-sm" id="add-card"><i class="bi bi-plus-lg me-1"></i>Kartu</button>
        <button class="btn btn-primary btn-sm" id="pay-card"><i class="bi bi-credit-card-2-back me-1"></i>Bayar</button>` : ''}</div>
    </div>
    <div class="d-grid gap-3 cc-list">${cards.length ? cards.map((c) => `
      <div class="card app-card"><div class="card-body"><div class="row g-3">
        <div class="col-lg-4">
          ${cardVisual(c)}
          <div class="mt-3">
            <div class="d-flex justify-content-between small mb-1"><span>Pemakaian limit</span><strong>${c.usagePercent}%</strong></div>
            ${progressBar(c.usagePercent)}
          </div>
          <dl class="mini-dl mt-3 mb-0">
            <dt>Nomor kartu</dt><dd>${c.cardNumber ? `•••• ${escapeHtml(c.cardNumber)}` : '<span class="text-muted">Belum diisi</span>'}</dd>
            <dt>Limit</dt><dd>${formatRupiah(c.limit)}</dd>
            <dt>Limit terpakai</dt><dd>${formatRupiah(c.outstanding)}</dd>
            <dt>Available limit</dt><dd class="text-success">${formatRupiah(c.availableLimit)}</dd>
            ${c.unbilledInstallments ? `<dt>Cicilan belum ditagih</dt><dd>${formatRupiah(c.unbilledInstallments)}</dd>` : ''}
            <dt>Minimum payment</dt><dd>${formatRupiah(c.minimumPayment)} <span class="text-muted">(${c.minimumPaymentPercent}%)</span></dd>
            <dt>Tanggal cetak</dt><dd>Tgl ${c.statementDate} · ${formatDateShort(c.nextStatementDate)}</dd>
            <dt>Jatuh tempo</dt><dd>Tgl ${c.dueDate} · ${formatDateShort(c.nextDueDate)} <span class="text-muted">(${relativeDayLabel(c.nextDueDate)})</span></dd>
          </dl>
          ${auditNote(c)}
        </div>
        <div class="col-lg-8">
          <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
            <h3 class="section-title mb-0"><i class="bi bi-receipt"></i>Pembelian & cicilan</h3>
            <div class="text-end small"><span class="text-muted">Total tagihan saat ini</span>
              <div class="fw-bold fs-6">${formatRupiah(c.bill)}</div></div>
          </div>
          ${purchasesTable(c)}
          <details class="form-more mt-2"><summary class="small fw-semibold">Rincian tagihan saat ini</summary>${billBreakdown(c)}
            ${c.unbilledInstallments ? `<div class="small text-muted">Cicilan belum ditagih ${formatRupiah(c.unbilledInstallments)} masuk tagihan satu per satu setiap tanggal ${billingDay()}, belum perlu dibayar sekarang.</div>` : ''}</details>
          ${c.bill < 0 ? '<div class="alert alert-info small mt-3 mb-0">Kartu lebih bayar (saldo kredit), akan terpakai untuk transaksi berikutnya.</div>' : ''}
          ${c.bill > c.billThisMonth ? `<div class="small text-muted mt-2"><i class="bi bi-info-circle me-1"></i>Tagihan saat ini ${formatRupiah(c.bill)} termasuk sisa tagihan bulan sebelumnya yang belum dibayar.</div>` : ''}
          ${canWrite() ? `<div class="d-flex flex-wrap gap-2 mt-3">
            <button class="btn btn-sm btn-primary" data-pay="${c.id}" ${c.bill > 0 ? '' : 'disabled'}><i class="bi bi-cash-coin me-1"></i>Bayar tagihan</button>
            <button class="btn btn-sm btn-outline-primary" data-spend="${c.id}"><i class="bi bi-bag-plus me-1"></i>Catat belanja</button>
            <button class="btn btn-sm btn-outline-secondary" data-edit-card="${c.id}"><i class="bi bi-pencil me-1"></i>Ubah kartu</button></div>` : ''}
        </div>
      </div></div></div>`).join('') : emptyState('bi-credit-card', 'Belum ada kartu kredit.')}
    </div>
    ${cards.length ? `<div class="card app-card mt-3"><div class="card-body">
      <h2 class="section-title mb-3"><i class="bi bi-clock-history"></i>Riwayat pembayaran kartu</h2>
      ${payments.length ? `<ul class="simple-list">${payments.slice(0, 10).map((p) => `
        <li><div class="icon-circle icon-sm icon-primary"><i class="bi bi-check2"></i></div>
          <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${escapeHtml(p.destinationName)}</div>
            <small class="text-muted">${formatDate(p.date)} · dari ${escapeHtml(p.sourceName)}${p.description ? ' · ' + escapeHtml(p.description) : ''}</small>${auditNote(p)}</div>
          <strong class="text-nowrap">${formatRupiah(p.amount)}</strong></li>`).join('')}</ul>` : emptyState('bi-receipt', 'Belum ada pembayaran kartu kredit.')}
      <p class="small text-muted mt-2 mb-0"><i class="bi bi-info-circle me-1"></i>Pembayaran mengurangi saldo rekening dan tagihan kartu, lalu mengembalikan limit.
        Pembayaran tidak dihitung pengeluaran lagi, karena belanja dan cicilannya sudah tercatat sebagai pengeluaran.</p>
    </div></div>` : ''}
    <p class="small text-muted mt-3"><i class="bi bi-calculator me-1"></i><strong>Tagihan saat ini</strong> = belanja pakai kartu + cicilan yang sudah ditagihkan − pembayaran.
      <strong>Limit terpakai</strong> juga menghitung sisa cicilan yang belum ditagih, karena bank langsung mengunci limit sebesar total cicilan.
      Cicilan ditagihkan setiap tanggal ${billingDay()}. Ketuk baris pembelian untuk melihat detail transaksinya.
      Hanya 4 digit terakhir nomor kartu yang disimpan.</p>`;

  container.querySelector('#add-card')?.addEventListener('click', () => openCardForm());
  container.querySelector('#pay-card')?.addEventListener('click', () => openTransactionForm(null, { type: 'Pembayaran Kartu Kredit' }));
  container.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () =>
    openTransactionForm(null, { type: 'Pembayaran Kartu Kredit', destinationAccount: b.dataset.pay })));
  container.querySelectorAll('[data-edit-card]').forEach((b) => b.addEventListener('click', () =>
    openCardForm(cards.find((c) => c.id === b.dataset.editCard))));
  container.querySelectorAll('[data-spend]').forEach((b) => b.addEventListener('click', () =>
    openTransactionForm(null, { type: 'Pengeluaran', sourceAccount: b.dataset.spend })));
  container.querySelectorAll('tr[data-trx]').forEach((tr) => {
    const open = async () => {
      try {
        const { data } = await api('getTransactions', { id: tr.dataset.trx });
        if (data[0]) openTransactionDetail(data[0]);
        else toast('Transaksi tidak ditemukan.', 'warning');
      } catch (err) { toastError(err); }
    };
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

export function openCardForm(card = null) {
  const c = card || { name: '', bank: '', cardNumber: '', limit: '', statementDate: 1, dueDate: 15, minimumPaymentPercent: 10, active: true };
  const modal = openModal({
    title: card ? `Ubah ${escapeHtml(c.name)}` : 'Tambah kartu kredit',
    body: `<form novalidate id="card-form"><div class="row g-3">
      <div class="col-md-6"><label class="form-label">Nama kartu</label><input name="name" class="form-control" maxlength="40" value="${escapeHtml(c.name)}"></div>
      <div class="col-md-6"><label class="form-label">Bank penerbit</label><input name="bank" class="form-control" maxlength="40" value="${escapeHtml(c.bank)}"></div>
      <div class="col-md-6"><label class="form-label" for="card-number">4 digit terakhir nomor kartu</label>
        <div class="input-group"><span class="input-group-text">•••• •••• ••••</span>
          <input id="card-number" name="cardNumber" class="form-control" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" value="${escapeHtml(c.cardNumber || '')}"></div>
        <div class="form-text">Demi keamanan, nomor lengkap kartu tidak disimpan.</div></div>
      <div class="col-md-6"><label class="form-label">Limit</label><div class="input-group"><span class="input-group-text">Rp</span>
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
    if (f.cardNumber.value.trim() && !/^\d{4}$/.test(f.cardNumber.value.trim())) return toast('Isi 4 digit terakhir nomor kartu saja (contoh 1234).', 'warning');
    setButtonLoading(btn, true);
    try {
      const res = await api('saveCreditCard', { id: card?.id, name: f.name.value, bank: f.bank.value, cardNumber: f.cardNumber.value.trim(), limit: parseAmount(f.limit.value),
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
