/**
 * ui.js — komponen antarmuka yang dipakai ulang: toast, modal, dialog konfirmasi,
 * skeleton loading, empty state, progress bar, dan grafik Chart.js.
 */
import { escapeHtml, formatRupiah, formatCompactRupiah, getPref } from './utils.js';

/* ---------------------------- Avatar & foto profil ---------------------------- */

/** Avatar pengguna: foto profil bila ada, jika tidak huruf depan nama. size: '' | 'avatar-lg' | 'avatar-xl'. */
export function avatar(user, size = '') {
  const name = user?.name || '?';
  if (user?.photo && /^data:image\/(jpeg|png|webp);base64,/.test(user.photo)) {
    return `<span class="avatar has-photo ${size}"><img src="${escapeHtml(user.photo)}" alt="Foto ${escapeHtml(name)}"></span>`;
  }
  return `<span class="avatar ${size}">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
}

/**
 * Mengecilkan foto dari kamera/galeri menjadi JPEG persegi 192×192 (±10–25 KB) agar muat di Google Sheets.
 * Foto tidak pernah disimpan di repository GitHub.
 */
export function resizePhoto(file, size = 192) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('File harus berupa gambar (JPG/PNG).'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('Ukuran foto maksimal 15 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let quality = 0.85;
      let data = canvas.toDataURL('image/jpeg', quality);
      while (data.length > 40000 && quality > 0.4) {
        quality -= 0.15;
        data = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Foto tidak dapat dibaca. Coba foto lain.'));
    };
    img.src = url;
  });
}

/* ---------------------------- Toast ---------------------------- */

const TOAST_ICONS = {
  success: 'bi-check-circle-fill',
  error: 'bi-x-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill'
};

export function toast(message, type = 'success', delay = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `app-toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i class="bi ${TOAST_ICONS[type] || TOAST_ICONS.info}"></i><div class="flex-grow-1">${escapeHtml(message)}</div>
    <button type="button" class="btn-close btn-close-sm" aria-label="Tutup"></button>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('.btn-close').addEventListener('click', close);
  setTimeout(close, type === 'error' ? Math.max(delay, 6000) : delay);
}

export function toastError(err) {
  toast(err?.message || 'Terjadi kesalahan. Coba lagi.', err?.code === 'VALIDATION' || err?.code === 'INSUFFICIENT' || err?.code === 'OVER_LIMIT' ? 'warning' : 'error');
}

/* ---------------------------- Modal ---------------------------- */

/**
 * Membuka modal Bootstrap. `body` berupa HTML string. Mengembalikan { el, body, close }.
 * Modal otomatis dihapus dari DOM setelah ditutup.
 */
