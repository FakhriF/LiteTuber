import * as THREE from "three";
import { VrmAvatar } from "./avatar.js";
import { PlaceholderAvatar } from "./placeholder.js";
import { FaceTracker } from "./face.js";
import { MicMouth } from "./audio.js";
import { PoseSync } from "./pose-sync.js";
import { inspectVrm } from "./vrm.js";
import { RetryLoop, isFatalMediaError } from "./recovery.js";
import * as store from "./store.js";
import { deletePreset, exportPresets, importPresets, mergePreset, normalizeName, savePreset } from "./presets.js";
import { setupProfiles } from "./profiles.js";
import { trackScaleFor } from "./track-scale.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

$("version").textContent = `v${__APP_VERSION__}`;

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
    console.error("renderer rebuild failed", err);
    return false;
  }
  const old = renderer;
  canvas.replaceWith(nextCanvas);
  canvas = nextCanvas;
  renderer = next;
  // The new renderer starts at its default size, so force a real resize.
  appliedSize.width = 0;
  appliedSize.height = 0;
  appliedSize.ratio = 0;
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

const camRetry = new RetryLoop({
  onExhausted: () =>
    toast("Camera could not be recovered. Click Start camera to try again.", 8000),
});
const micRetry = new RetryLoop({
  onExhausted: () =>
    toast("Mic could not be recovered. Click Start mic to try again.", 8000),
});
let deviceChangeTimer = 0;

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
const EYE_SET = new Set(EYE_KEYS);
const EXPR_SET = new Set(EXPR_KEYS);
const BLINK_SET = new Set(["blink", "blinkLeft", "blinkRight"]);

const identity = new THREE.Quaternion();
const smoothHead = new THREE.Quaternion();
const targetHead = new THREE.Quaternion();
// Reused so the 60 fps pose relay does not allocate a fresh 4-element array
// every frame; send() copies it into the JSON string before returning.
const headOut = [0, 0, 0, 0];
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
    NotAllowedError: `${kind} permission was denied. Click the lock/camera icon in the address bar, choose Allow, then try again.`,
    PermissionDeniedError: `${kind} permission was denied.`,
    SecurityError: `Access to ${kind} needs http://127.0.0.1 or https.`,
    NotFoundError: `${kind} was not found.`,
    DevicesNotFoundError: `${kind} was not found.`,
    NotReadableError: `${kind} is being used by another app (OBS/Zoom/another browser).`,
    TrackStartError: `${kind} could not be used because another app is using it.`,
    AbortError: `${kind} could not be opened.`,
    OverconstrainedError: `${kind} does not support the requested setting.`,
    NotSupportedError: `This browser does not support ${kind} access.`,
  };
  return map[name] || `Could not access ${kind}: ${err?.message || err}`;
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

function settingsPayload() {
  const payload = { ...settings };
  delete payload.panelHidden;
  return payload;
}

function pushSettings() {
  if (applyingServer) return;
  clearTimeout(pushTimer);
  const payload = settingsPayload();
  pushTimer = setTimeout(() => {
    fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: payload }),
    }).catch(() => {});
  }, 350);
}

