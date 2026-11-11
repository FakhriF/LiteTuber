# Panduan pemakaian

Panduan ini untuk pemakaian sehari-hari. Referensi teknis ada di
[ARCHITECTURE.md](ARCHITECTURE.md); build dan CI ada di [CI-WINDOWS.md](CI-WINDOWS.md) dan
[DESKTOP.md](DESKTOP.md).

## 1. Pilih cara menjalankan

| Mode | Cocok untuk | Butuh |
|---|---|---|
| Browser lokal | coding, testing, semua OS | Node.js 18+ |
| Desktop Tauri (Windows) | pemakaian stream, tanpa terminal | installer NSIS |

Keduanya membuka alamat yang sama, `http://127.0.0.1:8770/`, dan OBS tetap memakai
`http://127.0.0.1:8770/?ui=0`. Jadi kamu bisa pindah mode tanpa mengubah source OBS.

**Browser:**

```bash
cd ~/Projects/vtuber-lite
npm install      # sekali saja
npm start        # build + jalankan server
```

**Desktop:** jalankan installer, lalu buka **LiteTuber** dari Start Menu. Kalau installer belum
dibuat, lihat [CI-WINDOWS.md](CI-WINDOWS.md). Untuk development di laptop Linux:

```bash
npm run tauri dev
```

### Kalau memakai installer Windows

1. Buka halaman **Releases** repo, pilih versi terbaru, lalu unduh `*-setup.exe` dari **Assets**.
   File di Releases tidak perlu akun GitHub. Kalau belum ada rilis, ambil artifact `litetuber-nsis`
   dari **Actions → Tauri Windows** (perlu login).
2. Jalankan file `*-setup.exe`.
3. Kalau Windows menampilkan SmartScreen, pilih **More info → Run anyway**. Build ini belum
   ditandatangani.
4. Buka **LiteTuber** dari Start Menu.
5. Jendela LiteTuber adalah panel. Biarkan terbuka saat OBS dipakai.

Untuk update, tutup app lalu jalankan installer versi baru. Data di `%APPDATA%` tidak dihapus.
Untuk uninstall, pakai **Settings → Apps → LiteTuber → Uninstall**.

## 2. Pertama kali

1. Buka `http://127.0.0.1:8770/` (atau jendela LiteTuber).
2. Pilih avatar: tarik file `.vrm` ke jendela, atau klik **Pilih .vrm** di tab **Avatar**.
   Upload 15 MB butuh beberapa detik; nama file akan menampilkan persentase. File yang bukan VRM
   ditolak dan avatar lama tetap aman.
3. Buka tab **Wajah**, klik **Aktifkan kamera**, lalu izinkan akses kamera. Kalau ada beberapa
   kamera, pilih di dropdown yang muncul.
4. Hadap depan dengan posisi netral, lalu klik **Kalibrasi** (atau tekan `R`). Ini menyimpan patokan
   arah kepala supaya avatar tidak miring terus.
5. Opsional: buka tab **Mulut**, klik **Aktifkan mic**, izinkan akses mic, lalu pilih sumber mulut
   **Kamera + Mic**, **Kamera saja**, atau **Mic saja**.
6. Atur latar, framing, zoom, dan batas FPS di tab **Tampilan**.

Setelan langsung tersimpan dan dipakai lagi saat app dibuka berikutnya. Avatar juga disimpan di
server, jadi tidak perlu upload ulang.

## 3. Arti tab di panel

| Tab | Isi |
|---|---|
| **Avatar** | Pilih/ganti avatar, hapus avatar tersimpan (tombol `✕`). |
| **Wajah** | Aktifkan kamera, kalibrasi, sensitivitas, smoothing, mirror, balik X/Y/Z, prosesor tracking (GPU/CPU), dan on/off fitur (kepala, mata, kedip, ekspresi, idle, fisika rambut). |
| **Mulut** | Aktifkan mic, sumber gerak mulut, sensitivitas mic, level mic, tes gerak mulut, kedip otomatis. |
| **Tampilan** | Latar (transparan/green/blue/gambar), framing, zoom, exposure, batas FPS, kualitas render, kualitas otomatis, rate tracking, dan tombol **Salin URL untuk OBS**. |

Tombol `–` di kanan atas menyembunyikan panel; tekan `H` untuk memunculkannya lagi.

## 4. Memasang di OBS

1. Pastikan panel LiteTuber **tetap terbuka** (browser atau jendela desktop), dan tab-nya tidak
   diminimize total. Panel yang aktif mengirim gerakan live.
2. Di OBS: **Sources → + → Browser**.
3. URL: `http://127.0.0.1:8770/?ui=0` — tombol **Salin URL untuk OBS** di tab Tampilan juga bisa.
4. Width `1920`, Height `1080`.
5. Background transparan otomatis. Kalau mau green screen, pilih **Green** di panel, bukan di OBS.
6. Untuk audio stream, tambahkan **Audio Input Capture** di OBS dan pilih mic kamu. Mic di LiteTuber
   hanya dipakai untuk menggerakkan mulut; suaranya tidak dikeluarkan oleh app.

Source OBS adalah **tampilan saja**. Jangan buka panel kedua di OBS: tidak ada tombol kamera di sana,
dan semua pengaturan memang dilakukan dari panel browser. Badge **OBS off / OBS 1** di tab Tampilan
menunjukkan berapa source yang benar-benar menerima gerakan.

