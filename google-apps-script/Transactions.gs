/**
 * Transactions.gs — tambah/edit/hapus transaksi beserta validasi saldo, limit kartu,
 * aturan transfer, cicilan, dan pencegahan transaksi ganda.
 */

function publicTransaction_(t, names, installment, shoppingItems) {
  names = names || nameMap_();
  const out = {
    id: t.ID, date: t.Date, type: t.Type, sourceAccount: t.SourceAccount, sourceName: names[t.SourceAccount] || t.SourceAccount,
    destinationAccount: t.DestinationAccount, destinationName: t.DestinationAccount ? (names[t.DestinationAccount] || t.DestinationAccount) : '',
    category: t.Category, subCategory: t.SubCategory, amount: t.Amount, description: t.Description,
    paymentMethod: t.PaymentMethod, createdBy: t.CreatedBy, createdAt: t.CreatedAt, updatedAt: t.UpdatedAt,
    attachment: t.Attachment
  };
  if (installment) {
    out.installment = { id: installment.ID, principal: installment.Principal, tenor: installment.Tenor,
      interestRate: installment.Interest, adminFee: installment.AdminFee, monthlyPayment: installment.MonthlyPayment,
      totalAmount: installment.TotalAmount, firstBillingDate: installmentFirstBilling_(installment) };
  }
  if (shoppingItems && shoppingItems.length) out.shoppingItems = shoppingItems;
  return out;
}

