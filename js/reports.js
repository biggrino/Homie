/**
 * reports.js — laporan keuangan bulanan & tahunan beserta export Excel (SheetJS) dan PDF (jsPDF).
 */
import { api } from './api.js';
import { escapeHtml, formatRupiah, formatCompactRupiah, monthLabel, MONTHS, MONTHS_SHORT, loadScript, getPref, setPref, currentPeriod, monthOptions, yearOptions, todayISO, formatDateLong } from './utils.js';
import { toast, toastError, skeleton, emptyState, progressBar, createChart, doughnutChart, chartLegend } from './ui.js';

const LIBS = {
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  autotable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'
};

/* =========================== EXPORT =========================== */

/** sheets: [{ name, rows: [objek] }] */
export async function exportExcel(sheets, filename) {
  await loadScript(LIBS.xlsx);
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{ Info: 'Tidak ada data' }]);
    const headers = Object.keys(sheet.rows[0] || { Info: '' });
    ws['!cols'] = headers.map((h) => ({ wch: Math.min(40, Math.max(h.length + 2, ...sheet.rows.map((r) => String(r[h] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name.slice(0, 31));
  });
  XLSX.writeFile(workbook, filename);
}

/** doc: { title, subtitle, orientation, summary: [[label, nilai]], sections: [{ heading, head, body, foot }] } */
export async function exportPdf(doc, filename) {
  await loadScript(LIBS.jspdf);
  await loadScript(LIBS.autotable);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: doc.orientation || 'portrait', unit: 'pt', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(15, 118, 110);
  pdf.rect(0, 0, width, 64, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(16);
  pdf.text(doc.title, 40, 30);
  pdf.setFontSize(10);
  pdf.text(`Homie · ${doc.subtitle || ''}`, 40, 48);
  pdf.setTextColor(30, 41, 59);
  let y = 88;
  if (doc.summary?.length) {
    pdf.autoTable({
      startY: y, theme: 'plain', body: doc.summary, styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: { 0: { cellWidth: 180, textColor: [100, 116, 139] }, 1: { fontStyle: 'bold', halign: 'right' } },
      tableWidth: 360
    });
    y = pdf.lastAutoTable.finalY + 18;
  }
  (doc.sections || []).forEach((section) => {
    if (section.heading) {
      pdf.setFontSize(12);
      pdf.text(section.heading, 40, y);
      y += 8;
    }
    pdf.autoTable({
      startY: y, head: [section.head], body: section.body, foot: section.foot, theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 4 }, headStyles: { fillColor: [15, 118, 110] },
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      margin: { left: 40, right: 40 }
    });
    y = pdf.lastAutoTable.finalY + 24;
  });
  const pages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`Dicetak ${formatDateLong(todayISO())} · Halaman ${i}/${pages}`, 40, pdf.internal.pageSize.getHeight() - 20);
  }
  pdf.save(filename);
}

/* =========================== LAPORAN =========================== */

export async function renderReports(container) {
  const now = currentPeriod();
  const state = { type: 'monthly', month: now.month, year: now.year, ...getPref('reportFilter', {}) };
  container.innerHTML = `
    <div class="toolbar mb-3">
      <div class="btn-group" role="group" aria-label="Jenis laporan">
        <button class="btn btn-sm" data-type="monthly">Bulanan</button><button class="btn btn-sm" data-type="yearly">Tahunan</button></div>
      <div class="d-flex gap-2 flex-wrap">
        <select class="form-select form-select-sm w-auto" id="r-month" aria-label="Bulan">${monthOptions(state.month)}</select>
        <select class="form-select form-select-sm w-auto" id="r-year" aria-label="Tahun">${yearOptions(state.year)}</select>
        <button class="btn btn-sm btn-outline-success" id="r-excel"><i class="bi bi-file-earmark-excel me-1"></i>Excel</button>
        <button class="btn btn-sm btn-outline-danger" id="r-pdf"><i class="bi bi-file-earmark-pdf me-1"></i>PDF</button>
      </div>
    </div>
    <div id="report-body"></div>`;
  const body = container.querySelector('#report-body');
  let report = null;

  const syncControls = () => {
    container.querySelectorAll('[data-type]').forEach((b) => { b.className = `btn btn-sm ${b.dataset.type === state.type ? 'btn-primary' : 'btn-outline-primary'}`; });
    container.querySelector('#r-month').hidden = state.type === 'yearly';
  };

  async function load() {
    setPref('reportFilter', state);
    syncControls();
    body.innerHTML = skeleton(6);
    try {
      const res = await api('getReport', { type: state.type, month: state.month, year: state.year });
      report = res.data;
      if (report.type === 'yearly') drawYearly(body, report);
      else drawMonthly(body, report);
    } catch (err) {
      body.innerHTML = emptyState('bi-wifi-off', err.message);
    }
  }

  container.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { state.type = b.dataset.type; load(); }));
  container.querySelector('#r-month').addEventListener('change', (e) => { state.month = Number(e.target.value); load(); });
  container.querySelector('#r-year').addEventListener('change', (e) => { state.year = Number(e.target.value); load(); });
  container.querySelector('#r-excel').addEventListener('click', async () => {
    if (!report) return;
    try {
      await exportExcel(reportSheets(report), `laporan-${reportSlug(report)}.xlsx`);
      toast('Laporan Excel berhasil dibuat');
    } catch (err) { toastError(err); }
  });
  container.querySelector('#r-pdf').addEventListener('click', async () => {
    if (!report) return;
    try {
      await exportPdf(reportPdf(report), `laporan-${reportSlug(report)}.pdf`);
      toast('Laporan PDF berhasil dibuat');
    } catch (err) { toastError(err); }
  });
  await load();
}