Setelah update LiteTuber, reload source OBS sekali (**klik kanan → Refresh**). URL-nya tidak berubah.

## 5. Status rilis

Saat ini yang tersedia:

- mode browser lewat `npm start`,
- build dari source untuk desktop,
- workflow yang menghasilkan installer NSIS lewat GitHub Actions.

Belum tersedia:

- installer resmi yang sudah diuji di Windows,
- distribusi portable/ZIP,
- tanda tangan installer,
- paket MSIX untuk Microsoft Store.

Kalau installer belum ada, tetap bisa memakai mode browser. Semua data dan URL OBS sama.

## 6. Di mana data disimpan

| Data | Lokasi |
|---|---|
| Setelan dan nama avatar | `state.json` di folder data server |
| File avatar | `avatar.vrm` di folder data server |
| Background gambar | `background.json` di folder data server |
| Salinan setelan di browser | `localStorage` |
| Salinan avatar/background di browser | IndexedDB |

Folder data server:

- Mode browser: `data/` di dalam repo.
- Mode desktop: `%APPDATA%\app.litetuber.desktop\` (Windows).

OBS tidak menyimpan avatar sendiri; dia mengambil dari server lewat URL yang sama. Jadi ganti avatar
cukup sekali di panel.

**Reset:** tombol `✕` di tab Avatar menghapus avatar tersimpan. Untuk reset total, tutup app lalu
hapus folder data di atas. Di browser, hapus juga site data `127.0.0.1:8770` kalau ingin setelan
benar-benar kembali ke default.

**Pindah komputer:** salin folder data server (dan installer kalau memakai mode desktop), lalu
jalankan app di komputer baru.

## 7. Shortcut

| Tombol | Fungsi |
|---|---|
| `H` | sembunyikan/tampilkan panel |
| `R` | kalibrasi posisi netral kepala |
| `F` | fullscreen |

## 8. Troubleshooting

**Kamera tidak muncul atau "wajah: tidak ada"**
Pastikan tidak ada app lain yang memakai webcam. Cek izin kamera di browser (ikon gembok) atau di
Windows **Settings → Privacy & security → Camera**. Di desktop, izinkan desktop apps memakai kamera.
Coba cahaya lebih terang, jarak ±50 cm, dan pilih kamera yang benar di dropdown.

**Mic tidak menggerakkan mulut**
Pastikan **Aktifkan mic** sudah diklik, sumber mulut bukan **Kamera saja**, dan meter level bergerak
saat kamu bicara. Naikkan **Sensitivitas mic** kalau meter bergerak tapi mulut kurang terbuka.

**Kamera atau mic terputus saat dipakai**
LiteTuber mencoba menyambung ulang otomatis maksimal 3 kali dengan jeda 2, 5, lalu 10 detik. Kalau
device tidak kembali, status di panel berubah dan tombol **Aktifkan kamera** / **Aktifkan mic** bisa
diklik untuk mencoba lagi. Izin yang ditolak tidak diulang otomatis; ubah izin di browser atau
Windows Settings dulu. Kalau device yang dipakai hilang, aplikasi beralih ke device default dan
menampilkan pemberitahuan. Status **mic: suspended** berarti browser menahan audio; klik sekali di
halaman untuk mengaktifkannya.

**Avatar terlalu gelap/terang**
Atur **Exposure** di tab Tampilan.

**Arah kepala terbalik**
Coba **Balik X/Y/Z** di bagian Lanjutan tab Wajah. Untuk kamera yang tampil seperti cermin, biarkan
**Mirror** aktif.

**Panel ikut kerekam di OBS**
Gunakan URL `http://127.0.0.1:8770/?ui=0`, bukan URL panel.

**Avatar di OBS diam**
Panel harus terbuka dan tidak diminimize. Reload source OBS sekali, lalu cek badge **OBS 1**. Kalau
masih **OBS off**, pastikan source memakai `?ui=0` dan server yang sama.

**Avatar/setelan tidak sama di OBS**
Pastikan hanya ada satu server di port 8770. Kalau ada dua instance, tutup salah satunya. Reload
source OBS setelah mengganti avatar atau setelan.

**Port 8770 sudah dipakai**
Tutup LiteTuber lain atau `npm start` yang masih jalan. Versi desktop sengaja memakai server yang
sudah ada supaya OBS tidak terputus.

**Kualitas turun sendiri**
Itu **Kualitas otomatis**: resolusi dan rate tracking diturunkan saat FPS turun, lalu dinaikkan lagi
kalau sudah lancar. Matikan di tab Tampilan kalau ingin nilai tetap.

**Windows SmartScreen muncul saat install**
Installer dari CI belum ditandatangani. Pilih **More info → Run anyway** kalau kamu percaya sumber
build-nya. Ini akan hilang kalau nanti ada sertifikat atau rilis lewat Microsoft Store.

**Tracking terasa berat**
Set batas FPS `30`, framing **Kepala & bahu**, dan biarkan kualitas otomatis aktif. Kalau GPU
bermasalah, pilih prosesor tracking **CPU** (lebih lambat tapi lebih kompatibel). `?worker=0` bisa
dipakai untuk kembali ke tracking main thread saat diagnosa.
