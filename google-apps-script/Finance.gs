/**
 * Finance.gs — perhitungan keuangan: saldo rekening, kartu kredit, cicilan, anggaran,
 * kategori, ringkasan, dashboard, dan laporan. Semua angka dihitung dari data transaksi.
 */

const TYPE_INCOME = 'Pemasukan';
const TYPE_EXPENSE = 'Pengeluaran';
const TYPE_TRANSFER = 'Transfer';
const TYPE_CARD_PAYMENT = 'Pembayaran Kartu Kredit';
const TYPE_INSTALLMENT = 'Cicilan';
const TRANSACTION_TYPES = [TYPE_INCOME, TYPE_EXPENSE, TYPE_TRANSFER, TYPE_CARD_PAYMENT, TYPE_INSTALLMENT];
const ACCOUNT_TYPES = ['Bank', 'Tunai'];

/* =========================== FORMAT & RUMUS DASAR =========================== */

function formatRupiahGs_(amount) {
  const value = Math.round(Number(amount) || 0);
  const text = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (value < 0 ? '-Rp' : 'Rp') + text;
}

/** Saldo Akhir = Saldo Awal + Pemasukan − Pengeluaran + Transfer Masuk − Transfer Keluar (termasuk bayar kartu). */
function calculateAccountBalance_(a) {
  return Math.round(a.opening + a.income - a.expense + a.transferIn - a.transferOut - a.cardPayment);
}

/**
 * Outstanding (limit terpakai) = Belanja kartu + Total seluruh cicilan − Pembayaran.
 * Available Limit = Limit − Outstanding (cicilan langsung "mengunci" limit sebesar total cicilan).
 */
function calculateCreditCardOutstanding_(c) {
  return Math.round(c.charges + c.installments - c.payments);
}

/**
 * Tagihan kartu (yang harus dibayar) = Belanja kartu + Cicilan yang SUDAH ditagihkan − Pembayaran.
 * Cicilan bulan berikutnya belum masuk tagihan, sehingga tidak bisa/perlu dibayar sekarang.
 */
function calculateCreditCardBill_(c) {
  return Math.round(c.charges + c.installmentBilled - c.payments);
}

/** Minimum pembayaran = persen × tagihan, paling sedikit Rp50.000 (atau seluruh tagihan bila lebih kecil). */
function calculateMinimumPayment_(bill, percent) {
  if (bill <= 0) return 0;
  return Math.min(bill, Math.max(Math.round(bill * (Number(percent) || 0) / 100), 50000));
}

/**
 * Cicilan kartu kredit (bunga flat per bulan).
 * Bunga total = pokok × bunga% × tenor; cicilan/bulan = (pokok + bunga total) / tenor (dibulatkan);
 * biaya administrasi ditagihkan sekali pada bulan pertama.
 */
function calculateInstallment_(principal, tenor, interestRate, adminFee) {
  const interestTotal = Math.round(principal * (interestRate / 100) * tenor);
  const monthly = Math.round((principal + interestTotal) / tenor);
  return { interestTotal: interestTotal, monthly: monthly, total: monthly * tenor + (adminFee || 0) };
}

function calculateBudgetRemaining_(budget, actual) {
  const remaining = Math.round(budget - actual);
  const percent = budget > 0 ? Math.round((actual / budget) * 1000) / 10 : (actual > 0 ? 100 : 0);
  return { remaining: remaining, percent: percent };
}

/* =========================== LEDGER =========================== */

/**
 * Menghitung posisi seluruh rekening & kartu dari transaksi.
 * options.until: hanya transaksi dengan tanggal <= until. options.before: tanggal < before.
 * options.excludeId: abaikan satu transaksi (dipakai saat edit).
 */
