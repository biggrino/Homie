/**
 * api.js — komunikasi dengan Google Apps Script Web App.
 * Semua permintaan dikirim sebagai POST text/plain berisi JSON agar tidak memicu CORS preflight.
 * Bila API_URL belum diisi, aplikasi berjalan dalam Mode Demo (lihat demo-backend.js).
 */
import { loadDemoRuntime } from './demo-backend.js';

const TOKEN_KEY = 'mrt_session';
const REQUEST_TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(message, code = 'ERROR') {
    super(message);
    this.code = code;
  }
}

const state = {
  config: null,
  demo: false,
  session: readSession(),
  pending: 0,
  master: null
};

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
  } catch {
    return null;
  }
}

/** Memuat js/config.js (opsional). Jika tidak ada → Mode Demo. */
export function initApi() {
  return new Promise((resolve) => {
    const finish = () => {
      // eslint-disable-next-line no-undef
      const config = typeof CONFIG !== 'undefined' ? CONFIG : window.CONFIG;
      const url = config && String(config.API_URL || '').trim();
      state.config = config || {};
      state.demo = Boolean(state.config.DEMO_MODE) || !url || !/^https:\/\/script\.google(usercontent)?\.com\//.test(url);
      resolve({ demo: state.demo, config: state.config });
    };
    const script = document.createElement('script');
    script.src = 'js/config.js?v=' + Date.now();
    script.onload = finish;
    script.onerror = finish;
    document.head.appendChild(script);
  });
}

export const isDemo = () => state.demo;
export const getSession = () => state.session;
export const getUser = () => state.session?.user || null;
export const canWrite = () => ['Admin', 'Bapak', 'Ibu'].includes(getUser()?.role);
export const isAdmin = () => getUser()?.role === 'Admin';
export const getApiUrl = () => (state.demo ? '' : state.config.API_URL);

export function setSession(session) {
  state.session = session;
  try {
    if (session) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sessionStorage tidak tersedia */
  }
}

/** Memperbarui nama/role/foto pengguna yang sedang login (misalnya setelah ubah profil). */
export function updateSessionUser(user) {
  if (!state.session) return;
  setSession({ ...state.session, user: { ...state.session.user, ...user } });
}

function setLoading(delta) {
  state.pending = Math.max(0, state.pending + delta);
  document.body.classList.toggle('is-loading', state.pending > 0);
}

async function sendToServer(body) {
  if (!navigator.onLine) {
    throw new ApiError('Tidak ada koneksi internet. Periksa jaringan Anda lalu coba lagi.', 'OFFLINE');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(state.config.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError('Server terlalu lama merespons. Coba lagi sebentar lagi.', 'TIMEOUT');
    throw new ApiError('Gagal terhubung ke database. Periksa koneksi internet atau URL API di js/config.js.', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ApiError(`Server Google Apps Script tidak tersedia (kode ${response.status}). Coba lagi nanti.`, 'HTTP');
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('Respons server tidak dikenali. Pastikan Web App di-deploy dengan akses "Anyone" dan URL diakhiri /exec.', 'BAD_RESPONSE');
  }
}

async function sendToDemo(body) {
  const runtime = await loadDemoRuntime();
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  return runtime.handle(body);
}

/**
 * Memanggil aksi API. Mengembalikan objek { success, message, data } bila berhasil,
 * atau melempar ApiError dengan pesan yang mudah dipahami.
 */
export async function api(action, data = {}) {
  setLoading(1);
  try {
    const body = { action, data, token: state.session?.token };
    const result = state.demo ? await sendToDemo(body) : await sendToServer(body);
    if (!result || typeof result.success !== 'boolean') {
      throw new ApiError('Respons server tidak lengkap.', 'BAD_RESPONSE');
    }
    if (!result.success) {
      if (result.code === 'AUTH_REQUIRED') {
        setSession(null);
        window.dispatchEvent(new CustomEvent('auth:expired', { detail: result.message }));
      }
      throw new ApiError(result.message || 'Terjadi kesalahan.', result.code);
    }
    return result;
  } finally {
    setLoading(-1);
  }
}

/* ---------------- Data master (rekening, kartu, kategori) yang sering dipakai form ---------------- */

export async function loadMaster(force = false) {
  if (!state.master || force) {
    const res = await api('getMasterData');
    state.master = res.data;
    if (res.data.user) updateSessionUser(res.data.user);
  }
  return state.master;
}

export const getMaster = () => state.master;

export function clearMaster() {
  state.master = null;
}

export function accountName(id) {
  const m = state.master;
  if (!m) return id;
  const found = m.accounts.find((a) => a.id === id) || m.cards.find((c) => c.id === id);
  return found ? found.name : id;
}
