# Roadmap

Status per November 2026. Dokumen ini berisi rencana kerja, bukan jadwal rilis. Urutan dapat berubah
sesuai laporan bug dan kebutuhan pengguna.

## Sudah ada

- Installer Windows (NSIS) dan release otomatis dari tag `v*`.
- Mode browser dan desktop Tauri dengan URL yang sama, `http://127.0.0.1:8770/`.
- Avatar VRM 0.x dan 1.0, tracking wajah MediaPipe di Web Worker.
- Relay pose ke OBS, jadi OBS hanya menampilkan.
- Gerak mulut dari kamera/mic, adaptive quality, ETag, dan upload avatar dengan validasi.
- Pemulihan kamera dan mic: track putus terdeteksi, sambung ulang otomatis 3 kali (jeda 2, 5, 10
  detik), pindah ke device default saat device hilang, dan status mic suspended bisa di-resume.
- Test Vitest dan Rust, plus CI Linux dan Windows.

## v0.3

- **Portable ZIP.** Versi tanpa installer. Data tetap di `%APPDATA%`; mode benar-benar portable
  (data di sebelah `.exe`) diputuskan terpisah karena mengubah cara server mencari folder data.
- **Profil/preset.** Simpan kombinasi avatar, background, dan setelan, lalu pindah tanpa mengatur
  ulang. Ini bukan sekadar daftar setelan: server sekarang hanya menyimpan satu `avatar.vrm` dan
  satu `background.json`, jadi preset yang mengganti avatar butuh salinan aset per profil dan API
  baru. Dikerjakan bertahap: preset setelan dulu, lalu profil lengkap dengan aset.
- **Pisah `main.js`.** Pecah loop render, sinkronisasi, dan UI. Tidak ada perubahan perilaku.

## Rencana lanjutan

- **MSIX dan Microsoft Store.** Cara termurah menghilangkan SmartScreen karena Store menandatangani
  ulang paketnya.
- **Hotkey/Stream Deck.** Ganti ekspresi, background, atau profil dari tombol.
- **Auto-update.** Butuh installer yang ditandatangani lebih dulu.
- **English UI dan dokumentasi.** Dilakukan sebagai satu pass supaya istilah di app dan dokumen
  tetap sama.
- **Hand tracking.** Ditunda sampai ada kebutuhan framing full-body; biayanya model tambahan,
  finger bone VRM yang belum tentu ada, dan latency lebih tinggi.

## Tidak direncanakan

- Live2D.
- Electron.
- Render di cloud atau akun online.
