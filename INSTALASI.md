# Panduan Instalasi Homie

Homie terdiri dari dua bagian:

| Bagian | Isi | Di mana dijalankan |
|---|---|---|
| **Database & API** | Google Sheets (data), Google Apps Script (API/backend), Google Drive (file dokumen keluarga) | Selalu di akun Google Anda — **sama untuk semua pilihan instalasi** |
| **Website (frontend)** | `index.html`, `css/`, `js/`, `assets/`, `manifest.json`, `service-worker.js` | Boleh di GitHub Pages, di PC sendiri, atau di hosting gratis lain |

Jadi Anda selalu mengerjakan **Bagian A (database Google)** satu kali, lalu memilih **satu** tempat untuk website.

## Pilih cara instalasi

| | 1. GitHub Pages + Google | 2. PC server di rumah | 3. Hosting gratis lain |
|---|---|---|---|
| Panduan | [docs/INSTALASI-1-GITHUB-GOOGLE.md](docs/INSTALASI-1-GITHUB-GOOGLE.md) | [docs/INSTALASI-2-PC-SERVER.md](docs/INSTALASI-2-PC-SERVER.md) | [docs/INSTALASI-3-HOSTING-GRATIS.md](docs/INSTALASI-3-HOSTING-GRATIS.md) |
| Biaya | Gratis | Gratis (listrik PC) | Gratis |
| Bisa dibuka dari luar rumah | Ya | Hanya lewat Tailscale (VPN gratis) | Ya |
| HTTPS & install ke layar HP (PWA) | Ya | Lewat Tailscale HTTPS; di Wi-Fi rumah (http) hanya shortcut biasa | Ya |
| PC harus menyala | Tidak | **Ya** | Tidak |
| Kode website publik | Ya (repository publik) | Tidak | Tidak (Netlify/Cloudflare upload manual) |
| Paling cocok untuk | Pilihan utama, paling sederhana dirawat | Keluarga yang ingin website hanya bisa dibuka dari perangkat sendiri | Tidak mau memakai GitHub, atau ingin nama alamat berbeda |

> **Rekomendasi:** mulai dengan **Pilihan 1**. Pilihan 2 dan 3 memakai database Google yang sama, jadi Anda bisa pindah kapan saja
> tanpa kehilangan data — cukup pasang folder website yang sama (berisi `js/config.js`) di tempat baru.

## Isi panduan

1. **[GitHub Pages + database Google](docs/INSTALASI-1-GITHUB-GOOGLE.md)**
   Bagian A: Google Sheets, Apps Script, deploy API, folder Google Drive. Bagian B: website di GitHub Pages (upload lewat browser atau Git).
2. **[PC server di rumah](docs/INSTALASI-2-PC-SERVER.md)**
   Windows (XAMPP) atau Linux/Raspberry Pi (Nginx), dibuka dari HP lewat Wi-Fi rumah, akses dari luar rumah dengan Tailscale, jalan otomatis saat PC menyala.
3. **[Hosting gratis lain](docs/INSTALASI-3-HOSTING-GRATIS.md)**
   Netlify (seret-lepas folder), Cloudflare Pages, dan Vercel.

## Yang perlu diingat untuk semua pilihan

- `js/config.js` berisi **Web App URL** Apps Script. File ini harus ikut di folder website. Tanpa file ini aplikasi masuk **Mode Demo**
  (data contoh di browser, tidak tersimpan).
- Jangan pernah menaruh password Gmail, OAuth secret, API key, atau file KTP/KK/paspor di folder website atau repository.
  Dokumen keluarga tetap di Google Drive pribadi; aplikasi hanya menyimpan link-nya.
- Login PIN Homie adalah pengaman sederhana untuk keluarga, **bukan** autentikasi tingkat produksi. Baca bagian
  *Keamanan & keterbatasan* di [README.md](README.md).
- Setelah instalasi: ganti PIN semua pengguna, sesuaikan saldo awal & kartu kredit, lalu hapus data contoh
  (detail di akhir panduan 1).