// Profiles snapshot the server state, so the debounced save must land first.
async function flushSettings() {
  clearTimeout(pushTimer);
  if (applyingServer) return;
  try {
    await fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: settingsPayload() }),
    });
  } catch {
    /* the profile request will report a server problem */
  }
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
      label.textContent = `${name} · uploading ${pct}%`;
    });
    const done = (ok, code) => {
      label.textContent = name;
      if (!ok) {
        toast(
          code === 415
            ? "The server rejected the file: not a valid VRM avatar"
            : `Could not save the avatar to the server (${code})`,
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
    else if (!state.bgExists && serverBgMtime !== 0) {
      $("bgImage").style.backgroundImage = "";
      serverBgMtime = 0;
    }
    if (!avatarBusy && state.avatarExists && state.avatarMtime !== serverAvatarMtime)
      await loadServerAvatar(state);
    else if (!avatarBusy && !state.avatarExists && serverAvatarMtime !== 0) {
      await switchToPlaceholder();
      serverAvatarMtime = 0;
    }
  } finally {
    polling = false;
  }
}

// A profile apply swaps the active avatar, background, and settings on the
// server. Drop the cached ETag/mtimes so the next poll loads everything.
async function reloadFromServer() {
  clearTimeout(pushTimer);
  serverStateEtag = "";
  serverAvatarMtime = 0;
  serverBgMtime = 0;
  const state = await getServerState();
  if (!state) return;
  if (state.settings) applyServerSettings(state.settings);
  if (state.bgExists) {
    await loadServerBackground(state);
  } else {
    $("bgImage").style.backgroundImage = "";
  }
  if (state.avatarExists) {
    await loadServerAvatar(state);
  } else {
    await switchToPlaceholder();
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
    toast("No background image yet. Choose an image first.");
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
    toast(`Not a valid VRM avatar: ${check.reason || "incomplete file"}`);
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
    // Shader programs are compiled on the first draw otherwise, which shows up
    // as a one-frame hitch right when an avatar appears. A failed compile is
    // harmless: the first real render will report the error.
    try {
      renderer.compile(scene, camera);
    } catch {
      /* ignore */
    }
    if (persist) {
      await store.saveVrm(buffer, name).catch(() => {});
      pushAvatar(buffer, name);
    }
    toast(`Avatar loaded: ${name}`);
  } catch (err) {
    console.error(err);
    next.dispose();
    toast(`Could not load the avatar: ${err.message || err}`);
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

function cameraUiOff() {
  $("camBtn").textContent = "Start camera";
  $("camBtn").classList.remove("on");
  $("calBtn").disabled = true;
  updateCamPreview();
}

async function startCamera(deviceId, { auto = false } = {}) {
  if (face.running) return true;
  const slowHint = setTimeout(
    () => toast("Waiting for camera permission… check the permission popup or the camera icon in the address bar", 6000),
    3500,
  );
  try {
    $("camBtn").textContent = "Preparing…";
    await face.openCamera(deviceId || settings.camDevice || null, $("cam"));
    clearTimeout(slowHint);
    camStartedAt = performance.now();
    $("camBtn").textContent = "Stop camera";
    $("camBtn").classList.add("on");
    $("calBtn").disabled = false;
    updateCamPreview();
    refreshDevices();
    dismissHint();
    toast("Camera on, loading the face model…", 3000);
    await face.ensureLandmarker();
    camRetry.reset();
    toast("Face tracking ready — click Calibrate at your neutral position");
    return true;
  } catch (err) {
    clearTimeout(slowHint);
    console.error(err);
    face.stop();
    cameraUiOff();
    const fatal = isFatalMediaError(err);
    if (fatal) camRetry.stop();
    // During automatic recovery the retry loop owns the schedule and the
    // final message; a manual start reports the error directly.
    if (fatal || !auto) toast(mediaError(err, "camera"), 7000);
    else toast("Camera not available yet. Retrying…", 3000);
    return false;
  }
}

function beginCameraRecovery() {
  if (camRetry.pending) return;
  const delay = camRetry.schedule(() => startCamera(settings.camDevice || null, { auto: true }));
  if (delay === null) {
    toast("Camera could not be recovered. Click Start camera to try again.", 8000);
  }
}

function onCameraLost() {
  cameraUiOff();
  camStartedAt = 0;
  toast("Camera disconnected. Trying to reconnect…", 5000);
  beginCameraRecovery();
}

function stopCamera({ silent = false } = {}) {
  camRetry.reset();
  face.stop();
  face.calibrated = false;
  cameraUiOff();
  if (!silent) toast("Camera stopped");
}

function toggleCamera() {
  if (face.running) stopCamera();
  else startCamera();
}

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillDevices($("camDevice"), devices.filter((d) => d.kind === "videoinput"), "Default camera", "Camera");
    fillDevices($("micDevice"), devices.filter((d) => d.kind === "audioinput"), "Default mic", "Mic");
  } catch {
    /* devices are optional */
  }
}

function fillDevices(select, devices, fallbackLabel, prefix) {
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
    opt.textContent = d.label || `${prefix} ${i + 1}`;
    select.append(opt);
  });
  select.hidden = devices.length < 2;
  const wanted = select === $("camDevice") ? settings.camDevice : settings.micDevice;
  select.value = current || wanted || "";
}