function buildLedger_(options) {
  options = options || {};
  const accounts = readTable_('Accounts');
  const cards = readTable_('CreditCards');
  const acc = {};
  const cc = {};
  accounts.forEach(function (a) {
    acc[a.ID] = { opening: a.OpeningBalance, income: 0, expense: 0, transferIn: 0, transferOut: 0, cardPayment: 0 };
  });
  cards.forEach(function (c) { cc[c.ID] = { charges: 0, installments: 0, installmentBilled: 0, payments: 0 }; });
  const installmentTrx = [];

  readTable_('Transactions').forEach(function (t) {
    if (options.excludeId && t.ID === options.excludeId) return;
    if (options.until && t.Date > options.until) return;
    if (options.before && t.Date >= options.before) return;
    const amount = Number(t.Amount) || 0;
    const src = t.SourceAccount, dst = t.DestinationAccount;
    if (t.Type === TYPE_INCOME && acc[src]) acc[src].income += amount;
    if (t.Type === TYPE_EXPENSE) {
      if (acc[src]) acc[src].expense += amount;
      else if (cc[src]) cc[src].charges += amount;
    }
    if (t.Type === TYPE_TRANSFER) {
      if (acc[src]) acc[src].transferOut += amount;
      if (acc[dst]) acc[dst].transferIn += amount;
    }
    if (t.Type === TYPE_CARD_PAYMENT) {
      if (acc[src]) acc[src].cardPayment += amount;
      if (cc[dst]) cc[dst].payments += amount;
    }
    if (t.Type === TYPE_INSTALLMENT && cc[src]) {
      cc[src].installments += amount;
      installmentTrx.push(t);
    }
  });

  // Cicilan masuk tagihan kartu satu per satu pada tanggal penagihan (default tanggal 16).
  const today = todayStr_();
  let asOf = options.until || (options.before ? addDaysStr_(options.before, -1) : today);
  if (asOf > today) asOf = today;
  if (installmentTrx.length) {
    const instByTrx = {};
    readTable_('Installments').forEach(function (i) { instByTrx[i.TransactionID] = i; });
    installmentTrx.forEach(function (t) {
      const inst = instByTrx[t.ID];
      cc[t.SourceAccount].installmentBilled += inst ? installmentBilledAmount_(inst, installmentBilledCount_(inst, asOf)) : (Number(t.Amount) || 0);
    });
  }

  Object.keys(acc).forEach(function (id) { acc[id].balance = calculateAccountBalance_(acc[id]); });
  cards.forEach(function (c) {
    cc[c.ID].outstanding = calculateCreditCardOutstanding_(cc[c.ID]);
    cc[c.ID].bill = calculateCreditCardBill_(cc[c.ID]);
    cc[c.ID].unbilled = Math.round(cc[c.ID].installments - cc[c.ID].installmentBilled);
    cc[c.ID].available = Math.round(c.Limit - cc[c.ID].outstanding);
  });
  return { accounts: accounts, cards: cards, acc: acc, cc: cc };
}

function accountsWithBalance_(ledger) {
  return ledger.accounts.map(function (a) {
    const l = ledger.acc[a.ID];
    return {
      id: a.ID, name: a.AccountName, type: a.AccountType, active: isTrue_(a.Active),
      openingBalance: a.OpeningBalance, balance: l.balance, income: l.income, expense: l.expense,
      transferIn: l.transferIn, transferOut: l.transferOut, cardPayment: l.cardPayment
    };
  });
}

function cardsWithOutstanding_(ledger) {
  const today = todayStr_();
  return ledger.cards.map(function (c) {
    const l = ledger.cc[c.ID];
    const outstanding = l.outstanding;
    const nextDue = nextDayOfMonth_(c.DueDate || 1, today);
    return {
      id: c.ID, name: c.CardName, bank: c.Bank, active: isTrue_(c.Active), limit: c.Limit,
      outstanding: outstanding, availableLimit: l.available,
      usagePercent: c.Limit > 0 ? Math.round((outstanding / c.Limit) * 1000) / 10 : 0,
      statementDate: c.StatementDate, dueDate: c.DueDate, minimumPaymentPercent: c.MinimumPayment,
      bill: l.bill, totalBill: Math.max(l.bill, 0), unbilledInstallments: l.unbilled,
      minimumPayment: calculateMinimumPayment_(l.bill, c.MinimumPayment),
      nextStatementDate: nextDayOfMonth_(c.StatementDate || 1, today),
      nextDueDate: nextDue, daysToDue: daysBetween_(today, nextDue),
      charges: l.charges, installments: l.installments, installmentBilled: l.installmentBilled, payments: l.payments
    };
  });
}

function nextDayOfMonth_(day, fromText) {
  const p = parseDateStr_(fromText);
  let y = p.y, m = p.m;
  let d = Math.min(Number(day) || 1, daysInMonth_(y, m));
  if (d < p.d) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    d = Math.min(Number(day) || 1, daysInMonth_(y, m));
  }
  return dateStr_(y, m, d);
}

/** Menyimpan hasil hitung (saldo, outstanding, progres cicilan) ke sheet agar mudah dibaca langsung di Google Sheets. */
function recalculateStoredValues_() {
  const ledger = buildLedger_();
  const accUpdates = {};
  ledger.accounts.forEach(function (a) { accUpdates[a.ID] = { CurrentBalance: ledger.acc[a.ID].balance }; });
  rewriteColumns_('Accounts', accUpdates);
  const cardUpdates = {};
  ledger.cards.forEach(function (c) {
    cardUpdates[c.ID] = { Outstanding: ledger.cc[c.ID].outstanding, AvailableLimit: ledger.cc[c.ID].available, CurrentBill: ledger.cc[c.ID].bill };
  });
  rewriteColumns_('CreditCards', cardUpdates);
  const instUpdates = {};
  const today = todayStr_();
  readTable_('Installments').forEach(function (i) {
    const p = installmentProgress_(i, today);
    const first = installmentFirstBilling_(i);
    instUpdates[i.ID] = { PaidMonths: p.paidMonths, RemainingMonths: p.remainingMonths, Status: p.status,
      FirstBillingDate: first, EndDate: addMonthsStr_(first, (Number(i.Tenor) || 1) - 1) };
  });
  rewriteColumns_('Installments', instUpdates);
}