function getTransactions(data) {
  data = data || {};
  const names = nameMap_();
  const installments = {};
  readTable_('Installments').forEach(function (i) { installments[i.TransactionID] = i; });
  const shopping = {};
  readTable_('Shopping').forEach(function (s) {
    if (s.TransactionID) (shopping[s.TransactionID] = shopping[s.TransactionID] || []).push({ id: s.ID, item: s.Item, amount: s.ActualPrice });
  });
  let rows = readTable_('Transactions');

  if (data.id) rows = rows.filter(function (t) { return t.ID === data.id; });
  if (data.year) {
    const prefix = data.month ? monthParam_(data).key : String(data.year);
    rows = rows.filter(function (t) { return String(t.Date).indexOf(prefix) === 0; });
  }
  if (data.dateFrom) rows = rows.filter(function (t) { return t.Date >= data.dateFrom; });
  if (data.dateTo) rows = rows.filter(function (t) { return t.Date <= data.dateTo; });
  if (data.account) rows = rows.filter(function (t) { return t.SourceAccount === data.account || t.DestinationAccount === data.account; });
  if (data.category) rows = rows.filter(function (t) { return t.Category === data.category; });
  if (data.type) rows = rows.filter(function (t) { return t.Type === data.type; });
  if (data.search) {
    const q = String(data.search).toLowerCase();
    rows = rows.filter(function (t) {
      return [t.ID, t.Description, t.Category, t.SubCategory, names[t.SourceAccount], names[t.DestinationAccount], t.Type]
        .join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }
  rows.sort(function (a, b) {
    if (a.Date !== b.Date) return a.Date < b.Date ? 1 : -1;
    return a.ID < b.ID ? 1 : -1;
  });
  return ok_(rows.map(function (t) { return publicTransaction_(t, names, installments[t.ID], shopping[t.ID]); }));
}

/** Mengubah input dari frontend menjadi baris sheet + melakukan validasi format. */
function normalizeTransaction_(data) {
  const type = requireEnum_(data.type, TRANSACTION_TYPES, 'Jenis transaksi');
  const date = requireDate_(data.date, 'Tanggal');
  const source = requireString_(data.sourceAccount, type === TYPE_INCOME ? 'Rekening penerima' : 'Rekening/kartu sumber', 30);
  let destination = '';
  if (type === TYPE_TRANSFER) destination = requireString_(data.destinationAccount, 'Rekening tujuan', 30);
  if (type === TYPE_CARD_PAYMENT) destination = requireString_(data.destinationAccount, 'Kartu kredit yang dibayar', 30);

  let category = '', subCategory = '';
  if (type === TYPE_TRANSFER) category = 'Transfer';
  else if (type === TYPE_CARD_PAYMENT) category = 'Kartu Kredit';
  else {
    category = requireString_(data.category, 'Kategori', 40);
    subCategory = optionalString_(data.subCategory, 60);
  }

  let amount;
  let installment = null;
  if (type === TYPE_INSTALLMENT) {
    const inst = data.installment || {};
    const principal = toAmount_(inst.principal, 'Harga barang');
    const tenor = toNumber_(inst.tenor, 'Tenor cicilan', 1, 60);
    if (Math.round(tenor) !== tenor) throw appError_('Tenor cicilan harus bilangan bulat (bulan).');
    const rate = toNumber_(inst.interestRate === '' || inst.interestRate === undefined ? 0 : inst.interestRate, 'Bunga per bulan (%)', 0, 10);
    const adminFee = toAmount_(inst.adminFee, 'Biaya administrasi', true);
    amount = calculateInstallment_(principal, tenor, rate, adminFee).total;
    installment = { principal: principal, tenor: tenor, interestRate: rate, adminFee: adminFee };
  } else {
    amount = toAmount_(data.amount, 'Nominal');
  }

  const attachment = optionalString_(data.attachment, 500);
  if (attachment && !/^https:\/\//i.test(attachment)) throw appError_('Lampiran harus berupa link yang diawali https:// (misalnya link Google Drive).');

  return {
    row: {
      Date: date, Type: type, SourceAccount: source, DestinationAccount: destination, Category: category,
      SubCategory: subCategory, Amount: amount, Description: optionalString_(data.description, 200),
      PaymentMethod: optionalString_(data.paymentMethod, 40), Attachment: attachment
    },
    installment: installment
  };
}

/** Validasi bisnis: rekening ada & aktif, saldo cukup, limit kartu, aturan transfer, duplikat. */
function validateTransaction_(row, excludeId, allowDuplicate) {
  const accounts = {}, cards = {};
  readTable_('Accounts').forEach(function (a) { accounts[a.ID] = a; });
  readTable_('CreditCards').forEach(function (c) { cards[c.ID] = c; });
  const src = accounts[row.SourceAccount] || cards[row.SourceAccount];
  if (!src) throw appError_('Rekening atau kartu sumber tidak ditemukan. Muat ulang halaman lalu coba lagi.', 'NOT_FOUND');
  const srcName = src.AccountName || src.CardName;
  if (!isTrue_(src.Active)) throw appError_(srcName + ' sedang nonaktif dan tidak bisa dipakai.');
  const srcIsCard = !!cards[row.SourceAccount];
  const ledger = buildLedger_({ excludeId: excludeId });

  const ensureBalance = function () {
    const balance = ledger.acc[row.SourceAccount].balance;
    if (row.Amount > balance) {
      throw appError_('Saldo ' + srcName + ' tidak mencukupi untuk transaksi ini. Saldo saat ini ' + formatRupiahGs_(balance) + '.', 'INSUFFICIENT');
    }
  };
  const ensureLimit = function () {
    const available = ledger.cc[row.SourceAccount].available;
    if (row.Amount > available) {
      throw appError_('Transaksi melebihi limit tersedia ' + srcName + ' (' + formatRupiahGs_(available) + ').', 'OVER_LIMIT');
    }
  };

  if (row.Type === TYPE_INCOME) {
    if (srcIsCard) throw appError_('Pemasukan harus masuk ke rekening bank atau kas tunai, bukan kartu kredit.');
  } else if (row.Type === TYPE_EXPENSE) {
    if (srcIsCard) ensureLimit(); else ensureBalance();
    row.PaymentMethod = srcIsCard ? 'Kartu Kredit' : (row.PaymentMethod || (src.AccountType === 'Tunai' ? 'Tunai' : 'Transfer'));
  } else if (row.Type === TYPE_INSTALLMENT) {
    if (!srcIsCard) throw appError_('Cicilan hanya bisa dilakukan dengan kartu kredit.');
    ensureLimit();
    row.PaymentMethod = 'Kartu Kredit';
  } else if (row.Type === TYPE_TRANSFER) {
    const dst = accounts[row.DestinationAccount];
    if (srcIsCard) throw appError_('Transfer tidak bisa dilakukan dari kartu kredit.');
    if (!dst) throw appError_('Rekening tujuan transfer tidak ditemukan.', 'NOT_FOUND');
    if (!isTrue_(dst.Active)) throw appError_(dst.AccountName + ' sedang nonaktif.');
    if (row.SourceAccount === row.DestinationAccount) throw appError_('Rekening sumber dan tujuan transfer tidak boleh sama.');
    if (src.AccountType === 'Tunai' && getSetting_('ALLOW_CASH_TRANSFER', 'FALSE') !== 'TRUE') {
      throw appError_('Transfer dari kas tunai belum diaktifkan. Admin dapat mengaktifkannya di Pengaturan.');
    }
    if (src.AccountType === 'Bank' && dst.AccountType === 'Bank' && getSetting_('ALLOW_BANK_TO_BANK', 'TRUE') !== 'TRUE') {
      throw appError_('Transfer antar rekening bank belum diaktifkan. Admin dapat mengaktifkannya di Pengaturan.');
    }
    ensureBalance();
    row.PaymentMethod = row.PaymentMethod || 'Transfer';
  } else if (row.Type === TYPE_CARD_PAYMENT) {
    const card = cards[row.DestinationAccount];
    if (srcIsCard || src.AccountType !== 'Bank') throw appError_('Pembayaran kartu kredit harus dari rekening bank (Mandiri, BRI, BCA, BLU, dll).');
    if (!card) throw appError_('Kartu kredit yang dibayar tidak ditemukan.', 'NOT_FOUND');
    // Yang bisa dibayar hanya tagihan berjalan: belanja kartu + cicilan yang sudah ditagihkan − pembayaran sebelumnya.
    const bill = ledger.cc[card.ID].bill;
    if (bill <= 0) throw appError_(card.CardName + ' tidak memiliki tagihan yang perlu dibayar saat ini.');
    if (row.Amount > bill) {
      throw appError_('Nominal pembayaran (' + formatRupiahGs_(row.Amount) + ') melebihi tagihan ' + card.CardName + ' saat ini (' +
        formatRupiahGs_(bill) + '). Cicilan bulan berikutnya belum ditagihkan.');
    }
    ensureBalance();
    row.PaymentMethod = row.PaymentMethod || 'Transfer';
  }

  if (!allowDuplicate) {
    const desc = String(row.Description || '').toLowerCase();
    const duplicate = readTable_('Transactions').filter(function (t) {
      return t.ID !== excludeId && t.Date === row.Date && t.Type === row.Type && t.SourceAccount === row.SourceAccount &&
        t.DestinationAccount === row.DestinationAccount && Number(t.Amount) === row.Amount &&
        String(t.Description || '').toLowerCase() === desc;
    })[0];
    if (duplicate) {
      throw appError_('Transaksi yang sama persis sudah ada (' + duplicate.ID + '). Simpan tetap sebagai transaksi baru?', 'DUPLICATE');
    }
  }
}

function nextTransactionId_(date) {
  const prefix = 'TRX-' + date.replace(/-/g, '');
  return nextSimpleId_('Transactions', prefix, 4);
}

function addTransaction(data, user) {
  const cache = CacheService.getScriptCache();
  const requestKey = data.requestId ? 'req_' + String(data.requestId).slice(0, 80) : '';
  if (requestKey) {
    const previousId = cache.get(requestKey);
    if (previousId && findRow_('Transactions', previousId)) {
      return ok_(publicTransaction_(findRow_('Transactions', previousId)), 'Transaksi sudah tersimpan sebelumnya');
    }
  }
  const normalized = normalizeTransaction_(data);
  const row = normalized.row;
  validateTransaction_(row, null, isTrue_(data.allowDuplicate));
  const now = nowStr_();
  row.ID = nextTransactionId_(row.Date);
  row.CreatedBy = user ? user.name : '-';
  row.CreatedAt = now;
  row.UpdatedAt = now;
  insertRow_('Transactions', row);

  let installment = null;
  if (normalized.installment) {
    installment = buildInstallment_(Object.assign({
      id: nextSimpleId_('Installments', 'INS', 3), transactionId: row.ID, cardId: row.SourceAccount,
      description: row.Description || row.SubCategory || row.Category, startDate: row.Date
    }, normalized.installment));
    insertRow_('Installments', installment);
  }
  recalculateStoredValues_();
  if (requestKey) cache.put(requestKey, row.ID, 600);
  return ok_(publicTransaction_(row, null, installment), 'Transaksi berhasil disimpan');
}

function updateTransaction(data, user) {
  const id = requireString_(data.id, 'ID transaksi', 40);
  const existing = findRow_('Transactions', id);
  if (!existing) throw appError_('Transaksi ' + id + ' tidak ditemukan. Mungkin sudah dihapus.', 'NOT_FOUND');
  const normalized = normalizeTransaction_(data);
  const row = normalized.row;
  validateTransaction_(row, id, isTrue_(data.allowDuplicate));
  row.UpdatedAt = nowStr_();
  const updated = updateRow_('Transactions', id, row);

  const oldInstallment = readTable_('Installments').filter(function (i) { return i.TransactionID === id; })[0];
  let installment = null;
  if (normalized.installment) {
    installment = buildInstallment_(Object.assign({
      id: oldInstallment ? oldInstallment.ID : nextSimpleId_('Installments', 'INS', 3), transactionId: id,
      cardId: row.SourceAccount, description: row.Description || row.SubCategory || row.Category, startDate: row.Date
    }, normalized.installment));
    if (oldInstallment) updateRow_('Installments', oldInstallment.ID, installment);
    else insertRow_('Installments', installment);
  } else if (oldInstallment) {
    deleteRowById_('Installments', oldInstallment.ID);
  }
  // Transaksi dari menu Belanja yang diubah menjadi bukan pengeluaran → lepaskan kaitan item belanja.
  if (row.Type !== TYPE_EXPENSE) unlinkShoppingFromTransaction_(id);
  recalculateStoredValues_();
  return ok_(publicTransaction_(updated, null, installment), 'Transaksi berhasil diperbarui');
}

function deleteTransaction(data) {
  const id = requireString_(data.id, 'ID transaksi', 40);
  const existing = findRow_('Transactions', id);
  if (!existing) throw appError_('Transaksi ' + id + ' tidak ditemukan. Mungkin sudah dihapus.', 'NOT_FOUND');
  deleteRowsWhere_('Installments', function (i) { return i.TransactionID === id; });
  deleteRowById_('Transactions', id);
  const unlinked = unlinkShoppingFromTransaction_(id);
  recalculateStoredValues_();
  return ok_({ id: id, unlinkedShopping: unlinked }, unlinked
    ? 'Transaksi dihapus. ' + unlinked + ' item belanja kembali berstatus "belum dicatat".'
    : 'Transaksi berhasil dihapus');
}
