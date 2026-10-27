/**
 * Documents.gs — metadata dokumen keluarga. File asli TIDAK disimpan di sini;
 * cukup link Google Drive (atau penyimpanan pribadi lain).
 */

function documentExpiry_(expiryDate, today) {
  if (!expiryDate) return { status: 'Seumur hidup', level: 'none', daysLeft: null };
  const days = daysBetween_(today, expiryDate);
  if (days < 0) return { status: 'Expired', level: 'expired', daysLeft: days };
  if (days <= 30) return { status: 'Segera diperpanjang', level: 'urgent', daysLeft: days };
  if (days <= 90) return { status: 'Perhatian', level: 'warning', daysLeft: days };
  return { status: 'Aman', level: 'ok', daysLeft: days };
}

function publicDocument_(d, today) {
  const expiry = documentExpiry_(d.ExpiryDate, today || todayStr_());
  return {
    id: d.ID, owner: d.Owner, documentType: d.DocumentType, documentName: d.DocumentName,
    documentNumber: d.DocumentNumber, issueDate: d.IssueDate, expiryDate: d.ExpiryDate, driveUrl: d.DriveURL,
    notes: d.Notes, expiryStatus: expiry.status, expiryLevel: expiry.level, daysLeft: expiry.daysLeft
  };
}

function getDocuments(data) {
  const today = todayStr_();
  let rows = readTable_('FamilyDocuments');
  if (data && data.owner) rows = rows.filter(function (d) { return d.Owner === data.owner; });
  const order = ['Kartu Keluarga', 'Bapak', 'Ibu'];
  rows.sort(function (a, b) {
    const oa = order.indexOf(a.Owner) === -1 ? 9 : order.indexOf(a.Owner);
    const ob = order.indexOf(b.Owner) === -1 ? 9 : order.indexOf(b.Owner);
    if (oa !== ob) return oa - ob;
    if (a.Owner !== b.Owner) return a.Owner.localeCompare(b.Owner);
    return a.DocumentName.localeCompare(b.DocumentName);
  });
  return ok_(rows.map(function (d) { return publicDocument_(d, today); }));
}

function normalizeDocument_(data) {
  const url = optionalString_(data.driveUrl, 500);
  if (url && !/^https:\/\//i.test(url)) throw appError_('Link dokumen harus diawali https:// (contoh: link Google Drive).');
  const issue = optionalDate_(data.issueDate, 'Tanggal terbit');
  const expiry = optionalDate_(data.expiryDate, 'Masa berlaku');
  if (issue && expiry && expiry < issue) throw appError_('Masa berlaku tidak boleh lebih awal dari tanggal terbit.');
  return {
    Owner: requireString_(data.owner, 'Pemilik', 40),
    DocumentType: requireString_(data.documentType, 'Jenis dokumen', 40),
    DocumentName: requireString_(data.documentName, 'Nama dokumen', 100),
    DocumentNumber: optionalString_(data.documentNumber, 60),
    IssueDate: issue,
    ExpiryDate: expiry,
    DriveURL: url,
    Notes: optionalString_(data.notes, 300)
  };
}

function addDocument(data) {
  const row = normalizeDocument_(data);
  row.ID = nextSimpleId_('FamilyDocuments', 'DOC', 4);
  insertRow_('FamilyDocuments', row);
  return ok_(publicDocument_(row), 'Dokumen berhasil dicatat');
}

function updateDocument(data) {
  const id = requireString_(data.id, 'ID dokumen', 30);
  if (!findRow_('FamilyDocuments', id)) throw appError_('Dokumen tidak ditemukan.', 'NOT_FOUND');
  const updated = updateRow_('FamilyDocuments', id, normalizeDocument_(data));
  return ok_(publicDocument_(updated), 'Dokumen berhasil diperbarui');
}

function deleteDocument(data) {
  const id = requireString_(data.id, 'ID dokumen', 30);
  deleteRowById_('FamilyDocuments', id);
  return ok_({ id: id }, 'Dokumen dihapus');
}
