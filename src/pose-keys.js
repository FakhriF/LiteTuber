// Keys shared by the render loop and anything that needs the pose vocabulary.
export const KEYS = [
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
export const MOUTH_KEYS = ["aa", "ih", "ou", "ee", "oh"];
export const EYE_KEYS = ["lookUp", "lookDown", "lookLeft", "lookRight"];
export const EXPR_KEYS = ["happy", "angry", "sad", "surprised", "relaxed"];
export const EYE_SET = new Set(EYE_KEYS);
export const EXPR_SET = new Set(EXPR_KEYS);
export const BLINK_SET = new Set(["blink", "blinkLeft", "blinkRight"]);

export function blankWeights() {
  const weights = {};
  for (const key of KEYS) weights[key] = 0;
  return weights;
}
