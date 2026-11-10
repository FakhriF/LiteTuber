# LiteTuber

Aplikasi VTuber untuk avatar VRM. Render model `.vrm` di browser, gerakkan kepala, mata, dan mulut dari webcam/mic, lalu tampilkan di OBS sebagai Browser Source.

Fokusnya avatar VRM (VRM 0.x dan 1.0). Tidak memakai model Live2D. Semua berjalan lokal; tidak ada data yang dikirim ke mana-mana.

Panduan lengkap: [docs/PANDUAN.md](docs/PANDUAN.md).

## Install di Windows

Installer belum tersedia sebagai download resmi. Kalau build dari GitHub Actions sudah ada:

1. Buka repo di GitHub, masuk **Actions → Tauri Windows**, lalu pilih run terbaru.
2. Unduh artifact `litetuber-nsis`, ekstrak, lalu jalankan file `*-setup.exe`.
3. Kalau muncul SmartScreen, pilih **More info → Run anyway**. Build ini belum ditandatangani.
4. Buka **LiteTuber** dari Start Menu.
5. Tambahkan **Browser Source** di OBS dengan URL `http://127.0.0.1:8770/?ui=0`, ukuran `1920×1080`.

Jendela LiteTuber adalah panel pengaturan. Biarkan tetap terbuka saat OBS dipakai. Data app disimpan
di `%APPDATA%\app.litetuber.desktop\`.

Cara membuat installer lewat CI ada di [docs/CI-WINDOWS.md](docs/CI-WINDOWS.md).

## Jalankan tanpa installer

Butuh Node.js 18+.

```bash
cd ~/Projects/vtuber-lite
npm install      # sekali saja
npm start        # build + jalankan server
```

Buka `http://127.0.0.1:8770/`, pilih avatar, lalu nyalakan kamera dan mic dari panel.

Kalau sudah pernah build dan cuma mau menjalankan server:

```bash
npm run serve
```

## Pakai di OBS

1. Jalankan LiteTuber (app desktop atau `npm start`) dan biarkan panel tetap terbuka.
2. Di OBS: **Sources → + → Browser**.
3. URL: `http://127.0.0.1:8770/?ui=0`. Tombol **Salin URL untuk OBS** di panel juga bisa.
4. Width `1920`, Height `1080`.
5. Background transparan otomatis. Untuk green screen, pilih **Green** di panel.

Source OBS hanya menampilkan. Gerakan dikirim dari panel lewat relay lokal, jadi OBS tidak perlu
kamera sendiri. Badge **OBS off / OBS 1** di tab Tampilan menunjukkan apakah relay tersambung.

Setelah update, reload source OBS sekali (**klik kanan → Refresh**). URL-nya tetap sama.

## Fitur

- Avatar VRM 0.x dan 1.0, bisa drag & drop atau pilih file.
- Tracking wajah: kepala, kedip, ekspresi, dan arah mata.
- Gerak mulut dari kamera dan/atau mic, dengan 5 bentuk vokal.
- Background transparan, green, blue, atau gambar.
- Framing kepala–bahu, setengah badan, atau seluruh badan.
- Animasi idle dan fisika rambut.
- Kualitas otomatis: resolusi dan rate tracking menyesuaikan FPS.
- Upload avatar divalidasi, dengan progres dan tanpa merusak avatar lama.
- Pengaturan tersimpan di server lokal dan ikut terbaca oleh OBS.

## Data

- Mode browser: folder `data/` di repo.
- Mode desktop: `%APPDATA%\app.litetuber.desktop\` (Windows).
- OBS tidak menyimpan avatar sendiri; dia mengambil dari server lewat URL yang sama.

Tombol `✕` di tab Avatar menghapus avatar tersimpan. Detail reset dan pindah komputer ada di
[docs/PANDUAN.md](docs/PANDUAN.md).

## Shortcut

| Tombol | Fungsi |
| --- | --- |
| `H` | sembunyikan/tampilkan panel |
| `R` | kalibrasi posisi netral kepala |
| `F` | fullscreen |

## Troubleshooting

**Kamera tidak muncul** — cek izin kamera di browser atau Windows, dan pastikan tidak ada app lain
yang memakai webcam.

**Panel ikut kerekam di OBS** — pakai URL `?ui=0`, bukan URL panel.

**Avatar di OBS diam** — panel harus terbuka dan tidak diminimize. Reload source OBS, lalu cek badge
**OBS 1**.

**Kualitas turun sendiri** — itu fitur kualitas otomatis. Matikan di tab Tampilan kalau tidak mau.

Masalah lain dan langkah lengkapnya ada di [docs/PANDUAN.md](docs/PANDUAN.md).

## Development

Butuh Node.js 18+. Untuk build desktop, butuh Rust stable dan dependensi Tauri.

```bash
npm test        # Vitest
npm run build   # produksi ke dist/
npm run serve   # jalankan server tanpa build ulang
npm run tauri dev
cargo test --manifest-path src-tauri/Cargo.toml
```

Struktur modul dan alur data ada di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Build installer
Windows dan CI ada di [docs/CI-WINDOWS.md](docs/CI-WINDOWS.md); arsitektur desktop ada di
[docs/DESKTOP.md](docs/DESKTOP.md).

CI menjalankan `npm ci`, `npm test`, dan `npm run build` di Node 22 dan 24. Workflow Tauri Windows
menjalankan test yang sama, `cargo test`, lalu membuild installer NSIS.

## Lisensi

MIT — lihat [LICENSE](LICENSE). Model contoh tidak disertakan. Lisensi dependensi ada di
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
