# Aplikasi desktop (Tauri)

Scaffold Tauri v2 ada di `src-tauri/`. Tujuannya: installer Windows yang tidak membutuhkan
Node.js, tanpa mengubah alur OBS.

## Prinsip

- Jendela Tauri membuka **`http://127.0.0.1:8770/`**, bukan `tauri://localhost`.
  Panel browser, jendela desktop, dan OBS Browser Source memakai origin yang sama.
- Server HTTP tetap jalan di `127.0.0.1:8770`, dijalankan dari dalam proses Rust.
- Frontend hasil `npm run build` (folder `dist/`) di-embed ke binary saat compile.
- Data runtime disimpan di folder app-data Tauri, bukan `data/` milik repo.

## Isi server Rust

`src-tauri/src/server.rs` adalah port dari `serve.mjs`:

| Endpoint | Perilaku |
|---|---|
| `GET /` dan file statis | menyajikan `dist/` yang di-embed |
| `GET/PUT /api/state` | ETag + `304`, tulis atomik, read-modify-write diserialisasi |
| `GET/PUT/DELETE /api/avatar` | upload streaming, divalidasi header GLB/VRM, `415` kalau bukan VRM |
| `GET/PUT/DELETE /api/background` | JSON `dataUrl`, tulis atomik |
| `GET /ws/pose` | relay pose panel -> OBS, validasi + rate limit per socket |

Host dan Origin tetap dibatasi ke `127.0.0.1`/`localhost` port `8770`, sama seperti server Node.

## Port sudah dipakai

Kalau `8770` sudah listen (misalnya `npm start` masih jalan, atau LiteTuber kedua dibuka), aplikasi
tetap membuka jendela dan memakai server yang sudah ada. Ini sengaja: kamu bisa membuka panel desktop
sambil server Node lama melayani OBS.

## Perintah

```bash
npm install
npm run build                      # frontend -> dist/
npm run tauri build                # installer (butuh OS target)
npm run tauri build -- --debug --no-bundle   # cek kompilasi di Linux
npx tauri info                     # cek toolchain
```

Build installer Windows (NSIS) harus dijalankan di Windows atau GitHub Actions
(`.github/workflows/tauri.yml`). Lihat [CI-WINDOWS.md](CI-WINDOWS.md).

## Lokasi data

Tauri memakai `app_data_dir()`:

- Windows: `%APPDATA%\app.litetuber.desktop\`
- Linux: `~/.local/share/app.litetuber.desktop/`

Isinya `state.json`, `avatar.vrm`, dan `background.json`. Ini terpisah dari `data/` yang dipakai
`npm start`, jadi avatar/setelan desktop dimulai kosong pada run pertama.

## Yang belum bisa diverifikasi di laptop Linux

- Izin kamera/mic di WebView2. WebView2 punya izin sendiri; kalau prompt tidak muncul atau kamera
  ditolak, ini yang perlu dicek pertama di PC.
- Render dan relay di OBS CEF.
- Build NSIS/MSI dan hasil installer.
- Tanda tangan installer; build CI belum ditandatangani, jadi SmartScreen tetap muncul.

Urutan smoke test di PC ada di [CI-WINDOWS.md](CI-WINDOWS.md).
