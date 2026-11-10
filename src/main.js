import * as THREE from "three";
import { VrmAvatar } from "./avatar.js";
import { PlaceholderAvatar } from "./placeholder.js";
import { FaceTracker } from "./face.js";
import { MicMouth } from "./audio.js";
import { PoseSync } from "./pose-sync.js";
import { inspectVrm } from "./vrm.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const params = new URLSearchParams(location.search);
const settings = store.loadSettings();
const forcedBg = params.get("bg");
// OBS uses the same page with ?ui=0. That instance is display-only and mirrors
// the panel's live pose instead of creating its own settings/camera session.
const viewer = params.get("ui") === "0";
let remotePose = null;
const poseSync = new PoseSync(viewer ? "viewer" : "panel", {
  onPose: (pose) => {
    remotePose = pose;
  },
  onPeers: (count) => {
    const badge = $("obsBadge");
    if (!badge) return;
    badge.textContent = count > 0 ? `OBS ${count}` : "OBS off";
    badge.classList.toggle("on", count > 0);
  },
});
let applyingServer = false;
let serverAvatarMtime = 0;
let serverBgMtime = 0;
let pushTimer = 0;
let polling = false;
let lastPoll = 0;
let avatarBusy = false;
let serverStateEtag = "";
if (params.get("ui") === "0") settings.panelHidden = true;
if (params.get("bg")) settings.bg = params.get("bg");

let canvas = $("stage");

// Adaptive quality state. `scale` moves on its own when the GPU can't keep up;
// `userScale` is what the panel says, and `effTrackHz` may be lowered for the
// same reason. Both are restored as soon as there is headroom again.
const quality = {
  userScale: Number(settings.renderScale) || 1,
  scale: Number(settings.renderScale) || 1,
  effTrackHz: Number(settings.trackHz) || 30,
  fpsEma: 0,
  lastAdjust: 0,
  lastDown: 0,
};
let antialiasActive = quality.userScale >= 0.9;

function buildRenderer(target) {
  const r = new THREE.WebGLRenderer({
    canvas: target,
    alpha: true,
    antialias: antialiasActive,
    powerPreference: "high-performance",
  });
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = settings.exposure;
  return r;
}

let renderer = buildRenderer(canvas);

// Antialias is a context attribute, so switching it means a new canvas. A fresh
// canvas is built off-DOM first, so a failure leaves the running one untouched.
function rebuildRenderer() {
  const nextCanvas = document.createElement("canvas");
  nextCanvas.id = "stage";
  let next;
  try {
    next = buildRenderer(nextCanvas);
  } catch (err) {
    console.error("rebuild renderer gagal", err);
    return false;
  }
  const old = renderer;
  canvas.replaceWith(nextCanvas);
  canvas = nextCanvas;
  renderer = next;
  resize();
  // A resized canvas is cleared; draw once so switching quality never flashes blank.
  renderer.render(scene, camera);
  try {
    old.dispose();
    old.forceContextLoss();
  } catch {
    /* ignore */
  }
  return true;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

scene.add(new THREE.AmbientLight(0xffffff, 1.25));
const keyLight = new THREE.DirectionalLight(0xfff3e6, 2.35);
keyLight.position.set(0.7, 2.1, 1.7);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xbfd2ff, 0.85);
fillLight.position.set(-1.5, 1.1, 1.2);
scene.add(fillLight);

let avatar = new PlaceholderAvatar(scene);
const face = new FaceTracker();
const mic = new MicMouth();

const smoothW = {};
const KEYS = [
  "blink",
  "blinkLeft",
  "blinkRight",
  "aa",
  "oh",
  "ee",
  "ou",
  "ih",
  "happy",
  "angry",
  "sad",
  "surprised",
  "relaxed",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
];
for (const key of KEYS) smoothW[key] = 0;
const MOUTH_KEYS = ["aa", "ih", "ou", "ee", "oh"];
const EYE_KEYS = ["lookUp", "lookDown", "lookLeft", "lookRight"];
const EXPR_KEYS = ["happy", "angry", "sad", "surprised", "relaxed"];

const identity = new THREE.Quaternion();
const smoothHead = new THREE.Quaternion();
const targetHead = new THREE.Quaternion();
const tmpTarget = {};

let micRunning = false;
let micLevel = 0;
let camStartedAt = 0;
let mouthTestUntil = 0;
let hintDismissed = false;
let blinkTimer = 2 + Math.random() * 2.5;
let blinkT = -1;

