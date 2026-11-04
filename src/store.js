const SETTINGS_KEY = "litetuber.settings.v1";

export const defaults = {
  bg: "transparent",
  framing: "bust",
  zoom: 1,
  exposure: 1,
  mirror: true,
  sens: 1,
  smooth: 0.42,
  fpsCap: 60,
  mouthSrc: "both",
  micGain: 1,
  autoBlink: true,
  invertX: false,
  invertY: false,
  invertZ: false,
  delegate: "GPU",
  camDevice: "",
  micDevice: "",
  useHead: true,
  useEyes: true,
  useBlink: true,
  useExpr: true,
  useIdle: true,
  useSpring: true,
  panelHidden: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

let saveTimer = 0;
export function saveSettings(settings) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota errors */
    }
  }, 120);
}

const DB_NAME = "litetuber";
const DB_STORE = "assets";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function del(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const saveVrm = (buffer, name) => put("vrm", { buffer, name, ts: Date.now() });
export const loadVrm = () => get("vrm");
export const clearVrm = () => del("vrm");
export const saveBackground = (dataUrl) => put("bg", dataUrl);
export const loadBackground = () => get("bg");
export const clearBackground = () => del("bg");
