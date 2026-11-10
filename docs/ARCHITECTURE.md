# Arsitektur LiteTuber

Dokumen ini menjelaskan bentuk sistem, alasan di balik keputusan penting, dan aturan yang tidak boleh dilanggar saat mengubah kode. Tujuannya supaya perubahan berikutnya tidak diam-diam merusak alur OBS.

## Prinsip

1. **Ringan.** Satu tab browser, tanpa framework UI, tanpa Electron/Unity.
2. **OBS-first.** URL yang dibuka panel dan URL yang dipasang di OBS Browser Source harus sama persis: `http://127.0.0.1:8770/`.
3. **Server lokal adalah sumber kebenaran.** Setelan, avatar, dan background disimpan di `data/`, bukan hanya di browser. Ini yang membuat panel dan OBS sinkron otomatis.
4. **Tidak ada data keluar.** Server hanya bind ke `127.0.0.1` dan menolak Host/Origin asing.

## Alur data

```
          kamera                         mic
            │                             │
            ▼                             ▼
   ┌─────────────────┐          ┌─────────────────┐
   │ face-worker.js  │          │ audio.js         │
   │ MediaPipe       │          │ FFT → vowel      │
   └────────┬────────┘          └────────┬─────────┘
            │ 52 blendshape + matrix     │ bobot a/i/u/e/o
            ▼                            ▼
   ┌──────────────────────────────────────────────┐
   │ face.js / MicMouth                           │
   │ → ekspresi VRM, rotasi kepala, kalibrasi     │
   └──────────────────────┬───────────────────────┘
                          ▼
   ┌──────────────────────────────────────────────┐
   │ avatar.js (three-vrm) + main.js render loop  │
   │ adaptive quality → renderer + tracking rate  │
   └──────────────────────┬───────────────────────┘
                          ▼
                 canvas → OBS Browser Source

   Panel UI ──PUT /api/state──▶ serve.mjs ──data/state.json
   OBS      ──GET /api/state──▶ serve.mjs (poll ±2,5 dtk)
   Upload   ──PUT /api/avatar─▶ serve.mjs ──data/avatar.vrm
   Panel    ──WS /ws/pose────▶ serve.mjs ──pose──▶ OBS (live, 33 Hz)
```

## Modul

| File | Tanggung jawab |
|---|---|
| `src/main.js` | Entry, render loop, adaptive quality, wiring UI, polling server, background |
| `src/avatar.js` | Load VRM, optimasi mesh, idle pose, ekspresi, spring bone |
| `src/face.js` | Orkestrasi tracking: pilih worker/main-thread, kalibrasi, konversi ke VRM |
| `src/expressions.js` | Konversi blendshape ke ekspresi VRM, termasuk blink per mata (murni, bisa dites) |
| `src/face-worker.js` | Entry classic worker: init MediaPipe, inferensi per `ImageBitmap` |
| `src/pose-sync.js` | Klien WebSocket relay pose panel → OBS, reconnect dengan backoff |
| `src/pose-protocol.js` | Validasi dan normalisasi pesan pose, dipakai klien dan server |
| `src/audio.js` | Analisis mic, `vowelWeights`, smoothing mulut |
| `src/store.js` | Default setelan, localStorage, cache IndexedDB |
| `src/vrm.js` | Validasi header GLB/VRM, dipakai klien dan server |
| `src/http-cache.js` | ETag dari revisi + mtime/size, dipakai `/api/state` |
| `serve.mjs` | Static server + REST API, validasi upload, tulis atomik |
| `index.html` | Panel kontrol (bukan framework; event di-wire manual) |
| `src/style.css` | Semua styling panel dan background |

## Aturan yang tidak boleh dilanggar

### 1. Worker tracking harus classic, bukan module

Glue WASM MediaPipe memanggil `importScripts`, yang tidak tersedia di module worker. Karena itu `vite.config.js` memakai `worker: { format: "iife" }` dan `face-worker.js` diimpor lewat `?worker`.

- Worker dianggap gagal kalau tidak mengirim `ready` dalam 12 detik atau mengirim `error`.
- Fallback ke main thread bersifat otomatis dan tidak boleh setengah jalan: `mode` hanya `"worker"` atau `"main"`.
- `?worker=0` memaksa jalur main thread untuk diagnosa.
- Frame hanya dikirim saat worker tidak sibuk. Jangan membuat antrean frame; latensi lebih penting daripada kelengkapan.

### 2. Jangan pindah ke protokol `tauri://` atau URL lain

Desktop memakai Tauri, tetapi jendelanya tetap membuka `http://127.0.0.1:8770/`. OBS Browser Source memakai URL yang sama. Kalau protokol berubah, alur dua langkah (jalankan, tempel URL) rusak.

Server desktop adalah port Rust dari `serve.mjs` di `src-tauri/src/server.rs`. Endpoint, ETag, validasi VRM, dan relay pose harus tetap sama dengan versi Node. Jendela dibuat setelah port berhasil di-bind; kalau port sudah dipakai, app memakai server yang ada.

