/**
 * agenda.js — Agenda + To-Do keluarga: daftar tugas, kalender bulanan, dan agenda tanggal terpilih.
 */
import { api, canWrite, getMaster } from './api.js';
import { escapeHtml, todayISO, formatDateLong, formatDateShort, relativeDayLabel, parseISO, toISO, daysInMonth, MONTHS, getPref, setPref, currentPeriod, shiftMonth, isValidISODate } from './utils.js';
import { toast, toastError, openModal, confirmDialog, setButtonLoading, emptyState, skeleton } from './ui.js';
import { refreshApp } from './finance.js';

const CATEGORIES = ['Keluarga', 'Sekolah', 'Pekerjaan', 'Keuangan', 'Kesehatan', 'Belanja', 'Lainnya'];
const PRIORITIES = ['Rendah', 'Sedang', 'Tinggi'];
const STATUSES = ['Belum', 'Proses', 'Selesai'];
const CATEGORY_ICON = {
  Keluarga: 'bi-people', Sekolah: 'bi-backpack', Pekerjaan: 'bi-briefcase', Keuangan: 'bi-cash-coin',
  Kesehatan: 'bi-heart-pulse', Belanja: 'bi-cart', Lainnya: 'bi-three-dots'
};
const PRIORITY_TONE = { Rendah: 'secondary', Sedang: 'info', Tinggi: 'danger' };
const STATUS_TONE = { Belum: 'secondary', Proses: 'warning', Selesai: 'success' };
const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

let selectedDate = todayISO();

function agendaItem(a, { showDate = true } = {}) {
  const overdue = a.status !== 'Selesai' && a.date < todayISO();
  return `<li class="agenda-item ${a.status === 'Selesai' ? 'done' : ''} ${overdue ? 'overdue' : ''}">
    <input type="checkbox" class="form-check-input agenda-check" data-done="${a.id}" ${a.status === 'Selesai' ? 'checked' : ''} ${canWrite() ? '' : 'disabled'}
      aria-label="Tandai ${escapeHtml(a.title)} selesai">
    <button type="button" class="agenda-main" data-edit="${a.id}">
      <span class="agenda-title">${escapeHtml(a.title)}</span>
      <span class="agenda-meta"><i class="bi ${CATEGORY_ICON[a.category] || 'bi-dot'}"></i>${escapeHtml(a.category)}
        ${showDate ? ` · <span class="${overdue ? 'text-danger fw-semibold' : ''}">${formatDateShort(a.date)} (${relativeDayLabel(a.date)})</span>` : ''}
        ${a.time ? ` · ${escapeHtml(a.time)}` : ''}${a.owner ? ` · ${escapeHtml(a.owner)}` : ''}</span>
    </button>
    <span class="d-flex flex-column align-items-end gap-1">
      <span class="badge-soft badge-soft-${PRIORITY_TONE[a.priority]}">${a.priority}</span>
      <span class="badge-soft badge-soft-${STATUS_TONE[a.status]}">${a.status}</span>
    </span>
  </li>`;
}