/* =========================== REKENING =========================== */

function getAccounts() {
  return ok_(accountsWithBalance_(buildLedger_()));
}

function saveAccount(data) {
  const name = requireString_(data.name, 'Nama rekening', 40);
  const type = requireEnum_(data.type, ACCOUNT_TYPES, 'Jenis rekening');
  const opening = toAmount_(data.openingBalance, 'Saldo awal', true);
  const active = data.active === undefined ? true : isTrue_(data.active);
  ensureUniqueAccountName_(name, data.id);
  if (data.id) {
    updateRow_('Accounts', data.id, { AccountName: name, AccountType: type, OpeningBalance: opening, Active: active });
  } else {
    data.id = nextSimpleId_('Accounts', 'ACC', 3);
    insertRow_('Accounts', { ID: data.id, AccountName: name, AccountType: type, OpeningBalance: opening, CurrentBalance: opening, Active: active });
  }
  recalculateStoredValues_();
  return ok_({ id: data.id }, 'Rekening ' + name + ' berhasil disimpan');
}

function ensureUniqueAccountName_(name, exceptId) {
  const lower = name.toLowerCase();
  const clash = readTable_('Accounts').some(function (a) { return a.AccountName.toLowerCase() === lower && a.ID !== exceptId; }) ||
    readTable_('CreditCards').some(function (c) { return c.CardName.toLowerCase() === lower && c.ID !== exceptId; });
  if (clash) throw appError_('Nama "' + name + '" sudah dipakai rekening/kartu lain.');
}

/* =========================== KARTU KREDIT =========================== */

function getCreditCards() {
  const ledger = buildLedger_();
  const cards = cardsWithOutstanding_(ledger);
  const today = todayStr_();
  const installments = readTable_('Installments').map(function (i) { return publicInstallment_(i, today); });
  const monthKey = monthKey_(today);
  cards.forEach(function (card) {
    const active = installments.filter(function (i) { return i.cardId === card.id && i.status === 'Aktif'; });
    card.activeInstallments = active.length;
    card.installmentMonthly = active.reduce(function (s, i) { return s + i.monthlyPayment; }, 0);
    // Rincian cicilan yang ditagihkan bulan ini (tanggal penagihan jatuh di bulan berjalan).
    card.installmentThisMonth = [];
    installments.forEach(function (i) {
      if (i.cardId !== card.id) return;
      i.schedule.forEach(function (s) {
        if (monthKey_(s.date) !== monthKey) return;
        card.installmentThisMonth.push({ id: i.id, description: i.description, no: s.no, tenor: i.tenor, date: s.date,
          amount: s.amount, billed: s.billed });
      });
    });
  });
  return ok_(cards);
}

function saveCreditCard(data) {
  const name = requireString_(data.name, 'Nama kartu', 40);
  const bank = requireString_(data.bank, 'Bank penerbit', 40);
  const limit = toAmount_(data.limit, 'Limit');
  const statementDate = toNumber_(data.statementDate, 'Tanggal cetak tagihan', 1, 31);
  const dueDate = toNumber_(data.dueDate, 'Tanggal jatuh tempo', 1, 31);
  const minimum = toNumber_(data.minimumPayment === '' || data.minimumPayment === undefined ? 10 : data.minimumPayment, 'Minimum payment (%)', 0, 100);
  const active = data.active === undefined ? true : isTrue_(data.active);
  ensureUniqueAccountName_(name, data.id);
  const row = { CardName: name, Bank: bank, Limit: limit, StatementDate: Math.round(statementDate), DueDate: Math.round(dueDate),
    MinimumPayment: minimum, Active: active };
  if (data.id) {
    updateRow_('CreditCards', data.id, row);
  } else {
    data.id = nextSimpleId_('CreditCards', 'CC', 3);
    row.ID = data.id;
    row.Outstanding = 0;
    row.AvailableLimit = limit;
    insertRow_('CreditCards', row);
  }
  recalculateStoredValues_();
  return ok_({ id: data.id }, 'Kartu ' + name + ' berhasil disimpan');
}

