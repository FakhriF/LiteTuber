import { describe, expect, it } from "vitest";
import { vrmExpressions } from "../src/expressions.js";

const blend = (values) => new Map(Object.entries(values));

describe("vrmExpressions", () => {
  it("uses the shared blink preset for a normal blink", () => {
    const w = vrmExpressions(blend({ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.78 }), "both");
    expect(w.blink).toBeGreaterThan(0.8);
    expect(w.blinkLeft).toBe(0);
    expect(w.blinkRight).toBe(0);
  });

  it("sends only the closed eye for a wink", () => {
    const left = vrmExpressions(blend({ eyeBlinkLeft: 0.85, eyeBlinkRight: 0.02 }), "both");
    expect(left.blink).toBe(0);
    expect(left.blinkLeft).toBeGreaterThan(0.9);
    expect(left.blinkRight).toBeLessThan(0.05);

    const right = vrmExpressions(blend({ eyeBlinkLeft: 0.02, eyeBlinkRight: 0.85 }), "both");
    expect(right.blink).toBe(0);
    expect(right.blinkRight).toBeGreaterThan(0.9);
    expect(right.blinkLeft).toBeLessThan(0.05);
  });

  it("does not treat a slight asymmetry as a wink", () => {
    const w = vrmExpressions(blend({ eyeBlinkLeft: 0.7, eyeBlinkRight: 0.6 }), "both");
    expect(w.blink).toBeGreaterThan(0.6);
    expect(w.blinkLeft).toBe(0);
    expect(w.blinkRight).toBe(0);
  });

  it("hides camera mouth shapes when mic owns the mouth", () => {
    const w = vrmExpressions(blend({ jawOpen: 0.8, mouthStretchLeft: 0.7 }), "mic");
    expect(w.aa).toBe(0);
    expect(w.ih).toBe(0);
    expect(w.ee).toBe(0);
    expect(w.ou).toBe(0);
    expect(w.oh).toBe(0);
  });
});
