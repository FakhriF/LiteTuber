# LiteTuber

Alternatif super ringan buat Warudo/VTube Studio: render avatar VRM di browser, tracking wajah dari webcam, gerak mulut dari mic, background transparan/green screen, dan langsung dipakai sebagai **OBS Browser Source**.

Semua berjalan lokal (tidak ada data yang dikirim ke mana-mana).

## Kenapa ini ringan

- Tidak ada aplikasi native, tidak ada Unity/Electron. Cukup tab browser.
- Model VRM langsung dari file `.vrm` kamu (VRM 0.x dan 1.0).
- Tracking wajah pakai MediaPipe FaceLandmarker (WASM/GPU), ±30–60 fps, dijalankan di Web Worker supaya render tidak tersendat.
- Render Three.js dengan MToon, resolusi bisa dibatasi dan FPS bisa dikunci 30.
- Setelan dan avatar disimpan oleh server lokal (folder `data/`), jadi tidak perlu upload ulang dan otomatis sama di semua jendela — termasuk OBS.

## Menjalankan

Butuh Node.js 18+.

```bash
cd ~/Projects/vtuber-lite
npm install      # sekali saja
npm start        # build + jalankan server
```

Buka `http://127.0.0.1:8770/`.

Kalau sudah pernah build dan cuma mau jalanin:

```bash
npm run serve
```

## Pakai di OBS

1. Jalankan `npm start` (biarkan terminal terbuka).
2. Di OBS: **Sources → + → Browser**.
3. URL: `http://127.0.0.1:8770/?ui=0` (tombol **Salin URL untuk OBS** di panel juga bisa).
4. Width `1920`, Height `1080`.
5. Background transparan otomatis — tidak perlu chroma key. Kalau mau green screen, pilih **Green** di panel.

OBS punya storage browser sendiri, jadi dulu avatar/setelan tidak ikut. Sekarang semua disimpan di server (`data/`), jadi source OBS otomatis memakai avatar dan setelan yang sama. Perubahan di panel (mirror, framing, background, avatar baru) ikut ter-update di OBS dalam ±3 detik tanpa reload.

Source OBS itu **tampilan saja**, bukan panel kedua. Gerakan kepala, kedip, dan mulut dikirim live dari panel browser lewat relay lokal (`/ws/pose`), jadi OBS tidak perlu kamera sendiri dan tidak perlu diatur dari dalam OBS. Atur semuanya di panel browser.

Badge **OBS off / OBS 1** di tab **Tampilan** menunjukkan berapa source OBS yang sedang menerima gerakan. Kalau angkanya 0 padahal OBS sudah dibuka, reload source OBS sekali.

Kalau OBS dibuat sebelum update ini, reload source-nya sekali (**klik kanan → Refresh**).

Mau render di PC dan merekam di laptop lain? Lihat [docs/NDI.md](docs/NDI.md).

Untuk rekam/live tanpa OBS, bisa juga pakai window capture biasa dengan background green.

## Fitur

- **Tracking wajah**: kepala (yaw/pitch/roll), kedip mata, senyum, alis, pandangan mata.
- **Mulut**: 5 bentuk vokal (a, i, u, e, o) — dari kamera (buka mulut, monyong, lebar) dan/atau dari mic (analisis frekuensi).
- **Latar**: transparan, green, blue, atau gambar (drag & drop gambar juga bisa).
- **Framing**: kepala & bahu / setengah badan / seluruh badan, plus zoom.
- **Animasi idle**: napas, goyang badan, ayunan tangan (biar tidak kaku).
- **Pose A**: model VRM T-pose otomatis diturunkan tangannya.
- **Kalibrasi**: simpan posisi netral kepala biar tidak miring terus.
- **Kualitas otomatis**: kalau FPS turun, resolusi render dan rate tracking diturunkan bertahap, lalu dikembalikan saat sudah lancar. Bisa dimatikan di panel.
- **Upload avatar aman**: file diperiksa sebagai VRM sebelum dimuat/dikirim, progres upload terlihat, dan avatar lama tidak rusak kalau upload gagal.
- **Fitur ala carte**: gerak kepala, gerak mata, kedip, ekspresi wajah, animasi idle, dan fisika rambut bisa dimatikan satu-satu.

