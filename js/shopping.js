/**
 * shopping.js — menu Belanja: daftar Mandatory (rutin, otomatis disalin tiap bulan)
 * dan Complementary (tambahan, bisa disalin manual dari bulan lalu).
 * Barang yang sudah dibeli dicatat ke Keuangan per struk (satu transaksi Pengeluaran).
 */
import { api, canWrite, getMaster, loadMaster } from './api.js';
import {
  escapeHtml, formatRupiah, formatCompactRupiah, formatDateShort, parseAmount, attachAmountInput, getPref, setPref, currentPeriod,
  monthLabel, formatNumber, todayISO, isValidISODate, daysInMonth, uid
} from './utils.js';
import { toast, toastError, openModal, confirmDialog, setButtonLoading, emptyState, progressBar, skeleton } from './ui.js';
import { periodFilter, refreshApp, openTransactionDetail } from './finance.js';

const CATEGORIES = ['Bahan Pokok', 'Sayur & Buah', 'Lauk', 'Bumbu', 'Minuman', 'Kebersihan', 'Perlengkapan Mandi', 'Camilan', 'Kebutuhan Bayi', 'Lainnya'];
const UNITS = ['pcs', 'kg', 'gram', 'liter', 'botol', 'pak', 'kotak', 'galon', 'ikat', 'sachet', 'lusin'];
const GROUP_LABEL = { MANDATORY: 'Mandatory', COMPLEMENTARY: 'Complementary' };

const activePeriod = () => getPref('shoppingPeriod', currentPeriod());
const activeGroup = () => getPref('shoppingGroup', 'MANDATORY');

