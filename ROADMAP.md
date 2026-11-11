# Roadmap

Status per November 2026. Ini rencana kerja, bukan jadwal rilis.

## Sudah ada

- Installer Windows (NSIS) dan release otomatis dari tag `v*`.
- Mode browser dan desktop Tauri dengan URL yang sama, `http://127.0.0.1:8770/`.
- Avatar VRM 0.x dan 1.0, tracking wajah MediaPipe di Web Worker.
- Relay pose ke OBS, jadi OBS hanya menampilkan.
- Gerak mulut dari kamera/mic, adaptive quality, ETag, dan upload avatar dengan validasi.
- Test Vitest dan Rust, plus CI Linux dan Windows.

## Berikutnya

1. **Kamera dan mic lebih tahan gangguan.** Pulih sendiri setelah device dicabut, izin ditolak, atau
   mic berganti; tampilkan pesan yang jelas, bukan diam.
2. **Profil/preset.** Simpan kombinasi avatar dan setelan (misalnya "streaming" dan "testing"), lalu
   pindah tanpa mengatur ulang.
3. **Portable ZIP.** Versi tanpa installer untuk orang yang tidak mau memasang aplikasi.
4. **Pisah `main.js`.** Pecah loop render, sinkronisasi, dan UI supaya lebih mudah dirawat. Tidak ada
   perubahan perilaku yang direncanakan.

## Setelah itu

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
