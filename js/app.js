/**
 * app.js — titik masuk aplikasi: tema, login, layout (sidebar/bottom nav), router, dan PWA.
 */
import { initApi, api, isDemo, getSession, setSession, getUser, canWrite, loadMaster, clearMaster } from './api.js';
import { escapeHtml, getPref, setPref } from './utils.js';
import { toast, toastError, openModal, destroyCharts, pageSkeleton, errorState, avatar } from './ui.js';
import { renderDashboard } from './dashboard.js';
import { renderFinance, openTransactionForm } from './finance.js';
import { renderShopping, openShoppingForm } from './shopping.js';
import { renderAgenda, openAgendaForm } from './agenda.js';
import { renderDocuments } from './documents.js';
import { renderSettings } from './settings.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'bi-house-door', iconActive: 'bi-house-door-fill', mobile: true },
  { id: 'keuangan', label: 'Keuangan', icon: 'bi-wallet2', iconActive: 'bi-wallet-fill', mobile: true },
  { id: 'belanja', label: 'Belanja', icon: 'bi-cart3', iconActive: 'bi-cart-fill', mobile: true },
  { id: 'agenda', label: 'Agenda', icon: 'bi-calendar3', iconActive: 'bi-calendar-check-fill', mobile: true },
  { id: 'lainnya', label: 'Lainnya', icon: 'bi-grid', iconActive: 'bi-grid-fill', mobile: true, mobileIcon: 'bi-list' },
  { id: 'pengaturan', label: 'Pengaturan', icon: 'bi-gear', iconActive: 'bi-gear-fill', mobile: false }
];

const PAGES = {
  dashboard: { title: 'Dashboard', subtitle: 'Ringkasan kondisi rumah tangga', render: (el) => renderDashboard(el) },
  keuangan: { title: 'Keuangan', subtitle: 'Rekening, transaksi, kartu kredit & anggaran', render: (el, sub) => renderFinance(el, sub) },
  belanja: { title: 'Belanja', subtitle: 'Daftar belanja bulanan', render: (el) => renderShopping(el) },
  agenda: { title: 'Agenda', subtitle: 'Tugas & kalender keluarga', render: (el) => renderAgenda(el) },
  lainnya: { title: 'Lainnya', subtitle: 'Dokumen keluarga & menu lain', render: (el, sub) => (sub === 'dokumen' ? renderDocuments(el) : renderMore(el)) },
  pengaturan: { title: 'Pengaturan', subtitle: 'Tema, pengguna & backup', render: (el, sub) => renderSettings(el, sub) }
};

const $ = (sel) => document.querySelector(sel);
let currentRoute = { page: 'dashboard', sub: '' };
let renderToken = 0;

/* ---------------------------- Tema ---------------------------- */

function resolveTheme(pref) {
  if (pref === 'auto') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}

