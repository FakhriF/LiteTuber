// Presets are named combinations of panel settings only. Avatar and background
// image files stay in their existing stores, so a preset never copies assets.
export const PRESET_FIELDS = Object.freeze([
  "framing",
  "zoom",
  "exposure",
  "sens",
  "smooth",
  "mirror",
  "mouthSrc",
  "micGain",
  "renderScale",
  "fpsCap",
  "trackHz",
  "autoQuality",
  "bg",
]);

export const MAX_PRESETS = 24;
export const MAX_PRESET_NAME = 32;

function isScalar(value) {
  return typeof value === "string" || typeof value === "boolean" || Number.isFinite(value);
}

export function normalizeName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PRESET_NAME);
}

export function pickPreset(settings) {
  const picked = {};
  if (!settings || typeof settings !== "object") return picked;
  for (const key of PRESET_FIELDS) {
    if (isScalar(settings[key])) picked[key] = settings[key];
  }
  return picked;
}

export function sanitizePreset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = normalizeName(value.name);
  if (!name) return null;
  const settings = pickPreset(value.settings);
  if (!Object.keys(settings).length) return null;
  const ts = Number.isFinite(value.ts) ? value.ts : 0;
  return { name, settings, ts };
}

export function sanitizePresets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const preset = sanitizePreset(raw);
    if (!preset) continue;
    const key = preset.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(preset);
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}

// Saving an existing name replaces that preset instead of adding a duplicate.
export function savePreset(list, name, settings, now = Date.now()) {
  const presets = sanitizePresets(list);
  const clean = normalizeName(name);
  if (!clean) return { presets, error: "Beri nama preset dulu." };
  const picked = pickPreset(settings);
  if (!Object.keys(picked).length) {
    return { presets, error: "Tidak ada setelan yang bisa disimpan." };
  }
  const key = clean.toLowerCase();
  const replaced = presets.some((preset) => preset.name.toLowerCase() === key);
  const entry = { name: clean, settings: picked, ts: now };
  const rest = presets.filter((preset) => preset.name.toLowerCase() !== key);
  const next = [...rest, entry];
  // Drop the oldest entries when the list is full, never the one just saved.
  while (next.length > MAX_PRESETS) next.shift();
  return { presets: next, preset: entry, replaced };
}

export function deletePreset(list, name) {
  const key = normalizeName(name).toLowerCase();
  return sanitizePresets(list).filter((preset) => preset.name.toLowerCase() !== key);
}

// Returns a full settings object so callers can keep the existing object shape.
export function mergePreset(settings, preset) {
  const clean = sanitizePreset(preset);
  if (!clean) return { ...settings };
  return { ...settings, ...clean.settings };
}
