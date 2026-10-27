/**
 * Shopping.gs — daftar belanja bulanan (MANDATORY & COMPLEMENTARY) dan hubungannya dengan Keuangan.
 * MANDATORY otomatis disalin dari bulan sebelumnya saat bulan baru dibuka.
 * COMPLEMENTARY kosong setiap bulan dan hanya disalin lewat tombol "Salin Bulan Lalu".
 *
 * Alur seperti belanja sehari-hari: centang barang yang sudah dibeli → "Catat ke Keuangan" sekali per struk.
 * Satu struk = satu transaksi Pengeluaran (tunai, rekening, atau kartu kredit). Item yang sudah tercatat
 * terkunci harganya agar angka Belanja dan Keuangan selalu sama; hapus transaksinya untuk membuka kunci.
 */

const SHOPPING_GROUPS = ['MANDATORY', 'COMPLEMENTARY'];
const SHOPPING_STATUS = ['Belum dibeli', 'Sudah dibeli'];

function publicShopping_(s) {
  return {
    id: s.ID, month: s.Month, year: s.Year, group: s.Group, item: s.Item, category: s.Category, quantity: s.Quantity,
    unit: s.Unit, estimatedPrice: s.EstimatedPrice, actualPrice: s.ActualPrice, status: s.Status, notes: s.Notes,
    transactionId: s.TransactionID || '', purchaseDate: s.PurchaseDate || '', recorded: !!s.TransactionID
  };
}

function getShopping(data) {
  const period = monthParam_(data);
  ensureMandatoryCopied_(period);
  const items = readTable_('Shopping')
    .filter(function (s) { return s.Month === period.month && s.Year === period.year; })
    .map(publicShopping_)
    .sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'Belum dibeli' ? -1 : 1;
      return a.item.localeCompare(b.item);
    });
  return ok_({ period: period, items: items, summary: shoppingSummary_(period, items) });
}

function shoppingSummary_(period, items) {
  const categoryName = getSetting_('SHOPPING_BUDGET_CATEGORY', 'Belanja Bahan Makanan');
  const budgetRow = readTable_('Budgets').filter(function (b) {
    return b.Month === period.month && b.Year === period.year && b.Category === categoryName;
  })[0];
  const budget = budgetRow ? budgetRow.Amount : 0;
  const summarize = function (list) {
    const estimate = list.reduce(function (s, i) { return s + (Number(i.estimatedPrice) || 0); }, 0);
    const actual = list.filter(function (i) { return i.status === 'Sudah dibeli'; })
      .reduce(function (s, i) { return s + (Number(i.actualPrice) || 0); }, 0);
    const bought = list.filter(function (i) { return i.status === 'Sudah dibeli'; }).length;
    return { estimate: estimate, actual: actual, count: list.length, bought: bought };
  };
  const all = summarize(items);
  // Terpakai = pengeluaran kategori budget belanja yang SUDAH tercatat di Keuangan bulan ini
  // (dari menu Belanja maupun dicatat langsung di Keuangan), sehingga angka Belanja = angka Anggaran.
  const spent = periodStats_(period.start, period.end).byCategory[categoryName] || 0;
  const pendingItems = items.filter(function (i) { return i.status === 'Sudah dibeli' && !i.recorded; });
  const pending = pendingItems.reduce(function (s, i) { return s + (Number(i.actualPrice) || 0); }, 0);
  const planned = items.filter(function (i) { return i.status !== 'Sudah dibeli'; })
    .reduce(function (s, i) { return s + (Number(i.estimatedPrice) || 0); }, 0);
  const calc = calculateBudgetRemaining_(budget, spent + pending);
  return {
    budgetCategory: categoryName, budget: budget, estimate: all.estimate, actual: all.actual,
    difference: all.estimate - all.actual, remaining: calc.remaining, percent: calc.percent,
    spent: spent, pending: pending, pendingCount: pendingItems.length, planned: planned,
    projectedRemaining: calc.remaining - planned,
    count: all.count, bought: all.bought,
    mandatory: summarize(items.filter(function (i) { return i.group === 'MANDATORY'; })),
    complementary: summarize(items.filter(function (i) { return i.group === 'COMPLEMENTARY'; }))
  };
}

