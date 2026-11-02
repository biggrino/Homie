# Backend Google Apps Script

Folder ini berisi backend/API aplikasi. File `.gs` **tidak** dijalankan oleh GitHub Pages — isinya disalin ke editor Apps Script
(Mode Demo di browser juga membaca file ini agar logikanya sama persis).

## File yang dibuat di editor Apps Script

Editor Apps Script tidak mengenal folder, jadi buat file berikut (nama tanpa `.gs`, editor menambahkannya otomatis):

| Nama file di editor | Salin dari | Isi |
|---|---|---|
| `Code` | `Code.gs` | Konfigurasi (`SPREADSHEET_ID`), `doGet`/`doPost`, router `ROUTES`, login PIN, profil (`updateProfile`), pengaturan, validasi & tanggal |
| `Database` | `Database.gs` | `SCHEMA`, `setupDatabase()`, helper baca/tulis tabel, data default & contoh, `deleteSampleData()` |
| `Transactions` | `Transactions.gs` | `getTransactions`, `addTransaction`, `updateTransaction`, `deleteTransaction` + validasi |
| `Finance` | `Finance.gs` | Saldo rekening, kartu kredit, cicilan, kategori, anggaran, `getDashboard`, `getSummary`, `getReport` |
| `Shopping` | `Shopping.gs` | `getShopping`, `addShopping`, `updateShopping`, `deleteShopping`, `copyShopping`, `checkoutShopping` (belanja → 1 transaksi Pengeluaran) |
| `Agenda` | `Agenda.gs` | `getAgenda`, `addAgenda`, `updateAgenda`, `deleteAgenda` |
| `Documents` | `Documents.gs` | `getDocuments`, `addDocument`, `updateDocument`, `deleteDocument` |
| `appsscript.json` | `appsscript.json` | Manifest: zona waktu `Asia/Jakarta`, runtime V8 (tampilkan lewat Project Settings) |

Urutan file tidak berpengaruh — semua file `.gs` berbagi satu ruang global.

## Fungsi yang bisa dijalankan dari editor

| Fungsi | Kegunaan |
|---|---|
| `setupDatabase` | Membuat sheet + header, data default (rekening, kartu, kategori, pengguna PIN 1234) dan data contoh. Aman diulang — data yang ada tidak ditimpa. |
| `gantiPinManual` | Reset PIN bila Admin lupa: ubah `namaPengguna` & `pinBaru` di dalam fungsi, lalu Run. |
| `deleteSampleData` | Menghapus data contoh (sama dengan tombol di menu Pengaturan). |
| `aktifkanBackupDrive` | Dijalankan sekali setelah update ke versi 3 agar Google meminta izin Drive untuk tombol *Backup ke Google Drive*. Tidak mengubah data. |

Fungsi berakhiran `_` (misalnya `handleRequest_`) adalah fungsi internal.

## Mode update otomatis (Homie Loader)

Sebagai ganti semua file di atas, editor Apps Script cukup berisi `loader/Loader.gs` dan `loader/appsscript.json`.
Loader mengambil file `.gs` yang terdaftar di `versi.json` dari situs GitHub Pages (`HOMIE_SOURCE_URL`), menyimpannya di Script Properties,
dan memeriksa versi baru setiap `HOMIE_CHECK_MINUTES` menit. Fungsi editor yang tersedia: `izinkanAkses` (jalankan sekali setelah memasang),
`perbaruiSekarang` (ambil kode terbaru sekarang), dan `setupDatabase`. Langkah lengkap ada di README utama → *Cara update aplikasi*.

Saat merilis versi baru: naikkan `SERVER_VERSION` di `Code.gs`, `version` di `versi.json`, `APP_VERSION` di `js/settings.js`,
dan `CACHE_VERSION` di `service-worker.js` dengan nomor yang sama. Jika menambah file `.gs`, daftarkan juga di `versi.json`
dan `GAS_FILES` pada `js/demo-backend.js`.

## Format API

Semua permintaan dikirim sebagai **POST** ke Web App URL dengan body JSON (header `Content-Type: text/plain` agar tidak memicu CORS preflight):

```json
{ "action": "getDashboard", "token": "…", "data": { "month": 9, "year": 2026 } }
```

Respons selalu:

```json
{ "success": true, "message": "Berhasil", "data": { } }
{ "success": false, "message": "Saldo Mandiri tidak mencukupi untuk transaksi ini. Saldo saat ini Rp1.200.000.", "code": "INSUFFICIENT" }
```

`code` membantu frontend: `AUTH_REQUIRED` (login ulang), `FORBIDDEN` (role tidak cukup), `DUPLICATE` (transaksi kembar — kirim ulang dengan
`allowDuplicate: true` bila memang disengaja), `INSUFFICIENT`, `OVER_LIMIT`, `NOT_FOUND`, `VALIDATION`, `BUSY`.

Aksi versi 3: `getContracts` (`{ id?, status? }`), `saveContract` (`{ id?, contractNo, lender, item, tenor, monthlyPayment, firstDueDate,
paidBefore, paymentAccount, category, notes }`), `deleteContract` (`{ id }`, pembayaran tetap di Jurnal), `payContract`
(`{ contractId, date, sourceAccount, amount }` → mencatat Pengeluaran yang terhubung ke kontrak), dan `backupToDrive` (membuat salinan
spreadsheet ke folder `BACKUP_FOLDER_URL`; kode error `NO_BACKUP_FOLDER` / `BACKUP_FAILED`). `getCreditCards` kini mengembalikan
`cardNumber` (4 digit terakhir), `purchases` (tabel pembelian per kartu), dan `billThisMonth`.

`GET` hanya melayani `ping` dan `getUsers` (membuka Web App URL di browser = cek API aktif).

## Hak akses

| Role | Hak |
|---|---|
| Admin | Semua fungsi, termasuk pengguna, aturan transfer, link folder backup, hapus data contoh |
| Bapak, Ibu | Melihat dan mengubah data, termasuk kredit kontrak dan tombol Backup ke Google Drive |
| Viewer | Hanya melihat (semua aksi tulis ditolak di backend) |

## Catatan teknis

- Penulisan data memakai `LockService` agar dua orang yang menyimpan bersamaan tidak saling menimpa.
- Kolom tanggal, jam, dan nomor dokumen diformat **teks** agar tidak diubah otomatis oleh Google Sheets. Teks yang diawali `= + - @` disimpan sebagai teks biasa (mencegah formula injection).
- Setelah setiap perubahan transaksi, kolom `CurrentBalance`, `Outstanding`, `AvailableLimit`, dan progres cicilan ditulis ulang dari hasil hitung — sumber kebenarannya tetap sheet Transactions.
- Idempotensi: `addTransaction` menerima `requestId`; permintaan yang sama dalam 10 menit tidak membuat transaksi ganda (misalnya karena tombol ditekan dua kali / koneksi putus).
- Setiap mengubah kode: **Deploy → Manage deployments → Edit → New version → Deploy**.