## Shortcut

| Tombol | Fungsi |
| --- | --- |
| `H` | sembunyikan/tampilkan panel |
| `R` | kalibrasi posisi netral kepala |
| `F` | fullscreen |

## Tips buat laptop lemah

- Biarkan **Kualitas otomatis** aktif — dia menurunkan resolusi/tracking sendiri saat berat.
- Set **Batas FPS** ke `30`.
- Pakai framing **Kepala & bahu** (model yang dirender lebih sedikit).
- Kalau tracking terasa berat/aneh, coba `http://127.0.0.1:8770/?delegate=cpu` (pakai CPU, lebih lambat tapi lebih kompatibel).
- Kalau tracking justru bermasalah setelah update worker, coba `?worker=0` untuk kembali ke mode lama (tracking di main thread).
- Tutup tab lain yang pakai GPU.

## Troubleshooting

**Kamera tidak muncul / "wajah: tidak ada"**
Pastikan tidak ada aplikasi lain yang memakai webcam. Cek izin kamera di browser (ikon gembok di address bar). Kalau wajah tidak terdeteksi, coba cahaya lebih terang dan jarak ±50 cm.

**Model tidak bisa dimuat**
Pastikan file benar-benar `.vrm` (bukan `.vrm` yang di-rename). Model VRM 0.x dan 1.0 didukung. App dan server sama-sama memeriksa header file sebelum dipakai, jadi file yang salah ditolak lebih awal dan avatar lama tidak rusak.

**Panel ikut kerekam di OBS**
Pakai `?ui=0` di URL browser source.

**Avatar/setelan tidak sama di OBS**
Pastikan server yang jalan versi terbaru (`npm start`), lalu reload source OBS sekali. Setelah itu semuanya sinkron otomatis.

**Avatar di OBS diam, tidak ikut gerakan panel**
Ini bukan bug: OBS adalah tampilan. Pastikan panel browser masih terbuka dan tab-nya tidak diminimize (render loop dijeda saat tab benar-benar hidden). Reload source OBS sekali kalau baru update. Cek `window.__litetuber.pose.status` di console OBS harus `"connected"`.

## Struktur

```
index.html        UI panel + canvas
src/main.js       render loop, UI, background, OBS
src/avatar.js     loader VRM, pose idle, ekspresi
src/face.js       MediaPipe face tracking -> ekspresi VRM
src/expressions.js konversi blendshape ke ekspresi VRM (murni, bisa dites)
src/face-worker.js tracking di Web Worker (fallback ke main thread)
src/pose-sync.js  relay pose panel -> OBS lewat WebSocket
src/pose-protocol.js validasi pesan relay pose (dipakai klien + server)
src/audio.js      lip sync dari mic
src/vrm.js        validasi header GLB/VRM (dipakai klien + server)
src/http-cache.js ETag untuk polling state (304 tanpa body)
src/placeholder.js avatar dummy sebelum VRM dimuat
serve.mjs         static server + penyimpanan setelan/avatar (data/)
test/             Vitest: validator VRM, vowelWeights, merge setelan
docs/ARCHITECTURE.md  alur data, invariant, batasan
docs/NDI.md       panduan render di PC + rekam di laptop (NDI)
```

## Development

```bash
npm test        # Vitest
npm run build   # produksi ke dist/
npm run serve   # jalankan server tanpa build ulang
```

CI menjalankan `npm ci`, `npm test`, dan `npm run build` di Node 20 dan 22.

## Lisensi

MIT — lihat [LICENSE](LICENSE). Model contoh tidak disertakan. Lisensi dependensi ada di [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
