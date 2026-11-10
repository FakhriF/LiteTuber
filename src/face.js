import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import FaceWorker from "./face-worker.js?worker";
import { vrmExpressions } from "./expressions.js";

const WASM_PATH = "/wasm";
const MODEL_PATH = "/models/face_landmarker.task";

const _m = new THREE.Matrix4();
const _inv = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _target = new THREE.Quaternion();
export { vrmExpressions };

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
    const params = new URLSearchParams(location.search);
    this.delegate = params.get("delegate") === "cpu" ? "CPU" : "GPU";
    // "main" until a worker proves it can start; "worker" afterwards.
    this.mode = "main";
    this.worker = null;
    this.workerReady = false;
    this.workerDisabled = params.get("worker") === "0";
    this.busy = false;
    this.busyAt = 0;
    this.frameId = 0;
  }

  async ensureLandmarker() {
    if (this.workerReady || this.landmarker) return;
    if (!this.workerDisabled && (await this.startWorker())) return;
    await this.startMainThread();
  }

  startWorker() {
    if (typeof Worker === "undefined" || typeof createImageBitmap !== "function") {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let settled = false;
      let worker;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        try {
          worker?.terminate();
        } catch {
          /* ignore */
        }
        finish(false);
      }, 12000);

      try {
        worker = new FaceWorker();
      } catch {
        finish(false);
        return;
      }

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "ready") {
          this.worker = worker;
          this.workerReady = true;
          this.mode = "worker";
          worker.onmessage = (ev) => this.onWorkerMessage(ev);
          finish(true);
        } else if (msg.type === "error") {
          try {
            worker.terminate();
          } catch {
            /* ignore */
          }
          finish(false);
        }
      };
      worker.onerror = () => {
        try {
          worker.terminate();
        } catch {
          /* ignore */
        }
        finish(false);
      };
      worker.postMessage({
        type: "init",
        wasmPath: WASM_PATH,
        modelPath: MODEL_PATH,
        delegate: this.delegate,
      });
    });
  }

  async startMainThread() {
    this.mode = "main";
    this.workerReady = false;
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

  onWorkerMessage(e) {
    const msg = e.data;
    if (msg.type !== "result") return;
    this.busy = false;
    if (typeof msg.ms === "number") this.detectMs = msg.ms;

    if (!msg.shapes || msg.shapes.length === 0) {
      this.hasFace = false;
      this.confidence = 0;
      return;
    }

    this.hasFace = true;
    this.blend.clear();
    let conf = 0;
    for (const [name, score] of msg.shapes) {
      this.blend.set(name, score);
      if (name === "jawOpen" || name === "eyeBlinkLeft") conf = Math.max(conf, score);
    }
    this.confidence = conf;

    if (msg.matrix) {
      _m.fromArray(msg.matrix);
      this.rawQuat.setFromRotationMatrix(_m);
      if (!this.calibrated) {
        this.neutral.copy(this.rawQuat);
        this.calibrated = true;
      }
    }
  }

  queueFrame(now) {
    if (this.busy) {
      // Never wedge the pipeline if a result goes missing.
      if (now - this.busyAt < 1500) return;
      this.busy = false;
    }
    this.busy = true;
    this.busyAt = now;
    createImageBitmap(this.video)
      .then((bitmap) => {
        if (!this.workerReady || !this.worker) {
          bitmap.close();
          this.busy = false;
          return;
        }
        this.worker.postMessage(
          { type: "frame", id: ++this.frameId, ts: now, bitmap },
          [bitmap],
        );
      })
      .catch(() => {
        this.busy = false;
      });
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
    this.busy = false;
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
    if (!this.running || !this.video || this.video.readyState < 2) {
      if (this.running && this.video && this.video.paused) this.video.play().catch(() => {});
      return null;
    }

    if (this.mode === "worker" && this.workerReady) {
      this.queueFrame(now);
      return this.expressions;
    }

    if (!this.landmarker) return null;

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
    this.expressions = vrmExpressions(this.blend, mouthSource);
    return this.expressions;
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
    this.busy = false;
    this.frameId = 0;
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
      this.workerReady = false;
      this.mode = "main";
    }
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