function payCreditCard(data, user) {
  const payload = Object.assign({}, data, { type: TYPE_CARD_PAYMENT });
  if (!payload.description) payload.description = 'Pembayaran kartu kredit';
  const result = addTransaction(payload, user);
  if (result.success) result.message = 'Pembayaran kartu kredit berhasil dicatat';
  return result;
}

/* =========================== CICILAN =========================== */

function installmentBillingDay_() {
  const day = Math.round(Number(getSetting_('INSTALLMENT_BILLING_DAY', '16')));
  return day >= 1 && day <= 28 ? day : 16;
}

/** Tagihan cicilan pertama = tanggal penagihan (default 16) pertama yang jatuh pada/sesudah tanggal transaksi. */
function firstBillingDate_(startDate, day) {
  const p = parseDateStr_(startDate);
  let y = p.y, m = p.m;
  if (p.d > day) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return dateStr_(y, m, day);
}

function installmentFirstBilling_(inst) {
  return parseDateStr_(inst.FirstBillingDate) ? inst.FirstBillingDate : firstBillingDate_(inst.StartDate, installmentBillingDay_());
}

/** Jumlah bulan cicilan yang sudah ditagihkan ke kartu sampai tanggal asOf. */
function installmentBilledCount_(inst, asOf) {
  const first = installmentFirstBilling_(inst);
  if (asOf < first) return 0;
  const a = parseDateStr_(first), b = parseDateStr_(asOf);
  const count = monthDiff_(first, asOf) + (b.d >= a.d ? 1 : 0);
  return Math.max(0, Math.min(Number(inst.Tenor) || 1, count));
}

/** Nominal cicilan yang sudah ditagihkan (biaya admin ikut tagihan pertama). */
function installmentBilledAmount_(inst, count) {
  if (count <= 0) return 0;
  return Math.round(count * (Number(inst.MonthlyPayment) || 0) + (Number(inst.AdminFee) || 0));
}

function installmentSchedule_(inst, today) {
  const first = installmentFirstBilling_(inst);
  const list = [];
  for (let k = 0; k < (Number(inst.Tenor) || 1); k++) {
    const date = addMonthsStr_(first, k);
    list.push({ no: k + 1, date: date, amount: (Number(inst.MonthlyPayment) || 0) + (k === 0 ? (Number(inst.AdminFee) || 0) : 0),
      billed: date <= today });
  }
  return list;
}

function buildInstallment_(p) {
  const calc = calculateInstallment_(p.principal, p.tenor, p.interestRate, p.adminFee);
  const first = firstBillingDate_(p.startDate, installmentBillingDay_());
  const inst = {
    ID: p.id, TransactionID: p.transactionId, CardID: p.cardId, Description: p.description,
    Principal: p.principal, Interest: p.interestRate, AdminFee: p.adminFee, Tenor: p.tenor,
    MonthlyPayment: calc.monthly, TotalAmount: calc.total, StartDate: p.startDate,
    FirstBillingDate: first, EndDate: addMonthsStr_(first, p.tenor - 1)
  };
  const progress = installmentProgress_(inst, todayStr_());
  inst.PaidMonths = progress.paidMonths;
  inst.RemainingMonths = progress.remainingMonths;
  inst.Status = progress.status;
  return inst;
}

/**
 * Progres cicilan: satu bulan cicilan ditagihkan ke kartu setiap tanggal penagihan.
 * paidMonths = bulan yang sudah masuk tagihan kartu (dibayar lewat menu Bayar Kartu).
 */
function installmentProgress_(inst, today) {
  const tenor = Number(inst.Tenor) || 1;
  const billed = installmentBilledCount_(inst, today);
  const remaining = tenor - billed;
  const billedAmount = installmentBilledAmount_(inst, billed);
  const first = installmentFirstBilling_(inst);
  return {
    paidMonths: billed, remainingMonths: remaining, status: remaining <= 0 ? 'Lunas' : 'Aktif',
    remainingAmount: Math.round((Number(inst.TotalAmount) || 0) - billedAmount), paidAmount: billedAmount,
    nextBillingDate: remaining > 0 ? addMonthsStr_(first, billed) : ''
  };
}

