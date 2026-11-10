# Build Windows & CI

Jawaban singkat: **PC gaming tidak perlu dipakai untuk CI.** Build installer Windows sebaiknya
dijalankan di runner Windows milik GitHub Actions. PC gaming cukup dipakai sekali untuk smoke test
setelah installer jadi.

## Kenapa tidak bisa dari laptop Linux

Tauri memakai toolchain Windows asli:

- linker MSVC,
- Windows SDK,
- WebView2,
- NSIS/WiX untuk installer.

Cross-compile dari Linux bisa dicoba, tetapi tidak didukung resmi dan rawan gagal. Jangan jadikan
jalur utama.

## Pilihan CI

| Cara | Butuh PC gaming? | Catatan |
|---|---|---|
| GitHub Actions `windows-latest` | tidak | Paling simpel. Gratis untuk repo publik; repo privat memakai kuota menit bulanan. |
| Gitea Actions + runner sendiri | ya | Runner harus jalan di Windows, jadi PC gaming harus nyala saat build. Cocok hanya kalau repo wajib tetap di Gitea. |
| Build manual di PC gaming | ya | Perlu install Rust, Node, dan Visual Studio Build Tools. Tidak perlu CI, tapi repot dan tidak reproducible. |

Rekomendasi: **mirror repo ke GitHub, pakai GitHub Actions untuk build Windows.** Gitea/Tencent
tetap bisa menjadi remote utama untuk kode sehari-hari.

## Workflow yang sudah ada

File: `.github/workflows/tauri.yml`. Isinya:

- jalan di `windows-latest` lewat `workflow_dispatch` atau tag `v*`,
- memasang Node 20, Rust stable, dan cache Cargo,
- menjalankan `npm ci`, `npm test`, `npm run build`,
- membuild installer NSIS dengan `tauri-action`,
- mengunggah `.exe` sebagai artifact `litetuber-nsis`.

Belum ada pembuatan GitHub Release otomatis. Untuk rilis, ambil artifact dari halaman run lalu
upload manual; nanti bisa ditambah `tagName`/`releaseDraft` di `tauri-action`.

## Alur kerja yang disarankan

1. Kode tetap ditulis dan dites di laptop Linux:
   `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`.
2. Push ke Gitea, lalu mirror ke GitHub (remote `github`).
3. Buka tab **Actions → Tauri Windows → Run workflow** di GitHub, atau buat tag `v0.1.0`.
4. Unduh artifact `litetuber-nsis` dari halaman run.
5. Pasang installer itu di PC gaming sekali, lalu cek:
   - app terbuka dan server lokal jalan,
   - kamera/mic berfungsi,
   - OBS Browser Source `http://127.0.0.1:8770/?ui=0` menerima pose.

PC gaming tidak perlu Node, Rust, atau Visual Studio. Cukup jadi mesin uji.

## Build desktop dari laptop Linux

Scaffold Tauri bisa dikompilasi di Linux untuk menangkap error:

```bash
npm run build
npm run tauri build -- --debug --no-bundle
```

Hasilnya binary Linux di `src-tauri/target/debug/litetuber`. Installer Windows tetap harus dibuild
di Windows/CI karena memakai NSIS dan toolchain MSVC.


## Catatan signing

- Installer yang dibuild CI **belum ditandatangani**. Windows SmartScreen akan menampilkan
  peringatan sampai ada sertifikat Authenticode.
- Jalur Microsoft Store memakai MSIX; Store menandatangani ulang setelah sertifikasi.
- Tambahkan signing di CI nanti setelah sertifikat tersedia; jangan taruh certificate di repo.