function micUiOff() {
  $("micBtn").textContent = "Start mic";
  $("micBtn").classList.remove("on");
}

async function startMic(deviceId, { auto = false } = {}) {
  if (mic.running) return true;
  try {
    await mic.start(deviceId || settings.micDevice || null);
    refreshDevices();
    micRunning = true;
    $("micBtn").textContent = "Stop mic";
    $("micBtn").classList.add("on");
    micRetry.reset();
    if (mic.suspended) {
      toast("Mic on — click once on the page so audio can start");
    } else {
      toast("Mic on for mouth movement");
    }
    return true;
  } catch (err) {
    console.error(err);
    micRunning = false;
    mic.stop();
    micUiOff();
    const fatal = isFatalMediaError(err);
    if (fatal) micRetry.stop();
    if (fatal || !auto) toast(mediaError(err, "mic"), 7000);
    else toast("Mic not available yet. Retrying…", 3000);
    return false;
  }
}

function beginMicRecovery() {
  if (micRetry.pending) return;
  const delay = micRetry.schedule(() => startMic(settings.micDevice || null, { auto: true }));
  if (delay === null) {
    toast("Mic could not be recovered. Click Start mic to try again.", 8000);
  }
}

function onMicLost() {
  micRunning = false;
  micUiOff();
  toast("Mic disconnected. Trying to reconnect…", 5000);
  beginMicRecovery();
}

async function toggleMic() {
  if (mic.running) {
    micRetry.reset();
    mic.stop();
    micRunning = false;
    micUiOff();
    return;
  }
  await startMic(settings.micDevice || null);
}

function calibrate() {
  if (face.calibrate()) {
    smoothHead.identity();
    toast("Neutral position saved");
  } else {
    toast("Face not detected yet");
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

/* ---------- presets ---------- */

let presets = store.loadPresets();

function updatePresetButtons() {
  const selected = $("presetList").value;
  $("presetApply").disabled = !selected;
  $("presetDelete").disabled = !selected;
}

function renderPresetOptions(selected = $("presetList").value) {
  const select = $("presetList");
  const names = presets.map((preset) => preset.name).sort((a, b) => a.localeCompare(b, "id"));
  select.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— none selected —";
  select.append(none);
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  select.value = names.includes(selected) ? selected : "";
  updatePresetButtons();
}

function applyPresetSettings(preset) {
  Object.assign(settings, mergePreset(settings, preset));
  syncUI();
  syncQualityFromSettings();
  applyFraming();
  applyBackground();
  applyRenderScaleSetting();
  renderer.toneMappingExposure = settings.exposure;
  commit();
}

async function deviceListed(deviceId, kind) {
  if (!deviceId) return true;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === kind && d.deviceId === deviceId);
  } catch {
    // Without a device list there is nothing better to fall back to.
    return true;
  }
}