function toast(message, ms = 2400) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("on"), ms);
}

function mediaError(err, kind) {
  const name = err?.name || "";
  const map = {
    NotAllowedError: `Izin ${kind} ditolak. Klik ikon gembok/kamera di address bar lalu pilih Allow, kemudian coba lagi.`,
    PermissionDeniedError: `Izin ${kind} ditolak.`,
    SecurityError: `Akses ${kind} butuh http://127.0.0.1 atau https.`,
    NotFoundError: `${kind} tidak ditemukan.`,
    DevicesNotFoundError: `${kind} tidak ditemukan.`,
    NotReadableError: `${kind} sedang dipakai aplikasi lain (OBS/Zoom/browser lain).`,
    TrackStartError: `${kind} gagal dipakai aplikasi lain.`,
    AbortError: `${kind} gagal dibuka.`,
    OverconstrainedError: `${kind} tidak mendukung setting yang diminta.`,
    NotSupportedError: `Browser tidak mendukung akses ${kind}.`,
  };
  return map[name] || `Gagal mengakses ${kind}: ${err?.message || err}`;
}

function updateCamPreview() {
  const show = face.running && !settings.panelHidden;
  $("cam").classList.toggle("preview", show);
}

function dismissHint() {
  if (hintDismissed) return;
  hintDismissed = true;
  $("hint").classList.add("hidden");
}

async function serverJson(pathname, options) {
  const res = await fetch(pathname, { cache: "no-store", ...options });
  if (!res.ok) throw new Error(`${pathname} ${res.status}`);
  return res.json();
}

async function getServerState() {
  try {
    const res = await fetch("/api/state", {
      cache: "no-store",
      headers: serverStateEtag ? { "if-none-match": serverStateEtag } : {},
    });
    if (res.status === 304) return null;
    if (!res.ok) return null;
    serverStateEtag = res.headers.get("etag") || "";
    return await res.json();
  } catch {
    return null;
  }
}

function pushSettings() {
  if (applyingServer) return;
  clearTimeout(pushTimer);
  const payload = { ...settings };
  delete payload.panelHidden;
  pushTimer = setTimeout(() => {
    fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: payload }),
    }).catch(() => {});
  }, 350);
}

function applyServerSettings(incoming) {
  const next = { ...store.defaults, ...incoming };
  next.panelHidden = settings.panelHidden;
  if (forcedBg) next.bg = forcedBg;
  if (JSON.stringify(next) === JSON.stringify(settings)) return false;
  applyingServer = true;
  Object.assign(settings, next);
  syncUI();
  syncQualityFromSettings();
  applyBackground();
  applyFraming();
  applyRenderScaleSetting();
  renderer.toneMappingExposure = settings.exposure;
  store.saveSettings(settings);
  applyingServer = false;
  return true;
}

