/**
 * dashboard.js — ringkasan kondisi rumah tangga.
 */
import { api, getUser } from './api.js';
import { escapeHtml, formatRupiah, formatCompactRupiah, formatDateLong, formatDateShort, monthLabel, relativeDayLabel } from './utils.js';
import { moneyToggle, bindMoneyToggles, doughnutChart, chartLegend, emptyState, progressBar, pageSkeleton } from './ui.js';
import { transactionListItem, bindTransactionList } from './finance.js';

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function statCard({ label, value, icon, tone, note = '' }) {
  return `<div class="col-6 col-md-4 col-xxl-2">
    <div class="card app-card stat-card h-100" data-toggle-money role="button" tabindex="0" title="Klik untuk melihat angka lengkap">
      <div class="card-body">
        <div class="stat-icon icon-${tone}"><i class="bi ${icon}"></i></div>
        <div class="stat-label">${label}</div>
        <div class="stat-value">${moneyToggle(value)}</div>
        ${note ? `<div class="stat-note">${note}</div>` : ''}
      </div></div></div>`;
}

function sectionCard(title, icon, body, link = '') {
  return `<div class="card app-card h-100"><div class="card-body">
    <div class="section-head"><h2 class="section-title"><i class="bi ${icon}"></i>${title}</h2>${link}</div>${body}</div></div>`;
}

