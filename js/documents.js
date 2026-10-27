/**
 * documents.js — Dokumen Keluarga. Aplikasi hanya menyimpan metadata + link Google Drive,
 * bukan file dokumen asli.
 */
import { api, canWrite } from './api.js';
import { escapeHtml, formatDate, getPref, setPref, isValidISODate } from './utils.js';
import { toast, toastError, openModal, confirmDialog, setButtonLoading, emptyState, skeleton } from './ui.js';
import { refreshApp } from './finance.js';

const OWNER_TYPES = {
  'Kartu Keluarga': ['Kartu Keluarga'],
  Bapak: ['KTP', 'SIM', 'NPWP', 'Paspor', 'BPJS'],
  Ibu: ['KTP', 'SIM', 'NPWP', 'Paspor', 'BPJS'],
  Anak: ['Akta kelahiran', 'KIA', 'Paspor', 'BPJS', 'Dokumen sekolah']
};
const OWNER_ICON = { 'Kartu Keluarga': 'bi-people-fill', Bapak: 'bi-person-fill', Ibu: 'bi-person-heart', Anak: 'bi-emoji-smile-fill' };
const LEVEL_TONE = { expired: 'danger', urgent: 'warning', warning: 'info', ok: 'success', none: 'secondary' };

function maskNumber(number) {
  const text = String(number || '');
  if (text.length <= 4) return text || '-';
  return '•'.repeat(Math.min(8, text.length - 4)) + text.slice(-4);
}

function expiryText(d) {
  if (d.expiryLevel === 'none') return 'Berlaku seumur hidup';
  if (d.expiryLevel === 'expired') return `Kedaluwarsa ${Math.abs(d.daysLeft)} hari lalu`;
  return `Berlaku s.d. ${formatDate(d.expiryDate)} · ${d.daysLeft} hari lagi`;
}