function publicInstallment_(i, today, cardNames) {
  const p = installmentProgress_(i, today || todayStr_());
  return {
    id: i.ID, transactionId: i.TransactionID, cardId: i.CardID, cardName: cardNames ? (cardNames[i.CardID] || i.CardID) : i.CardID,
    description: i.Description, principal: i.Principal, interestRate: i.Interest, adminFee: i.AdminFee, tenor: i.Tenor,
    monthlyPayment: i.MonthlyPayment, totalAmount: i.TotalAmount, paidMonths: p.paidMonths,
    remainingMonths: p.remainingMonths, remainingAmount: p.remainingAmount, paidAmount: p.paidAmount,
    startDate: i.StartDate, firstBillingDate: installmentFirstBilling_(i), nextBillingDate: p.nextBillingDate,
    endDate: addMonthsStr_(installmentFirstBilling_(i), (Number(i.Tenor) || 1) - 1), status: p.status,
    progressPercent: Math.round((p.paidMonths / (Number(i.Tenor) || 1)) * 100),
    schedule: installmentSchedule_(i, today || todayStr_())
  };
}

function getInstallments(data) {
  const today = todayStr_();
  const cardNames = nameMap_();
  let list = readTable_('Installments').map(function (i) { return publicInstallment_(i, today, cardNames); });
  if (data && data.status) list = list.filter(function (i) { return i.status === data.status; });
  list.sort(function (a, b) { return (a.status === b.status ? 0 : a.status === 'Aktif' ? -1 : 1) || (b.startDate > a.startDate ? 1 : -1); });
  return ok_(list);
}

/* =========================== KATEGORI =========================== */

function publicCategory_(c) {
  return {
    id: c.ID, name: c.Name, type: c.Type, color: c.Color || '#64748b', active: isTrue_(c.Active),
    subCategories: String(c.SubCategories || '').split(',').map(function (s) { return s.trim(); }).filter(String)
  };
}

function getCategories() {
  return ok_(readTable_('Categories').map(publicCategory_));
}

function saveCategory(data) {
  const name = requireString_(data.name, 'Nama kategori', 40);
  const type = requireEnum_(data.type || TYPE_EXPENSE, [TYPE_EXPENSE, TYPE_INCOME], 'Jenis kategori');
  const subs = (Array.isArray(data.subCategories) ? data.subCategories : String(data.subCategories || '').split(','))
    .map(function (s) { return String(s).trim(); }).filter(String).join(',');
  const color = /^#[0-9a-fA-F]{6}$/.test(String(data.color || '')) ? data.color : '#64748b';
  const active = data.active === undefined ? true : isTrue_(data.active);
  const categories = readTable_('Categories');
  const clash = categories.some(function (c) { return c.Name.toLowerCase() === name.toLowerCase() && c.Type === type && c.ID !== data.id; });
  if (clash) throw appError_('Kategori "' + name + '" sudah ada.');
  if (['transfer', 'kartu kredit'].indexOf(name.toLowerCase()) !== -1) throw appError_('Nama kategori "' + name + '" dipakai oleh sistem.');

  if (data.id) {
    const existing = categories.filter(function (c) { return c.ID === data.id; })[0];
    if (!existing) throw appError_('Kategori tidak ditemukan.');
    updateRow_('Categories', data.id, { Name: name, Type: type, SubCategories: subs, Color: color, Active: active });
    if (existing.Name !== name) renameCategoryUsage_(existing.Name, name);
    return ok_({ id: data.id }, 'Kategori berhasil diperbarui');
  }
  const id = nextSimpleId_('Categories', 'CAT', 3);
  insertRow_('Categories', { ID: id, Name: name, Type: type, SubCategories: subs, Color: color, Active: active });
  return ok_({ id: id }, 'Kategori berhasil ditambahkan');
}

function renameCategoryUsage_(oldName, newName) {
  const trxUpdates = {};
  readTable_('Transactions').forEach(function (t) { if (t.Category === oldName) trxUpdates[t.ID] = { Category: newName }; });
  rewriteColumns_('Transactions', trxUpdates);
  const budgetUpdates = {};
  readTable_('Budgets').forEach(function (b) { if (b.Category === oldName) budgetUpdates[b.ID] = { Category: newName }; });
  rewriteColumns_('Budgets', budgetUpdates);
}

function deleteCategory(data) {
  const id = requireString_(data.id, 'ID kategori');
  const category = findRow_('Categories', id);
  if (!category) throw appError_('Kategori tidak ditemukan.');
  const used = readTable_('Transactions').some(function (t) { return t.Category === category.Name; });
  if (used) {
    updateRow_('Categories', id, { Active: false });
    return ok_({ id: id, deactivated: true }, 'Kategori sudah dipakai transaksi, jadi dinonaktifkan (tidak dihapus).');
  }
  deleteRowById_('Categories', id);
  deleteRowsWhere_('Budgets', function (b) { return b.Category === category.Name; });
  return ok_({ id: id }, 'Kategori berhasil dihapus');
}

/* =========================== PENGELUARAN & PEMASUKAN PER PERIODE =========================== */