export async function renderShopping(container) {
  const filter = periodFilter('shoppingPeriod', () => load());
  container.innerHTML = `
    <div class="toolbar mb-3"><h2 class="h6 mb-0 fw-bold">Daftar Belanja</h2>${filter.html}</div>
    <div id="shop-body">${skeleton(4, 'list')}</div>`;
  filter.bind(container);
  const body = container.querySelector('#shop-body');

  async function load() {
    const period = activePeriod();
    const group = activeGroup();
    body.innerHTML = skeleton(4, 'list');
    let data;
    try {
      ({ data } = await api('getShopping', period));
    } catch (err) {
      body.innerHTML = emptyState('bi-wifi-off', err.message);
      return;
    }
    const s = data.summary;
    const items = data.items.filter((i) => i.group === group);
    const groupSummary = group === 'MANDATORY' ? s.mandatory : s.complementary;
    const pendingItems = data.items.filter((i) => i.status === 'Sudah dibeli' && !i.recorded);
    body.innerHTML = `
      <div class="card app-card mb-3"><div class="card-body">
        <div class="row g-3 text-center text-md-start">
          <div class="col-6 col-md-3"><div class="stat-label">Budget belanja</div><div class="fw-bold fs-5">${formatRupiah(s.budget)}</div></div>
          <div class="col-6 col-md-3"><div class="stat-label">Terpakai <span class="text-muted fw-normal">(di Keuangan)</span></div><div class="fw-bold fs-5">${formatRupiah(s.spent)}</div></div>
          <div class="col-6 col-md-3"><div class="stat-label">Belum dicatat</div><div class="fw-bold fs-5 ${s.pending ? 'text-warning' : ''}">${formatRupiah(s.pending)}</div></div>
          <div class="col-6 col-md-3"><div class="stat-label">Sisa budget</div><div class="fw-bold fs-5 ${s.remaining < 0 ? 'text-danger' : 'text-success'}">${formatRupiah(s.remaining)}</div></div>
        </div>
        <div class="mt-3">${progressBar(s.percent, { height: 10 })}</div>
        <div class="d-flex flex-wrap justify-content-between small text-muted mt-2 gap-2">
          <span>${s.bought} dari ${s.count} item sudah dibeli · terpakai ${s.percent}%</span>
          <span>Sisa daftar (estimasi) ${formatRupiah(s.planned)} · perkiraan sisa budget akhir bulan
            <strong class="${s.projectedRemaining < 0 ? 'text-danger' : ''}">${formatRupiah(s.projectedRemaining)}</strong></span>
        </div>
        <div class="small text-muted mt-2"><i class="bi bi-link-45deg me-1"></i>Budget & terpakai = anggaran kategori "${escapeHtml(s.budgetCategory)}" di menu Keuangan, termasuk pengeluaran kategori ini yang dicatat langsung di Keuangan.
          ${s.budget ? '' : '<a href="#/keuangan/anggaran">Atur anggaran</a>'}</div>
      </div></div>

      ${pendingItems.length && canWrite() ? `
      <div class="alert alert-warning d-flex flex-wrap align-items-center gap-2 mb-3" role="status">
        <i class="bi bi-receipt fs-5"></i>
        <div class="flex-grow-1"><strong>${pendingItems.length} barang sudah dibeli (${formatRupiah(s.pending)})</strong> belum dicatat ke Keuangan.
          <div class="small">Catat sekali per struk agar saldo rekening/kartu dan anggaran ikut berkurang.</div></div>
        <button class="btn btn-sm btn-warning fw-semibold" id="checkout"><i class="bi bi-journal-plus me-1"></i>Catat ke Keuangan</button>
      </div>` : ''}

      <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
        <div class="segmented" role="tablist">${['MANDATORY', 'COMPLEMENTARY'].map((g) => `
          <button class="segmented-btn ${g === group ? 'active' : ''}" data-group="${g}" role="tab" aria-selected="${g === group}">
            ${GROUP_LABEL[g]} <span class="count-pill">${data.items.filter((i) => i.group === g).length}</span></button>`).join('')}
        </div>
        ${canWrite() ? `<div class="d-flex flex-wrap gap-2">
          <button class="btn btn-sm btn-outline-primary" id="copy-last"><i class="bi bi-files me-1"></i>Salin Bulan Lalu</button>
          <button class="btn btn-sm btn-outline-success" id="checkout2"><i class="bi bi-bag-check me-1"></i>Selesai Belanja</button>
          <button class="btn btn-sm btn-primary" id="add-item"><i class="bi bi-plus-lg me-1"></i>Tambah</button></div>` : ''}
      </div>
      <p class="small text-muted">${group === 'MANDATORY'
        ? '<i class="bi bi-arrow-repeat me-1"></i>Kebutuhan rutin. Saat memasuki bulan baru, daftar ini otomatis disalin dari bulan sebelumnya.'
        : '<i class="bi bi-stars me-1"></i>Kebutuhan tambahan. Kosong setiap bulan — gunakan tombol Salin Bulan Lalu bila perlu.'}
        Estimasi ${formatRupiah(groupSummary.estimate)} · realisasi ${formatRupiah(groupSummary.actual)}.</p>
      <div class="card app-card"><div class="card-body p-2">
        ${items.length ? `<ul class="shop-list">${items.map((i) => `
          <li class="shop-item ${i.status === 'Sudah dibeli' ? 'done' : ''}">
            <input class="form-check-input shop-check" type="checkbox" data-toggle="${i.id}" ${i.status === 'Sudah dibeli' ? 'checked' : ''} ${canWrite() && !i.recorded ? '' : 'disabled'}
              aria-label="Tandai ${escapeHtml(i.item)} sudah dibeli" ${i.recorded ? 'title="Sudah tercatat di Keuangan"' : ''}>
            <button type="button" class="shop-main" data-edit="${i.id}">
              <span class="shop-name">${escapeHtml(i.item)}</span>
              <span class="shop-meta">${formatNumber(i.quantity)} ${escapeHtml(i.unit)} · ${escapeHtml(i.category)}${i.notes ? ' · ' + escapeHtml(i.notes) : ''}</span>
              ${i.recorded ? `<span class="shop-tag tag-recorded"><i class="bi bi-check2-circle me-1"></i>Tercatat ${formatDateShort(i.purchaseDate)}</span>`
                : i.status === 'Sudah dibeli' ? '<span class="shop-tag tag-pending"><i class="bi bi-hourglass-split me-1"></i>Belum dicatat</span>' : ''}
            </button>
            <span class="shop-price">${i.status === 'Sudah dibeli'
              ? `<strong>${formatCompactRupiah(i.actualPrice)}</strong><small class="d-block text-muted">est. ${formatCompactRupiah(i.estimatedPrice)}</small>`
              : `<strong>${formatCompactRupiah(i.estimatedPrice)}</strong><small class="d-block text-muted">estimasi</small>`}
              ${i.recorded ? `<button type="button" class="btn btn-link btn-sm p-0 small" data-trx="${escapeHtml(i.transactionId)}">Lihat transaksi</button>` : ''}</span>
          </li>`).join('')}</ul>`
          : emptyState('bi-cart', group === 'MANDATORY' ? 'Belum ada daftar belanja rutin bulan ini.' : 'Daftar Complementary masih kosong bulan ini.')}
      </div></div>`;

    body.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => { setPref('shoppingGroup', b.dataset.group); load(); }));
    body.querySelector('#add-item')?.addEventListener('click', () => openShoppingForm(null, { group, ...period }));
    const checkout = () => openCheckout(data.items, period, load);
    body.querySelector('#checkout')?.addEventListener('click', checkout);
    body.querySelector('#checkout2')?.addEventListener('click', checkout);
    body.querySelector('#copy-last')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setButtonLoading(btn, true, 'Menyalin…');
      try {
        const res = await api('copyShopping', { ...period, group });
        toast(res.message);
        load();
      } catch (err) {
        toastError(err);
        setButtonLoading(btn, false);
      }
    });
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
      openShoppingForm(data.items.find((i) => i.id === b.dataset.edit))));
    body.querySelectorAll('[data-trx]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const { data: list } = await api('getTransactions', { id: b.dataset.trx });
        if (list[0]) openTransactionDetail(list[0]);
        else toast('Transaksi tidak ditemukan.', 'warning');
      } catch (err) {
        toastError(err);
      }
    }));
    body.querySelectorAll('[data-toggle]').forEach((check) => check.addEventListener('change', async () => {
      check.disabled = true;
      try {
        const res = await api('updateShopping', { id: check.dataset.toggle, statusOnly: true, status: check.checked ? 'Sudah dibeli' : 'Belum dibeli' });
        toast(check.checked ? `✅ ${res.data.item} sudah dibeli — jangan lupa Catat ke Keuangan` : `${res.data.item} ditandai belum dibeli`, check.checked ? 'success' : 'info');
        load();
      } catch (err) {
        toastError(err);
        check.checked = !check.checked;
        check.disabled = false;
      }
    }));
  }
  await load();
}

