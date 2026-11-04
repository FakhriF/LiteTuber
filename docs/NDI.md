# Render di PC, rekam di laptop (NDI)

Setup ini bikin **PC yang kerja berat** (tracking wajah + render 3D) dan **laptop cuma menerima video + merekam**. Cocok kalau laptop lemah tapi mau file rekaman langsung ada di laptop.

Alur: **kamera HP → PC (render) → NDI → OBS laptop (rekam)**

## Yang dibutuhkan

- PC dan laptop di jaringan yang sama. Kabel LAN paling stabil; WiFi 5 GHz masih oke.
- OBS di kedua mesin + **NDI Runtime** dan plugin **DistroAV** (dulu bernama OBS-NDI). Keduanya wajib ada di **kedua** mesin.
- Kamera HP jadi webcam di PC:
  - Windows 11 baru: **Phone Link → Use phone as webcam**.
  - Kalau tidak ada: **Iriun**, **DroidCam**, atau **Camo**. USB lebih stabil daripada WiFi.
- Mic: paling gampang dari HP juga (DroidCam/Iriun mendukung audio), atau mic USB yang dicolok ke PC.

## 0. Install NDI

NDI itu dua bagian: **NDI Runtime** (mesinnya) dan **plugin OBS** (DistroAV, dulu OBS-NDI). Install di PC dan laptop.

**Arch / CachyOS (OBS native, seperti di laptop ini)**

```bash
paru -S distroav
```

Itu otomatis memasang `ndi-sdk` (menyediakan `libndi`) + plugin. Pastikan `avahi` jalan:

```bash
sudo systemctl enable --now avahi-daemon
```

Restart OBS. Cek: **Sources → + → NDI Source** dan **Tools → NDI Output Settings**.

**Kalau OBS-nya Flatpak**

```bash
flatpak install com.obsproject.Studio.Plugin.DistroAV
sudo flatpak override com.obsproject.Studio --system-talk-name=org.freedesktop.Avahi
```

**Windows**

```powershell
winget install --exact --id DistroAV.DistroAV
```

Lalu install **NDI Runtime 6.3+** dari <https://ndi.video/tools/> (NDI Tools sudah termasuk runtime). Restart OBS.

**macOS**

```bash
brew install --cask distroav
```

Plus NDI Tools untuk runtime. Catatan: DistroAV butuh OBS ≥ 31.1.1.

## 1. HP jadi webcam di PC

1. Pasang app di HP dan client di PC, sambungkan lewat USB atau WiFi.
2. Di LiteTuber, dropdown **Kamera** harus menampilkan device HP. Pilih itu.
3. Dropdown **Mic** pilih mic HP (kalau app-nya mendukung audio), atau mic lain yang ada di PC.

Kalau mulut avatar digerakkan mic HP dan audio rekaman juga dari mic HP, sinkronisasinya otomatis karena semuanya lewat jalur yang sama.

## 2. Jalankan LiteTuber di PC

```bash
cd ~/Projects/vtuber-lite
npm start
```

Buka `http://127.0.0.1:8770/`, pilih avatar, nyalakan kamera + mic, atur mirror/framing.

Kalau nanti butuh transparan di hasil akhir, pilih background **Green** — NDI biasanya mengirim gambar yang sudah terkomposit (alpha tidak selalu kebawa), jadi chroma key di laptop lebih aman.

## 3. OBS di PC (sumber NDI)

1. Tambah **Browser Source**:
   - URL: `http://127.0.0.1:8770/?ui=0`
   - Width `1920`, Height `1080`.
2. Kalau mau audio ikut terkirim: tambah **Audio Input Capture** di scene yang sama dan pilih mic HP / mic PC.
3. Aktifkan NDI:
   - **Tools → NDI Output Settings** → centang **Main Output**, atau
   - **Dedicated NDI Output** (NDI Filter) dengan nama `LiteTuber` (lebih rapi kalau ada beberapa output).
4. Pastikan scene-nya menampilkan avatar saja (tanpa panel UI).

## 4. OBS di laptop (perekam)

1. Tambah source **NDI Source** → pilih `LiteTuber` (atau `Main Output`).
2. **Bandwidth**: `Highest`. **Sync**: `Network`.
3. Cek mixer: audio dari NDI harus masuk. Kalau tidak, klik ikon audio di source NDI.
4. Rekaman:
   - **Settings → Output → Recording**: pakai encoder hardware (NVENC / QSV / VAAPI).
   - 1080p30 kalau laptop lemah, 1080p60 kalau kuat.
   - Format `mkv` (lebih aman kalau OBS crash; bisa di-remux ke mp4 setelahnya).

## Kalau audio dan video tidak sinkron

Video datang telat karena lewat HP → PC → NDI. Kalau audio direkam dari **mic laptop** (bukan dari NDI), suara akan lebih dulu daripada gerak mulut.

- Paling gampang: rekam audio dari **NDI** (satu jalur dengan video) — otomatis sinkron.
- Kalau tetap mau mic laptop: OBS laptop → **Advanced Audio Properties → Sync Offset** pada mic, kasih `+200` sampai `+400` ms sampai ketemu.

## Alternatif tanpa NDI: rekam di PC ke folder laptop

Kalau tidak butuh monitor live di laptop:

1. Share folder di laptop (SMB/NFS).
2. Di OBS PC, set **Recording Path** ke folder share tersebut.
3. File rekaman langsung muncul di laptop, tanpa encode/NDI tambahan. Paling ringan untuk laptop.

## Troubleshooting

**NDI Source tidak menemukan PC**
- Pastikan satu subnet dan tidak ada AP isolation / guest WiFi.
- Coba **NDI Access Manager** untuk menambahkan host manual.
- Buka firewall: UDP 5353 (mDNS), TCP/UDP 5960–5970.

**Video patah-patah / delay naik**
- Pakai kabel LAN antara PC dan laptop.
- Turunkan ke 30 fps di LiteTuber dan OBS.
- Di NDI Source, coba bandwidth `Highest` (kualitas) atau turunkan resolusi scene.

**Laptop tetap berat**
- Pastikan encoder hardware aktif, bukan x264.
- Rekam 1080p30, bukan 60.
- Tutup preview di OBS laptop (klik kanan preview → performance).

**Lip sync terasa aneh**
- Pastikan mic yang menggerakkan avatar adalah mic yang sama (atau sejenis) dengan yang direkam.
- Kalau pakai mic laptop untuk rekaman, pakai Sync Offset seperti di atas.