### 3. Server adalah bus sinkronisasi

- Panel menulis setelan ke server; OBS tidak perlu tahu apa pun selain mem-poll.
- `panelHidden` sengaja tidak disinkronkan karena itu state per-jendela.
- State dibandingkan lewat ETag dari revisi tulis + mtime/size, bukan `JSON.stringify` tiap poll. Jangan menambah polling lebih cepat sebagai pengganti versi.
- Tulis file selalu atomik (`.part` untuk upload avatar, `.tmp` untuk state/background, lalu `rename`). Jangan menulis langsung ke `avatar.vrm`, `state.json`, atau `background.json`.
- Pose live **tidak** lewat state/poll. Panel mengirim `{w, head}` ke `/ws/pose` ±33 Hz, dan server hanya meneruskan ke viewer `?ui=0`. Jangan menulis pose ke `data/`; itu data sesi, bukan setelan.
- Server mengirim `{t:"status", viewers}` ke panel setiap viewer masuk/keluar. Panel memakainya hanya untuk badge OBS; status ini bukan state yang disimpan.

### 4. Upload divalidasi sebelum dipakai

- Klien memeriksa `src/vrm.js` sebelum memuat avatar, supaya file salah tidak dikirim 15 MB.
- Server memeriksa prefiks stream yang sama. File non-VRM ditolak `415` dan avatar lama tidak tersentuh.
- `GLB` harus: magic `glTF`, versi 2, chunk pertama JSON, dan berisi ekstensi `VRM` atau `VRMC_vrm`.

### 5. Kualitas tidak boleh turun di bawah batas tanpa alasan

Adaptive quality hanya boleh menurunkan `renderScale`/`trackHz` ketika FPS di bawah target. Nilai pilihan pengguna adalah plafon: kualitas otomatis tidak boleh melebihi setelan manual. Saat beban ringan, nilai dinaikkan bertahap kembali ke plafon.

- Antialias hanya aktif saat `renderScale >= 0.9`; renderer dibangun ulang di canvas off-DOM, dan render sekali setelah swap supaya canvas tidak sempat kosong.
- Badge FPS menampilkan skala aktif (`28 fps · 45%`) agar perilaku ini terlihat.

### 6. Data plane bebas DOM

`face.js`, `audio.js`, `avatar.js`, dan `vrm.js` tidak boleh menyentuh DOM panel. Satu-satunya elemen yang boleh dibuat adalah `<video>` internal untuk kamera. Ini yang membuat modul tersebut bisa dites tanpa browser penuh.

## Jalur state

1. UI mengubah `settings` → `store.saveSettings` (debounce 120 ms) → `pushSettings` (debounce 350 ms) → `PUT /api/state`.
2. Klien lain memanggil `GET /api/state` tiap ±2,5 detik dengan `If-None-Match` berisi ETag terakhir.
3. ETag dihitung dari revisi tulis + mtime/size `state.json`, `avatar.vrm`, dan `background.json`. Kalau tidak berubah, server menjawab `304` tanpa body, jadi klien tidak perlu parse JSON.
4. Saat berubah, `applyServerSettings` membandingkan state, lalu `Object.assign` + `syncUI` + apply background/framing/scale. Flag `applyingServer` mencegah echo balik ke server.
5. Avatar/background hanya diunduh ulang kalau `mtime` berubah.

Semua tulis state/background memakai file sementara lalu `rename`, dan read-modify-write diserialisasi supaya dua penyimpanan cepat tidak saling menimpa.

Keterbatasan yang diketahui: last-write-wins jika dua klien menulis settings pada saat yang sama, dan tiga lapisan cache (localStorage, IndexedDB, `data/`). Cukup untuk satu panel + satu OBS.

## Build dan tes

```bash
npm install
npm test        # Vitest: validator VRM, vowelWeights, merge setelan
npm run build   # dist/ (gitignored)
npm run serve   # PORT=8770
cargo test --manifest-path src-tauri/Cargo.toml   # server Rust + pose + VRM
```

- `dist/` tidak di-commit.
- Worker menghasilkan bundel IIFE terpisah di `dist/assets/`; itu normal.
- CI (`.github/workflows/ci.yml`) menjalankan `npm ci`, `npm test`, dan `npm run build` di Node 22 dan 24.

## Catatan deployment

- **Portable/browser:** `dist/` + `serve.mjs` + Node 18+.
- **Tauri:** server Rust menyajikan `dist/` yang di-embed dengan endpoint dan URL identik; data di `%APPDATA%\app.litetuber.desktop\`. Installer Windows dibangun di Windows/CI Windows. Detail di [DESKTOP.md](DESKTOP.md).
- **Microsoft Store:** jalur MSIX (signing gratis oleh Microsoft). EXE/MSI butuh sertifikat sendiri.
- Jangan bundel avatar contoh tanpa izin lisensi VRM yang jelas.
