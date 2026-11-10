const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Maps a MediaPipe blendshape map to VRM preset expressions. Kept free of
// Three.js and MediaPipe imports so it can be tested in Node.
export function vrmExpressions(blend, mouthSource) {
  const g = (name) => blend.get(name) || 0;
  const avg = (a, b) => (g(a) + g(b)) * 0.5;

  const jaw = g("jawOpen");
  const pucker = g("mouthPucker");
  const funnel = g("mouthFunnel");
  const smile = avg("mouthSmileLeft", "mouthSmileRight");
  const stretch = avg("mouthStretchLeft", "mouthStretchRight");
  const browDown = avg("browDownLeft", "browDownRight");
  const browUp = Math.max(g("browInnerUp"), avg("browOuterUpLeft", "browOuterUpRight"));
  const wide = avg("eyeWideLeft", "eyeWideRight");

  const openness = clamp01(jaw * 1.55);
  const round = clamp01(Math.max(pucker, funnel));
  const spread = clamp01(stretch * 1.25);
  const aa = clamp01(openness * (1 - 0.75 * round) * (1 - 0.5 * spread));
  const oh = clamp01(openness * (0.25 + 0.75 * funnel) * (1 - 0.6 * spread));
  const ou = clamp01(pucker * 1.15) * clamp01(0.25 + jaw * 1.3);
  const ih = clamp01(spread * (1 - 0.85 * openness));
  const ee = clamp01(spread * (0.3 + 0.9 * openness) + smile * 0.15);

  // MediaPipe reports each eye separately. Only use the per-eye expressions
  // when one eye is clearly more closed; a normal blink uses the shared preset
  // so models without Blink_L/Blink_R still work.
  const blinkLeft = clamp01(g("eyeBlinkLeft") * 1.12);
  const blinkRight = clamp01(g("eyeBlinkRight") * 1.12);
  const closed = Math.max(blinkLeft, blinkRight);
  const wink = closed > 0.25 && Math.abs(blinkLeft - blinkRight) > 0.2;

  return {
    blink: wink ? 0 : closed,
    blinkLeft: wink ? blinkLeft : 0,
    blinkRight: wink ? blinkRight : 0,
    aa: mouthSource === "mic" ? 0 : aa,
    ih: mouthSource === "mic" ? 0 : ih,
    ou: mouthSource === "mic" ? 0 : ou,
    ee: mouthSource === "mic" ? 0 : ee,
    oh: mouthSource === "mic" ? 0 : oh,
    happy: clamp01(smile * 0.9),
    angry: clamp01(browDown * 0.85),
    sad: clamp01(browUp * 0.55 + avg("mouthFrownLeft", "mouthFrownRight") * 0.45),
    surprised: clamp01(browUp * 0.65 + wide * 0.55),
    relaxed: 0,
    lookUp: clamp01(Math.max(g("eyeLookUpLeft"), g("eyeLookUpRight")) * 0.8),
    lookDown: clamp01(Math.max(g("eyeLookDownLeft"), g("eyeLookDownRight")) * 0.8),
    lookLeft: clamp01(Math.max(g("eyeLookOutLeft"), g("eyeLookInRight")) * 0.8),
    lookRight: clamp01(Math.max(g("eyeLookInLeft"), g("eyeLookOutRight")) * 0.8),
  };
}
