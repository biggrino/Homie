# Instalasi 3 — Hosting Gratis Lain

Selain GitHub Pages, website Homie bisa dipasang di layanan hosting statis gratis berikut. Semuanya menyediakan **HTTPS**
(jadi Homie bisa di-*install* di HP sebagai aplikasi) dan tidak membutuhkan server sendiri.
**Database tetap Google Sheets + Apps Script** dari Bagian A panduan 1.

| Layanan | Cara unggah | Alamat gratis | Cocok untuk |
|---|---|---|---|
| **Netlify** | Seret-lepas folder di browser | `nama.netlify.app` | Paling mudah, tanpa GitHub |
| **Cloudflare Pages** | Unggah folder/zip di browser, atau sambungkan GitHub | `nama.pages.dev` | Cepat di Indonesia, tanpa GitHub |
| **Vercel** | Sambungkan repository GitHub | `nama.vercel.app` | Sudah punya repository GitHub (panduan 1) |

Semua layanan di atas punya paket gratis yang cukup untuk pemakaian keluarga. Batas paket bisa berubah; periksa halaman harga
masing-masing layanan. Vercel paket Hobby ditujukan untuk pemakaian pribadi/non-komersial.

---

## Langkah 0 — Siapkan database & folder website

1. Kerjakan **Bagian A** di [INSTALASI-1-GITHUB-GOOGLE.md](INSTALASI-1-GITHUB-GOOGLE.md#bagian-a--database--api-di-google-wajib-untuk-semua-pilihan-instalasi)
   sampai `js/config.js` berisi Web App URL.
2. Pastikan folder website berisi `index.html` di tingkat paling atas, bersama `css/`, `js/` (termasuk `config.js`), `assets/`,
   `manifest.json`, dan `service-worker.js`. Folder `docs/` dan `google-apps-script/` boleh ikut (tidak berbahaya) atau dihapus.

---

## Pilihan A — Netlify (seret-lepas)

1. Daftar/masuk di <https://app.netlify.com> (bisa pakai akun Google). Masuk dulu agar situs tidak terhapus otomatis.
2. Buka **Sites** → **Add new site → Deploy manually** (atau buka <https://app.netlify.com/drop>).
3. Seret **folder website** (yang berisi `index.html`) ke kotak unggah. Tunggu sampai status **Published**.
4. Ganti nama alamat: **Site configuration → Change site name** → misalnya `homie-keluarga` →
   alamat menjadi `https://homie-keluarga.netlify.app`.
5. Buka alamat itu → login Admin, PIN `1234`. Pastikan tidak ada banner Mode Demo.

**Update:** buka situs → tab **Deploys** → seret folder versi baru ke kotak *Drag and drop your site output folder here*.

## Pilihan B — Cloudflare Pages

1. Daftar/masuk di <https://dash.cloudflare.com>.
2. Menu **Workers & Pages** → **Create** → pilih **Pages** → **Upload assets** (*Direct Upload*).
   (Tampilan Cloudflare kadang berubah; cari opsi *Pages* dengan unggah file langsung.)
3. Project name: `homie` → **Create project**.
4. Seret **folder website** atau file **zip** berisi folder website → **Deploy site**.
5. Alamat: `https://homie.pages.dev` (jika nama sudah dipakai orang lain, Cloudflare menambahkan akhiran).

**Update:** buka project → **Create deployment** / **Upload assets** → unggah folder versi baru.

**Alternatif otomatis:** jika kode sudah ada di GitHub (panduan 1), pilih **Connect to Git** → pilih repository `homie` →
*Framework preset*: **None**, *Build command*: kosongkan, *Build output directory*: `/` → **Save and Deploy**.
Setiap `git push` akan memperbarui situs otomatis.

## Pilihan C — Vercel (butuh repository GitHub)

1. Selesaikan Bagian B1–B2 di panduan 1 (repository `homie` berisi file aplikasi termasuk `js/config.js`). Repository boleh **Private**.
2. Masuk ke <https://vercel.com> dengan akun GitHub → **Add New… → Project** → **Import** repository `homie`.
3. *Framework Preset*: **Other**. *Build Command*: kosongkan / override kosong. *Output Directory*: `.` (titik, artinya folder utama).
4. **Deploy**. Alamat: `https://homie-xxxx.vercel.app` (bisa diganti di *Settings → Domains*).

**Update:** cukup unggah/`git push` ke repository; Vercel men-deploy ulang otomatis.

---

## Setelah instalasi

Lanjutkan **Bagian C — Setelah instalasi** di panduan 1 (ganti PIN, saldo awal, kartu kredit, hapus data contoh).

## Catatan

- Anda boleh memasang website di lebih dari satu tempat sekaligus (misalnya GitHub Pages dan Netlify). Semuanya memakai database
  Google yang sama, jadi datanya identik.
- Domain sendiri (misalnya `homie.namakeluarga.id`) bisa ditambahkan di menu *Domains* masing-masing layanan; domain berbayar.
- Jangan unggah file backup (`backup-*.xlsx`, `transaksi-*.csv`) atau scan dokumen pribadi ke folder website.

## Masalah umum

| Gejala | Solusi |
|---|---|
| Halaman 404 / kosong | `index.html` tidak berada di tingkat paling atas folder yang diunggah (terbungkus satu folder lagi). Unggah isi foldernya. |
| Banner Mode Demo | `js/config.js` tidak ikut terunggah. Periksa daftar file di menu deploy layanan tersebut. |
| Tampilan lama setelah update | Tutup semua tab Homie di HP lalu buka lagi; service worker mengambil versi terbaru. |
| "Gagal terhubung ke database" | Buka Web App URL di browser; harus tampil `"API aktif"` (lihat panduan 1, langkah A3). |