// Unplugging a device fires `devicechange`. The refresh also covers devices
// that appear later, and moves an active stream to the default device.
function onDeviceChange() {
  clearTimeout(deviceChangeTimer);
  deviceChangeTimer = setTimeout(async () => {
    await refreshDevices();
    const camWanted = settings.camDevice;
    if ((face.running || camRetry.pending) && !(await deviceListed(camWanted, "videoinput"))) {
      settings.camDevice = "";
      commit();
      toast("The selected camera disappeared. Switching to the default camera.", 5000);
      if (face.running) {
        stopCamera({ silent: true });
        await startCamera(null, { auto: true });
      }
    }
    const micWanted = settings.micDevice;
    if ((mic.running || micRetry.pending) && !(await deviceListed(micWanted, "audioinput"))) {
      settings.micDevice = "";
      commit();
      toast("The selected mic disappeared. Switching to the default mic.", 5000);
      if (mic.running) {
        micRetry.reset();
        mic.stop();
        micRunning = false;
        micUiOff();
        await startMic(null, { auto: true });
      }
    }
  }, 400);
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
  $("vrmName").textContent = "no avatar yet";
  toast("Saved avatar removed");
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
    micRetry.reset();
    mic.stop();
    micRunning = false;
    micUiOff();
    await startMic(settings.micDevice || null);
  }
});
$("micBtn").addEventListener("click", toggleMic);
$("calBtn").addEventListener("click", calibrate);
$("mouthTest").addEventListener("click", () => {
  mouthTestUntil = performance.now() + 1800;
  toast("Expression test — if the avatar does not move, the model has no mouth expressions", 3500);
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
  applyTrackScale();
  face.resetModel();
  commit();
  if (face.running) toast("Tracking processor changed — stop and start the camera");
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
  applyTrackScale();
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
    await store.saveBackground(dataUrl).catch(() => toast("Image is too large to save"));
    fetch("/api/background", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    }).catch(() => {});
  };
  reader.readAsDataURL(file);
});

$("presetList").addEventListener("change", updatePresetButtons);

$("presetSave").addEventListener("click", () => {
  const name = normalizeName($("presetName").value) || $("presetList").value;
  const result = savePreset(presets, name, settings);
  if (result.error) {
    toast(result.error);
    return;
  }
  if (!store.savePresets(result.presets)) {
    toast("Could not save the preset. Is browser storage full?");
    return;
  }
  presets = result.presets;
  $("presetName").value = "";
  renderPresetOptions(result.preset.name);
  toast(
    result.replaced
      ? `Preset "${result.preset.name}" updated`
      : `Preset "${result.preset.name}" saved`,
  );
});

$("presetApply").addEventListener("click", () => {
  const name = $("presetList").value;
  const preset = presets.find((item) => item.name === name);
  if (!preset) {
    toast("Choose a preset first.");
    return;
  }
  applyPresetSettings(preset);
  if (settings.bg === "image" && !$("bgImage").style.backgroundImage) {
    toast(`Preset "${name}" applied. No background image yet; choose one in the Display tab.`, 4200);
  } else {
    toast(`Preset "${name}" applied`);
  }
});

$("presetDelete").addEventListener("click", () => {
  const name = $("presetList").value;
  if (!name) return;
  if (!window.confirm(`Delete preset "${name}"?`)) return;
  const next = deletePreset(presets, name);
  if (!store.savePresets(next)) {
    toast("Could not delete the preset.");
    return;
  }
  presets = next;
  renderPresetOptions("");
  toast(`Preset "${name}" deleted`);
});

$("presetExport").addEventListener("click", () => {
  if (!presets.length) {
    toast("No presets to export yet.");
    return;
  }
  const file = exportPresets(presets);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `litetuber-preset-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${file.presets.length} preset${file.presets.length === 1 ? "" : "s"} exported`);
});

$("presetImport").addEventListener("click", () => $("presetFile").click());
$("presetFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    toast("File is not valid JSON.");
    return;
  }
  const result = importPresets(presets, payload);
  if (result.error) {
    toast(result.error);
    return;
  }
  if (!store.savePresets(result.presets)) {
    toast("Could not save the preset. Is browser storage full?");
    return;
  }
  presets = result.presets;
  renderPresetOptions("");
  const parts = [`${result.added} preset${result.added === 1 ? "" : "s"} imported`];
  if (result.skipped) parts.push(`${result.skipped} skipped because the name already exists`);
  if (result.dropped) parts.push(`${result.dropped} did not fit (max 24)`);
  toast(parts.join(", "), 4200);
});

renderPresetOptions("");

setupProfiles({ $, toast, flushSettings, reloadFromServer });

