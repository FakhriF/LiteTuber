# Roadmap

Status per November 2026. Ini rencana kerja, bukan jadwal rilis.

## Sudah ada

- Installer Windows (NSIS) dan release otomatis dari tag `v*`.
- Mode browser dan desktop Tauri dengan URL yang sama, `http://127.0.0.1:8770/`.
- Avatar VRM 0.x dan 1.0, tracking wajah MediaPipe di Web Worker.
- Relay pose ke OBS, jadi OBS hanya menampilkan.
- Gerak mulut dari kamera/mic, adaptive quality, ETag, dan upload avatar dengan validasi.
- Test Vitest dan Rust, plus CI Linux dan Windows.

## v0.2: reliability kamera dan mic

Tujuan: stream tidak berhenti gara-gara device bermasalah. Tidak ada fitur baru di rilis ini.

1. **Deteksi device putus.** Kalau track kamera atau mic berakhir (kabel dicabut, device dimatikan),
   status di panel berubah, avatar berhenti dengan rapi, dan muncul pesan yang jelas.
2. **Pulih sendiri.** Coba sambung ulang maksimal 3 kali dengan jeda 2, 5, lalu 10 detik. Kalau
   tetap gagal, berhenti dan tampilkan tombol coba lagi. Jangan retry terus-menerus saat izin
   ditolak.
3. **Device berubah.** `devicechange` memperbarui daftar kamera/mic. Kalau device yang sedang
   dipakai hilang, pindah ke default dan beri tahu pengguna.
4. **Mic suspended.** Kalau AudioContext di-suspend browser, tampilkan statusnya dan coba resume
   saat panel diklik.

Kriteria selesai:

- Cabut lalu pasang lagi webcam saat tracking jalan: avatar berhenti, lalu pulih tanpa reload.
- Ganti mic saat aktif: gerak mulut mengikuti device baru.
- Tolak izin kamera/mic: tidak ada retry berulang, pesan tetap jelas.
- `npm test` dan `cargo test` lulus; ada test untuk logika recovery.

## v0.3

- **Portable ZIP.** Versi tanpa installer. Data tetap di `%APPDATA%`; mode benar-benar portable
  (data di sebelah `.exe`) diputuskan terpisah karena mengubah cara server mencari folder data.
- **Profil/preset.** Simpan kombinasi avatar dan setelan, lalu pindah tanpa mengatur ulang.
- **Pisah `main.js`.** Pecah loop render, sinkronisasi, dan UI. Tidak ada perubahan perilaku.

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
