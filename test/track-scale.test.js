import { describe, expect, it } from "vitest";
import { TRACK_SCALE_REDUCED, trackScaleFor, trackSizeFor } from "../src/track-scale.js";

describe("trackScaleFor", () => {
  it("keeps the full frame on GPU at a normal tracking rate", () => {
    expect(trackScaleFor({ delegate: "GPU", trackHz: 30 })).toBe(1);
    expect(trackScaleFor({ delegate: "GPU", trackHz: 60 })).toBe(1);
  });

  it("shrinks the frame on the CPU delegate", () => {
    expect(trackScaleFor({ delegate: "CPU", trackHz: 30 })).toBe(TRACK_SCALE_REDUCED);
    expect(trackScaleFor({ delegate: "cpu", trackHz: 60 })).toBe(TRACK_SCALE_REDUCED);
  });

  it("shrinks the frame at 20 Hz or less", () => {
    expect(trackScaleFor({ delegate: "GPU", trackHz: 20 })).toBe(TRACK_SCALE_REDUCED);
    expect(trackScaleFor({ delegate: "GPU", trackHz: 15 })).toBe(TRACK_SCALE_REDUCED);
  });

  it("ignores junk values instead of shrinking the frame", () => {
    expect(trackScaleFor({})).toBe(1);
    expect(trackScaleFor()).toBe(1);
    expect(trackScaleFor({ delegate: "GPU", trackHz: "nope" })).toBe(1);
    expect(trackScaleFor({ delegate: "GPU", trackHz: 0 })).toBe(1);
  });
});

describe("trackSizeFor", () => {
  it("turns a 0.75 scale on 640x480 into 480x360", () => {
    expect(trackSizeFor(640, 480, TRACK_SCALE_REDUCED)).toEqual({ width: 480, height: 360 });
  });

  it("passes the frame through at full scale", () => {
    expect(trackSizeFor(1280, 720, 1)).toEqual({ width: 1280, height: 720 });
    expect(trackSizeFor(1280, 720, 2)).toEqual({ width: 1280, height: 720 });
  });

  it("returns null before the video has a size", () => {
    expect(trackSizeFor(0, 0, 1)).toBeNull();
    expect(trackSizeFor(Number.NaN, 480, 1)).toBeNull();
    expect(trackSizeFor(640, undefined, 1)).toBeNull();
  });

  it("never returns a zero-pixel canvas", () => {
    const size = trackSizeFor(640, 480, 0.001);
    expect(size.width).toBeGreaterThanOrEqual(2);
    expect(size.height).toBeGreaterThanOrEqual(2);
  });
});