/** Menyalin daftar MANDATORY bulan lalu ke bulan berjalan (sekali per bulan). */
function ensureMandatoryCopied_(period) {
  const current = monthParam_({});
  if (period.key !== current.key) return;
  const flag = 'MANDATORY_COPIED_' + period.key;
  if (getSetting_(flag, '') === 'TRUE') return;
  withLock_(function () {
    clearTableCache_();
    if (getSetting_(flag, '') === 'TRUE') return;
    const hasItems = readTable_('Shopping').some(function (s) {
      return s.Month === period.month && s.Year === period.year && s.Group === 'MANDATORY';
    });
    if (hasItems) {
      setSetting_(flag, 'TRUE', 'Daftar Mandatory bulan ini sudah tersedia');
      return;
    }
    const copied = copyShoppingItems_(period, 'MANDATORY');
    if (copied > 0) setSetting_(flag, 'TRUE', 'Daftar Mandatory otomatis disalin dari bulan sebelumnya');
  });
}

function copyShoppingItems_(period, group) {
  const prev = previousMonth_(period.month, period.year);
  const rows = readTable_('Shopping');
  const existingNames = {};
  rows.forEach(function (s) {
    if (s.Month === period.month && s.Year === period.year && s.Group === group) existingNames[s.Item.toLowerCase()] = true;
  });
  const source = rows.filter(function (s) {
    return s.Month === prev.month && s.Year === prev.year && s.Group === group && !existingNames[s.Item.toLowerCase()];
  });
  if (!source.length) return 0;
  const sampleIds = parseJsonSafe_(getSetting_('SAMPLE_IDS', '[]'), []);
  let nextNumber = Number(nextSimpleId_('Shopping', 'SHP', 4).split('-')[1]);
  const newSampleIds = [];
  const copies = source.map(function (s) {
    const id = 'SHP-' + ('0000' + nextNumber++).slice(-Math.max(4, String(nextNumber - 1).length));
    if (sampleIds.indexOf(s.ID) !== -1) newSampleIds.push(id);
    return { ID: id, Month: period.month, Year: period.year, Group: group, Item: s.Item, Category: s.Category,
      Quantity: s.Quantity, Unit: s.Unit, EstimatedPrice: s.ActualPrice || s.EstimatedPrice, ActualPrice: 0,
      Status: 'Belum dibeli', Notes: s.Notes };
  });
  insertRows_('Shopping', copies);
  if (newSampleIds.length) addSampleIds_(newSampleIds);
  return copies.length;
}

function copyShopping(data) {
  const period = monthParam_(data);
  const group = requireEnum_(data.group || 'COMPLEMENTARY', SHOPPING_GROUPS, 'Grup belanja');
  const copied = copyShoppingItems_(period, group);
  if (!copied) throw appError_('Tidak ada item ' + (group === 'MANDATORY' ? 'Mandatory' : 'Complementary') + ' baru dari bulan lalu untuk disalin.');
  return ok_({ copied: copied }, copied + ' item disalin dari bulan lalu');
}

function normalizeShopping_(data) {
  const period = monthParam_(data);
  const status = data.status ? requireEnum_(data.status, SHOPPING_STATUS, 'Status') : 'Belum dibeli';
  const actual = toAmount_(data.actualPrice, 'Harga aktual', true);
  return {
    Month: period.month, Year: period.year,
    Group: requireEnum_(data.group, SHOPPING_GROUPS, 'Grup belanja'),
    Item: requireString_(data.item, 'Nama barang', 80),
    Category: optionalString_(data.category, 40) || 'Lainnya',
    Quantity: toNumber_(data.quantity === '' || data.quantity === undefined ? 1 : data.quantity, 'Jumlah', 0.01, 100000),
    Unit: optionalString_(data.unit, 20) || 'pcs',
    EstimatedPrice: toAmount_(data.estimatedPrice, 'Estimasi harga', true),
    ActualPrice: actual,
    Status: status,
    Notes: optionalString_(data.notes, 200)
  };
}

function addShopping(data) {
  const row = normalizeShopping_(data);
  row.ID = nextSimpleId_('Shopping', 'SHP', 4);
  insertRow_('Shopping', row);
  return ok_(publicShopping_(row), 'Item belanja berhasil ditambahkan');
}

function recordedLockMessage_(row) {
  return '"' + row.Item + '" sudah tercatat di Keuangan (' + row.TransactionID + '). ' +
    'Untuk mengubah harga atau status, hapus/ubah transaksi tersebut di Jurnal terlebih dahulu.';
}

