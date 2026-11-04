import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_PATH = "/wasm";
const MODEL_PATH = "/models/face_landmarker.task";

const _m = new THREE.Matrix4();
const _inv = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _target = new THREE.Quaternion();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.stream = null;
    this.video = null;
    this.running = false;
    this.lastTs = -1;
    this.hasFace = false;
    this.blend = new Map();
    this.rawQuat = new THREE.Quaternion();
    this.neutral = new THREE.Quaternion();
    this.calibrated = false;
    this.expressions = {};
    this.headQuat = new THREE.Quaternion();
    this.confidence = 0;
    this.detectMs = 0;
    this.error = null;
    this.delegate = new URLSearchParams(location.search).get("delegate") === "cpu" ? "CPU" : "GPU";
  }

  async ensureLandmarker() {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: this.delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.4,
      minFacePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    };
    const timeout = (ms) =>
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

    try {
      this.landmarker = await Promise.race([
        FaceLandmarker.createFromOptions(fileset, options),
        timeout(18000),
      ]);
    } catch (err) {
      options.baseOptions.delegate = this.delegate === "GPU" ? "CPU" : "GPU";
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    }
  }

  async openCamera(deviceId, videoEl) {
    if (videoEl) this.video = videoEl;
    if (!this.video) this.video = document.getElementById("cam");
    if (this.stream) return;

    const quality = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
    const attempts = [];
    if (deviceId) attempts.push({ audio: false, video: { deviceId: { exact: deviceId }, ...quality } });
    attempts.push({ audio: false, video: quality });
    attempts.push({ audio: false, video: true });

    let lastError = null;
    for (const constraints of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        lastError = err;
        if (err?.name === "NotAllowedError" || err?.name === "SecurityError") throw err;
      }
    }
    if (!this.stream) throw lastError || new Error("Kamera tidak tersedia");

    if (this.video) {
      this.video.srcObject = this.stream;
      this.video.play().catch(() => {});
    }
    this.running = true;
    this.error = null;
    this.lastTs = -1;
  }

  async start(videoEl, deviceId) {
    await this.openCamera(deviceId, videoEl);
    await this.ensureLandmarker();
  }

  stop() {
    this.running = false;
    this.hasFace = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }

  calibrate() {
    if (!this.hasFace) return false;
    this.neutral.copy(this.rawQuat);
    this.calibrated = true;
    return true;
  }

  sample(now) {
    if (!this.running || !this.landmarker || !this.video || this.video.readyState < 2) {
      if (this.running && this.video && this.video.paused) this.video.play().catch(() => {});
      return null;
    }
    let ts = now;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;

    const t0 = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, ts);
    } catch {
      return null;
    }
    this.detectMs = performance.now() - t0;

    const shapes = result?.faceBlendshapes?.[0]?.categories;
    if (!shapes || shapes.length === 0) {
      this.hasFace = false;
      this.confidence = 0;
      return null;
    }

    this.hasFace = true;
    this.blend.clear();
    let conf = 0;
    for (const c of shapes) {
      this.blend.set(c.categoryName, c.score);
      if (c.categoryName === "jawOpen" || c.categoryName === "eyeBlinkLeft") conf = Math.max(conf, c.score);
    }
    this.confidence = conf;

    if (result.facialTransformationMatrixes?.length) {
      _m.fromArray(result.facialTransformationMatrixes[0].data);
      this.rawQuat.setFromRotationMatrix(_m);
      if (!this.calibrated) {
        this.neutral.copy(this.rawQuat);
        this.calibrated = true;
      }
    }

    return this.expressions;
  }

  computeExpressions(mouthSource) {
    const g = (name) => this.blend.get(name) || 0;
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

    const w = {
      blink: clamp01(Math.max(g("eyeBlinkLeft"), g("eyeBlinkRight")) * 1.12),
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
    this.expressions = w;
    return w;
  }

  getHeadQuaternion(sens, mirror, invert, out) {
    _inv.copy(this.neutral).invert();
    _target.copy(this.rawQuat).multiply(_inv);
    _euler.setFromQuaternion(_target, "YXZ");

    const sx = (invert?.x ? -1 : 1) * sens;
    const sy = (invert?.y ? -1 : 1) * sens;
    const sz = (invert?.z ? -1 : 1) * sens;
    const flip = mirror ? -1 : 1;

    const pitch = THREE.MathUtils.clamp(_euler.x, -1.1, 1.1) * sx;
    const yaw = THREE.MathUtils.clamp(_euler.y, -1.2, 1.2) * sy * flip;
    const roll = THREE.MathUtils.clamp(_euler.z, -0.9, 0.9) * sz * flip;

    out.setFromEuler(_euler.set(pitch, yaw, roll, "YXZ"));
    return out;
  }

  resetModel() {
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* ignore */
      }
      this.landmarker = null;
      this.hasFace = false;
      this.calibrated = false;
    }
  }
}
