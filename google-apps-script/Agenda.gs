/**
 * Agenda.gs — agenda keluarga sekaligus to-do list.
 */

const AGENDA_CATEGORIES = ['Keluarga', 'Sekolah', 'Pekerjaan', 'Keuangan', 'Kesehatan', 'Belanja', 'Lainnya'];
const AGENDA_PRIORITIES = ['Rendah', 'Sedang', 'Tinggi'];
const AGENDA_STATUS = ['Belum', 'Proses', 'Selesai'];

function publicAgenda_(a) {
  return {
    id: a.ID, title: a.Title, date: a.Date, time: a.Time, category: a.Category, owner: a.Owner,
    priority: a.Priority, status: a.Status, description: a.Description
  };
}

function getAgenda(data) {
  data = data || {};
  let rows = readTable_('Agenda');
  if (data.dateFrom) rows = rows.filter(function (a) { return a.Date >= data.dateFrom; });
  if (data.dateTo) rows = rows.filter(function (a) { return a.Date <= data.dateTo; });
  if (data.status) rows = rows.filter(function (a) { return a.Status === data.status; });
  rows.sort(function (a, b) {
    if (a.Date !== b.Date) return a.Date < b.Date ? -1 : 1;
    return String(a.Time).localeCompare(String(b.Time));
  });
  return ok_(rows.map(publicAgenda_));
}

function normalizeAgenda_(data) {
  const time = optionalString_(data.time, 5);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw appError_('Jam tidak valid. Gunakan format 24 jam, contoh 08:30.');
  return {
    Title: requireString_(data.title, 'Judul', 100),
    Date: requireDate_(data.date, 'Tanggal'),
    Time: time,
    Category: requireEnum_(data.category || 'Keluarga', AGENDA_CATEGORIES, 'Kategori'),
    Owner: optionalString_(data.owner, 40),
    Priority: requireEnum_(data.priority || 'Sedang', AGENDA_PRIORITIES, 'Prioritas'),
    Status: requireEnum_(data.status || 'Belum', AGENDA_STATUS, 'Status'),
    Description: optionalString_(data.description, 300)
  };
}

function addAgenda(data) {
  const row = normalizeAgenda_(data);
  row.ID = nextSimpleId_('Agenda', 'AGD', 4);
  insertRow_('Agenda', row);
  return ok_(publicAgenda_(row), 'Agenda berhasil ditambahkan');
}

function updateAgenda(data) {
  const id = requireString_(data.id, 'ID agenda', 30);
  if (!findRow_('Agenda', id)) throw appError_('Agenda tidak ditemukan.', 'NOT_FOUND');
  const patch = data.statusOnly ? { Status: requireEnum_(data.status, AGENDA_STATUS, 'Status') } : normalizeAgenda_(data);
  const updated = updateRow_('Agenda', id, patch);
  return ok_(publicAgenda_(updated), patch.Status === 'Selesai' && data.statusOnly ? 'Tugas ditandai selesai' : 'Agenda berhasil diperbarui');
}

function deleteAgenda(data) {
  const id = requireString_(data.id, 'ID agenda', 30);
  deleteRowById_('Agenda', id);
  return ok_({ id: id }, 'Agenda dihapus');
}
