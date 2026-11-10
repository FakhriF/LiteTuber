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

## Workflow yang dipakai nanti

Tambahkan setelah scaffold `src-tauri/` ada:

```yaml
name: Tauri Windows

on:
  workflow_dispatch:
  push:
    tags: ["v*"]

jobs:
  build:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - uses: dtolnay/rust-toolchain@stable

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: "./src-tauri -> target"

      - run: npm ci
      - run: npm run build

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v__VERSION__
          releaseName: "LiteTuber v__VERSION__"
          releaseDraft: true
          prerelease: false
```

Workflow ini menghasilkan installer NSIS/MSI dan menaruhnya di GitHub Releases (draft). Setelah
scaffold Tauri, `package.json` juga perlu:

```json
{
  "scripts": {
    "tauri": "tauri"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  }
}
```

## Alur kerja yang disarankan

1. Kode tetap ditulis dan dites di laptop Linux:
   `npm test`, `npm run build`.
2. Push ke Gitea dan mirror ke GitHub.
3. Jalankan workflow **Tauri Windows** secara manual, atau buat tag `v0.1.0`.
4. Unduh installer dari GitHub Releases.
5. Pasang installer itu di PC gaming sekali, lalu cek:
   - app terbuka dan server lokal jalan,
   - kamera/mic berfungsi,
   - OBS Browser Source `http://127.0.0.1:8770/?ui=0` menerima pose.

PC gaming tidak perlu Node, Rust, atau Visual Studio. Cukup jadi mesin uji.

## Catatan signing

- Installer yang dibuild CI **belum ditandatangani**. Windows SmartScreen akan menampilkan
  peringatan sampai ada sertifikat Authenticode.
- Jalur Microsoft Store memakai MSIX; Store menandatangani ulang setelah sertifikasi.
- Tambahkan signing di CI nanti setelah sertifikat tersedia; jangan taruh certificate di repo.
