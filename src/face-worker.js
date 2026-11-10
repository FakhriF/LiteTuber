// Classic worker: MediaPipe's WASM glue loads itself with importScripts, which
// only exists in classic workers. Vite emits this entry as IIFE for that reason
// (see `worker.format` in vite.config.js).
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let landmarker = null;
let lastTs = -1;

self.onmessage = async (ev) => {
  const msg = ev.data;

  if (msg.type === "init") {
    try {
      const fileset = await FilesetResolver.forVisionTasks(msg.wasmPath);
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: msg.modelPath, delegate: msg.delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
      self.postMessage({ type: "ready", delegate: msg.delegate });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err?.message || err) });
    }
    return;
  }

  if (msg.type === "frame") {
    if (!landmarker) {
      msg.bitmap.close?.();
      self.postMessage({ type: "skip" });
      return;
    }
    let ts = msg.ts;
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;

    const t0 = performance.now();
    let result = null;
    try {
      result = landmarker.detectForVideo(msg.bitmap, ts);
    } catch {
      /* a dropped frame is cheaper than a crash */
    }
    msg.bitmap.close?.();

    const shapes = result?.faceBlendshapes?.[0]?.categories;
    const matrix = result?.facialTransformationMatrixes?.[0]?.data;
    self.postMessage({
      type: "result",
      id: msg.id,
      ms: performance.now() - t0,
      shapes: shapes ? shapes.map((c) => [c.categoryName, c.score]) : null,
      matrix: matrix ? Array.from(matrix) : null,
    });
  }
};