/**
 * "Selesai Belanja / Catat ke Keuangan": pilih barang dalam satu struk, sesuaikan harga,
 * pilih dibayar pakai apa → tersimpan sebagai satu transaksi Pengeluaran.
 */
async function openCheckout(allItems, period, onDone) {
  if (!canWrite()) return;
  const master = getMaster() || await loadMaster();
  const candidates = allItems.filter((i) => !i.recorded)
    .sort((a, b) => (a.status === b.status ? a.item.localeCompare(b.item) : a.status === 'Sudah dibeli' ? -1 : 1));
  if (!candidates.length) return toast('Semua barang bulan ini sudah tercatat di Keuangan.', 'info');
  const accounts = master.accounts.filter((a) => a.active);
  const cards = master.cards.filter((c) => c.active);
  const lastSource = getPref('shoppingSource', accounts.find((a) => a.type === 'Tunai')?.id || accounts[0]?.id);
  const shopCategory = master.settings.SHOPPING_BUDGET_CATEGORY || 'Belanja Bahan Makanan';
  const categories = master.categories.filter((c) => c.type === 'Pengeluaran' && c.active);
  const today = todayISO();
  const inPeriod = today.slice(0, 7) === `${period.year}-${String(period.month).padStart(2, '0')}`;
  const defaultDate = inPeriod ? today : `${period.year}-${String(period.month).padStart(2, '0')}-${String(daysInMonth(period.year, period.month)).padStart(2, '0')}`;
  const opt = (id, label) => `<option value="${id}" ${id === lastSource ? 'selected' : ''}>${label}</option>`;

  const modal = openModal({
    title: 'Catat belanja ke Keuangan',
    size: 'modal-lg',
    body: `<form id="co-form" novalidate>
      <p class="small text-muted mb-2">Centang barang yang ada di satu struk/nota. Harga bisa disesuaikan dengan struk.</p>
      <ul class="checkout-list mb-3">${candidates.map((i) => `
        <li><label class="d-flex align-items-center gap-2 flex-grow-1 min-w-0 mb-0">
          <input type="checkbox" class="form-check-input mt-0" data-co="${i.id}" ${i.status === 'Sudah dibeli' ? 'checked' : ''}>
          <span class="min-w-0"><span class="d-block text-truncate fw-semibold">${escapeHtml(i.item)}</span>
            <small class="text-muted">${formatNumber(i.quantity)} ${escapeHtml(i.unit)} · ${i.status === 'Sudah dibeli' ? 'sudah dibeli' : 'belum dicentang'}</small></span></label>
          <div class="input-group input-group-sm co-price"><span class="input-group-text">Rp</span>
            <input class="form-control text-end" inputmode="numeric" data-price="${i.id}" value="${i.actualPrice || i.estimatedPrice || ''}" aria-label="Harga ${escapeHtml(i.item)}"></div></li>`).join('')}
      </ul>
      <div class="checkout-total mb-3"><span>Total struk</span><strong id="co-total">Rp0</strong></div>
      <div class="row g-3">
        <div class="col-12 col-md-6"><label class="form-label" for="co-source">Dibayar pakai</label>
          <select id="co-source" name="source" class="form-select">
            <optgroup label="Tunai">${accounts.filter((a) => a.type === 'Tunai').map((a) => opt(a.id, `${escapeHtml(a.name)} · ${formatRupiah(a.balance)}`)).join('')}</optgroup>
            <optgroup label="Rekening bank / debit / QRIS">${accounts.filter((a) => a.type === 'Bank').map((a) => opt(a.id, `${escapeHtml(a.name)} · ${formatRupiah(a.balance)}`)).join('')}</optgroup>
            <optgroup label="Kartu kredit">${cards.map((c) => opt(c.id, `${escapeHtml(c.name)} · limit ${formatCompactRupiah(c.availableLimit)}`)).join('')}</optgroup>
          </select><div class="form-text" id="co-source-info"></div></div>
        <div class="col-6 col-md-3"><label class="form-label" for="co-date">Tanggal struk</label>
          <input id="co-date" name="date" type="date" class="form-control" value="${defaultDate}"></div>
        <div class="col-6 col-md-3"><label class="form-label" for="co-method">Metode</label>
          <select id="co-method" name="method" class="form-select"></select></div>
        <div class="col-12 col-md-6"><label class="form-label" for="co-cat">Kategori anggaran</label>
          <select id="co-cat" name="category" class="form-select">${categories.map((c) => `<option ${c.name === shopCategory ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
        <div class="col-12 col-md-6"><label class="form-label" for="co-desc">Keterangan / nama toko <span class="text-muted">(opsional)</span></label>
          <input id="co-desc" name="description" class="form-control" maxlength="200" placeholder="Contoh: Belanja bulanan di Superindo"></div>
      </div>
      <div class="small text-muted mt-3"><i class="bi bi-info-circle me-1"></i>Tersimpan sebagai <strong>1 transaksi Pengeluaran</strong> di Jurnal. Jika dibayar dengan kartu kredit,
        nominal masuk tagihan kartu dan dilunasi lewat Bayar Kartu (tidak dihitung pengeluaran dua kali).</div>
    </form>`,
    footer: '<button class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary" id="co-save"><i class="bi bi-check2 me-1"></i>Simpan transaksi</button>'
  });
  const form = modal.el.querySelector('#co-form');
  const f = form.elements;
  form.querySelectorAll('[data-price]').forEach((input) => attachAmountInput(input));
  const selected = () => [...form.querySelectorAll('[data-co]:checked')].map((c) => c.dataset.co);
  const priceOf = (id) => parseAmount(form.querySelector(`[data-price="${id}"]`).value);
  const total = () => selected().reduce((t, id) => t + priceOf(id), 0);
  const refresh = () => {
    form.querySelector('#co-total').textContent = `${formatRupiah(total())} · ${selected().length} barang`;
    const id = f.source.value;
    const acc = accounts.find((a) => a.id === id);
    const card = cards.find((c) => c.id === id);
    const info = form.querySelector('#co-source-info');
    info.className = 'form-text';
    if (acc) info.innerHTML = `Saldo ${formatRupiah(acc.balance)}`;
    if (card) info.innerHTML = `Limit tersedia ${formatRupiah(card.availableLimit)} · masuk tagihan kartu`;
    if ((acc && total() > acc.balance) || (card && total() > card.availableLimit)) {
      info.className = 'form-text text-danger';
      info.innerHTML += ' — tidak cukup';
    }
    const methods = card ? ['Kartu Kredit'] : acc?.type === 'Tunai' ? ['Tunai'] : ['Kartu Debit', 'QRIS', 'Transfer', 'E-Wallet'];
    const current = f.method.value;
    f.method.innerHTML = methods.map((m) => `<option ${m === current ? 'selected' : ''}>${m}</option>`).join('');
    f.method.disabled = methods.length === 1;
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();

  const requestId = uid();
  modal.el.querySelector('#co-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ids = selected();
    if (!ids.length) return toast('Centang minimal satu barang.', 'warning');
    const zero = ids.find((id) => !(priceOf(id) > 0));
    if (zero) return toast(`Isi harga "${candidates.find((i) => i.id === zero).item}".`, 'warning');
    if (!isValidISODate(f.date.value)) return toast('Tanggal struk tidak valid.', 'warning');
    setButtonLoading(btn, true);
    try {
      const prices = Object.fromEntries(ids.map((id) => [id, priceOf(id)]));
      const res = await api('checkoutShopping', { ids, prices, sourceAccount: f.source.value, date: f.date.value, category: f.category.value,
        description: f.description.value.trim(), paymentMethod: f.method.value, requestId });
      setPref('shoppingSource', f.source.value);
      toast(res.message);
      modal.close();
      await loadMaster(true);
      onDone();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });
}

export function openShoppingForm(item = null, preset = {}) {
  if (!canWrite()) return toast('Akun Viewer hanya dapat melihat data.', 'warning');
  const period = item ? { month: item.month, year: item.year } : { ...activePeriod(), ...preset };
  const i = item || { group: preset.group || activeGroup(), item: '', category: 'Bahan Pokok', quantity: 1, unit: 'pcs', estimatedPrice: '', actualPrice: '', status: 'Belum dibeli', notes: '' };
  const modal = openModal({
    title: item ? 'Ubah item belanja' : `Tambah belanja · ${monthLabel(period.month, period.year)}`,
    body: `<form id="shop-form" novalidate><div class="row g-3">
      ${item?.recorded ? `<div class="col-12"><div class="alert alert-success small mb-0"><i class="bi bi-lock me-1"></i>Sudah tercatat di Keuangan
        (${escapeHtml(item.transactionId)}, ${formatDateShort(item.purchaseDate)}). Harga & status dikunci agar sama dengan Jurnal —
        hapus transaksinya bila ingin mengubah.</div></div>` : ''}
      <div class="col-12"><div class="segmented w-100">${['MANDATORY', 'COMPLEMENTARY'].map((g) => `
        <input type="radio" class="btn-check" name="group" id="g-${g}" value="${g}" ${i.group === g ? 'checked' : ''}>
        <label class="segmented-btn flex-fill text-center" for="g-${g}">${GROUP_LABEL[g]}</label>`).join('')}</div></div>
      <div class="col-12"><label class="form-label">Nama barang</label><input name="item" class="form-control" maxlength="80" required value="${escapeHtml(i.item)}" placeholder="Contoh: Beras"></div>
      <div class="col-6"><label class="form-label">Kategori</label><input name="category" class="form-control" list="shop-cats" value="${escapeHtml(i.category)}">
        <datalist id="shop-cats">${CATEGORIES.map((c) => `<option value="${c}">`).join('')}</datalist></div>
      <div class="col-3"><label class="form-label">Jumlah</label><input name="quantity" type="number" min="0.01" step="0.01" class="form-control" value="${i.quantity}"></div>
      <div class="col-3"><label class="form-label">Satuan</label><input name="unit" class="form-control" list="shop-units" value="${escapeHtml(i.unit)}">
        <datalist id="shop-units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist></div>
      <div class="col-6"><label class="form-label">Estimasi harga (total)</label><div class="input-group"><span class="input-group-text">Rp</span>
        <input name="estimatedPrice" class="form-control" inputmode="numeric" value="${i.estimatedPrice || ''}"></div></div>
      <div class="col-6"><label class="form-label">Harga aktual</label><div class="input-group"><span class="input-group-text">Rp</span>
        <input name="actualPrice" class="form-control" inputmode="numeric" value="${i.actualPrice || ''}"></div></div>
      <div class="col-12"><label class="form-label">Status</label><select name="status" class="form-select">
        ${['Belum dibeli', 'Sudah dibeli'].map((s) => `<option ${s === i.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label">Catatan</label><input name="notes" class="form-control" maxlength="200" value="${escapeHtml(i.notes)}" placeholder="Merek, toko, dll."></div>
    </div></form>`,
    footer: `${item && !item.recorded ? '<button class="btn btn-outline-danger me-auto" id="shop-delete"><i class="bi bi-trash me-1"></i>Hapus</button>' : ''}
      <button class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary" id="shop-save">Simpan</button>`
  });
  const form = modal.el.querySelector('#shop-form');
  const f = form.elements;
  const itemInput = form.querySelector('[name="item"]'); // elements.item adalah method bawaan, jadi ambil langsung
  attachAmountInput(f.estimatedPrice);
  attachAmountInput(f.actualPrice);
  f.actualPrice.addEventListener('input', () => { if (parseAmount(f.actualPrice.value) > 0) f.status.value = 'Sudah dibeli'; });
  if (item?.recorded) {
    f.actualPrice.disabled = true;
    f.status.disabled = true;
  }

  modal.el.querySelector('#shop-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!itemInput.value.trim()) return toast('Nama barang wajib diisi.', 'warning');
    if (!(Number(f.quantity.value) > 0)) return toast('Jumlah harus lebih dari 0.', 'warning');
    setButtonLoading(btn, true);
    try {
      const payload = { id: item?.id, ...period, group: form.querySelector('input[name="group"]:checked').value, item: itemInput.value,
        category: f.category.value, quantity: f.quantity.value, unit: f.unit.value, estimatedPrice: parseAmount(f.estimatedPrice.value),
        actualPrice: parseAmount(f.actualPrice.value), status: f.status.value, notes: f.notes.value };
      const res = await api(item ? 'updateShopping' : 'addShopping', payload);
      toast(res.message);
      modal.close();
      refreshApp();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });
  modal.el.querySelector('#shop-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Hapus item?', message: `"${item.item}" akan dihapus dari daftar belanja.`, confirmText: 'Hapus', danger: true });
    if (!ok) return;
    try {
      const res = await api('deleteShopping', { id: item.id });
      toast(res.message);
      modal.close();
      refreshApp();
    } catch (err) {
      toastError(err);
    }
  });
}