/**
 * Daftar pengeluaran keluarga. Aturan agar tidak dihitung ganda:
 * - Pengeluaran tunai/bank/kartu kredit diakui pada tanggal transaksi.
 * - Cicilan diakui per bulan pada tanggal penagihannya (default tgl 16), bukan sekaligus.
 * - Pembayaran kartu kredit & transfer BUKAN pengeluaran (hanya memindahkan uang).
 */
function expenseEntries_() {
  const cardIds = {};
  readTable_('CreditCards').forEach(function (c) { cardIds[c.ID] = true; });
  const transactions = readTable_('Transactions');
  const trxById = {};
  const entries = [];
  transactions.forEach(function (t) {
    trxById[t.ID] = t;
    if (t.Type === TYPE_EXPENSE) {
      entries.push({ date: t.Date, category: t.Category, amount: Number(t.Amount) || 0, viaCard: !!cardIds[t.SourceAccount], installment: false });
    }
  });
  readTable_('Installments').forEach(function (i) {
    const trx = trxById[i.TransactionID];
    const category = trx ? trx.Category : 'Lainnya';
    const first = installmentFirstBilling_(i);
    for (let k = 0; k < i.Tenor; k++) {
      entries.push({ date: addMonthsStr_(first, k), category: category,
        amount: i.MonthlyPayment + (k === 0 ? (Number(i.AdminFee) || 0) : 0), viaCard: true, installment: true });
    }
  });
  return entries;
}

function periodStats_(start, end, entries) {
  entries = entries || expenseEntries_();
  const stats = { income: 0, expense: 0, expenseViaCard: 0, installmentExpense: 0, transfer: 0, cardPayment: 0,
    byCategory: {}, incomeByCategory: {}, transactionCount: 0 };
  readTable_('Transactions').forEach(function (t) {
    if (t.Date < start || t.Date > end) return;
    stats.transactionCount++;
    const amount = Number(t.Amount) || 0;
    if (t.Type === TYPE_INCOME) {
      stats.income += amount;
      stats.incomeByCategory[t.Category] = (stats.incomeByCategory[t.Category] || 0) + amount;
    }
    if (t.Type === TYPE_TRANSFER) stats.transfer += amount;
    if (t.Type === TYPE_CARD_PAYMENT) stats.cardPayment += amount;
  });
  entries.forEach(function (e) {
    if (e.date < start || e.date > end) return;
    stats.expense += e.amount;
    if (e.viaCard) stats.expenseViaCard += e.amount;
    if (e.installment) stats.installmentExpense += e.amount;
    stats.byCategory[e.category] = (stats.byCategory[e.category] || 0) + e.amount;
  });
  stats.cashFlow = stats.income - stats.expense;
  return stats;
}

function categoryList_(map, colors) {
  return Object.keys(map).map(function (name) {
    return { category: name, amount: map[name], color: colors[name] || '#94a3b8' };
  }).sort(function (a, b) { return b.amount - a.amount; });
}

function categoryColors_() {
  const colors = {};
  readTable_('Categories').forEach(function (c) { colors[c.Name] = c.Color || '#64748b'; });
  return colors;
}

function nameMap_() {
  const names = {};
  readTable_('Accounts').forEach(function (a) { names[a.ID] = a.AccountName; });
  readTable_('CreditCards').forEach(function (c) { names[c.ID] = c.CardName; });
  return names;
}

/* =========================== ANGGARAN =========================== */

function budgetReport_(period, entries) {
  const stats = periodStats_(period.start, period.end, entries);
  const budgets = readTable_('Budgets').filter(function (b) { return b.Month === period.month && b.Year === period.year; });
  const categories = readTable_('Categories').filter(function (c) { return c.Type === TYPE_EXPENSE; });
  const names = [];
  categories.forEach(function (c) { if (isTrue_(c.Active) || stats.byCategory[c.Name]) names.push(c.Name); });
  budgets.forEach(function (b) { if (names.indexOf(b.Category) === -1) names.push(b.Category); });
  Object.keys(stats.byCategory).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
  const colors = categoryColors_();
  const items = names.map(function (name) {
    const budgetRow = budgets.filter(function (b) { return b.Category === name; })[0];
    const budget = budgetRow ? budgetRow.Amount : 0;
    const actual = stats.byCategory[name] || 0;
    const calc = calculateBudgetRemaining_(budget, actual);
    return { id: budgetRow ? budgetRow.ID : '', category: name, color: colors[name] || '#94a3b8', budget: budget,
      actual: actual, remaining: calc.remaining, percent: calc.percent };
  });
  const totalBudget = items.reduce(function (s, i) { return s + i.budget; }, 0);
  const totalActual = items.reduce(function (s, i) { return s + i.actual; }, 0);
  const totals = calculateBudgetRemaining_(totalBudget, totalActual);
  return { period: period, items: items, totalBudget: totalBudget, totalActual: totalActual,
    totalRemaining: totals.remaining, totalPercent: totals.percent, stats: stats };
}

