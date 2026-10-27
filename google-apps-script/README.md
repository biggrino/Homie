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

Fungsi berakhiran `_` (misalnya `handleRequest_`) adalah fungsi internal.

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

`GET` hanya melayani `ping` dan `getUsers` (membuka Web App URL di browser = cek API aktif).

## Hak akses

| Role | Hak |
|---|---|
| Admin | Semua fungsi, termasuk pengguna, aturan transfer, hapus data contoh |
| Bapak, Ibu | Melihat dan mengubah data |
| Viewer | Hanya melihat (semua aksi tulis ditolak di backend) |

## Catatan teknis

- Penulisan data memakai `LockService` agar dua orang yang menyimpan bersamaan tidak saling menimpa.
- Kolom tanggal, jam, dan nomor dokumen diformat **teks** agar tidak diubah otomatis oleh Google Sheets. Teks yang diawali `= + - @` disimpan sebagai teks biasa (mencegah formula injection).
- Setelah setiap perubahan transaksi, kolom `CurrentBalance`, `Outstanding`, `AvailableLimit`, dan progres cicilan ditulis ulang dari hasil hitung — sumber kebenarannya tetap sheet Transactions.
- Idempotensi: `addTransaction` menerima `requestId`; permintaan yang sama dalam 10 menit tidak membuat transaksi ganda (misalnya karena tombol ditekan dua kali / koneksi putus).
- Setiap mengubah kode: **Deploy → Manage deployments → Edit → New version → Deploy**.