export async function renderAgenda(container) {
  container.innerHTML = skeleton(4, 'list');
  const { data } = await api('getAgenda');
  const taskFilter = getPref('agendaTaskFilter', 'open');
  const cal = getPref('agendaMonth', currentPeriod());

  const tasks = data.filter((a) => (taskFilter === 'open' ? a.status !== 'Selesai' : taskFilter === 'done' ? a.status === 'Selesai' : true));
  const byDate = data.reduce((map, a) => { (map[a.date] ||= []).push(a); return map; }, {});

  const first = new Date(Date.UTC(cal.year, cal.month - 1, 1)).getUTCDay();
  const offset = (first + 6) % 7;
  const totalDays = daysInMonth(cal.year, cal.month);
  const today = todayISO();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= totalDays; d++) {
    const iso = toISO(cal.year, cal.month, d);
    const items = byDate[iso] || [];
    const dots = items.slice(0, 3).map((a) => `<span class="cal-dot bg-${a.status === 'Selesai' ? 'success' : PRIORITY_TONE[a.priority]}"></span>`).join('');
    cells.push(`<button type="button" class="cal-cell ${iso === today ? 'today' : ''} ${iso === selectedDate ? 'selected' : ''} ${items.length ? 'has-items' : ''}"
      data-date="${iso}" aria-label="${formatDateLong(iso)}${items.length ? `, ${items.length} agenda` : ''}">
      <span class="cal-day">${d}</span><span class="cal-dots">${dots}${items.length > 3 ? '<span class="cal-more">+</span>' : ''}</span></button>`);
  }
  const dayItems = (byDate[selectedDate] || []);

  container.innerHTML = `
    <div class="row g-3">
      <div class="col-lg-5 order-lg-2">
        <div class="card app-card mb-3"><div class="card-body">
          <div class="section-head">
            <h2 class="section-title"><i class="bi bi-check2-square"></i>Tugas <span class="count-pill">${data.filter((a) => a.status !== 'Selesai').length}</span></h2>
            <select class="form-select form-select-sm w-auto" id="task-filter" aria-label="Filter tugas">
              <option value="open" ${taskFilter === 'open' ? 'selected' : ''}>Belum selesai</option>
              <option value="done" ${taskFilter === 'done' ? 'selected' : ''}>Selesai</option>
              <option value="all" ${taskFilter === 'all' ? 'selected' : ''}>Semua</option></select>
          </div>
          ${tasks.length ? `<ul class="agenda-list">${tasks.map((a) => agendaItem(a)).join('')}</ul>` : emptyState('bi-emoji-sunglasses', 'Tidak ada tugas di sini.')}
        </div></div>
      </div>
      <div class="col-lg-7 order-lg-1">
        <div class="card app-card mb-3"><div class="card-body">
          <div class="section-head">
            <h2 class="section-title"><i class="bi bi-calendar3"></i>Kalender</h2>
            <div class="d-flex align-items-center gap-1">
              <button class="btn btn-icon" data-cal="-1" aria-label="Bulan sebelumnya"><i class="bi bi-chevron-left"></i></button>
              <span class="fw-semibold cal-label">${MONTHS[cal.month - 1]} ${cal.year}</span>
              <button class="btn btn-icon" data-cal="1" aria-label="Bulan berikutnya"><i class="bi bi-chevron-right"></i></button>
              <button class="btn btn-sm btn-outline-secondary ms-1" data-cal="0">Hari ini</button>
            </div>
          </div>
          <div class="calendar">${WEEKDAYS.map((w) => `<div class="cal-head">${w}</div>`).join('')}${cells.join('')}</div>
        </div></div>
        <div class="card app-card"><div class="card-body">
          <div class="section-head">
            <h2 class="section-title"><i class="bi bi-calendar-event"></i>${formatDateLong(selectedDate)}</h2>
            ${canWrite() ? '<button class="btn btn-sm btn-primary" id="add-on-date"><i class="bi bi-plus-lg me-1"></i>Agenda</button>' : ''}
          </div>
          ${dayItems.length ? `<ul class="agenda-list">${dayItems.map((a) => agendaItem(a, { showDate: false })).join('')}</ul>` : emptyState('bi-calendar2', 'Tidak ada kegiatan pada tanggal ini.')}
        </div></div>
      </div>
    </div>`;

  const rerender = () => renderAgenda(container);
  container.querySelector('#task-filter').addEventListener('change', (e) => { setPref('agendaTaskFilter', e.target.value); rerender(); });
  container.querySelectorAll('[data-cal]').forEach((b) => b.addEventListener('click', () => {
    const delta = Number(b.dataset.cal);
    const next = delta === 0 ? currentPeriod() : shiftMonth(cal.month, cal.year, delta);
    if (delta === 0) selectedDate = todayISO();
    setPref('agendaMonth', next);
    rerender();
  }));
  container.querySelectorAll('.cal-cell[data-date]').forEach((cell) => cell.addEventListener('click', () => {
    selectedDate = cell.dataset.date;
    rerender();
  }));
  container.querySelector('#add-on-date')?.addEventListener('click', () => openAgendaForm(null, { date: selectedDate }));
  container.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openAgendaForm(data.find((a) => a.id === b.dataset.edit))));
  container.querySelectorAll('[data-done]').forEach((check) => check.addEventListener('change', async () => {
    check.disabled = true;
    try {
      const res = await api('updateAgenda', { id: check.dataset.done, statusOnly: true, status: check.checked ? 'Selesai' : 'Belum' });
      toast(check.checked ? '✅ Tugas ditandai selesai' : res.message);
      rerender();
    } catch (err) {
      toastError(err);
      check.checked = !check.checked;
      check.disabled = false;
    }
  }));
}