async function pushAvatar(buffer, name) {
  const label = $("vrmName");
  // XHR (not fetch) because upload progress events are what let a 15 MB avatar
  // show a percentage instead of looking frozen.
  await new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/avatar?name=${encodeURIComponent(name)}`);
    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      if (!label.textContent.startsWith(name)) return;
      const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
      label.textContent = `${name} · mengunggah ${pct}%`;
    });
    const done = (ok, code) => {
      label.textContent = name;
      if (!ok) {
        toast(
          code === 415
            ? "Server menolak: file bukan avatar VRM valid"
            : `Gagal menyimpan avatar ke server (${code})`,
        );
      }
      resolve();
    };
    xhr.addEventListener("load", () => done(xhr.status >= 200 && xhr.status < 300, xhr.status));
    xhr.addEventListener("error", () => done(false, 0));
    xhr.addEventListener("abort", () => done(false, 0));
    xhr.send(buffer);
  });
}

async function loadServerAvatar(state) {
  try {
    const res = await fetch("/api/avatar", { cache: "no-store" });
    if (!res.ok) return false;
    const buffer = await res.arrayBuffer();
    await loadVrmBuffer(buffer, state?.avatarName || "avatar", false);
    serverAvatarMtime = state?.avatarMtime || 0;
    return true;
  } catch {
    return false;
  }
}

async function loadServerBackground(state) {
  try {
    const data = await serverJson("/api/background");
    if (!data?.dataUrl) return false;
    $("bgImage").style.backgroundImage = `url("${data.dataUrl}")`;
    serverBgMtime = state?.bgMtime || 0;
    return true;
  } catch {
    return false;
  }
}

async function pollServer() {
  if (polling) return;
  polling = true;
  try {
    const state = await getServerState();
    if (!state) return;
    if (state.settings) applyServerSettings(state.settings);
    if (state.bgExists && state.bgMtime !== serverBgMtime) await loadServerBackground(state);
    if (!avatarBusy && state.avatarExists && state.avatarMtime !== serverAvatarMtime)
      await loadServerAvatar(state);
  } finally {
    polling = false;
  }
}

function applyFraming() {
  const h = avatar.height;
  const top = avatar.topY;
  const visible = 2 * Math.tan((camera.fov * Math.PI) / 360);
  let viewHeight;
  let targetY;
  if (settings.framing === "bust") {
    viewHeight = h * 0.34;
    targetY = top + h * 0.045 - viewHeight / 2;
  } else if (settings.framing === "upper") {
    viewHeight = h * 0.62;
    targetY = top + h * 0.04 - viewHeight / 2;
  } else {
    viewHeight = h * 1.1;
    targetY = (avatar.topY + avatar.bottomY) / 2;
  }
  const dist = viewHeight / visible / settings.zoom;
  camera.position.set(0, targetY + h * 0.01, dist);
  camera.lookAt(0, targetY, 0);
}

function applyBackground() {
  document.body.classList.remove("green", "blue");
  $("bgImage").classList.remove("on");
  scene.background = null;

  if (settings.bg === "green") document.body.classList.add("green");
  else if (settings.bg === "blue") document.body.classList.add("blue");
  else if (settings.bg === "image") $("bgImage").classList.add("on");

  for (const btn of document.querySelectorAll("#bgChips button")) {
    btn.classList.toggle("active", btn.dataset.bg === settings.bg);
  }
}

function applyPanel() {
  $("panel").classList.toggle("hidden", settings.panelHidden);
  $("hideBtn").textContent = settings.panelHidden ? "+" : "–";
  updateCamPreview();
}

function applyTab(tab) {
  for (const btn of document.querySelectorAll(".tabs button")) {
    btn.classList.toggle("on", btn.dataset.tab === tab);
  }
  for (const section of document.querySelectorAll("#panel .body section")) {
    section.hidden = section.dataset.tab !== tab;
  }
}

let activeTab = "avatar";
try {
  activeTab = localStorage.getItem("litetuber.tab") || "avatar";
} catch {
  /* private mode: keep the default */
}
for (const btn of document.querySelectorAll(".tabs button")) {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    try {
      localStorage.setItem("litetuber.tab", activeTab);
    } catch {
      /* ignore */
    }
    applyTab(activeTab);
  });
}

async function setBackgroundImageFromStore() {
  const dataUrl = await store.loadBackground();
  if (dataUrl) {
    $("bgImage").style.backgroundImage = `url("${dataUrl}")`;
  } else if (settings.bg === "image") {
    toast("Belum ada gambar latar. Pilih gambar dulu.");
    settings.bg = "transparent";
    store.saveSettings(settings);
    applyBackground();
    syncUI();
  }
}

async function loadVrmBuffer(buffer, name, persist = true) {
  if (avatarBusy) return;
  const check = inspectVrm(new Uint8Array(buffer));
  if (!check.ok) {
    toast(`Bukan avatar VRM valid: ${check.reason || "file tidak lengkap"}`);
    return;
  }
  avatarBusy = true;
  const next = new VrmAvatar(scene);
  try {
    await next.load(buffer.slice(0), name);
    const previous = avatar;
    avatar = next;
    previous.dispose();
    dismissHint();
    $("vrmName").textContent = name;
    applyFraming();
    if (persist) {
      await store.saveVrm(buffer, name).catch(() => {});
      pushAvatar(buffer, name);
    }
    toast(`Avatar dimuat: ${name}`);
  } catch (err) {
    console.error(err);
    next.dispose();
    toast(`Gagal memuat avatar: ${err.message || err}`);
  } finally {
    avatarBusy = false;
  }
}

async function switchToPlaceholder() {
  if (avatar.kind !== "vrm") return;
  avatar.dispose();
  avatar = new PlaceholderAvatar(scene);
  applyFraming();
}

async function onVrmFile(file) {
  if (!file) return;
  const name = file.name.replace(/\.vrm$/i, "");
  const buffer = await file.arrayBuffer();
  await loadVrmBuffer(buffer, name);
}

async function startCamera(deviceId) {
  const slowHint = setTimeout(
    () => toast("Menunggu izin kamera… cek popup izin atau ikon kamera di address bar", 6000),
    3500,
  );
  try {
    $("camBtn").textContent = "Menyiapkan…";
    await face.openCamera(deviceId || settings.camDevice || null, $("cam"));
    clearTimeout(slowHint);
    camStartedAt = performance.now();
    $("camBtn").textContent = "Matikan kamera";
    $("camBtn").classList.add("on");
    $("calBtn").disabled = false;
    updateCamPreview();
    refreshDevices();
    dismissHint();
    toast("Kamera aktif, menyiapkan model wajah…", 3000);
    await face.ensureLandmarker();
    toast("Tracking wajah siap — klik Kalibrasi saat posisi netral");
  } catch (err) {
    clearTimeout(slowHint);
    console.error(err);
    $("camBtn").textContent = "Aktifkan kamera";
    $("camBtn").classList.remove("on");
    updateCamPreview();
    toast(mediaError(err, "kamera"), 7000);
  }
}

function stopCamera() {
  face.stop();
  face.calibrated = false;
  $("camBtn").textContent = "Aktifkan kamera";
  $("camBtn").classList.remove("on");
  $("calBtn").disabled = true;
  updateCamPreview();
  toast("Kamera dimatikan");
}

function toggleCamera() {
  if (face.running) stopCamera();
  else startCamera();
}

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillDevices($("camDevice"), devices.filter((d) => d.kind === "videoinput"), "Kamera default");
    fillDevices($("micDevice"), devices.filter((d) => d.kind === "audioinput"), "Mic default");
  } catch {
    /* devices are optional */
  }
}

function fillDevices(select, devices, fallbackLabel) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = fallbackLabel;
  select.append(def);
  devices.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `${fallbackLabel.split(" ")[0]} ${i + 1}`;
    select.append(opt);
  });
  select.hidden = devices.length < 2;
  const wanted = select === $("camDevice") ? settings.camDevice : settings.micDevice;
  select.value = current || wanted || "";
}

async function toggleMic() {
  if (mic.running) {
    mic.stop();
    micRunning = false;
    $("micBtn").textContent = "Aktifkan mic";
    $("micBtn").classList.remove("on");
    return;
  }
  try {
    await mic.start(settings.micDevice || null);
    refreshDevices();
    micRunning = true;
    $("micBtn").textContent = "Matikan mic";
    $("micBtn").classList.add("on");
    if (mic.suspended) {
      toast("Mic aktif — klik sekali di halaman supaya audio jalan");
    } else {
      toast("Mic aktif untuk gerak mulut");
    }
  } catch (err) {
    console.error(err);
    toast(mediaError(err, "mic"), 7000);
  }
}

function calibrate() {
  if (face.calibrate()) {
    smoothHead.identity();
    toast("Posisi netral disimpan");
  } else {
    toast("Wajah belum terdeteksi");
  }
}

function syncUI() {
  $("sens").value = settings.sens;
  $("sensOut").textContent = settings.sens.toFixed(2);
  $("smooth").value = settings.smooth;
  $("smoothOut").textContent = settings.smooth.toFixed(2);
  $("mirror").checked = settings.mirror;
  $("invX").checked = settings.invertX;
  $("invY").checked = settings.invertY;
  $("invZ").checked = settings.invertZ;
  $("delegate").value = settings.delegate;
  $("micGain").value = settings.micGain;
  $("micGainOut").textContent = settings.micGain.toFixed(2);
  $("mouthSrc").value = settings.mouthSrc;
  $("autoBlink").checked = settings.autoBlink;
  $("useHead").checked = settings.useHead;
  $("useEyes").checked = settings.useEyes;
  $("useBlink").checked = settings.useBlink;
  $("useExpr").checked = settings.useExpr;
  $("useIdle").checked = settings.useIdle;
  $("useSpring").checked = settings.useSpring;
  $("framing").value = settings.framing;
  $("zoom").value = settings.zoom;
  $("zoomOut").textContent = settings.zoom.toFixed(2);
  $("exposure").value = settings.exposure;
  $("exposureOut").textContent = settings.exposure.toFixed(2);
  $("fpsCap").value = String(settings.fpsCap);
  $("renderScale").value = String(settings.renderScale);
  $("trackHz").value = String(settings.trackHz);
  $("autoQuality").checked = settings.autoQuality !== false;
  renderer.toneMappingExposure = settings.exposure;
}

function commit() {
  store.saveSettings(settings);
  pushSettings();
}

/* ---------- UI wiring ---------- */

$("pickVrm").addEventListener("click", () => $("vrmFile").click());
$("vrmFile").addEventListener("change", (e) => {
  onVrmFile(e.target.files?.[0]);
  e.target.value = "";
});
$("clearVrm").addEventListener("click", async () => {
  await store.clearVrm().catch(() => {});
  fetch("/api/avatar", { method: "DELETE" }).catch(() => {});
  await switchToPlaceholder();
  $("vrmName").textContent = "belum ada avatar";
  toast("Avatar tersimpan dihapus");
});

$("camBtn").addEventListener("click", async () => {
  if (face.running) {
    stopCamera();
  } else {
    await startCamera();
  }
});

$("camDevice").addEventListener("change", async (e) => {
  settings.camDevice = e.target.value;
  commit();
  if (face.running) {
    stopCamera();
    await startCamera(settings.camDevice);
  }
});

$("micDevice").addEventListener("change", async (e) => {
  settings.micDevice = e.target.value;
  commit();
  if (mic.running) {
    mic.stop();
    micRunning = false;
    $("micBtn").textContent = "Aktifkan mic";
    $("micBtn").classList.remove("on");
    await toggleMic();
  }
});
$("micBtn").addEventListener("click", toggleMic);
$("calBtn").addEventListener("click", calibrate);
$("mouthTest").addEventListener("click", () => {
  mouthTestUntil = performance.now() + 1800;
  toast("Tes ekspresi — kalau avatar tidak bergerak, modelnya tidak punya ekspresi mulut", 3500);
});

$("hideBtn").addEventListener("click", () => {
  settings.panelHidden = !settings.panelHidden;
  applyPanel();
  commit();
});

$("sens").addEventListener("input", (e) => {
  settings.sens = Number(e.target.value);
  $("sensOut").textContent = settings.sens.toFixed(2);
  commit();
});
$("smooth").addEventListener("input", (e) => {
  settings.smooth = Number(e.target.value);
  $("smoothOut").textContent = settings.smooth.toFixed(2);
  commit();
});
$("mirror").addEventListener("change", (e) => {
  settings.mirror = e.target.checked;
  commit();
});
for (const axis of ["x", "y", "z"]) {
  $(`inv${axis.toUpperCase()}`).addEventListener("change", (e) => {
    settings[`invert${axis.toUpperCase()}`] = e.target.checked;
    commit();
  });
}

$("delegate").addEventListener("change", (e) => {
  settings.delegate = e.target.value;
  face.delegate = settings.delegate;
  face.resetModel();
  commit();
  if (face.running) toast("Prosesor tracking diganti — klik matikan lalu aktifkan kamera");
});

$("micGain").addEventListener("input", (e) => {
  settings.micGain = Number(e.target.value);
  $("micGainOut").textContent = settings.micGain.toFixed(2);
  commit();
});
$("mouthSrc").addEventListener("change", (e) => {
  settings.mouthSrc = e.target.value;
  commit();
});
$("autoBlink").addEventListener("change", (e) => {
  settings.autoBlink = e.target.checked;
  commit();
});
for (const key of ["useHead", "useEyes", "useBlink", "useExpr", "useIdle", "useSpring"]) {
  $(key).addEventListener("change", (e) => {
    settings[key] = e.target.checked;
    commit();
  });
}

$("framing").addEventListener("change", (e) => {
  settings.framing = e.target.value;
  applyFraming();
  commit();
});
$("zoom").addEventListener("input", (e) => {
  settings.zoom = Number(e.target.value);
  $("zoomOut").textContent = settings.zoom.toFixed(2);
  applyFraming();
  commit();
});
$("exposure").addEventListener("input", (e) => {
  settings.exposure = Number(e.target.value);
  $("exposureOut").textContent = settings.exposure.toFixed(2);
  renderer.toneMappingExposure = settings.exposure;
  commit();
});
$("renderScale").addEventListener("change", (e) => {
  settings.renderScale = Number(e.target.value);
  syncQualityFromSettings();
  applyRenderScaleSetting();
  commit();
});
$("trackHz").addEventListener("change", (e) => {
  settings.trackHz = Number(e.target.value);
  quality.effTrackHz = settings.trackHz;
  commit();
});
$("fpsCap").addEventListener("change", (e) => {
  settings.fpsCap = Number(e.target.value);
  quality.fpsEma = 0;
  commit();
});
$("autoQuality").addEventListener("change", (e) => {
  settings.autoQuality = e.target.checked;
  syncQualityFromSettings();
  applyAutoScale();
  commit();
});

for (const btn of document.querySelectorAll("#bgChips button")) {
  btn.addEventListener("click", async () => {
    const bg = btn.dataset.bg;
    if (bg === "image") {
      $("bgFile").click();
      return;
    }
    settings.bg = bg;
    applyBackground();
    commit();
  });
}

$("bgFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result);
    $("bgImage").style.backgroundImage = `url("${dataUrl}")`;
    settings.bg = "image";
    applyBackground();
    syncUI();
    commit();
    await store.saveBackground(dataUrl).catch(() => toast("Gambar terlalu besar untuk disimpan"));
    fetch("/api/background", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    }).catch(() => {});
  };
  reader.readAsDataURL(file);
});

$("obsBtn").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?ui=0`;
  try {
    await navigator.clipboard.writeText(url);
    toast(`URL OBS disalin (mode tampilan): ${url}`, 3200);
  } catch {
    toast(url, 6000);
  }
});