$("obsBtn").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?ui=0`;
  try {
    await navigator.clipboard.writeText(url);
    toast(`OBS URL copied (display mode): ${url}`, 3200);
  } catch {
    toast(url, 6000);
  }
});

window.addEventListener("pointerdown", async () => {
  if (mic.running && mic.suspended) {
    const resumed = await mic.resume();
    if (resumed) toast("Mic audio resumed");
  }
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

// The drawing buffer is expensive to resize, so a drag-resize that fires
// dozens of events per second is coalesced into one rAF, and a size or ratio
// that did not actually change never touches WebGL at all.
const appliedSize = { width: 0, height: 0, ratio: 0 };

function applySize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const base = Math.max(0.4, Math.min(window.devicePixelRatio || 1, 1.5));
  const ratio = base * (quality.scale || 1);
  if (width !== appliedSize.width || height !== appliedSize.height) {
    renderer.setSize(width, height, false);
    appliedSize.width = width;
    appliedSize.height = height;
  }
  if (ratio !== appliedSize.ratio) {
    renderer.setPixelRatio(ratio);
    appliedSize.ratio = ratio;
    // setPixelRatio re-applies the logical size with a new buffer.
    renderer.setSize(width, height, false);
  }
}

function resize() {
  applySize();
  applyFraming();
}

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    resize();
  });
});

function syncQualityFromSettings() {
  quality.userScale = Number(settings.renderScale) || 1;
  quality.scale = quality.userScale;
  quality.effTrackHz = Number(settings.trackHz) || 30;
  quality.fpsEma = 0;
  applyTrackScale();
}

// MediaPipe cost follows pixel count, so a tight budget also gets a smaller
// frame to look at. The visual output is unaffected: the VRM render keeps its
// own resolution.
function applyTrackScale() {
  face.trackScale = trackScaleFor({
    delegate: settings.delegate,
    trackHz: quality.effTrackHz,
  });
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
    applyTrackScale();
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
        if (!settings.useEyes && EYE_SET.has(key)) continue;
        if (!settings.useExpr && EXPR_SET.has(key)) continue;
        if (!settings.useBlink && BLINK_SET.has(key)) continue;
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

  if (!viewer) poseSync.send(smoothW, smoothHead.toArray(headOut, 0));

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
      camEl.textContent = "cam: off";
      camEl.className = "";
    } else {
      const w = face.video?.videoWidth || 0;
      const h = face.video?.videoHeight || 0;
      if (w > 0) {
        camEl.textContent = `cam: ${w}×${h}`;
        camEl.className = "good";
      } else if (now - camStartedAt > 3000) {
        camEl.textContent = "cam: no picture";
        camEl.className = "bad";
      } else {
        camEl.textContent = "cam: waiting…";
        camEl.className = "";
      }
    }

    const faceEl = $("statusFace");
    if (!face.running) {
      faceEl.textContent = "face: –";
      faceEl.className = "";
    } else if (face.hasFace) {
      faceEl.textContent = "face: detected";
      faceEl.className = "good";
    } else {
      faceEl.textContent = "face: not visible";
      faceEl.className = now - camStartedAt > 4000 ? "bad" : "";
    }

    const micEl = $("statusMic");
    if (!mic.running) {
      micEl.textContent = "mic: off";
      micEl.className = "";
    } else if (mic.suspended) {
      micEl.textContent = "mic: suspended";
      micEl.className = "bad";
    } else {
      micEl.textContent = `mic: ${Math.round(micLevel * 100)}%`;
      micEl.className = micLevel > 0.02 ? "good" : "";
    }
  }
}

/* ---------- boot ---------- */

async function boot() {
  const delegateParam = params.get("delegate");
  if (delegateParam) settings.delegate = delegateParam.toLowerCase() === "cpu" ? "CPU" : "GPU";
  face.delegate = settings.delegate;
  applyTrackScale();
  applyPanel();
  applyTab(activeTab);
  applyBackground();
  syncUI();
  resize();
  poseSync.connect();
  requestAnimationFrame(frame);
  refreshDevices();
  face.onTrackEnded = onCameraLost;
  mic.onTrackEnded = onMicLost;
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

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
      $("vrmName").textContent = `${saved.name} (saved)`;
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
  camRetry,
  micRetry,
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
