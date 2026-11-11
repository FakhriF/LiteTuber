# LiteTuber

LiteTuber menampilkan avatar VRM di browser. Kepala, mata, dan mulut mengikuti webcam dan mic, lalu
hasilnya dipakai sebagai Browser Source di OBS. Model yang didukung VRM 0.x dan 1.0; Live2D tidak
didukung. Semua proses berjalan di komputer sendiri.

Panduan pemakaian: [docs/PANDUAN.md](docs/PANDUAN.md). Rencana berikutnya: [ROADMAP.md](ROADMAP.md).

## Install di Windows

Installer ada di halaman [Releases](https://github.com/FakhriF/LiteTuber/releases). Tidak perlu akun
GitHub untuk mengunduh.

1. Buka **Releases** dan pilih versi terbaru.
2. Unduh file `*-setup.exe` dari bagian **Assets**.
3. Jalankan installer. Kalau SmartScreen muncul, pilih **More info** lalu **Run anyway**. Build ini
   belum ditandatangani.
4. Buka **LiteTuber** dari Start Menu.
5. Di OBS, tambahkan **Browser Source** dengan URL `http://127.0.0.1:8770/?ui=0` dan ukuran
   `1920×1080`.

Biarkan jendela LiteTuber terbuka selama dipakai. Jendela itu panel pengaturan, sedangkan OBS hanya
menampilkan. Data aplikasi disimpan di `%APPDATA%\app.litetuber.desktop\`.

Mulai v0.3.0, versi tanpa installer juga tersedia: unduh `*-portable.zip`, ekstrak, lalu jalankan
`LiteTuber.exe`. Data tetap disimpan di `%APPDATA%`, jadi setelan, avatar, dan profil tidak hilang
saat folder ZIP dipindah. Butuh WebView2 Runtime; Windows 10/11 biasanya sudah punya.

Kalau ingin mencoba build yang belum dirilis, artifact Actions bisa diunduh dari tab **Actions**
(perlu login GitHub). Artifact installer bernama `litetuber-nsis`, versi portable bernama
`litetuber-portable`. Cara build dan rilis ada di [docs/CI-WINDOWS.md](docs/CI-WINDOWS.md).

## Jalankan dari source

Butuh Node.js 18 atau lebih baru.

```bash
cd ~/Projects/vtuber-lite
npm install
npm start
```

Buka `http://127.0.0.1:8770/`. Kalau hanya ingin menjalankan server tanpa build ulang, pakai
`npm run serve`.

## Pakai di OBS

1. Jalankan LiteTuber dan buka panelnya. Jangan tutup atau minimize panel selama OBS dipakai.
2. Di OBS, klik **+** pada **Sources** lalu pilih **Browser**.
3. Isi URL `http://127.0.0.1:8770/?ui=0`. Tombol **Salin URL untuk OBS** di panel menghasilkan URL
   yang sama.
4. Atur width `1920` dan height `1080`.
5. Latar transparan aktif sendiri. Kalau butuh green screen, pilih **Green** di panel.

OBS tidak membuka kamera sendiri. Panel mengirim gerakan ke OBS lewat server lokal. Di tab
**Tampilan** ada badge **OBS off / OBS 1** yang menunjukkan apakah OBS sudah tersambung.

Setelah update, klik kanan source OBS lalu **Refresh**. URL-nya tidak berubah.

## Fitur

- Avatar VRM 0.x dan 1.0, lewat drag and drop atau tombol pilih file.
- Tracking kepala, kedip, ekspresi, dan arah mata.
- Gerak mulut dari kamera, mic, atau keduanya.
- Latar transparan, green, blue, atau gambar.
- Framing kepala-bahu, setengah badan, atau seluruh badan.
- Animasi idle dan fisika rambut.
- Penyesuaian kualitas berdasarkan FPS.
- Pemulihan kamera dan mic setelah device putus atau berganti.
- Preset setelan: simpan kombinasi framing, kualitas, dan latar dengan nama.
- Profil lengkap: simpan avatar, gambar latar, dan setelan sekaligus, lalu pindah profil tanpa upload ulang.
- Ekspor/impor preset sebagai JSON untuk memindahkannya ke browser atau PC lain.
- Upload avatar dengan validasi dan progres; avatar lama tidak rusak kalau file ditolak.
- Setelan, preset, dan profil disimpan lokal dan dipakai lagi oleh OBS.

## Data

Mode browser menyimpan data di folder `data/`. Mode desktop menyimpan di
`%APPDATA%\app.litetuber.desktop\`. OBS mengambil avatar dari server yang sama, jadi tidak ada
salinan terpisah. Setiap profil menyimpan salinan avatar dan latarnya di subfolder `profiles/`,
sedangkan avatar dan latar yang sedang aktif tetap di root folder data. Update installer tidak
menghapus folder ini; jalankan installer baru tanpa uninstall.

Tombol `✕` di tab Avatar menghapus avatar yang tersimpan. Cara reset dan pindah komputer ada di
[docs/PANDUAN.md](docs/PANDUAN.md).

## Shortcut

| Tombol | Fungsi |
| --- | --- |
| `H` | sembunyikan/tampilkan panel |
| `R` | kalibrasi posisi netral kepala |
| `F` | fullscreen |

## Kalau ada masalah

- **Kamera tidak muncul**: cek izin kamera di browser atau Windows, dan pastikan webcam tidak dipakai
  aplikasi lain.
- **Panel ikut terekam**: pakai URL `?ui=0`, bukan URL panel.
- **Avatar diam di OBS**: panel harus terbuka dan tidak diminimize. Refresh source OBS, lalu cek
  badge **OBS 1**.
- **Kualitas turun sendiri**: itu penyesuaian otomatis. Matikan di tab Tampilan kalau tidak mau.

Masalah lain dan langkah lengkapnya ada di [docs/PANDUAN.md](docs/PANDUAN.md).

## Development

Butuh Node.js 18 atau lebih baru. Untuk build desktop, butuh Rust stable dan dependensi Tauri.

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

MIT, lihat [LICENSE](LICENSE). Model contoh tidak disertakan. Lisensi dependensi ada di
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
