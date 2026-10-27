# Instalasi 2 — PC Server di Rumah

Website Homie dijalankan dari sebuah PC/laptop/mini-PC di rumah, lalu dibuka dari HP dan laptop keluarga lewat Wi-Fi rumah.
**Database tetap Google Sheets + Apps Script** (Bagian A panduan 1), sehingga data aman walaupun PC rusak atau mati.

```
HP / laptop keluarga ──Wi-Fi rumah──▶ PC server (website Homie) 
        │                                   
        └───────────── internet ───────────▶ Google Apps Script ─▶ Google Sheets
```

Browser HP yang memanggil Google langsung. PC server hanya menyajikan file website, jadi PC kecil pun cukup
(Windows 10/11, Linux, atau Raspberry Pi).

**Kelebihan:** alamat website tidak publik, tidak perlu GitHub.
**Kekurangan:** PC harus menyala saat website dibuka. Di Wi-Fi rumah alamatnya `http://` (bukan https), sehingga fitur
*install aplikasi* (PWA) di HP hanya menjadi shortcut biasa — gunakan Tailscale HTTPS (langkah 5) bila ingin PWA penuh.

---

## Langkah 1 — Siapkan database Google

Kerjakan **Bagian A** di [INSTALASI-1-GITHUB-GOOGLE.md](INSTALASI-1-GITHUB-GOOGLE.md#bagian-a--database--api-di-google-wajib-untuk-semua-pilihan-instalasi)
sampai file `js/config.js` berisi Web App URL.

## Langkah 2 — Pasang web server

Pilih sesuai sistem operasi PC.

### Pilihan A — Windows 10/11 dengan XAMPP

1. Unduh **XAMPP for Windows** dari <https://www.apachefriends.org> dan instal (cukup centang komponen **Apache**).
2. Salin **isi** folder aplikasi ke `C:\xampp\htdocs\homie\` sehingga ada file `C:\xampp\htdocs\homie\index.html`
   dan `C:\xampp\htdocs\homie\js\config.js`.
3. Buka **XAMPP Control Panel** → klik **Start** di baris *Apache*.
   Jika muncul peringatan **Windows Defender Firewall**, centang **Private networks** → **Allow access**.
4. Tes di PC tersebut: buka `http://localhost/homie/` → halaman login Homie tampil tanpa banner Mode Demo.
5. Agar Apache menyala otomatis setiap PC dihidupkan: tutup XAMPP, buka lagi dengan **klik kanan → Run as administrator**,
   lalu klik tanda ✖ merah di kolom *Service* baris Apache → **Yes** (Apache dipasang sebagai Windows Service).

> Port 80 bentrok (Apache tidak mau Start)? Biasanya karena Skype/IIS. Di XAMPP: *Config → Apache (httpd.conf)* → ganti
> `Listen 80` menjadi `Listen 8080`, simpan, Start lagi. Alamat menjadi `http://localhost:8080/homie/`.

### Pilihan B — Linux (Ubuntu/Debian/Raspberry Pi OS) dengan Nginx

```bash
sudo apt update
sudo apt install -y nginx
sudo mkdir -p /var/www/homie
sudo cp -r ~/manajemen-rumah-tangga/* /var/www/homie/     # sesuaikan lokasi folder aplikasi
sudo chown -R www-data:www-data /var/www/homie
```

Buat konfigurasi situs:

```bash
sudo nano /etc/nginx/sites-available/homie
```

Isi:

```nginx
server {
    listen 80 default_server;
    server_name _;
    root /var/www/homie;
    index index.html;

    # File yang harus selalu versi terbaru
    location ~ ^/(index\.html|service-worker\.js|manifest\.json|js/config\.js)$ {
        add_header Cache-Control "no-cache";
    }
    location / {
        try_files $uri $uri/ =404;
    }
}
```

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/homie /etc/nginx/sites-enabled/homie
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable nginx                 # otomatis menyala saat boot
sudo ufw allow 'Nginx HTTP' 2>/dev/null      # jika firewall ufw aktif
```

Tes: `http://localhost/` di PC tersebut.

### Pilihan C — Uji coba cepat (tanpa instal web server)

Hanya untuk mencoba; berhenti saat jendela terminal ditutup. Butuh Python 3.

```bash
cd folder-aplikasi-homie
python -m http.server 8080        # Windows: py -m http.server 8080
```

Buka `http://localhost:8080/`.

## Langkah 3 — Buka dari HP lewat Wi-Fi rumah

1. Cari alamat IP PC:
   - Windows: buka *Command Prompt* → ketik `ipconfig` → lihat **IPv4 Address**, misalnya `192.168.1.10`.
   - Linux: `hostname -I`.
2. Di HP yang tersambung ke **Wi-Fi yang sama**, buka:
   - XAMPP: `http://192.168.1.10/homie/`
   - Nginx: `http://192.168.1.10/`
3. Agar alamat IP tidak berubah-ubah, buka pengaturan router (biasanya `192.168.1.1` atau tertulis di stiker router) →
   menu **DHCP / LAN** → **Address Reservation / Static Lease** → pilih PC server → simpan. Atau atur IP statis di PC.
4. Tambahkan ke layar utama HP: Chrome → ⋮ → **Tambahkan ke layar utama** (akan menjadi shortcut, karena alamatnya http).

## Langkah 4 — Pengaturan PC server

- Matikan **Sleep/Hibernate** otomatis (Windows: *Settings → System → Power* → Sleep: *Never* saat tersambung listrik).
- Nyalakan PC setelah listrik padam: di BIOS/UEFI aktifkan *Restore on AC Power Loss* bila tersedia.
- Jangan membuka port 80 di router ke internet (*port forwarding*). Untuk akses dari luar rumah gunakan langkah 5.

## Langkah 5 (opsional) — Akses dari luar rumah + HTTPS dengan Tailscale

Tailscale adalah VPN gratis untuk pemakaian pribadi: hanya perangkat yang login ke akun Tailscale Anda yang bisa membuka website.

1. Daftar di <https://tailscale.com> (bisa login dengan akun Google).
2. Instal **Tailscale** di PC server dan di setiap HP/laptop keluarga, login dengan akun yang sama
   (atau undang anggota keluarga dari halaman admin Tailscale).
3. Dari HP (data seluler pun bisa), buka `http://NAMA-PC/homie/` (XAMPP) atau `http://NAMA-PC/` (Nginx).
   `NAMA-PC` adalah nama perangkat PC di aplikasi Tailscale; bisa juga memakai alamat `100.x.y.z` yang tertera di sana.
4. **HTTPS + PWA penuh:** di halaman admin Tailscale → **DNS** → aktifkan **MagicDNS** dan **HTTPS Certificates**.
   Lalu di PC server jalankan (Windows: *Command Prompt as administrator*; Linux: pakai `sudo`):

   ```bash
   tailscale serve --bg 80
   ```

   Website kini tersedia di `https://NAMA-PC.NAMA-TAILNET.ts.net/` (XAMPP: tambahkan `homie/` di belakangnya).
   Dari alamat https ini Homie bisa di-*install* sebagai aplikasi di HP dan bekerja dengan service worker.

## Update aplikasi

1. Timpa file di `C:\xampp\htdocs\homie\` atau `/var/www/homie/` dengan versi baru. **Jangan hapus `js/config.js`.**
2. Untuk backend `.gs`, ikuti bagian *Update aplikasi* di panduan 1 (Deploy → New version).
3. Di HP, tutup semua tab Homie lalu buka lagi.

## Masalah umum

| Gejala | Solusi |
|---|---|
| HP tidak bisa membuka `http://192.168.x.x` | HP dan PC harus di Wi-Fi yang sama; izinkan Apache/Nginx di firewall (Windows: *Windows Defender Firewall → Allow an app* → centang *Apache HTTP Server* untuk Private). Pastikan jaringan Wi-Fi di Windows berjenis **Private**, bukan Public. |
| Banner Mode Demo | `js/config.js` tidak ikut tersalin ke folder server. |
| "Gagal terhubung ke database" | PC/HP tidak punya internet, atau Web App URL salah. Website boleh lokal, tetapi database di Google tetap butuh internet. |
| Tidak ada tombol *Install aplikasi* | Normal untuk alamat `http://` di jaringan rumah. Pakai langkah 5 (Tailscale HTTPS) atau pilihan instalasi 1/3. |
| Apache tidak mau Start | Port 80 dipakai program lain — lihat catatan ganti ke `Listen 8080` di Pilihan A. |