function getBudgets(data) {
  const report = budgetReport_(monthParam_(data));
  delete report.stats;
  return ok_(report);
}

function saveBudget(data) {
  const period = monthParam_(data);
  const category = requireString_(data.category, 'Kategori', 40);
  const amount = toAmount_(data.amount, 'Nominal anggaran', true);
  upsertBudget_(period, category, amount);
  return ok_({}, 'Anggaran ' + category + ' disimpan');
}

function upsertBudget_(period, category, amount) {
  const existing = readTable_('Budgets').filter(function (b) {
    return b.Month === period.month && b.Year === period.year && b.Category === category;
  })[0];
  if (existing) {
    updateRow_('Budgets', existing.ID, { Amount: amount });
    return existing.ID;
  }
  const prefix = 'BGT-' + period.year + ('0' + period.month).slice(-2);
  const id = nextSimpleId_('Budgets', prefix, 2);
  insertRow_('Budgets', { ID: id, Month: period.month, Year: period.year, Category: category, Amount: amount });
  return id;
}

function copyBudget(data) {
  const period = monthParam_(data);
  const prev = previousMonth_(period.month, period.year);
  const source = readTable_('Budgets').filter(function (b) { return b.Month === prev.month && b.Year === prev.year; });
  if (!source.length) throw appError_('Belum ada anggaran pada bulan sebelumnya untuk disalin.');
  source.forEach(function (b) { upsertBudget_(period, b.Category, b.Amount); });
  return ok_({ copied: source.length }, source.length + ' anggaran disalin dari bulan sebelumnya');
}

/* =========================== RINGKASAN & DASHBOARD =========================== */

function summaryFor_(period, entries) {
  const ledger = buildLedger_({ until: period.end });
  const accounts = accountsWithBalance_(ledger);
  const cards = cardsWithOutstanding_(buildLedger_());
  const stats = periodStats_(period.start, period.end, entries);
  const today = todayStr_();
  const installments = readTable_('Installments').map(function (i) { return publicInstallment_(i, today); })
    .filter(function (i) { return i.status === 'Aktif'; });
  const active = accounts.filter(function (a) { return a.active || a.balance !== 0; });
  const sum = function (list, key) { return list.reduce(function (s, x) { return s + x[key]; }, 0); };
  return {
    period: period,
    totalCash: sum(active, 'balance'),
    bankBalance: sum(active.filter(function (a) { return a.type === 'Bank'; }), 'balance'),
    cashBalance: sum(active.filter(function (a) { return a.type === 'Tunai'; }), 'balance'),
    cardOutstanding: sum(cards, 'outstanding'),
    cardBill: cards.reduce(function (s, c) { return s + Math.max(c.bill, 0); }, 0),
    cardAvailable: sum(cards.filter(function (c) { return c.active; }), 'availableLimit'),
    activeInstallments: { count: installments.length, monthly: sum(installments, 'monthlyPayment'), remaining: sum(installments, 'remainingAmount') },
    income: stats.income, expense: stats.expense, cashFlow: stats.cashFlow, expenseViaCard: stats.expenseViaCard,
    transfer: stats.transfer, cardPayment: stats.cardPayment,
    accounts: active, cards: cards, stats: stats
  };
}

function getSummary(data) {
  const period = monthParam_(data);
  const summary = summaryFor_(period);
  summary.expenseByCategory = categoryList_(summary.stats.byCategory, categoryColors_());
  delete summary.stats;
  return ok_(summary);
}