window.addEventListener("pointerdown", () => {
  if (mic.running && mic.suspended) mic.resume();
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if (k === "h") {
    settings.panelHidden = !settings.panelHidden;
    applyPanel();
    commit();
  } else if (k === "r") {
    calibrate();
  } else if (k === "f") {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
});

const dropZone = window;
dropZone.addEventListener("dragover", (e) => e.preventDefault());
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && /\.vrm$/i.test(file.name)) onVrmFile(file);
  else if (file && file.type.startsWith("image/")) {
    const dt = new DataTransfer();
    dt.items.add(file);
    $("bgFile").files = dt.files;
    $("bgFile").dispatchEvent(new Event("change"));
  }
});

function applySize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const base = Math.max(0.4, Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setPixelRatio(base * (quality.scale || 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

function resize() {
  applySize();
  applyFraming();
}
window.addEventListener("resize", resize);

function syncQualityFromSettings() {
  quality.userScale = Number(settings.renderScale) || 1;
  quality.scale = quality.userScale;
  quality.effTrackHz = Number(settings.trackHz) || 30;
  quality.fpsEma = 0;
}

function applyAutoScale() {
  applySize();
}

function applyRenderScaleSetting() {
  const wantAA = quality.userScale >= 0.9;
  if (wantAA !== antialiasActive && rebuildRenderer()) {
    antialiasActive = wantAA;
    return;
  }
  resize();
}

// Keeps the frame budget honest on weak machines: drops render scale first,
// then tracking rate, and walks both back up once there is headroom.
function adaptQuality(now, dt) {
  if (!settings.autoQuality || dt <= 0) return;
  const inst = 1 / dt;
  quality.fpsEma = quality.fpsEma ? quality.fpsEma * 0.9 + inst * 0.1 : inst;
  if (now - quality.lastAdjust < 1500) return;
  quality.lastAdjust = now;

  const target = Number(settings.fpsCap) || 60;
  const minScale = 0.4;
  const fps = quality.fpsEma;
  let changed = false;

  if (fps < target * 0.8 && quality.scale > minScale) {
    quality.scale = Math.max(minScale, Math.round((quality.scale - 0.15) * 100) / 100);
    quality.lastDown = now;
    changed = true;
  } else if (fps < target * 0.9 && quality.effTrackHz > 15 && face.detectMs > 12) {
    quality.effTrackHz = quality.effTrackHz > 30 ? 30 : 15;
  } else if (
    fps > target * 0.97 &&
    quality.scale < quality.userScale &&
    now - quality.lastDown > 6000
  ) {
    quality.scale = Math.min(quality.userScale, Math.round((quality.scale + 0.05) * 100) / 100);
    changed = true;
  }

  if (changed) applyAutoScale();
}

/* ---------- loop ---------- */

function updateAutoBlink(dt) {
  if (blinkT >= 0) {
    blinkT += dt / 0.15;
    if (blinkT >= 1) {
      blinkT = -1;
      blinkTimer = 1.8 + Math.random() * 3.4;
    }
    return Math.sin(Math.min(1, blinkT) * Math.PI);
  }
  blinkTimer -= dt;
  if (blinkTimer <= 0) blinkT = 0;
  return 0;
}

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let lastRender = 0;
let lastStatus = 0;
let lastTrack = 0;

// The mic meter is cosmetic; repainting it every frame forces a style recalc
// for no visible gain.
let meterAt = 0;
let meterPct = -1;
let meterRunning = false;
function uiMeter(now) {
  if (now - meterAt < 100) return;
  meterAt = now;
  const pct = Math.round(micLevel * 100);
  if (pct === meterPct && mic.running === meterRunning) return;
  meterPct = pct;
  meterRunning = mic.running;
  $("micMeter").style.setProperty("--level", `${pct}%`);
  $("micDb").textContent = mic.running ? String(pct) : "–";
}

function frame(now) {
  requestAnimationFrame(frame);

  const interval = 1000 / Number(settings.fpsCap || 60);
  if (now - lastRender < interval - 1.2) return;
  const dt = clamp((now - last) / 1000, 0.001, 0.1);
  last = now;
  lastRender = now;

  let faceActive = false;
  let faceSeen = false;
  const camMouth = settings.mouthSrc !== "mic" || !micRunning;
  const micMouth = settings.mouthSrc !== "cam" && micRunning;

  for (const key of KEYS) tmpTarget[key] = 0;

  if (face.running) {
    const trackMs = 1000 / Math.max(5, quality.effTrackHz || 30);
    if (now - lastTrack >= trackMs) {
      lastTrack = now;
      face.sample(now);
    }
    if (face.hasFace) {
      faceSeen = true;
      const exp = face.computeExpressions(camMouth ? "both" : "mic");
      if (settings.mirror) {
        const swap = exp.lookLeft;
        exp.lookLeft = exp.lookRight;
        exp.lookRight = swap;
      }
      for (const key of KEYS) {
        if (!settings.useEyes && EYE_KEYS.includes(key)) continue;
        if (!settings.useExpr && EXPR_KEYS.includes(key)) continue;
        if (!settings.useBlink && (key === "blink" || key === "blinkLeft" || key === "blinkRight"))
          continue;
        tmpTarget[key] = exp[key] || 0;
      }
      if (settings.useHead) {
        face.getHeadQuaternion(
          settings.sens,
          settings.mirror,
          { x: settings.invertX, y: settings.invertY, z: settings.invertZ },
          targetHead,
        );
        faceActive = true;
      }
    }
  }

  micLevel = 0;
  if (mic.running) {
    const m = mic.read(dt, settings.micGain);
    if (m) {
      micLevel = m.level;
      if (micMouth) {
        // In "both" mode mic wins while someone is speaking: camera mouth
        // shapes are too generic and would hide the vowel distinction.
        const micDominant = camMouth && m.level > 0.04;
        for (const key of MOUTH_KEYS) {
          const value = m[key] || 0;
          tmpTarget[key] = micDominant ? value : Math.max(tmpTarget[key], value);
        }
      }
    }
  }

  if (now < mouthTestUntil) {
    const wave = 0.5 + 0.5 * Math.sin(now / 85);
    tmpTarget.aa = Math.max(tmpTarget.aa, 0.25 + 0.75 * wave);
    tmpTarget.ou = Math.max(tmpTarget.ou, 0.4 * (1 - wave));
    tmpTarget.happy = Math.max(tmpTarget.happy, 0.55);
  }

  uiMeter(now);

  // A viewer mirrors the panel's already-smoothed values. Applying smoothing
  // again would add visible lag and soften the panel's expressions.
  const remote = viewer && remotePose && poseSync.fresh;

  if (!faceSeen && settings.autoBlink && !remote) {
    tmpTarget.blink = Math.max(tmpTarget.blink, updateAutoBlink(dt));
  }

  if (remote) {
    for (const key of KEYS) {
      const value = Number(remotePose.w?.[key]);
      smoothW[key] = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
    }
    const head = remotePose.head;
    if (Array.isArray(head) && head.every((n) => Number.isFinite(n))) {
      smoothHead.fromArray(head);
    }
  } else {
    const attack = 1 - Math.exp(-dt / 0.045);
    const release = 1 - Math.exp(-dt / 0.11);
    for (const key of KEYS) {
      const target = tmpTarget[key] || 0;
      const k = target > smoothW[key] ? attack : release;
      smoothW[key] += (target - smoothW[key]) * k;
    }

    const tau = 0.015 + settings.smooth * 0.24;
    const headK = 1 - Math.exp(-dt / tau);
    if (faceActive) smoothHead.slerp(targetHead, headK);
    else smoothHead.slerp(identity, headK * 0.35);
  }

  if (!viewer) poseSync.send(smoothW, smoothHead.toArray());

  avatar.pose(
    now / 1000,
    faceActive || smoothHead.angleTo(identity) > 0.001 ? smoothHead : null,
    settings.useIdle,
  );
  avatar.setExpressions(smoothW);
  avatar.update(dt, settings.useSpring);

  renderer.render(scene, camera);
  adaptQuality(now, dt);

  fpsFrames += 1;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const shown = Math.round(fpsFrames / fpsTime);
    const pct = Math.round(quality.scale * 100);
    $("fps").textContent =
      settings.autoQuality && pct !== Math.round(quality.userScale * 100)
        ? `${shown} fps · ${pct}%`
        : `${shown} fps`;
    fpsFrames = 0;
    fpsTime = 0;
  }

  if (settings.panelHidden && now - lastPoll > 2500) {
    lastPoll = now;
    pollServer();
  }

  if (now - lastStatus > 400) {
    lastStatus = now;
    const camEl = $("statusCam");
    if (!face.running) {
      camEl.textContent = "kamera: off";
      camEl.className = "";
    } else {
      const w = face.video?.videoWidth || 0;
      const h = face.video?.videoHeight || 0;
      if (w > 0) {
        camEl.textContent = `kamera: ${w}×${h}`;
        camEl.className = "good";
      } else if (now - camStartedAt > 3000) {
        camEl.textContent = "kamera: tanpa gambar";
        camEl.className = "bad";
      } else {
        camEl.textContent = "kamera: menunggu…";
        camEl.className = "";
      }
    }

    const faceEl = $("statusFace");
    if (!face.running) {
      faceEl.textContent = "wajah: –";
      faceEl.className = "";
    } else if (face.hasFace) {
      faceEl.textContent = "wajah: terdeteksi";
      faceEl.className = "good";
    } else {
      faceEl.textContent = "wajah: tidak terlihat";
      faceEl.className = now - camStartedAt > 4000 ? "bad" : "";
    }

    const micEl = $("statusMic");
    micEl.textContent = `mic: ${mic.running ? `${Math.round(micLevel * 100)}%` : "off"}`;
    micEl.className = mic.running && micLevel > 0.02 ? "good" : "";
  }
}

/* ---------- boot ---------- */

async function boot() {
  const delegateParam = params.get("delegate");
  if (delegateParam) settings.delegate = delegateParam.toLowerCase() === "cpu" ? "CPU" : "GPU";
  face.delegate = settings.delegate;
  applyPanel();
  applyTab(activeTab);
  applyBackground();
  syncUI();
  resize();
  poseSync.connect();
  requestAnimationFrame(frame);
  refreshDevices();

  const server = await getServerState();
  if (server?.settings) applyServerSettings(server.settings);
  else pushSettings();

  if (server?.bgExists) {
    await loadServerBackground(server);
  } else {
    await setBackgroundImageFromStore();
  }

  if (server?.avatarExists) {
    await loadServerAvatar(server);
  } else {
    const saved = await store.loadVrm().catch(() => null);
    if (saved?.buffer) {
      $("vrmName").textContent = `${saved.name} (tersimpan)`;
      await loadVrmBuffer(saved.buffer, saved.name, true);
    }
  }
}

let lastErrorToast = 0;
function reportError(message) {
  if (performance.now() - lastErrorToast < 3000) return;
  lastErrorToast = performance.now();
  toast(String(message).slice(0, 180), 6000);
}
window.addEventListener("error", (e) => reportError(`Error: ${e.message || e.error}`));
window.addEventListener("unhandledrejection", (e) =>
  reportError(`Error: ${e.reason?.message || e.reason}`),
);

window.__litetuber = {
  face,
  mic,
  settings,
  quality,
  get renderer() {
    return renderer;
  },
  smoothW,
  get smoothHead() {
    return smoothHead;
  },
  get micLevel() {
    return micLevel;
  },
  get avatar() {
    return avatar;
  },
  get avatarBusy() {
    return avatarBusy;
  },
  pose: poseSync,
  get remotePose() {
    return remotePose;
  },
};

boot();
