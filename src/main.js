import * as THREE from "three";
import { PlaceholderAvatar } from "./placeholder.js";
import { FaceTracker } from "./face.js";
import { MicMouth } from "./audio.js";
import { PoseSync } from "./pose-sync.js";
import * as store from "./store.js";
import { $, createUi } from "./ui.js";
import { blankWeights } from "./pose-keys.js";
import { createView } from "./view.js";
import { createAvatarLoader } from "./avatar-loader.js";
import { createServerSync } from "./server-sync.js";
import { createMedia } from "./media.js";
import { createPanel } from "./panel.js";
import { createLoop } from "./loop.js";

$("version").textContent = `v${__APP_VERSION__}`;

const params = new URLSearchParams(location.search);
const settings = store.loadSettings();
const forcedBg = params.get("bg");
// OBS uses the same page with ?ui=0. That instance is display-only and mirrors
// the panel's live pose instead of creating its own settings/camera session.
const viewer = params.get("ui") === "0";
if (viewer) settings.panelHidden = true;
if (forcedBg) settings.bg = forcedBg;

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

// Everything the modules below need to read or replace while the app runs.
// The smoothing state lives here too, because the loop writes it and the debug
// handle exposes it.
const S = {
  forcedBg,
  canvas: null,
  renderer: null,
  antialiasActive: quality.userScale >= 0.9,
  avatar: null,
  avatarBusy: false,
  remotePose: null,
  micRunning: false,
  micLevel: 0,
  camStartedAt: 0,
  mouthTestUntil: 0,
  hintDismissed: false,
  applyingServer: false,
  serverAvatarMtime: 0,
  serverBgMtime: 0,
  serverStateEtag: "",
  pushTimer: 0,
  polling: false,
  lastPoll: 0,
  smoothW: blankWeights(),
  smoothHead: new THREE.Quaternion(),
  targetHead: new THREE.Quaternion(),
  headOut: [0, 0, 0, 0],
  tmpTarget: {},
};

// Cross-module calls are collected here as each module is created, so the
// modules can call each other without importing one another.
const api = {};

const ui = createUi({ S });
Object.assign(api, ui);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

scene.add(new THREE.AmbientLight(0xffffff, 1.25));
const keyLight = new THREE.DirectionalLight(0xfff3e6, 2.35);
keyLight.position.set(0.7, 2.1, 1.7);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xbfd2ff, 0.85);
fillLight.position.set(-1.5, 1.1, 1.2);
scene.add(fillLight);

const face = new FaceTracker();
const mic = new MicMouth();
S.avatar = new PlaceholderAvatar(scene);

const canvas = $("stage");
const view = createView({ settings, quality, S, scene, camera, face });
view.init(canvas);
Object.assign(api, {
  applyFraming: view.applyFraming,
  applyRenderScaleSetting: view.applyRenderScaleSetting,
  syncQualityFromSettings: view.syncQualityFromSettings,
  applyTrackScale: view.applyTrackScale,
  applyAutoScale: view.applyAutoScale,
  adaptQuality: view.adaptQuality,
});

const avatarLoader = createAvatarLoader({ $, store, settings, S, api, scene, camera });
Object.assign(api, {
  loadServerAvatar: avatarLoader.loadServerAvatar,
  loadServerBackground: avatarLoader.loadServerBackground,
  setBackgroundImageFromStore: avatarLoader.setBackgroundImageFromStore,
  switchToPlaceholder: avatarLoader.switchToPlaceholder,
  onVrmFile: avatarLoader.onVrmFile,
});

const serverSync = createServerSync({ settings, S, api });
Object.assign(api, {
  pushSettings: serverSync.pushSettings,
  flushSettings: serverSync.flushSettings,
  pollServer: serverSync.pollServer,
  reloadFromServer: serverSync.reloadFromServer,
});

const media = createMedia({
  $,
  settings,
  S,
  api,
  face,
  mic,
  toast: ui.toast,
  mediaError: ui.mediaError,
});
Object.assign(api, {
  startCamera: media.startCamera,
  stopCamera: media.stopCamera,
  toggleCamera: media.toggleCamera,
  startMic: media.startMic,
  toggleMic: media.toggleMic,
  calibrate: media.calibrate,
  onCameraLost: media.onCameraLost,
  onMicLost: media.onMicLost,
  onDeviceChange: media.onDeviceChange,
  refreshDevices: media.refreshDevices,
  updateCamPreview: media.updateCamPreview,
  micUiOff: media.micUiOff,
  micRetry: media.micRetry,
});

const panel = createPanel({ $, settings, quality, S, api, face, mic });
Object.assign(api, {
  syncUI: panel.syncUI,
  applyPanel: panel.applyPanel,
  applyBackground: panel.applyBackground,
  commit: panel.commit,
});

const poseSync = new PoseSync(viewer ? "viewer" : "panel", {
  onPose: (pose) => {
    S.remotePose = pose;
  },
  onPeers: (count) => {
    const badge = $("obsBadge");
    if (!badge) return;
    badge.textContent = count > 0 ? `OBS ${count}` : "OBS off";
    badge.classList.toggle("on", count > 0);
  },
});

const loop = createLoop({
  $,
  settings,
  quality,
  S,
  api,
  face,
  mic,
  poseSync,
  viewer,
  scene,
  camera,
});

/* ---------- boot ---------- */

async function boot() {
  const delegateParam = params.get("delegate");
  if (delegateParam) settings.delegate = delegateParam.toLowerCase() === "cpu" ? "CPU" : "GPU";
  face.delegate = settings.delegate;
  view.applyTrackScale();
  panel.applyPanel();
  panel.applyCurrentTab();
  panel.applyBackground();
  panel.syncUI();
  view.resize();
  poseSync.connect();
  loop.start();
  media.refreshDevices();
  face.onTrackEnded = media.onCameraLost;
  mic.onTrackEnded = media.onMicLost;
  navigator.mediaDevices?.addEventListener?.("devicechange", media.onDeviceChange);

  const server = await serverSync.getServerState();
  if (server?.settings) serverSync.applyServerSettings(server.settings);
  else serverSync.pushSettings();

  if (server?.bgExists) {
    await avatarLoader.loadServerBackground(server);
  } else {
    await avatarLoader.setBackgroundImageFromStore();
  }

  if (server?.avatarExists) {
    await avatarLoader.loadServerAvatar(server);
  } else {
    const saved = await store.loadVrm().catch(() => null);
    if (saved?.buffer) {
      $("vrmName").textContent = `${saved.name} (saved)`;
      await avatarLoader.loadVrmBuffer(saved.buffer, saved.name, true);
    }
  }
}

window.addEventListener("error", (e) => ui.reportError(`Error: ${e.message || e.error}`));
window.addEventListener("unhandledrejection", (e) =>
  ui.reportError(`Error: ${e.reason?.message || e.reason}`),
);

window.__litetuber = {
  face,
  mic,
  camRetry: media.camRetry,
  micRetry: media.micRetry,
  settings,
  quality,
  get renderer() {
    return S.renderer;
  },
  smoothW: S.smoothW,
  get smoothHead() {
    return S.smoothHead;
  },
  get micLevel() {
    return S.micLevel;
  },
  get avatar() {
    return S.avatar;
  },
  get avatarBusy() {
    return S.avatarBusy;
  },
  pose: poseSync,
  get remotePose() {
    return S.remotePose;
  },
};

boot();