function applyTheme(pref = getPref('theme', 'auto')) {
  const theme = resolveTheme(pref);
  document.documentElement.setAttribute('data-bs-theme', theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#0b1220' : '#0f766e');
  const icon = $('#theme-toggle i');
  if (icon) icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
}

function toggleTheme() {
  const next = resolveTheme(getPref('theme', 'auto')) === 'dark' ? 'light' : 'dark';
  setPref('theme', next);
  applyTheme(next);
  refreshView();
}

/* ---------------------------- Login ---------------------------- */

async function showLogin(message) {
  $('#app').hidden = true;
  $('#splash').hidden = true;
  $('#login-screen').hidden = false;
  const usersEl = $('#login-users');
  usersEl.innerHTML = '<div class="spinner-border spinner-border-sm text-primary"></div>';
  $('#login-hint').textContent = isDemo()
    ? 'Mode Demo: PIN awal semua pengguna adalah 1234.'
    : 'PIN awal 1234 — segera ganti di Pengaturan setelah masuk.';
  if (message) toast(message, 'warning');
  try {
    const res = await api('getUsers');
    const lastUser = getPref('lastUser', res.data[0]?.id);
    usersEl.innerHTML = res.data.map((u) => `
      <label class="user-chip">
        <input type="radio" name="userId" value="${escapeHtml(u.id)}" ${u.id === lastUser ? 'checked' : ''}>
        <span><span class="avatar">${escapeHtml(u.name.charAt(0))}</span>${escapeHtml(u.name)}
        <small>${escapeHtml(u.role)}</small></span>
      </label>`).join('');
    $('#login-pin').focus();
  } catch (err) {
    usersEl.innerHTML = `<div class="alert alert-danger small mb-0">${escapeHtml(err.message)}
      <button type="button" class="btn btn-sm btn-link p-0 ms-1" id="login-retry">Coba lagi</button></div>`;
    $('#login-retry').addEventListener('click', () => showLogin());
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const userId = new FormData(event.target).get('userId');
  const pinInput = $('#login-pin');
  const pin = pinInput.value.trim();
  if (!userId) return toast('Pilih nama pengguna terlebih dahulu.', 'warning');
  if (!/^\d{4,8}$/.test(pin)) return toast('PIN berupa 4–8 digit angka.', 'warning');
  const button = $('#login-submit');
  button.disabled = true;
  button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Memeriksa…';
  try {
    const res = await api('login', { userId, pin });
    setSession(res.data);
    setPref('lastUser', userId);
    pinInput.value = '';
    toast(res.message);
    await startApp();
  } catch (err) {
    toastError(err);
    pinInput.select();
  } finally {
    button.disabled = false;
    button.textContent = 'Masuk';
  }
}

async function logout() {
  try {
    await api('logout', { token: getSession()?.token });
  } catch {
    /* tetap keluar walaupun gagal menghubungi server */
  }
  setSession(null);
  clearMaster();
  showLogin();
}

/* ---------------------------- Layout ---------------------------- */

function renderNav() {
  const route = currentRoute.page;
  $('#sidebar-nav').innerHTML = NAV.map((item) => `
    <a href="#/${item.id}" class="sidebar-link ${route === item.id ? 'active' : ''}">
      <i class="bi ${route === item.id ? item.iconActive : item.icon}"></i><span>${item.label}</span></a>`).join('');

  $('#bottom-nav').innerHTML = NAV.filter((i) => i.mobile).map((item) => {
    const active = route === item.id || (item.id === 'lainnya' && route === 'pengaturan');
    return `<a href="#/${item.id}" class="bottom-link ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>
      <i class="bi ${active ? item.iconActive : item.mobileIcon || item.icon}"></i><span>${item.label}</span></a>`;
  }).join('');

  const user = getUser();
  if (!user) return;
  $('#user-menu').innerHTML = avatar(user);
  $('#sidebar-user').innerHTML = `<div class="d-flex align-items-center gap-2">
      <a href="#/pengaturan/akun" title="Akun saya">${avatar(user)}</a>
      <div class="min-w-0"><div class="fw-semibold text-truncate">${escapeHtml(user.name)}</div>
      <div class="small text-muted">${escapeHtml(user.role)}${isDemo() ? ' · Demo' : ''}</div></div>
      <button class="btn btn-icon ms-auto" data-action="logout" title="Keluar"><i class="bi bi-box-arrow-right"></i></button></div>`;
  $('#user-dropdown').innerHTML = `
    <li><h6 class="dropdown-header">${escapeHtml(user.name)} · ${escapeHtml(user.role)}</h6></li>
    <li><a class="dropdown-item" href="#/pengaturan/akun"><i class="bi bi-person-circle me-2"></i>Akun saya</a></li>
    <li><a class="dropdown-item" href="#/pengaturan"><i class="bi bi-gear me-2"></i>Pengaturan</a></li>
    <li><a class="dropdown-item" href="#/pengaturan/backup"><i class="bi bi-cloud-arrow-down me-2"></i>Backup</a></li>
    <li><hr class="dropdown-divider"></li>
    <li><button class="dropdown-item text-danger" data-action="logout"><i class="bi bi-box-arrow-right me-2"></i>Keluar</button></li>`;
}

function renderMore(container) {
  const tiles = [
    { href: '#/lainnya/dokumen', icon: 'bi-folder2-open', tone: 'primary', title: 'Dokumen Keluarga', text: 'KK, KTP, SIM, paspor, BPJS & masa berlaku' },
    { href: '#/keuangan/laporan', icon: 'bi-bar-chart-line', tone: 'info', title: 'Laporan Keuangan', text: 'Laporan bulanan & tahunan, export Excel/PDF' },
    { href: '#/keuangan/anggaran', icon: 'bi-pie-chart', tone: 'success', title: 'Anggaran', text: 'Atur budget & kategori pengeluaran' },
    { href: '#/keuangan/kartu', icon: 'bi-credit-card', tone: 'warning', title: 'Kartu Kredit & Cicilan', text: 'Tagihan, limit & progres cicilan' },
    { href: '#/pengaturan/akun', icon: 'bi-person-circle', tone: 'info', title: 'Akun Saya', text: 'Foto profil, nama & PIN' },
    { href: '#/pengaturan', icon: 'bi-gear', tone: 'secondary', title: 'Pengaturan', text: 'Tema, rekening, pengguna & aturan' },
    { href: '#/pengaturan/backup', icon: 'bi-cloud-arrow-down', tone: 'danger', title: 'Backup', text: 'Export CSV/Excel & tanggal backup terakhir' }
  ];
  container.innerHTML = `<div class="row g-3">${tiles.map((t) => `
    <div class="col-12 col-md-6 col-xl-4"><a href="${t.href}" class="card app-card menu-tile h-100">
      <div class="card-body d-flex align-items-center gap-3">
        <div class="icon-circle icon-${t.tone}"><i class="bi ${t.icon}"></i></div>
        <div class="min-w-0"><div class="fw-semibold">${t.title}</div><div class="small text-muted">${t.text}</div></div>
        <i class="bi bi-chevron-right ms-auto text-muted"></i></div></a></div>`).join('')}</div>`;
}

/* ---------------------------- Router ---------------------------- */

function parseHash() {
  const [page = 'dashboard', sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { page: PAGES[page] ? page : 'dashboard', sub };
}

async function refreshView() {
  const token = ++renderToken;
  const view = $('#view');
  const page = PAGES[currentRoute.page];
  destroyCharts();
  document.title = `${page.title} · Homie`;
  $('#page-title').textContent = window.innerWidth < 992 && currentRoute.page === 'dashboard' ? 'Homie' : page.title;
  $('#page-subtitle').textContent = page.subtitle;
  const fab = $('#fab');
  fab.hidden = !canWrite() || !['dashboard', 'keuangan', 'belanja', 'agenda'].includes(currentRoute.page);
  if (!view.children.length || view.dataset.page !== currentRoute.page + currentRoute.sub) view.innerHTML = pageSkeleton();
  view.dataset.page = currentRoute.page + currentRoute.sub;
  try {
    const content = document.createElement('div');
    content.className = 'view-content';
    const render = page.render(content, currentRoute.sub);
    // Tampilkan konten segera (halaman merender skeleton sendiri), lalu tunggu data selesai.
    if (token === renderToken) view.replaceChildren(content);
    await render;
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    view.innerHTML = errorState(err.message || 'Gagal memuat halaman.');
    view.querySelector('#retry-btn')?.addEventListener('click', refreshView);
  }
}

function onRouteChange() {
  const next = parseHash();
  const samePage = next.page === currentRoute.page && next.sub === currentRoute.sub;
  currentRoute = next;
  renderNav();
  if (!samePage || !$('#view').children.length) {
    window.scrollTo({ top: 0 });
    refreshView();
  }
}

/* ---------------------------- Tombol tambah (FAB) ---------------------------- */

function openQuickAdd() {
  const actions = [
    { id: 'trx', icon: 'bi-receipt', tone: 'primary', label: 'Tambah transaksi', text: 'Pemasukan, pengeluaran, transfer, cicilan' },
    { id: 'pay', icon: 'bi-credit-card-2-back', tone: 'warning', label: 'Bayar kartu kredit', text: 'Kurangi tagihan kartu' },
    { id: 'shop', icon: 'bi-cart-plus', tone: 'success', label: 'Tambah belanja', text: 'Daftar belanja bulan ini' },
    { id: 'agenda', icon: 'bi-calendar-plus', tone: 'info', label: 'Tambah agenda / tugas', text: 'Kegiatan & to-do keluarga' }
  ];
  const modal = openModal({
    title: 'Tambah data',
    fullscreenMobile: false,
    body: `<div class="list-group list-group-flush quick-actions">${actions.map((a) => `
      <button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-quick="${a.id}">
        <span class="icon-circle icon-${a.tone}"><i class="bi ${a.icon}"></i></span>
        <span class="text-start"><span class="fw-semibold d-block">${a.label}</span><small class="text-muted">${a.text}</small></span>
      </button>`).join('')}</div>`
  });
  modal.el.querySelectorAll('[data-quick]').forEach((btn) => btn.addEventListener('click', () => {
    modal.close();
    const action = btn.dataset.quick;
    setTimeout(() => {
      if (action === 'trx') openTransactionForm();
      if (action === 'pay') openTransactionForm(null, { type: 'Pembayaran Kartu Kredit' });
      if (action === 'shop') openShoppingForm();
      if (action === 'agenda') openAgendaForm();
    }, 200);
  }));
}

function handleFab() {
  if (currentRoute.page === 'belanja') return openShoppingForm();
  if (currentRoute.page === 'agenda') return openAgendaForm();
  if (currentRoute.page === 'keuangan') return openTransactionForm();
  return openQuickAdd();
}

/* ---------------------------- Start ---------------------------- */

async function startApp() {
  $('#login-screen').hidden = true;
  $('#splash').hidden = false;
  $('#splash-text').textContent = 'Memuat data keluarga…';
  try {
    await loadMaster(true);
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED') return;
    $('#splash').hidden = true;
    $('#app').hidden = false;
    $('#view').innerHTML = errorState(err.message);
    $('#retry-btn').addEventListener('click', startApp);
    return;
  }
  $('#splash').hidden = true;
  $('#app').hidden = false;
  $('#demo-badge').hidden = !isDemo();
  const demoBanner = $('#demo-banner');
  demoBanner.hidden = !isDemo() || getPref('hideDemoBanner', false);
  demoBanner.innerHTML = `<i class="bi bi-info-circle me-2"></i><span>Mode Demo: data contoh berjalan di browser dan hilang saat halaman dimuat ulang.
    Buat <code>js/config.js</code> berisi URL Apps Script untuk memakai Google Sheets.</span>
    <button class="btn-close btn-sm ms-auto" aria-label="Tutup" id="demo-close"></button>`;
  $('#demo-close').addEventListener('click', () => { demoBanner.hidden = true; setPref('hideDemoBanner', true); });
  currentRoute = parseHash();
  renderNav();
  await refreshView();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) return;
  try {
    navigator.serviceWorker.register('service-worker.js').catch((err) => console.warn('Service worker gagal:', err));
  } catch (err) {
    console.warn('Service worker tidak tersedia:', err);
  }
}

async function boot() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#login-form').addEventListener('submit', handleLogin);
  $('#fab').addEventListener('click', handleFab);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="logout"]')) logout(); });
  window.addEventListener('hashchange', onRouteChange);
  window.addEventListener('app:refresh', refreshView);
  window.addEventListener('app:theme', (e) => { applyTheme(e.detail); refreshView(); });
  window.addEventListener('app:logout', logout);
  window.addEventListener('app:user', renderNav);
  window.addEventListener('auth:expired', (e) => showLogin(e.detail));
  const updateOnline = () => { $('#offline-banner').hidden = navigator.onLine; };
  window.addEventListener('online', () => { updateOnline(); toast('Koneksi internet kembali.', 'info'); });
  window.addEventListener('offline', updateOnline);
  updateOnline();

  await initApi();
  registerServiceWorker();
  if (getSession()?.token) await startApp();
  else showLogin();
}

boot();