export function openAgendaForm(item = null, preset = {}) {
  if (!canWrite()) return toast('Akun Viewer hanya dapat melihat data.', 'warning');
  const a = item || { title: '', date: preset.date || selectedDate || todayISO(), time: '', category: 'Keluarga', owner: '', priority: 'Sedang', status: 'Belum', description: '' };
  const owners = [...new Set(['Bapak', 'Ibu', 'Anak', 'Keluarga', ...(getMaster()?.users || []).map((u) => u.name)])].filter((n) => n !== 'Admin');
  const select = (name, list, value) => `<select name="${name}" class="form-select">${list.map((v) => `<option ${v === value ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const modal = openModal({
    title: item ? 'Ubah agenda' : 'Tambah agenda / tugas',
    body: `<form id="agenda-form" novalidate><div class="row g-3">
      <div class="col-12"><label class="form-label">Judul</label><input name="title" class="form-control" maxlength="100" value="${escapeHtml(a.title)}" placeholder="Contoh: Ambil rapor anak"></div>
      <div class="col-7"><label class="form-label">Tanggal</label><input name="date" type="date" class="form-control" value="${a.date}"></div>
      <div class="col-5"><label class="form-label">Jam</label><input name="time" type="time" class="form-control" value="${escapeHtml(a.time)}"></div>
      <div class="col-6"><label class="form-label">Kategori</label>${select('category', CATEGORIES, a.category)}</div>
      <div class="col-6"><label class="form-label">Penanggung jawab</label><input name="owner" class="form-control" list="agenda-owners" maxlength="40" value="${escapeHtml(a.owner)}">
        <datalist id="agenda-owners">${owners.map((o) => `<option value="${escapeHtml(o)}">`).join('')}</datalist></div>
      <div class="col-6"><label class="form-label">Prioritas</label>${select('priority', PRIORITIES, a.priority)}</div>
      <div class="col-6"><label class="form-label">Status</label>${select('status', STATUSES, a.status)}</div>
      <div class="col-12"><label class="form-label">Keterangan</label><textarea name="description" class="form-control" rows="2" maxlength="300">${escapeHtml(a.description)}</textarea></div>
    </div></form>`,
    footer: `${item ? '<button class="btn btn-outline-danger me-auto" id="agenda-delete"><i class="bi bi-trash me-1"></i>Hapus</button>' : ''}
      <button class="btn btn-light" data-bs-dismiss="modal">Batal</button><button class="btn btn-primary" id="agenda-save">Simpan</button>`
  });
  const f = modal.el.querySelector('#agenda-form').elements;
  modal.el.querySelector('#agenda-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!f.title.value.trim()) return toast('Judul agenda wajib diisi.', 'warning');
    if (!isValidISODate(f.date.value)) return toast('Tanggal tidak valid.', 'warning');
    setButtonLoading(btn, true);
    try {
      const res = await api(item ? 'updateAgenda' : 'addAgenda', {
        id: item?.id, title: f.title.value, date: f.date.value, time: f.time.value, category: f.category.value,
        owner: f.owner.value, priority: f.priority.value, status: f.status.value, description: f.description.value
      });
      toast(res.message);
      selectedDate = f.date.value;
      const p = parseISO(f.date.value);
      setPref('agendaMonth', { month: p.m, year: p.y });
      modal.close();
      refreshApp();
    } catch (err) {
      toastError(err);
      setButtonLoading(btn, false);
    }
  });
  modal.el.querySelector('#agenda-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Hapus agenda?', message: `"${item.title}" akan dihapus.`, confirmText: 'Hapus', danger: true });
    if (!ok) return;
    try {
      const res = await api('deleteAgenda', { id: item.id });
      toast(res.message);
      modal.close();
      refreshApp();
    } catch (err) {
      toastError(err);
    }
  });
}
