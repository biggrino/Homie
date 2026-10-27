/**
 * settings.js — Pengaturan: tampilan, akun & PIN, aturan transfer, pengguna/role, backup, data contoh, koneksi.
 */
import { api, getUser, canWrite, isAdmin, isDemo, getApiUrl, loadMaster, updateSessionUser } from './api.js';
import { escapeHtml, getPref, setPref, todayISO, downloadBlob, formatDate } from './utils.js';
import { toast, toastError, openModal, confirmDialog, setButtonLoading, skeleton, avatar, resizePhoto } from './ui.js';
import { openCategoryManager, openAccountForm, refreshApp } from './finance.js';
import { openCardForm } from './creditcard.js';
import { exportExcel, downloadCurrentMonthReport } from './reports.js';

const APP_VERSION = '2.0.0';

function card(id, icon, title, body) {
  return `<div class="card app-card mb-3" id="${id}"><div class="card-body">
    <h2 class="section-title mb-3"><i class="bi ${icon}"></i>${title}</h2>${body}</div></div>`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function markBackup() {
  if (!canWrite()) return;
  try {
    await api('recordBackup');
  } catch {
    /* pencatatan tanggal backup tidak wajib berhasil */
  }
}

export async function renderSettings(container, sub) {
  container.innerHTML = skeleton(4, 'list');
  const [{ data: settings }, master] = await Promise.all([api('getSettings'), loadMaster()]);
  const user = getUser();
  const theme = getPref('theme', 'auto');
  const lastBackup = settings.LAST_BACKUP ? `${formatDate(settings.LAST_BACKUP.slice(0, 10))} ${settings.LAST_BACKUP.slice(11, 16)} oleh ${escapeHtml(settings.LAST_BACKUP_BY || '-')}` : 'Belum pernah';
  const apiUrl = getApiUrl();

  container.innerHTML = `<div class="row g-3"><div class="col-lg-6">
    ${card('tampilan', 'bi-palette', 'Tampilan', `
      <label class="form-label fw-semibold">Tema</label>
      <div class="segmented w-100 mb-3">${[['light', 'Light Mode', 'bi-sun'], ['dark', 'Dark Mode', 'bi-moon-stars'], ['auto', 'Ikuti sistem', 'bi-circle-half']].map(([v, l, i]) => `
        <input type="radio" class="btn-check" name="theme" id="theme-${v}" value="${v}" ${theme === v ? 'checked' : ''}>
        <label class="segmented-btn flex-fill text-center" for="theme-${v}"><i class="bi ${i} me-1"></i>${l}</label>`).join('')}</div>
      <div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="pref-compact" ${getPref('compactNumbers', true) ? 'checked' : ''}>
        <label class="form-check-label" for="pref-compact">Tampilkan angka ringkas di dashboard (Rp15,4 Jt)</label></div>`)}

    ${card('akun', 'bi-person-circle', 'Akun Saya', `
      <div class="d-flex align-items-center gap-3 mb-3">
        <div class="photo-edit">${avatar(user, 'avatar-xl')}
          <button type="button" class="photo-btn" id="photo-pick" title="Ganti foto" aria-label="Ganti foto profil"><i class="bi bi-camera-fill"></i></button></div>
        <input type="file" id="photo-file" accept="image/*" hidden>
        <div class="min-w-0"><div class="fw-bold fs-5 text-truncate">${escapeHtml(user.name)}</div><div class="small text-muted">Role: ${escapeHtml(user.role)}</div>
          <div class="d-flex flex-wrap gap-2 mt-2">
            <button type="button" class="btn btn-sm btn-outline-primary" id="photo-pick2"><i class="bi bi-image me-1"></i>${user.photo ? 'Ganti foto' : 'Tambah foto'}</button>
            ${user.photo ? '<button type="button" class="btn btn-sm btn-outline-secondary" id="photo-remove">Hapus foto</button>' : ''}</div></div></div>
      <form id="name-form" class="mb-3" novalidate>
        <label class="form-label small fw-semibold" for="my-name">Nama tampilan</label>
        <div class="input-group"><input id="my-name" name="myName" class="form-control" maxlength="40" value="${escapeHtml(user.name)}" autocomplete="name">
          <button class="btn btn-primary" type="submit" id="name-save">Simpan nama</button></div>
      </form>
      <label class="form-label small fw-semibold">Ganti PIN</label>
      <form id="pin-form" class="row g-2" novalidate>
        <div class="col-12 col-sm-4"><input type="password" inputmode="numeric" maxlength="8" class="form-control" name="oldPin" placeholder="PIN lama" autocomplete="current-password"></div>
        <div class="col-6 col-sm-4"><input type="password" inputmode="numeric" maxlength="8" class="form-control" name="newPin" placeholder="PIN baru" autocomplete="new-password"></div>
        <div class="col-6 col-sm-4"><input type="password" inputmode="numeric" maxlength="8" class="form-control" name="confirmPin" placeholder="Ulangi PIN" autocomplete="new-password"></div>
        <div class="col-12 d-flex gap-2"><button class="btn btn-primary btn-sm" type="submit" id="pin-save">Ganti PIN</button>
          <button class="btn btn-outline-danger btn-sm ms-auto" type="button" id="logout-btn"><i class="bi bi-box-arrow-right me-1"></i>Keluar</button></div>
      </form>`)}

    ${card('master', 'bi-bank', 'Rekening, Kartu & Kategori', `
      <ul class="simple-list mb-3">${master.accounts.map((a) => `<li><i class="bi ${a.type === 'Tunai' ? 'bi-cash-stack' : 'bi-bank'} text-muted"></i>
        <span class="flex-grow-1">${escapeHtml(a.name)} <small class="text-muted">${a.type}${a.active ? '' : ' · nonaktif'}</small></span>
        ${canWrite() ? `<button class="btn btn-icon" data-acc="${a.id}" aria-label="Ubah"><i class="bi bi-pencil"></i></button>` : ''}</li>`).join('')}
        ${master.cards.map((c) => `<li><i class="bi bi-credit-card text-muted"></i>
        <span class="flex-grow-1">${escapeHtml(c.name)} <small class="text-muted">Kartu kredit${c.active ? '' : ' · nonaktif'}</small></span>
        ${canWrite() ? `<button class="btn btn-icon" data-card="${c.id}" aria-label="Ubah"><i class="bi bi-pencil"></i></button>` : ''}</li>`).join('')}</ul>
      ${canWrite() ? `<div class="d-flex flex-wrap gap-2">
        <button class="btn btn-sm btn-outline-primary" id="new-acc"><i class="bi bi-plus-lg me-1"></i>Rekening</button>
        <button class="btn btn-sm btn-outline-primary" id="new-card"><i class="bi bi-plus-lg me-1"></i>Kartu kredit</button>
        <button class="btn btn-sm btn-outline-secondary" id="manage-cat"><i class="bi bi-tags me-1"></i>Kelola kategori</button></div>` : ''}`)}
  </div><div class="col-lg-6">
    ${card('backup', 'bi-cloud-arrow-down', 'Backup', `
      <p class="small text-muted">Google Sheets tetap menjadi database utama. Anda juga bisa membuat salinan manual di Google Sheets: <em>File → Buat salinan</em>.</p>
      <div class="d-grid gap-2">
        <button class="btn btn-outline-primary text-start" id="bk-csv"><i class="bi bi-filetype-csv me-2"></i>Export transaksi (CSV)</button>
        <button class="btn btn-outline-success text-start" id="bk-xlsx"><i class="bi bi-file-earmark-excel me-2"></i>Export semua data (Excel)</button>
        <button class="btn btn-outline-danger text-start" id="bk-pdf"><i class="bi bi-file-earmark-pdf me-2"></i>Download laporan bulan ini (PDF)</button>
      </div>
      <div class="small mt-3"><i class="bi bi-clock-history me-1"></i>Backup terakhir: <strong id="last-backup">${lastBackup}</strong></div>`)}

    ${isAdmin() ? card('aturan', 'bi-sliders', 'Aturan Transaksi (Admin)', `
      <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="set-b2b" ${settings.ALLOW_BANK_TO_BANK !== 'FALSE' ? 'checked' : ''}>
        <label class="form-check-label" for="set-b2b">Izinkan transfer antar rekening bank</label></div>
      <div class="form-check form-switch mb-3"><input class="form-check-input" type="checkbox" id="set-cash" ${settings.ALLOW_CASH_TRANSFER === 'TRUE' ? 'checked' : ''}>
        <label class="form-check-label" for="set-cash">Izinkan transfer dari kas tunai (setor tunai / antar dompet)</label></div>
      <label class="form-label small" for="set-billday">Tanggal cicilan kartu kredit ditagihkan setiap bulan</label>
      <div class="input-group input-group-sm mb-1" style="max-width:220px"><span class="input-group-text">Tanggal</span>
        <input type="number" min="1" max="28" class="form-control" id="set-billday" value="${escapeHtml(settings.INSTALLMENT_BILLING_DAY || '16')}"></div>
      <div class="form-text mt-0 mb-3">Berlaku untuk cicilan baru. Cicilan yang sudah ada tetap memakai jadwal lamanya.</div>
      <label class="form-label small">Kategori anggaran untuk budget menu Belanja</label>
      <select class="form-select form-select-sm mb-3" id="set-shopcat">${master.categories.filter((c) => c.type === 'Pengeluaran').map((c) => `
        <option ${c.name === settings.SHOPPING_BUDGET_CATEGORY ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
      <button class="btn btn-primary btn-sm" id="save-rules">Simpan aturan</button>`) : ''}

    ${isAdmin() ? card('pengguna', 'bi-people', 'Kelola Akun Pengguna (Admin)', `
      <p class="small text-muted">Admin dapat mengubah nama, foto, role, status aktif, dan me-reset PIN semua akun.</p>
      <ul class="simple-list mb-3">${(settings.users || []).map((u) => `<li>
        ${avatar(u)}
        <span class="flex-grow-1 min-w-0"><span class="fw-semibold">${escapeHtml(u.name)}</span>${u.id === user.id ? ' <small class="text-primary">(Anda)</small>' : ''}
          <small class="d-block text-muted">${escapeHtml(u.role)}${u.active ? '' : ' · <span class="text-danger">nonaktif</span>'}</small></span>
        <button class="btn btn-sm btn-outline-primary" data-user="${u.id}"><i class="bi bi-pencil me-1"></i>Edit</button></li>`).join('')}</ul>
      <button class="btn btn-sm btn-outline-primary" id="new-user"><i class="bi bi-person-plus me-1"></i>Tambah pengguna</button>
      <p class="small text-muted mt-3 mb-0">Admin: semua fungsi · Bapak/Ibu: lihat & ubah data · Viewer: hanya melihat.</p>`) : ''}

    ${isAdmin() && settings.SAMPLE_COUNT ? card('contoh', 'bi-eraser', 'Data Contoh', `
      <p class="small">Terdapat <strong>${settings.SAMPLE_COUNT}</strong> data contoh (transaksi, anggaran, belanja, agenda, dokumen). Rekening, kartu, dan kategori default tidak ikut dihapus.</p>
      <button class="btn btn-sm btn-outline-danger" id="del-sample"><i class="bi bi-trash me-1"></i>Hapus data contoh</button>`) : ''}

    ${card('koneksi', 'bi-plug', 'Koneksi & Tentang', `
      <dl class="mini-dl mb-3">
        <dt>Mode</dt><dd>${isDemo() ? '<span class="badge text-bg-warning">Demo (data di browser)</span>' : '<span class="badge text-bg-success">Google Sheets</span>'}</dd>
        <dt>API</dt><dd class="text-truncate" style="max-width:220px">${apiUrl ? escapeHtml(apiUrl.replace(/(\/s\/.{6}).+(.{6}\/exec)$/, '$1…$2')) : '-'}</dd>
        <dt>Versi aplikasi</dt><dd>${APP_VERSION}</dd><dt>Versi database</dt><dd>${escapeHtml(settings.DB_VERSION || '-')}</dd>
      </dl>
      <button class="btn btn-sm btn-outline-secondary" id="ping"><i class="bi bi-activity me-1"></i>Tes koneksi</button>`)}
  </div></div>`;

  if (['backup', 'akun', 'pengguna'].includes(sub)) setTimeout(() => container.querySelector('#' + sub)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

  // ---- Akun Saya: foto & nama
  const saveProfile = async (patch, btn, message) => {
    if (btn) setButtonLoading(btn, true);
    try {
      const res = await api('updateProfile', patch);
      updateSessionUser(res.data);
      window.dispatchEvent(new Event('app:user'));
      toast(message || res.message);
      renderSettings(container, 'akun');
    } catch (err) {
      toastError(err);
      if (btn) setButtonLoading(btn, false);
    }
  };
  const fileInput = container.querySelector('#photo-file');
  const pick = () => fileInput.click();
  container.querySelector('#photo-pick').addEventListener('click', pick);
  container.querySelector('#photo-pick2').addEventListener('click', pick);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const photo = await resizePhoto(file);
      await saveProfile({ photo }, container.querySelector('#photo-pick2'), 'Foto profil diperbarui');
    } catch (err) {
      toastError(err);
    }
  });
  container.querySelector('#photo-remove')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ok = await confirmDialog({ title: 'Hapus foto profil?', message: 'Avatar akan kembali menampilkan huruf depan nama Anda.', confirmText: 'Hapus foto', danger: true });
    if (ok) saveProfile({ photo: '' }, btn, 'Foto profil dihapus');
  });
  container.querySelector('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.elements.myName.value.trim();
    if (!name) return toast('Nama wajib diisi.', 'warning');
    if (name === user.name) return toast('Nama tidak berubah.', 'info');
    saveProfile({ name }, container.querySelector('#name-save'), 'Nama berhasil diubah');
  });

  container.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => {
    setPref('theme', r.value);
    window.dispatchEvent(new CustomEvent('app:theme', { detail: r.value }));
  }));
  container.querySelector('#pref-compact').addEventListener('change', (e) => { setPref('compactNumbers', e.target.checked); toast('Preferensi tampilan disimpan'); });
  container.querySelector('#logout-btn').addEventListener('click', () => window.dispatchEvent(new Event('app:logout')));

  container.querySelector('#pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (!/^\d{4,8}$/.test(f.newPin.value)) return toast('PIN baru harus 4–8 digit angka.', 'warning');
    if (f.newPin.value !== f.confirmPin.value) return toast('Konfirmasi PIN tidak sama.', 'warning');
    const btn = container.querySelector('#pin-save');
    setButtonLoading(btn, true);
    try {
      const res = await api('changePin', { oldPin: f.oldPin.value, newPin: f.newPin.value });
      toast(res.message);
      e.target.reset();
    } catch (err) {
      toastError(err);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  container.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => openAccountForm(master.accounts.find((a) => a.id === b.dataset.acc))));
  container.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => openCardForm(master.cards.find((c) => c.id === b.dataset.card))));
  container.querySelector('#new-acc')?.addEventListener('click', () => openAccountForm());
  container.querySelector('#new-card')?.addEventListener('click', () => openCardForm());
  container.querySelector('#manage-cat')?.addEventListener('click', () => openCategoryManager(refreshApp));

  container.querySelector('#bk-csv').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true, 'Menyiapkan…');
    try {
      const { data } = await api('getTransactions');
      const headers = ['ID', 'Tanggal', 'Jenis', 'Sumber', 'Tujuan', 'Kategori', 'Subkategori', 'Nominal', 'Keterangan', 'Metode', 'Dibuat oleh', 'Dibuat', 'Diperbarui'];
      const lines = data.map((t) => [t.id, t.date, t.type, t.sourceName, t.destinationName, t.category, t.subCategory, t.amount, t.description,
        t.paymentMethod, t.createdBy, t.createdAt, t.updatedAt].map(csvEscape).join(','));
      downloadBlob(new Blob(['﻿' + [headers.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }), `transaksi-${todayISO()}.csv`);
      await markBackup();
      toast(`${data.length} transaksi diexport ke CSV`);
      refreshApp();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });
  container.querySelector('#bk-xlsx').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true, 'Menyiapkan…');
    try {
      const { data } = await api('exportAll');
      await exportExcel(Object.entries(data.tables).map(([name, rows]) => ({ name, rows })), `backup-homie-${todayISO()}.xlsx`);
      await markBackup();
      toast('Backup Excel berhasil dibuat');
      refreshApp();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });
  container.querySelector('#bk-pdf').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true, 'Menyiapkan…');
    try {
      await downloadCurrentMonthReport();
      await markBackup();
      toast('Laporan PDF berhasil diunduh');
      refreshApp();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });

  container.querySelector('#save-rules')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    try {
      const res = await api('updateSettings', {
        ALLOW_BANK_TO_BANK: container.querySelector('#set-b2b').checked,
        ALLOW_CASH_TRANSFER: container.querySelector('#set-cash').checked,
        SHOPPING_BUDGET_CATEGORY: container.querySelector('#set-shopcat').value,
        INSTALLMENT_BILLING_DAY: container.querySelector('#set-billday').value
      });
      toast(res.message);
      await loadMaster(true);
    } catch (err) {
      toastError(err);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  const openUserForm = (u = null) => {
    let photo = u?.photo || '';
    const isSelf = u?.id === user.id;
    const modal = openModal({
      title: u ? `Edit akun ${escapeHtml(u.name)}` : 'Tambah pengguna',
      fullscreenMobile: false,
      body: `<form id="user-form" novalidate><div class="row g-3">
        <div class="col-12 d-flex align-items-center gap-3">
          <span id="user-photo-preview">${avatar({ name: u?.name || '?', photo }, 'avatar-lg')}</span>
          <input type="file" id="user-photo-file" accept="image/*" hidden>
          <div class="d-flex flex-wrap gap-2"><button type="button" class="btn btn-sm btn-outline-primary" id="user-photo-pick"><i class="bi bi-image me-1"></i>Pilih foto</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="user-photo-clear">Tanpa foto</button></div></div>
        <div class="col-12"><label class="form-label">Nama</label><input name="userName" class="form-control" maxlength="40" value="${escapeHtml(u?.name || '')}"></div>
        <div class="col-6"><label class="form-label">Role</label><select name="role" class="form-select">${['Admin', 'Bapak', 'Ibu', 'Viewer'].map((r) => `<option ${r === u?.role ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div class="col-6"><label class="form-label">${u ? 'Reset PIN (opsional)' : 'PIN awal'}</label><input name="pin" type="password" inputmode="numeric" maxlength="8" class="form-control" autocomplete="new-password" placeholder="${u ? 'Kosongkan jika tetap' : '4–8 digit'}"></div>
        <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="user-active" ${u?.active === false ? '' : 'checked'} ${isSelf ? 'disabled' : ''}>
          <label class="form-check-label" for="user-active">Akun aktif${isSelf ? ' (akun Anda sendiri tidak bisa dinonaktifkan)' : ''}</label></div></div>
        ${u?.updatedAt ? `<div class="col-12 small text-muted">Terakhir diubah ${escapeHtml(formatDate(u.updatedAt.slice(0, 10)))} ${escapeHtml(u.updatedAt.slice(11, 16))}</div>` : ''}
      </div></form>`,
      footer: '<button class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary" id="user-save">Simpan</button>'
    });
    const f = modal.el.querySelector('#user-form').elements;
    const preview = () => { modal.el.querySelector('#user-photo-preview').innerHTML = avatar({ name: f.userName.value || '?', photo }, 'avatar-lg'); };
    const file = modal.el.querySelector('#user-photo-file');
    modal.el.querySelector('#user-photo-pick').addEventListener('click', () => file.click());
    modal.el.querySelector('#user-photo-clear').addEventListener('click', () => { photo = ''; preview(); });
    f.userName.addEventListener('input', preview);
    file.addEventListener('change', async () => {
      const chosen = file.files[0];
      file.value = '';
      if (!chosen) return;
      try {
        photo = await resizePhoto(chosen);
        preview();
      } catch (err) {
        toastError(err);
      }
    });
    modal.el.querySelector('#user-save').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (!f.userName.value.trim()) return toast('Nama wajib diisi.', 'warning');
      if ((!u || f.pin.value) && !/^\d{4,8}$/.test(f.pin.value)) return toast('PIN harus 4–8 digit angka.', 'warning');
      setButtonLoading(btn, true);
      try {
        const res = await api('saveUser', { id: u?.id, name: f.userName.value, role: f.role.value, pin: f.pin.value, active: isSelf ? true : f.active.checked, photo });
        toast(res.message);
        modal.close();
        if (isSelf) await loadMaster(true).then(() => window.dispatchEvent(new Event('app:user')));
        renderSettings(container, 'pengguna');
      } catch (err) {
        toastError(err);
        setButtonLoading(btn, false);
      }
    });
  };
  container.querySelector('#new-user')?.addEventListener('click', () => openUserForm());
  container.querySelectorAll('[data-user]').forEach((b) => b.addEventListener('click', () => openUserForm(settings.users.find((u) => u.id === b.dataset.user))));

  container.querySelector('#del-sample')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ok = await confirmDialog({ title: 'Hapus data contoh?', message: 'Semua data contoh akan dihapus permanen dari Google Sheets. Data yang Anda buat sendiri tidak ikut terhapus.', confirmText: 'Hapus', danger: true });
    if (!ok) return;
    setButtonLoading(btn, true, 'Menghapus…');
    try {
      const res = await api('deleteSampleData');
      toast(res.message);
      await loadMaster(true);
      refreshApp();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });

  container.querySelector('#ping').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true, 'Menghubungi…');
    const start = performance.now();
    try {
      await api('ping');
      toast(`Terhubung ke database (${Math.round(performance.now() - start)} ms)`);
    } catch (err) {
      toastError(err);
    } finally {
      setButtonLoading(btn, false);
    }
  });
}