export function openModal({ title, body, footer = '', size = '', fullscreenMobile = true, onClose } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'modal fade';
  wrapper.tabIndex = -1;
  wrapper.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size} ${fullscreenMobile ? 'modal-fullscreen-sm-down' : ''}">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${title}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Tutup"></button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    </div>`;
  document.body.appendChild(wrapper);
  const instance = new bootstrap.Modal(wrapper);
  wrapper.addEventListener('hidden.bs.modal', () => {
    instance.dispose();
    wrapper.remove();
    onClose?.();
  });
  instance.show();
  return { el: wrapper, body: wrapper.querySelector('.modal-body'), close: () => instance.hide() };
}

/** Dialog konfirmasi (pengganti confirm()). Mengembalikan Promise<boolean>. */
export function confirmDialog({ title = 'Konfirmasi', message, confirmText = 'Ya, lanjutkan', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      size: 'modal-sm',
      fullscreenMobile: false,
      body: `<p class="mb-0">${escapeHtml(message)}</p>`,
      footer: `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Batal</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button>`,
      onClose: () => { if (!answered) resolve(false); }
    });
    modal.el.querySelector('[data-confirm]').addEventListener('click', () => {
      answered = true;
      resolve(true);
      modal.close();
    });
  });
}

/* ---------------------------- Status tampilan ---------------------------- */

export function skeleton(lines = 3, type = 'cards') {
  if (type === 'list') {
    return `<div class="skeleton-list">${'<div class="skeleton skeleton-row"></div>'.repeat(lines)}</div>`;
  }
  return `<div class="row g-3">${Array.from({ length: lines }, () =>
    '<div class="col-6 col-lg-4"><div class="skeleton skeleton-card"></div></div>').join('')}</div>`;
}

export function pageSkeleton() {
  return `<div class="page-skeleton" aria-busy="true" aria-label="Memuat data">
    <div class="skeleton skeleton-title"></div>${skeleton(6)}<div class="mt-3">${skeleton(4, 'list')}</div></div>`;
}

export function emptyState(icon, text, action = '') {
  return `<div class="empty-state"><i class="bi ${icon}"></i><p>${escapeHtml(text)}</p>${action}</div>`;
}

export function errorState(message, retryId = 'retry-btn') {
  return `<div class="empty-state error-state"><i class="bi bi-wifi-off"></i>
    <p>${escapeHtml(message)}</p>
    <button class="btn btn-primary btn-sm" id="${retryId}"><i class="bi bi-arrow-clockwise me-1"></i>Coba lagi</button></div>`;
}

export function setButtonLoading(button, loading, text = 'Menyimpan…') {
  if (!button) return;
  if (loading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>${escapeHtml(text)}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

export function progressBar(value, { tone = 'auto', height = 8 } = {}) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const color = tone !== 'auto' ? tone : value >= 100 ? 'danger' : value >= 80 ? 'warning' : 'success';
  return `<div class="progress app-progress" style="height:${height}px" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="progress-bar bg-${color}" style="width:${pct}%"></div></div>`;
}

/** Angka ringkas yang bisa diklik untuk menampilkan angka lengkap. */
export function moneyToggle(value, extraClass = '') {
  const compact = getPref('compactNumbers', true);
  return `<span class="money-toggle ${extraClass}" data-full="${formatRupiah(value)}" data-compact="${formatCompactRupiah(value)}"
    data-state="${compact ? 'compact' : 'full'}">${compact ? formatCompactRupiah(value) : formatRupiah(value)}</span>`;
}

export function bindMoneyToggles(root) {
  root.querySelectorAll('[data-toggle-money]').forEach((card) => {
    card.addEventListener('click', () => {
      card.querySelectorAll('.money-toggle').forEach((el) => {
        const toFull = el.dataset.state === 'compact';
        el.textContent = toFull ? el.dataset.full : el.dataset.compact;
        el.dataset.state = toFull ? 'full' : 'compact';
      });
      card.classList.toggle('expanded');
    });
  });
}

export function typeBadge(type) {
  const map = {
    Pemasukan: ['success', 'bi-arrow-down-left'],
    Pengeluaran: ['danger', 'bi-arrow-up-right'],
    Transfer: ['info', 'bi-arrow-left-right'],
    'Pembayaran Kartu Kredit': ['primary', 'bi-credit-card-2-back'],
    Cicilan: ['warning', 'bi-calendar2-range']
  };
  const [tone, icon] = map[type] || ['secondary', 'bi-dot'];
  const label = type === 'Pembayaran Kartu Kredit' ? 'Bayar Kartu' : type;
  return `<span class="badge-soft badge-soft-${tone}"><i class="bi ${icon}"></i>${escapeHtml(label)}</span>`;
}

export function trxIcon(type) {
  return {
    Pemasukan: 'bi-arrow-down-left', Pengeluaran: 'bi-arrow-up-right', Transfer: 'bi-arrow-left-right',
    'Pembayaran Kartu Kredit': 'bi-credit-card-2-back', Cicilan: 'bi-calendar2-range'
  }[type] || 'bi-dot';
}

/* ---------------------------- Chart.js ---------------------------- */

const charts = new Set();

export function destroyCharts() {
  charts.forEach((chart) => chart.destroy());
  charts.clear();
}

function chartTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--app-muted').trim() || '#64748b',
    grid: styles.getPropertyValue('--app-border').trim() || '#e2e8f0',
    font: "'Plus Jakarta Sans', system-ui, sans-serif"
  };
}

export function createChart(canvas, config) {
  if (!window.Chart || !canvas) return null;
  const theme = chartTheme();
  Chart.defaults.color = theme.text;
  Chart.defaults.font.family = theme.font;
  Chart.defaults.borderColor = theme.grid;
  config.options = { animation: { duration: 450 }, ...config.options };
  const chart = new Chart(canvas, config);
  charts.add(chart);
  return chart;
}

export function doughnutChart(canvas, items, { valueKey = 'amount', labelKey = 'category' } = {}) {
  return createChart(canvas, {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i[labelKey]),
      datasets: [{ data: items.map((i) => i[valueKey]), backgroundColor: items.map((i) => i.color), borderWidth: 2,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--app-surface').trim() || '#fff' }]
    },
    options: {
      cutout: '64%',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${formatRupiah(ctx.parsed)}` } }
      }
    }
  });
}

export function chartLegend(items, total) {
  return `<ul class="chart-legend">${items.map((i) => `
    <li><span class="dot" style="background:${i.color}"></span><span class="flex-grow-1 text-truncate">${escapeHtml(i.category)}</span>
      <span class="text-muted small me-2">${total ? Math.round((i.amount / total) * 100) : 0}%</span>
      <strong>${formatCompactRupiah(i.amount)}</strong></li>`).join('')}</ul>`;
}
