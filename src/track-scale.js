// Tracking input resolution.
//
// MediaPipe walks every pixel of the frame it is given, so its cost grows with
// the pixel count. At 640x480 a face is still easy to find after a 0.75 scale
// (480x360, about 44% fewer pixels), and that is the case that matters: the CPU
// delegate and a lowered tracking rate are both signs that the machine is
// already tight on frame time. GPU at a normal rate keeps the full frame.

export const TRACK_SCALE_REDUCED = 0.75;

export function trackScaleFor({ delegate, trackHz } = {}) {
  const cpu = String(delegate ?? "").toUpperCase() === "CPU";
  const hz = Number(trackHz);
  const lowRate = Number.isFinite(hz) && hz > 0 && hz <= 20;
  return cpu || lowRate ? TRACK_SCALE_REDUCED : 1;
}

// Rounded down to whole pixels, clamped to something a model can still read.
export function trackSizeFor(width, height, scale) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return null;
  const s = Number(scale);
  if (!Number.isFinite(s) || s <= 0 || s >= 1) return { width: Math.round(w), height: Math.round(h) };
  return {
    width: Math.max(2, Math.round(w * s)),
    height: Math.max(2, Math.round(h * s)),
  };
}