function getDashboard(data) {
  const period = monthParam_(data);
  const today = todayStr_();
  ensureMandatoryCopied_(monthParam_({}));
  const entries = expenseEntries_();
  const summary = summaryFor_(period, entries);
  const budget = budgetReport_(period, entries);
  const names = nameMap_();

  const recent = readTable_('Transactions')
    .sort(function (a, b) { return a.Date === b.Date ? (a.ID < b.ID ? 1 : -1) : (a.Date < b.Date ? 1 : -1); })
    .slice(0, 5).map(function (t) { return publicTransaction_(t, names); });

  const current = monthParam_({});
  const pendingShopping = readTable_('Shopping').filter(function (s) {
    return s.Month === current.month && s.Year === current.year && s.Status !== 'Sudah dibeli';
  });

  const todayAgenda = readTable_('Agenda').filter(function (a) { return a.Date === today; })
    .sort(function (a, b) { return String(a.Time).localeCompare(String(b.Time)); }).map(publicAgenda_);

  const upcomingBills = summary.cards.filter(function (c) { return c.active && c.bill > 0; })
    .sort(function (a, b) { return a.daysToDue - b.daysToDue; });

  const installments = readTable_('Installments').map(function (i) { return publicInstallment_(i, today, names); })
    .filter(function (i) { return i.status === 'Aktif'; });

  return ok_({
    period: period,
    today: today,
    summary: {
      totalBalance: summary.totalCash, bankBalance: summary.bankBalance, cashBalance: summary.cashBalance,
      income: summary.income, expense: summary.expense, cashFlow: summary.cashFlow,
      cardOutstanding: summary.cardOutstanding, cardBill: summary.cardBill, totalBudget: budget.totalBudget, budgetUsed: budget.totalActual,
      budgetRemaining: budget.totalRemaining, budgetPercent: budget.totalPercent
    },
    accounts: summary.accounts.filter(function (a) { return a.active; })
      .map(function (a) { return { id: a.id, name: a.name, type: a.type, balance: a.balance }; }),
    expenseByCategory: categoryList_(summary.stats.byCategory, categoryColors_()),
    recentTransactions: recent,
    pendingShopping: { count: pendingShopping.length, items: pendingShopping.slice(0, 5).map(publicShopping_) },
    todayAgenda: todayAgenda,
    upcomingBills: upcomingBills,
    activeInstallments: installments
  });
}

/* =========================== LAPORAN =========================== */

function getReport(data) {
  const type = (data && data.type) || 'monthly';
  const entries = expenseEntries_();
  const colors = categoryColors_();
  if (type === 'yearly') {
    const year = monthParam_({ month: 1, year: data.year }).year;
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const p = monthParam_({ month: m, year: year });
      const s = periodStats_(p.start, p.end, entries);
      months.push({ month: m, income: s.income, expense: s.expense, cashFlow: s.cashFlow, transfer: s.transfer, cardPayment: s.cardPayment });
    }
    const yearStats = periodStats_(year + '-01-01', year + '-12-31', entries);
    const budgetTotals = {};
    readTable_('Budgets').filter(function (b) { return b.Year === year; }).forEach(function (b) {
      budgetTotals[b.Category] = (budgetTotals[b.Category] || 0) + b.Amount;
    });
    const categories = Object.keys(budgetTotals);
    Object.keys(yearStats.byCategory).forEach(function (c) { if (categories.indexOf(c) === -1) categories.push(c); });
    const budgetVsActual = categories.map(function (c) {
      const budget = budgetTotals[c] || 0, actual = yearStats.byCategory[c] || 0;
      const calc = calculateBudgetRemaining_(budget, actual);
      return { category: c, color: colors[c] || '#94a3b8', budget: budget, actual: actual, remaining: calc.remaining, percent: calc.percent };
    }).sort(function (a, b) { return b.actual - a.actual; });
    return ok_({
      type: 'yearly', year: year, months: months,
      totals: { income: yearStats.income, expense: yearStats.expense, cashFlow: yearStats.cashFlow,
        transfer: yearStats.transfer, cardPayment: yearStats.cardPayment, expenseViaCard: yearStats.expenseViaCard },
      byCategory: categoryList_(yearStats.byCategory, colors),
      budgetVsActual: budgetVsActual,
      openingBalance: totalBalance_(buildLedger_({ before: year + '-01-01' })),
      closingBalance: totalBalance_(buildLedger_({ until: year + '-12-31' }))
    });
  }

  const period = monthParam_(data);
  const opening = buildLedger_({ before: period.start });
  const closing = buildLedger_({ until: period.end });
  const budget = budgetReport_(period, entries);
  const stats = budget.stats;
  return ok_({
    type: 'monthly', period: period,
    openingBalance: totalBalance_(opening), closingBalance: totalBalance_(closing),
    income: stats.income, expense: stats.expense, expenseViaCard: stats.expenseViaCard,
    expenseCashAndBank: stats.expense - stats.expenseViaCard,
    installmentExpense: stats.installmentExpense, transfer: stats.transfer, cardPayment: stats.cardPayment,
    cashFlow: stats.cashFlow, transactionCount: stats.transactionCount,
    byCategory: categoryList_(stats.byCategory, colors),
    incomeByCategory: categoryList_(stats.incomeByCategory, colors),
    budget: budget.items, totalBudget: budget.totalBudget,
    accounts: opening.accounts.map(function (a) {
      return { name: a.AccountName, type: a.AccountType, opening: opening.acc[a.ID].balance, closing: closing.acc[a.ID].balance };
    })
  });
}

function totalBalance_(ledger) {
  return Object.keys(ledger.acc).reduce(function (s, id) { return s + ledger.acc[id].balance; }, 0);
}
