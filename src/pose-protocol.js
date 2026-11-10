// Shared validation for the local pose relay. Both sides are on the same
// machine, but a malformed message must never be broadcast to OBS viewers.
export const POSE_KEYS = [
  "blink",
  "blinkLeft",
  "blinkRight",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
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

const finite01 = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export function normalizePoseMessage(raw) {
  if (!raw || typeof raw !== "object" || raw.t !== "pose") return null;
  if (!raw.w || typeof raw.w !== "object") return null;

  const w = {};
  for (const key of POSE_KEYS) {
    const value = raw.w[key];
    if (value === undefined) continue;
    if (!finite01(value)) return null;
    w[key] = Math.round(value * 1000) / 1000;
  }

  let head = null;
  if (raw.head !== undefined) {
    if (!Array.isArray(raw.head) || raw.head.length !== 4) return null;
    if (!raw.head.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    head = raw.head.map((n) => Math.round(n * 10000) / 10000);
  }

  if (!Object.keys(w).length && !head) return null;
  return { t: "pose", w, head };
}
