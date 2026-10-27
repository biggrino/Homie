# Instalasi 1 — GitHub Pages + Database Google

Panduan untuk pengguna non-programmer. Perkiraan waktu: 30–45 menit.

**Yang dibutuhkan**

- Akun **Google pribadi** (Gmail). Akun Google Workspace kantor/sekolah sering tidak bisa memilih akses *Anyone* saat deploy — pakai Gmail pribadi.
- Akun **GitHub** gratis (<https://github.com/signup>).
- Folder aplikasi Homie (hasil ekstrak `manajemen-rumah-tangga.zip`).
- Tidak wajib: Git dan Visual Studio Code. Semua langkah bisa dilakukan lewat browser.

> Ingin mencoba dulu tanpa setup? Buka simulasi, atau jalankan folder aplikasi dengan VS Code → klik kanan `index.html` →
> **Open with Live Server**. Tanpa `js/config.js` aplikasi berjalan dalam **Mode Demo** (PIN `1234`, data tidak tersimpan).

---

## BAGIAN A — Database & API di Google (wajib untuk semua pilihan instalasi)

### A1. Buat Google Sheets

1. Buka <https://sheets.google.com> → **Kosong / Blank**.
2. Ganti nama spreadsheet (kiri atas) menjadi **Database Homie**.
3. **Tidak perlu** membuat sheet atau header sendiri. Fungsi `setupDatabase()` di langkah A2 membuat semuanya otomatis:
   `Users, Accounts, Transactions, Categories, Budgets, CreditCards, Installments, Shopping, Agenda, FamilyDocuments, Settings`
   (daftar kolom ada di README bagian E).

### A2. Pasang Google Apps Script

1. Di spreadsheet tadi pilih **Ekstensi → Apps Script** (*Extensions → Apps Script*). Editor baru terbuka di tab lain.
2. Ganti nama project (kiri atas, "Untitled project") menjadi **API Homie**.
3. Buat file sesuai folder `google-apps-script/` (buka file `.gs` dengan Notepad/VS Code, pilih semua, salin, tempel):
   - File `Code.gs` sudah ada → hapus seluruh isinya → tempel isi `google-apps-script/Code.gs`.
   - Klik **+** di samping *Files* → **Script** → ketik `Database` (tanpa `.gs`) → tempel isi `Database.gs`.
   - Ulangi untuk **`Transactions`**, **`Finance`**, **`Shopping`**, **`Agenda`**, **`Documents`**. Total 7 file.
4. Klik ⚙️ **Project Settings** (ikon roda gigi di kiri) →
   - **Time zone**: `(GMT+07:00) Jakarta`.
   - Centang **Show "appsscript.json" manifest file in editor** → kembali ke Editor → buka `appsscript.json` → ganti isinya dengan
     `google-apps-script/appsscript.json`.
5. Klik 💾 **Save project** (Ctrl+S).
6. Biarkan `const SPREADSHEET_ID = '';` di `Code.gs` apa adanya. Karena script dibuat dari menu Ekstensi, script otomatis memakai
   spreadsheet ini. (Hanya jika Anda membuat script terpisah di script.google.com, isi dengan ID spreadsheet — bagian URL di antara
   `/d/` dan `/edit`.)
7. Jalankan setup: pilih fungsi **`setupDatabase`** di dropdown toolbar → **Run**.
   - Muncul **Authorization required** → *Review permissions* → pilih akun Anda → **Advanced** → *Go to API Homie (unsafe)* → **Allow**.
     Peringatan ini normal untuk script buatan sendiri.
   - Tunggu *Execution completed*. Kembali ke spreadsheet: semua sheet, pengguna (PIN awal `1234`), rekening, kartu, kategori,
     dan data contoh sudah terbentuk.

### A3. Deploy API (Web App)

1. Di editor Apps Script klik **Deploy → New deployment**.
2. Klik ⚙️ di samping *Select type* → **Web app**.
3. Isi:
   - Description: `Homie v2`
   - **Execute as: Me**
   - **Who has access: Anyone** (agar website bisa memanggil API tanpa login Google; data tetap dijaga login PIN).
4. **Deploy** → izinkan akses bila diminta.
5. Salin **Web app URL**, bentuknya:

   ```
   https://script.google.com/macros/s/AKfycb.................../exec
   ```

6. Tes: tempel URL itu di browser → harus tampil teks JSON berisi `"API aktif"`.
   Jika yang muncul halaman login/izin Google, ulangi langkah 3 dan pastikan *Who has access: Anyone*.

### A4. Folder Google Drive untuk dokumen keluarga

Menu **Lainnya → Dokumen Keluarga** hanya menyimpan data & **link** dokumen. File KTP/KK/paspor tetap di Drive pribadi Anda.

1. Buka <https://drive.google.com> → **Baru → Folder** → beri nama `Homie - Dokumen Keluarga`.
2. Klik kanan folder → **Bagikan** → tambahkan hanya email pasangan/anggota keluarga yang perlu. Biarkan *Akses umum: Dibatasi*.
3. Unggah hasil scan dokumen ke folder ini. Untuk setiap file: klik kanan → **Bagikan → Salin link**, lalu tempel di kolom
   *Link Google Drive* saat menambah dokumen di aplikasi.
4. Jangan pernah mengubah akses folder/file menjadi *Siapa saja yang memiliki link*.

### A5. Buat file `js/config.js`

1. Di folder aplikasi, salin `js/config.example.js` lalu beri nama **`js/config.js`**.
2. Buka dengan Notepad/VS Code dan isi URL dari langkah A3:

   ```js
   const CONFIG = {
     API_URL: "https://script.google.com/macros/s/AKfycb.................../exec",
     DEMO_MODE: false
   };
   ```

3. Simpan. File ini hanya berisi URL (bukan password), jadi aman ikut diunggah bersama website.

Bagian A selesai. Lanjutkan ke **Bagian B** (GitHub Pages), atau ke panduan
[2 — PC server](INSTALASI-2-PC-SERVER.md) / [3 — hosting gratis lain](INSTALASI-3-HOSTING-GRATIS.md).

---

## BAGIAN B — Website di GitHub Pages

### B1. Buat repository

1. Login GitHub → tombol **+** kanan atas → **New repository**.
2. Repository name: `homie`. Pilih **Public** (GitHub Pages gratis membutuhkan repository publik).
3. Centang **Add a README file** → **Create repository**.

### B2. Unggah file (pilih salah satu)

**Cara 1 — lewat browser (tanpa Git)**

1. Di halaman repository klik **Add file → Upload files**.
2. Buka folder aplikasi di File Explorer, pilih **semua isi di dalam folder** (`index.html`, `manifest.json`, `service-worker.js`,
   folder `css`, `js`, `assets`, `google-apps-script`, `docs`, dan file `.md`) lalu seret ke halaman GitHub.
   Pastikan `js/config.js` ikut. Jangan unggah folder induknya — `index.html` harus berada di halaman utama repository.
3. Jika ditanya menimpa `README.md`, biarkan tertimpa.
4. Tulis pesan *Initial Homie* → **Commit changes**.

**Cara 2 — lewat Git**

```bash
git clone https://github.com/USERNAME/homie.git
cd homie
# salin seluruh isi folder aplikasi ke sini (termasuk js/config.js)
git add .
git commit -m "Initial Homie"
git push origin main
```

### B3. Aktifkan GitHub Pages

1. Repository → **Settings → Pages**.
2. *Build and deployment* → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → **Save**.
3. Tunggu 1–2 menit, lalu buka:

   ```
   https://USERNAME.github.io/homie/
   ```

4. Pastikan **tidak** ada banner *Mode Demo*. Masuk sebagai **Admin**, PIN **1234**.

### B4. Pasang di HP seperti aplikasi

- **Android (Chrome):** buka alamat website → menu ⋮ → **Instal aplikasi / Tambahkan ke layar utama**. Ikon **Homie** muncul di layar HP.
- **iPhone (Safari):** tombol Bagikan → **Tambahkan ke Layar Utama**.

---

## BAGIAN C — Setelah instalasi (penting)

1. **Ganti PIN semua pengguna:** Pengaturan → Kelola Akun Pengguna → **Edit** tiap akun → isi *Reset PIN* (6–8 digit disarankan).
   Setiap anggota bisa menambah foto profil dan mengganti namanya sendiri di **Akun Saya**.
2. **Saldo awal rekening:** Pengaturan → Rekening → ✏️ → saldo pada hari mulai memakai aplikasi.
3. **Kartu kredit:** limit, tanggal cetak, jatuh tempo, persen minimum payment. Tanggal tagihan cicilan (default **16**) ada di
   Pengaturan → Aturan Transaksi.
4. **Hapus data contoh:** Pengaturan → Data Contoh → *Hapus data contoh*.
5. **Anggaran bulan ini:** Keuangan → Anggaran.
6. Coba satu alur lengkap: tambah pengeluaran, belanja → *Catat ke Keuangan*, bayar kartu. Lalu buka spreadsheet dan pastikan barisnya muncul.
   Checklist lengkap ada di README bagian **J**.
7. Bagikan alamat website ke keluarga beserta nama & PIN masing-masing.

## Update aplikasi di kemudian hari

- **Website:** unggah file yang berubah lewat *Add file → Upload files* (atau `git push`). GitHub Pages memperbarui otomatis dalam 1–2 menit.
  Jika HP masih menampilkan versi lama, tutup semua tab Homie lalu buka lagi.
- **Backend (`.gs`):** tempel kode baru di editor Apps Script → Save → **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
  URL Web App tetap sama, `js/config.js` tidak perlu diubah.
- **Upgrade dari versi 1 (Manajemen Rumah Tangga):** ganti semua file `.gs` dan semua file website, lalu deploy versi baru seperti di atas.
  Saat aplikasi pertama kali dibuka, database diperbarui otomatis (kolom baru di ujung kanan sheet Users, CreditCards, Installments,
  Shopping; pengaturan tanggal tagihan cicilan 16). Data lama tidak dihapus dan tidak ada fungsi yang perlu dijalankan manual.

## Masalah umum

| Gejala | Solusi |
|---|---|
| Banner **Mode Demo** masih muncul | `js/config.js` belum terunggah atau URL salah (harus diawali `https://script.google.com/macros/s/` dan diakhiri `/exec`). Tunggu 1–2 menit lalu muat ulang paksa (Ctrl+Shift+R). |
| "Gagal terhubung ke database" | Buka Web App URL di browser; harus tampil `"API aktif"`. Jika muncul halaman login Google, deployment belum *Anyone*. |
| "Respons server tidak dikenali" | Anda memakai URL `/dev` atau akses bukan *Anyone*. Buat deployment baru dan pakai URL `/exec`. |
| Kode `.gs` baru tidak berpengaruh | Wajib *Manage deployments → Edit → New version → Deploy* setiap kali `.gs` diubah. |
| 404 di `USERNAME.github.io/homie` | `index.html` tidak di halaman utama repository (terunggah di dalam subfolder), atau Pages belum diaktifkan. |
| Lupa PIN Admin | Editor Apps Script → buka `Code.gs` → ubah `namaPengguna` & `pinBaru` di fungsi `gantiPinManual` → pilih fungsi itu → Run. |