function updateShopping(data) {
  const id = requireString_(data.id, 'ID item', 30);
  const existing = findRow_('Shopping', id);
  if (!existing) throw appError_('Item belanja tidak ditemukan.', 'NOT_FOUND');
  let patch;
  if (existing.TransactionID) {
    const status = data.status === undefined ? existing.Status : data.status;
    const price = data.actualPrice === undefined ? existing.ActualPrice : toAmount_(data.actualPrice, 'Harga aktual', true);
    if (status !== existing.Status || price !== existing.ActualPrice) throw appError_(recordedLockMessage_(existing), 'LOCKED');
  }
  if (data.statusOnly) {
    patch = { Status: requireEnum_(data.status, SHOPPING_STATUS, 'Status') };
    if (data.actualPrice !== undefined) patch.ActualPrice = toAmount_(data.actualPrice, 'Harga aktual', true);
    if (patch.Status === 'Sudah dibeli' && !patch.ActualPrice && !existing.ActualPrice) patch.ActualPrice = existing.EstimatedPrice;
  } else {
    patch = normalizeShopping_(Object.assign({ month: existing.Month, year: existing.Year }, data));
  }
  const updated = updateRow_('Shopping', id, patch);
  return ok_(publicShopping_(updated), 'Item belanja berhasil diperbarui');
}

function deleteShopping(data) {
  const id = requireString_(data.id, 'ID item', 30);
  const existing = findRow_('Shopping', id);
  if (!existing) throw appError_('Item belanja tidak ditemukan.', 'NOT_FOUND');
  if (existing.TransactionID) throw appError_(recordedLockMessage_(existing), 'LOCKED');
  deleteRowById_('Shopping', id);
  return ok_({ id: id }, 'Item belanja dihapus');
}

/**
 * Catat belanja ke Keuangan: beberapa item (satu struk) → satu transaksi Pengeluaran.
 * data: { ids, prices: {id: harga}, sourceAccount, date, category, subCategory, description, paymentMethod, requestId }
 */
function checkoutShopping(data, user) {
  const ids = Array.isArray(data.ids) ? data.ids.map(String) : [];
  if (!ids.length) throw appError_('Pilih minimal satu barang yang dicatat.');
  if (ids.length > 200) throw appError_('Maksimal 200 barang per transaksi.');
  const prices = data.prices || {};
  const rows = readTable_('Shopping');
  const items = ids.map(function (id) {
    const row = rows.filter(function (r) { return r.ID === id; })[0];
    if (!row) throw appError_('Item belanja ' + id + ' tidak ditemukan. Muat ulang halaman.', 'NOT_FOUND');
    if (row.TransactionID) throw appError_('"' + row.Item + '" sudah tercatat di Keuangan (' + row.TransactionID + ').');
    const price = prices[id] !== undefined && prices[id] !== '' ? toAmount_(prices[id], 'Harga ' + row.Item, true)
      : (row.ActualPrice || row.EstimatedPrice);
    if (!(price > 0)) throw appError_('Isi harga aktual "' + row.Item + '".');
    return { row: row, price: price };
  });
  const total = items.reduce(function (s, i) { return s + i.price; }, 0);
  const names = items.map(function (i) { return i.row.Item; });
  let description = optionalString_(data.description, 200);
  if (!description) {
    description = 'Belanja: ' + names.join(', ');
    if (description.length > 200) description = description.slice(0, 190) + '… (' + names.length + ' item)';
  }
  const result = addTransaction({
    type: TYPE_EXPENSE, date: data.date || todayStr_(), sourceAccount: data.sourceAccount,
    category: data.category || getSetting_('SHOPPING_BUDGET_CATEGORY', 'Belanja Bahan Makanan'),
    subCategory: data.subCategory, amount: total, description: description, paymentMethod: data.paymentMethod,
    requestId: data.requestId, allowDuplicate: true
  }, user);
  const trx = result.data;
  const updates = {};
  items.forEach(function (i) {
    updates[i.row.ID] = { Status: 'Sudah dibeli', ActualPrice: i.price, TransactionID: trx.id, PurchaseDate: trx.date };
  });
  rewriteColumns_('Shopping', updates);
  return ok_({ transaction: trx, count: items.length, total: total },
    items.length + ' barang (' + formatRupiahGs_(total) + ') dicatat sebagai pengeluaran ' + trx.id);
}

/** Dipanggil saat transaksi dihapus/diubah: item belanja kembali "sudah dibeli, belum dicatat". */
function unlinkShoppingFromTransaction_(transactionId) {
  const updates = {};
  let count = 0;
  readTable_('Shopping').forEach(function (s) {
    if (s.TransactionID === transactionId) {
      updates[s.ID] = { TransactionID: '', PurchaseDate: '' };
      count++;
    }
  });
  if (count) rewriteColumns_('Shopping', updates);
  return count;
}