export async function renderDocuments(container) {
  container.innerHTML = skeleton(4);
  const { data } = await api('getDocuments');
  const ownerFilter = getPref('documentOwner', '');
  const owners = [...new Set(['Kartu Keluarga', 'Bapak', 'Ibu', 'Anak', ...data.map((d) => d.owner)])];
  const list = ownerFilter ? data.filter((d) => d.owner === ownerFilter) : data;
  const count = (level) => data.filter((d) => d.expiryLevel === level).length;
  const grouped = list.reduce((map, d) => { (map[d.owner] ||= []).push(d); return map; }, {});

  container.innerHTML = `
    <div class="alert alert-secondary d-flex gap-2 small mb-3" role="note">
      <i class="bi bi-shield-lock fs-5"></i>
      <div>Demi keamanan, <strong>file KTP/KK/paspor tidak disimpan di aplikasi maupun GitHub</strong>.
        Simpan file di Google Drive pribadi (akses terbatas), lalu tempel link-nya di sini. Nomor dokumen disamarkan di tampilan.</div>
    </div>
    <div class="row g-2 mb-3">
      <div class="col-4"><div class="expiry-summary tone-danger"><strong>${count('expired')}</strong><span>Expired</span></div></div>
      <div class="col-4"><div class="expiry-summary tone-warning"><strong>${count('urgent')}</strong><span>Segera diperpanjang</span></div></div>
      <div class="col-4"><div class="expiry-summary tone-info"><strong>${count('warning')}</strong><span>Perhatian</span></div></div>
    </div>
    <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
      <div class="chip-row">${['', ...owners].map((o) => `
        <button class="chip ${o === ownerFilter ? 'active' : ''}" data-owner="${escapeHtml(o)}">${o ? escapeHtml(o) : 'Semua'}</button>`).join('')}</div>
      ${canWrite() ? '<button class="btn btn-primary btn-sm" id="add-doc"><i class="bi bi-plus-lg me-1"></i>Dokumen</button>' : ''}
    </div>
    ${Object.keys(grouped).length ? Object.entries(grouped).map(([owner, docs]) => `
      <h2 class="section-title mt-2 mb-2"><i class="bi ${OWNER_ICON[owner] || 'bi-person'}"></i>${escapeHtml(owner)} <span class="count-pill">${docs.length}</span></h2>
      <div class="row g-3 mb-3">${docs.map((d) => `
        <div class="col-md-6 col-xl-4"><div class="card app-card doc-card h-100"><div class="card-body">
          <div class="d-flex gap-3 align-items-start">
            <div class="icon-circle icon-${LEVEL_TONE[d.expiryLevel]}"><i class="bi bi-file-earmark-person"></i></div>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-bold text-truncate">${escapeHtml(d.documentName)}</div>
              <div class="small text-muted">${escapeHtml(d.documentType)}</div>
            </div>
            <span class="badge-soft badge-soft-${LEVEL_TONE[d.expiryLevel]}">${escapeHtml(d.expiryStatus)}</span>
          </div>
          <dl class="mini-dl mt-3 mb-2">
            <dt>Nomor</dt><dd><span class="doc-number" data-full="${escapeHtml(d.documentNumber)}" data-masked="${escapeHtml(maskNumber(d.documentNumber))}">${escapeHtml(maskNumber(d.documentNumber))}</span>
              ${d.documentNumber ? `<button class="btn btn-link btn-sm p-0 ms-1" data-reveal aria-label="Tampilkan nomor"><i class="bi bi-eye"></i></button>` : ''}</dd>
            <dt>Terbit</dt><dd>${formatDate(d.issueDate)}</dd>
            <dt>Masa berlaku</dt><dd class="${d.expiryLevel === 'expired' ? 'text-danger' : ''}">${d.expiryDate ? formatDate(d.expiryDate) : 'Seumur hidup'}</dd>
          </dl>
          <div class="small text-muted mb-2">${escapeHtml(expiryText(d))}</div>
          ${d.notes ? `<div class="small mb-2">${escapeHtml(d.notes)}</div>` : ''}
          <div class="d-flex gap-2">
            ${d.driveUrl ? `<a class="btn btn-sm btn-outline-primary flex-grow-1" href="${escapeHtml(d.driveUrl)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-google me-1"></i>Buka di Drive</a>`
              : '<span class="btn btn-sm btn-outline-secondary flex-grow-1 disabled">Belum ada link</span>'}
            ${canWrite() ? `<button class="btn btn-sm btn-outline-secondary" data-edit="${d.id}" aria-label="Ubah"><i class="bi bi-pencil"></i></button>` : ''}
          </div>
        </div></div></div>`).join('')}
      </div>`).join('') : emptyState('bi-folder2-open', 'Belum ada dokumen yang dicatat.')}`;

  container.querySelectorAll('[data-owner]').forEach((b) => b.addEventListener('click', () => { setPref('documentOwner', b.dataset.owner); renderDocuments(container); }));
  container.querySelector('#add-doc')?.addEventListener('click', () => openDocumentForm(null, { owner: ownerFilter }));
  container.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openDocumentForm(data.find((d) => d.id === b.dataset.edit))));
  container.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const span = b.previousElementSibling;
    const showing = span.textContent === span.dataset.full;
    span.textContent = showing ? span.dataset.masked : span.dataset.full;
    b.innerHTML = `<i class="bi ${showing ? 'bi-eye' : 'bi-eye-slash'}"></i>`;
  }));
}