export async function renderDashboard(container) {
  container.innerHTML = pageSkeleton();
  const { data } = await api('getDashboard');
  const s = data.summary;
  const user = getUser();
  const totalExpense = data.expenseByCategory.reduce((t, i) => t + i.amount, 0);

  const accountsHtml = data.accounts.map((a) => `
    <div class="col-6 col-md-4 col-xl-2">
      <div class="account-chip ${a.type === 'Tunai' ? 'is-cash' : ''}">
        <div class="d-flex align-items-center gap-2 mb-1">
          <i class="bi ${a.type === 'Tunai' ? 'bi-cash-stack' : 'bi-bank'}"></i>
          <span class="text-truncate fw-semibold">${escapeHtml(a.name)}</span>
        </div>
        <div class="account-balance ${a.balance < 0 ? 'text-danger' : ''}" title="${formatRupiah(a.balance)}">${formatRupiah(a.balance)}</div>
      </div></div>`).join('');

  const recentHtml = data.recentTransactions.length
    ? `<div class="trx-list">${data.recentTransactions.map(transactionListItem).join('')}</div>`
    : emptyState('bi-receipt', 'Belum ada transaksi.');

  const agendaHtml = data.todayAgenda.length
    ? `<ul class="simple-list">${data.todayAgenda.map((a) => `
      <li><span class="time-pill">${escapeHtml(a.time || '--:--')}</span>
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate ${a.status === 'Selesai' ? 'text-decoration-line-through text-muted' : ''}">${escapeHtml(a.title)}</div>
        <small class="text-muted">${escapeHtml(a.owner || '-')} · ${escapeHtml(a.category)}</small></div>
        <span class="badge-soft badge-soft-${a.status === 'Selesai' ? 'success' : a.status === 'Proses' ? 'info' : 'secondary'}">${a.status}</span></li>`).join('')}</ul>`
    : emptyState('bi-calendar2-check', 'Tidak ada agenda hari ini.');

  const shoppingHtml = data.pendingShopping.count
    ? `<ul class="simple-list">${data.pendingShopping.items.map((i) => `
      <li><i class="bi bi-circle text-muted"></i><div class="flex-grow-1 min-w-0 text-truncate">${escapeHtml(i.item)}
        <small class="text-muted">· ${escapeHtml(String(i.quantity))} ${escapeHtml(i.unit)}</small></div>
        <small class="text-muted">${formatCompactRupiah(i.estimatedPrice)}</small></li>`).join('')}</ul>
      ${data.pendingShopping.count > 5 ? `<div class="small text-muted mt-2">+${data.pendingShopping.count - 5} item lainnya</div>` : ''}`
    : emptyState('bi-bag-check', 'Semua belanja bulan ini sudah dibeli.');

  const billsHtml = data.upcomingBills.length
    ? `<ul class="simple-list">${data.upcomingBills.map((c) => `
      <li><div class="icon-circle icon-sm icon-warning"><i class="bi bi-credit-card"></i></div>
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold">${escapeHtml(c.name)}</div>
        <small class="text-muted">Jatuh tempo ${formatDateShort(c.nextDueDate)} · ${relativeDayLabel(c.nextDueDate)}</small></div>
        <div class="text-end"><div class="fw-semibold">${formatCompactRupiah(c.bill)}</div>
        <small class="text-muted">Min ${formatCompactRupiah(c.minimumPayment)}</small></div></li>`).join('')}</ul>`
    : emptyState('bi-emoji-smile', 'Tidak ada tagihan kartu kredit.');
  const billsLink = '<a href="#/keuangan/bayar-kartu" class="section-link">Bayar</a>';

  const installmentHtml = data.activeInstallments.length
    ? `<ul class="simple-list">${data.activeInstallments.map((i) => `
      <li class="d-block"><div class="d-flex justify-content-between gap-2"><span class="fw-semibold text-truncate">${escapeHtml(i.description)}</span>
        <span class="text-nowrap">${formatCompactRupiah(i.monthlyPayment)}/bln</span></div>
        <div class="d-flex justify-content-between small text-muted mb-1"><span>${escapeHtml(i.cardName)}${i.nextBillingDate ? ` · tagihan ${formatDateShort(i.nextBillingDate)}` : ''}</span><span>${i.paidMonths} / ${i.tenor} ditagih</span></div>
        ${progressBar(i.progressPercent, { tone: 'primary', height: 6 })}</li>`).join('')}</ul>`
    : emptyState('bi-check2-all', 'Tidak ada cicilan aktif.');

  container.innerHTML = `
    <section class="hero-card mb-3">
      <div>
        <div class="hero-greeting">${greeting()}, ${escapeHtml(user?.name || '')}!</div>
        <div class="hero-date">${formatDateLong(data.today)}</div>
      </div>
      <div class="hero-balance">
        <div class="small opacity-75">Total saldo keluarga</div>
        <div class="hero-amount">${formatRupiah(s.totalBalance)}</div>
        <div class="small opacity-75">Cash flow ${monthLabel(data.period.month, data.period.year)}:
          <strong>${s.cashFlow >= 0 ? '+' : ''}${formatCompactRupiah(s.cashFlow)}</strong></div>
      </div>
    </section>

    <div class="row g-3 mb-3">
      ${statCard({ label: 'Total saldo', value: s.totalBalance, icon: 'bi-wallet2', tone: 'primary', note: 'Rekening + tunai' })}
      ${statCard({ label: 'Pemasukan', value: s.income, icon: 'bi-arrow-down-left', tone: 'success', note: 'Bulan ini' })}
      ${statCard({ label: 'Pengeluaran', value: s.expense, icon: 'bi-arrow-up-right', tone: 'danger', note: 'Bulan ini' })}
      ${statCard({ label: 'Tagihan kartu', value: s.cardBill, icon: 'bi-credit-card', tone: 'warning', note: 'Harus dibayar' })}
      ${statCard({ label: 'Total anggaran', value: s.totalBudget, icon: 'bi-pie-chart', tone: 'info', note: `Terpakai ${s.budgetPercent}%` })}
      ${statCard({ label: 'Sisa anggaran', value: s.budgetRemaining, icon: 'bi-piggy-bank', tone: s.budgetRemaining < 0 ? 'danger' : 'success', note: s.budgetRemaining < 0 ? 'Melebihi anggaran' : 'Masih aman' })}
    </div>

    <div class="card app-card mb-3"><div class="card-body">
      <div class="section-head"><h2 class="section-title"><i class="bi bi-safe2"></i>Cash Position</h2>
        <a href="#/keuangan/rekening" class="section-link">Detail</a></div>
      <div class="row g-2">${accountsHtml || emptyState('bi-bank', 'Belum ada rekening aktif.')}</div>
    </div></div>

    <div class="row g-3 mb-3">
      <div class="col-lg-5">${sectionCard('Porsi Pengeluaran Bulanan', 'bi-pie-chart-fill', totalExpense
        ? `<div class="chart-wrap chart-doughnut"><canvas id="dash-expense-chart" aria-label="Grafik porsi pengeluaran"></canvas>
            <div class="chart-center"><small>Total</small><strong>${formatCompactRupiah(totalExpense)}</strong></div></div>
            ${chartLegend(data.expenseByCategory, totalExpense)}`
        : emptyState('bi-pie-chart', 'Belum ada pengeluaran bulan ini.'))}</div>
      <div class="col-lg-7">${sectionCard('5 Transaksi Terakhir', 'bi-clock-history', recentHtml, '<a href="#/keuangan/jurnal" class="section-link">Lihat semua</a>')}</div>
    </div>

    <div class="row g-3">
      <div class="col-md-6 col-xxl-3">${sectionCard('Agenda Hari Ini', 'bi-calendar-event', agendaHtml, '<a href="#/agenda" class="section-link">Agenda</a>')}</div>
      <div class="col-md-6 col-xxl-3">${sectionCard(`Belanja Belum Selesai <span class="count-pill">${data.pendingShopping.count}</span>`, 'bi-cart3', shoppingHtml, '<a href="#/belanja" class="section-link">Belanja</a>')}</div>
      <div class="col-md-6 col-xxl-3">${sectionCard('Tagihan Kartu Terdekat', 'bi-bell', billsHtml, billsLink)}</div>
      <div class="col-md-6 col-xxl-3">${sectionCard('Cicilan Aktif', 'bi-calendar2-range', installmentHtml, '<a href="#/keuangan/cicilan" class="section-link">Cicilan</a>')}</div>
    </div>
    <p class="text-center small text-muted mt-4 mb-0"><i class="bi bi-hand-index me-1"></i>Ketuk kartu ringkasan untuk melihat angka lengkap.</p>`;

  bindMoneyToggles(container);
  bindTransactionList(container);
  if (totalExpense) doughnutChart(container.querySelector('#dash-expense-chart'), data.expenseByCategory);
}
