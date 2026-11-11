# Roadmap

Status per November 2026. Dokumen ini berisi rencana kerja, bukan jadwal rilis. Urutan dapat berubah
sesuai laporan bug dan kebutuhan pengguna.

## Sudah ada

- Installer Windows (NSIS) dan release otomatis dari tag `v*`.
- Mode browser dan desktop Tauri dengan URL yang sama, `http://127.0.0.1:8770/`.
- Avatar VRM 0.x dan 1.0, tracking wajah MediaPipe di Web Worker.
- Relay pose ke OBS, jadi OBS hanya menampilkan.
- Gerak mulut dari kamera/mic, adaptive quality, ETag, dan upload avatar dengan validasi.
- Test Vitest dan Rust, plus CI Linux dan Windows.

## v0.2: reliability kamera dan mic

Tujuan: tracking tetap berjalan dan status perangkat selalu jelas saat kamera atau mic bermasalah.
Tidak ada fitur baru di rilis ini.

1. **Deteksi device putus.** Jika track kamera atau mic berakhir (kabel dicabut, device dimatikan),
   status di panel berubah, avatar berhenti dengan rapi, dan muncul pesan yang jelas.
2. **Pemulihan otomatis.** Sambung ulang maksimal 3 kali dengan jeda 2, 5, lalu 10 detik. Jika
   masih gagal, proses berhenti dan panel menampilkan tombol coba lagi. Tidak ada percobaan ulang
   berulang saat izin ditolak.
3. **Perubahan device.** `devicechange` memperbarui daftar kamera dan mic. Jika device yang sedang
   dipakai hilang, aplikasi berpindah ke device default dan menampilkan pemberitahuan.
4. **Mic suspended.** Jika AudioContext di-suspend browser, statusnya ditampilkan dan resume
   dicoba saat panel diklik.

Kriteria selesai:

- Webcam dicabut lalu dipasang kembali saat tracking berjalan: avatar berhenti, lalu pulih tanpa reload.
- Mic diganti saat aktif: gerak mulut mengikuti device baru.
- Izin kamera atau mic ditolak: tidak ada retry berulang dan pesan tetap jelas.
- `npm test` dan `cargo test` lulus, termasuk test untuk logika pemulihan.

## v0.3

- **Portable ZIP.** Versi tanpa installer. Data tetap di `%APPDATA%`; mode benar-benar portable
  (data di sebelah `.exe`) diputuskan terpisah karena mengubah cara server mencari folder data.
- **Profil/preset.** Simpan kombinasi avatar dan setelan, lalu pindah tanpa mengatur ulang.
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