export function openDocumentForm(doc = null, preset = {}) {
  if (!canWrite()) return toast('Akun Viewer hanya dapat melihat data.', 'warning');
  const d = doc || { owner: preset.owner || 'Bapak', documentType: '', documentName: '', documentNumber: '', issueDate: '', expiryDate: '', driveUrl: '', notes: '' };
  const modal = openModal({
    title: doc ? 'Ubah dokumen' : 'Catat dokumen keluarga',
    body: `<form id="doc-form" novalidate><div class="row g-3">
      <div class="col-6"><label class="form-label">Pemilik</label><input name="owner" class="form-control" list="doc-owners" maxlength="40" value="${escapeHtml(d.owner)}">
        <datalist id="doc-owners">${[...Object.keys(OWNER_TYPES), 'Anak 1', 'Anak 2'].map((o) => `<option value="${o}">`).join('')}</datalist></div>
      <div class="col-6"><label class="form-label">Jenis dokumen</label><input name="documentType" class="form-control" list="doc-types" maxlength="40" value="${escapeHtml(d.documentType)}">
        <datalist id="doc-types"></datalist></div>
      <div class="col-12"><label class="form-label">Nama dokumen</label><input name="documentName" class="form-control" maxlength="100" value="${escapeHtml(d.documentName)}" placeholder="Contoh: KTP Bapak"></div>
      <div class="col-12"><label class="form-label">Nomor dokumen</label><input name="documentNumber" class="form-control" maxlength="60" autocomplete="off" value="${escapeHtml(d.documentNumber)}"></div>
      <div class="col-6"><label class="form-label">Tanggal terbit</label><input name="issueDate" type="date" class="form-control" value="${d.issueDate}"></div>
      <div class="col-6"><label class="form-label">Masa berlaku</label><input name="expiryDate" type="date" class="form-control" value="${d.expiryDate}">
        <div class="form-text">Kosongkan jika seumur hidup.</div></div>
      <div class="col-12"><label class="form-label">Link Google Drive</label><input name="driveUrl" type="url" class="form-control" placeholder="https://drive.google.com/…" value="${escapeHtml(d.driveUrl)}">
        <div class="form-text">Pastikan file di Drive <strong>tidak</strong> dibagikan ke "Siapa saja yang memiliki link".</div></div>
      <div class="col-12"><label class="form-label">Catatan</label><textarea name="notes" class="form-control" rows="2" maxlength="300">${escapeHtml(d.notes)}</textarea></div>
    </div></form>`,
    footer: `${doc ? '<button class="btn btn-outline-danger me-auto" id="doc-delete"><i class="bi bi-trash me-1"></i>Hapus</button>' : ''}
      <button class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary" id="doc-save">Simpan</button>`
  });
  const f = modal.el.querySelector('#doc-form').elements;
  const updateTypes = () => {
    const key = f.owner.value.startsWith('Anak') ? 'Anak' : f.owner.value;
    modal.el.querySelector('#doc-types').innerHTML = (OWNER_TYPES[key] || [...new Set(Object.values(OWNER_TYPES).flat())]).map((t) => `<option value="${t}">`).join('');
  };
  const suggestName = () => {
    if (!doc && f.documentType.value && !f.documentName.dataset.touched) {
      f.documentName.value = f.documentType.value === f.owner.value ? f.documentType.value : `${f.documentType.value} ${f.owner.value}`;
    }
  };
  f.owner.addEventListener('input', () => { updateTypes(); suggestName(); });
  f.documentType.addEventListener('input', suggestName);
  f.documentName.addEventListener('input', () => { f.documentName.dataset.touched = '1'; });
  updateTypes();

  modal.el.querySelector('#doc-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!f.owner.value.trim() || !f.documentType.value.trim() || !f.documentName.value.trim()) return toast('Pemilik, jenis, dan nama dokumen wajib diisi.', 'warning');
    if (f.issueDate.value && !isValidISODate(f.issueDate.value)) return toast('Tanggal terbit tidak valid.', 'warning');
    if (f.driveUrl.value && !/^https:\/\//i.test(f.driveUrl.value)) return toast('Link harus diawali https://', 'warning');
    setButtonLoading(btn, true);
    try {
      const res = await api(doc ? 'updateDocument' : 'addDocument', {
        id: doc?.id, owner: f.owner.value, documentType: f.documentType.value, documentName: f.documentName.value,
        documentNumber: f.documentNumber.value, issueDate: f.issueDate.value, expiryDate: f.expiryDate.value, driveUrl: f.driveUrl.value, notes: f.notes.value
      });
      toast(res.message);
      modal.close();
      refreshApp();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });
  modal.el.querySelector('#doc-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Hapus dokumen?', message: `Catatan "${doc.documentName}" akan dihapus (file di Google Drive tidak ikut terhapus).`, confirmText: 'Hapus', danger: true });
    if (!ok) return;
    try {
      const res = await api('deleteDocument', { id: doc.id });
      toast(res.message);
      modal.close();
      refreshApp();
    } catch (err) {
      toastError(err);
    }
  });
}