function reportSlug(r) {
  return r.type === 'yearly' ? `tahunan-${r.year}` : `bulanan-${r.period.key}`;
}

function statBox(label, value, tone = '') {
  return `<div class="col-6 col-md-4 col-xl-2"><div class="report-stat">
    <div class="stat-label">${label}</div><div class="fw-bold ${tone}" title="${formatRupiah(value)}">${formatRupiah(value)}</div></div></div>`;
}

function budgetTable(items) {
  if (!items.length) return emptyState('bi-pie-chart', 'Belum ada data anggaran.');
  return `<div class="table-responsive-stack"><table class="table align-middle mb-0">
    <thead><tr><th>Kategori</th><th class="text-end">Budget</th><th class="text-end">Realisasi</th><th class="text-end">Sisa</th><th style="min-width:140px">Persentase</th></tr></thead>
    <tbody>${items.map((i) => `<tr>
      <td data-label="Kategori"><span class="dot me-2" style="background:${i.color}"></span>${escapeHtml(i.category)}</td>
      <td data-label="Budget" class="text-end">${formatRupiah(i.budget)}</td>
      <td data-label="Realisasi" class="text-end">${formatRupiah(i.actual)}</td>
      <td data-label="Sisa" class="text-end ${i.remaining < 0 ? 'text-danger' : ''}">${formatRupiah(i.remaining)}</td>
      <td data-label="Persentase"><div class="d-flex align-items-center gap-2"><div class="flex-grow-1">${progressBar(i.percent, { height: 6 })}</div><small>${i.percent}%</small></div></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function drawMonthly(body, r) {
  const total = r.expense;
  body.innerHTML = `
    <div class="card app-card mb-3"><div class="card-body">
      <h2 class="section-title mb-3"><i class="bi bi-file-earmark-bar-graph"></i>Laporan Bulanan · ${monthLabel(r.period.month, r.period.year)}</h2>
      <div class="row g-2">
        ${statBox('Saldo awal', r.openingBalance)}
        ${statBox('Pemasukan', r.income, 'text-success')}
        ${statBox('Pengeluaran', r.expense, 'text-danger')}
        ${statBox('Transfer', r.transfer)}
        ${statBox('Pembayaran kartu kredit', r.cardPayment)}
        ${statBox('Saldo akhir', r.closingBalance, 'text-primary')}
      </div>
      <p class="small text-muted mt-3 mb-0"><i class="bi bi-info-circle me-1"></i>Pengeluaran termasuk belanja via kartu kredit ${formatRupiah(r.expenseViaCard)}
        (cicilan ${formatRupiah(r.installmentExpense)}). Saldo akhir = saldo awal + pemasukan − pengeluaran tunai/rekening (${formatRupiah(r.expenseCashAndBank)}) − pembayaran kartu.</p>
    </div></div>
    <div class="row g-3 mb-3">
      <div class="col-lg-5"><div class="card app-card h-100"><div class="card-body">
        <h3 class="section-title mb-3"><i class="bi bi-pie-chart-fill"></i>Pengeluaran per Kategori</h3>
        ${total ? `<div class="chart-wrap chart-doughnut"><canvas id="rm-doughnut"></canvas><div class="chart-center"><small>Total</small><strong>${formatCompactRupiah(total)}</strong></div></div>
          ${chartLegend(r.byCategory, total)}` : emptyState('bi-pie-chart', 'Belum ada pengeluaran.')}
      </div></div></div>
      <div class="col-lg-7"><div class="card app-card h-100"><div class="card-body">
        <h3 class="section-title mb-3"><i class="bi bi-bar-chart-fill"></i>Budget vs Realisasi</h3>
        <div class="chart-wrap chart-bar"><canvas id="rm-bar"></canvas></div>
      </div></div></div>
    </div>
    <div class="card app-card mb-3"><div class="card-body">
      <h3 class="section-title mb-3"><i class="bi bi-table"></i>Perbandingan Budget & Realisasi</h3>${budgetTable(r.budget)}</div></div>
    <div class="card app-card"><div class="card-body">
      <h3 class="section-title mb-3"><i class="bi bi-bank"></i>Saldo Rekening</h3>
      <div class="table-responsive-stack"><table class="table align-middle mb-0"><thead><tr><th>Rekening</th><th class="text-end">Saldo awal</th><th class="text-end">Saldo akhir</th><th class="text-end">Perubahan</th></tr></thead>
      <tbody>${r.accounts.map((a) => `<tr><td data-label="Rekening">${escapeHtml(a.name)}</td><td data-label="Saldo awal" class="text-end">${formatRupiah(a.opening)}</td>
        <td data-label="Saldo akhir" class="text-end">${formatRupiah(a.closing)}</td>
        <td data-label="Perubahan" class="text-end ${a.closing - a.opening < 0 ? 'text-danger' : 'text-success'}">${formatRupiah(a.closing - a.opening)}</td></tr>`).join('')}</tbody></table></div>
    </div></div>`;
  if (total) doughnutChart(body.querySelector('#rm-doughnut'), r.byCategory);
  const items = r.budget.filter((i) => i.budget || i.actual);
  createChart(body.querySelector('#rm-bar'), {
    type: 'bar',
    data: {
      labels: items.map((i) => i.category),
      datasets: [
        { label: 'Budget', data: items.map((i) => i.budget), backgroundColor: 'rgba(148,163,184,.55)', borderRadius: 6 },
        { label: 'Realisasi', data: items.map((i) => i.actual), backgroundColor: items.map((i) => i.color), borderRadius: 6 }
      ]
    },
    options: chartMoneyOptions({ indexAxis: 'y' })
  });
}

function chartMoneyOptions(extra = {}) {
  const horizontal = extra.indexAxis === 'y';
  const moneyAxis = { ticks: { callback: (v) => formatCompactRupiah(v) }, grid: { color: 'rgba(148,163,184,.15)' } };
  return {
    maintainAspectRatio: false,
    ...extra,
    plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatRupiah(horizontal ? ctx.parsed.x : ctx.parsed.y)}` } } },
    scales: horizontal ? { x: moneyAxis, y: { grid: { display: false } } } : { y: moneyAxis, x: { grid: { display: false } } }
  };
}

function drawYearly(body, r) {
  const total = r.totals.expense;
  body.innerHTML = `
    <div class="card app-card mb-3"><div class="card-body">
      <h2 class="section-title mb-3"><i class="bi bi-calendar3"></i>Laporan Tahunan ${r.year}</h2>
      <div class="row g-2">
        ${statBox('Saldo awal tahun', r.openingBalance)}
        ${statBox('Total pemasukan', r.totals.income, 'text-success')}
        ${statBox('Total pengeluaran', r.totals.expense, 'text-danger')}
        ${statBox('Cash flow', r.totals.cashFlow, r.totals.cashFlow >= 0 ? 'text-success' : 'text-danger')}
        ${statBox('Pembayaran kartu', r.totals.cardPayment)}
        ${statBox('Saldo akhir tahun', r.closingBalance, 'text-primary')}
      </div>
    </div></div>
    <div class="card app-card mb-3"><div class="card-body">
      <h3 class="section-title mb-3"><i class="bi bi-bar-chart-fill"></i>Pemasukan, Pengeluaran & Cash Flow per Bulan</h3>
      <div class="chart-wrap chart-tall"><canvas id="ry-bar"></canvas></div></div></div>
    <div class="row g-3 mb-3">
      <div class="col-lg-5"><div class="card app-card h-100"><div class="card-body">
        <h3 class="section-title mb-3"><i class="bi bi-pie-chart-fill"></i>Pengeluaran per Kategori</h3>
        ${total ? `<div class="chart-wrap chart-doughnut"><canvas id="ry-doughnut"></canvas><div class="chart-center"><small>Total</small><strong>${formatCompactRupiah(total)}</strong></div></div>
          ${chartLegend(r.byCategory, total)}` : emptyState('bi-pie-chart', 'Belum ada pengeluaran.')}
      </div></div></div>
      <div class="col-lg-7"><div class="card app-card h-100"><div class="card-body">
        <h3 class="section-title mb-3"><i class="bi bi-table"></i>Rincian per Bulan</h3>
        <div class="table-responsive-stack"><table class="table table-sm align-middle mb-0"><thead><tr><th>Bulan</th><th class="text-end">Pemasukan</th><th class="text-end">Pengeluaran</th><th class="text-end">Cash flow</th></tr></thead>
        <tbody>${r.months.map((m) => `<tr><td data-label="Bulan">${MONTHS[m.month - 1]}</td><td data-label="Pemasukan" class="text-end">${formatRupiah(m.income)}</td>
          <td data-label="Pengeluaran" class="text-end">${formatRupiah(m.expense)}</td>
          <td data-label="Cash flow" class="text-end ${m.cashFlow < 0 ? 'text-danger' : 'text-success'}">${formatRupiah(m.cashFlow)}</td></tr>`).join('')}</tbody></table></div>
      </div></div></div>
    </div>
    <div class="card app-card"><div class="card-body">
      <h3 class="section-title mb-3"><i class="bi bi-clipboard-data"></i>Perbandingan Budget & Realisasi ${r.year}</h3>${budgetTable(r.budgetVsActual)}</div></div>`;
  createChart(body.querySelector('#ry-bar'), {
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        { type: 'bar', label: 'Pemasukan', data: r.months.map((m) => m.income), backgroundColor: 'rgba(16,185,129,.75)', borderRadius: 6 },
        { type: 'bar', label: 'Pengeluaran', data: r.months.map((m) => m.expense), backgroundColor: 'rgba(239,68,68,.7)', borderRadius: 6 },
        { type: 'line', label: 'Cash flow', data: r.months.map((m) => m.cashFlow), borderColor: '#0f766e', backgroundColor: '#0f766e', cubicInterpolationMode: 'monotone', pointRadius: 3 }
      ]
    },
    options: chartMoneyOptions()
  });
  if (total) doughnutChart(body.querySelector('#ry-doughnut'), r.byCategory);
}

function reportSheets(r) {
  if (r.type === 'yearly') {
    return [
      { name: 'Ringkasan', rows: [
        { Keterangan: 'Saldo awal tahun', Nilai: r.openingBalance }, { Keterangan: 'Total pemasukan', Nilai: r.totals.income },
        { Keterangan: 'Total pengeluaran', Nilai: r.totals.expense }, { Keterangan: 'Cash flow', Nilai: r.totals.cashFlow },
        { Keterangan: 'Transfer internal', Nilai: r.totals.transfer }, { Keterangan: 'Pembayaran kartu kredit', Nilai: r.totals.cardPayment },
        { Keterangan: 'Saldo akhir tahun', Nilai: r.closingBalance }] },
      { name: 'Per Bulan', rows: r.months.map((m) => ({ Bulan: MONTHS[m.month - 1], Pemasukan: m.income, Pengeluaran: m.expense, 'Cash Flow': m.cashFlow })) },
      { name: 'Per Kategori', rows: r.byCategory.map((c) => ({ Kategori: c.category, Pengeluaran: c.amount })) },
      { name: 'Budget vs Realisasi', rows: r.budgetVsActual.map((b) => ({ Kategori: b.category, Budget: b.budget, Realisasi: b.actual, Sisa: b.remaining, 'Persen (%)': b.percent })) }
    ];
  }
  return [
    { name: 'Ringkasan', rows: [
      { Keterangan: 'Saldo awal', Nilai: r.openingBalance }, { Keterangan: 'Pemasukan', Nilai: r.income },
      { Keterangan: 'Pengeluaran', Nilai: r.expense }, { Keterangan: '— via kartu kredit', Nilai: r.expenseViaCard },
      { Keterangan: 'Transfer', Nilai: r.transfer }, { Keterangan: 'Pembayaran kartu kredit', Nilai: r.cardPayment },
      { Keterangan: 'Saldo akhir', Nilai: r.closingBalance }] },
    { name: 'Per Kategori', rows: r.byCategory.map((c) => ({ Kategori: c.category, Pengeluaran: c.amount })) },
    { name: 'Budget vs Realisasi', rows: r.budget.map((b) => ({ Kategori: b.category, Budget: b.budget, Realisasi: b.actual, Sisa: b.remaining, 'Persen (%)': b.percent })) },
    { name: 'Saldo Rekening', rows: r.accounts.map((a) => ({ Rekening: a.name, Jenis: a.type, 'Saldo Awal': a.opening, 'Saldo Akhir': a.closing })) }
  ];
}

function reportPdf(r) {
  const rp = formatRupiah;
  if (r.type === 'yearly') {
    return {
      title: `Laporan Keuangan Tahunan ${r.year}`, subtitle: `Tahun ${r.year}`,
      summary: [['Saldo awal tahun', rp(r.openingBalance)], ['Total pemasukan', rp(r.totals.income)], ['Total pengeluaran', rp(r.totals.expense)],
        ['Cash flow', rp(r.totals.cashFlow)], ['Pembayaran kartu kredit', rp(r.totals.cardPayment)], ['Saldo akhir tahun', rp(r.closingBalance)]],
      sections: [
        { heading: 'Per Bulan', head: ['Bulan', 'Pemasukan', 'Pengeluaran', 'Cash flow'], body: r.months.map((m) => [MONTHS[m.month - 1], rp(m.income), rp(m.expense), rp(m.cashFlow)]) },
        { heading: 'Budget vs Realisasi', head: ['Kategori', 'Budget', 'Realisasi', 'Sisa', '%'], body: r.budgetVsActual.map((b) => [b.category, rp(b.budget), rp(b.actual), rp(b.remaining), b.percent + '%']) }
      ]
    };
  }
  return {
    title: `Laporan Keuangan ${monthLabel(r.period.month, r.period.year)}`, subtitle: monthLabel(r.period.month, r.period.year),
    summary: [['Saldo awal', rp(r.openingBalance)], ['Pemasukan', rp(r.income)], ['Pengeluaran', rp(r.expense)], ['  via kartu kredit', rp(r.expenseViaCard)],
      ['Transfer', rp(r.transfer)], ['Pembayaran kartu kredit', rp(r.cardPayment)], ['Saldo akhir', rp(r.closingBalance)]],
    sections: [
      { heading: 'Budget vs Realisasi', head: ['Kategori', 'Budget', 'Realisasi', 'Sisa', '%'], body: r.budget.map((b) => [b.category, rp(b.budget), rp(b.actual), rp(b.remaining), b.percent + '%']) },
      { heading: 'Saldo Rekening', head: ['Rekening', 'Saldo awal', 'Saldo akhir'], body: r.accounts.map((a) => [a.name, rp(a.opening), rp(a.closing)]) }
    ]
  };
}

/** Dipakai menu Backup: unduh laporan bulan berjalan dalam PDF. */
export async function downloadCurrentMonthReport() {
  const now = currentPeriod();
  const res = await api('getReport', { type: 'monthly', month: now.month, year: now.year });
  await exportPdf(reportPdf(res.data), `laporan-${reportSlug(res.data)}.pdf`);
}
