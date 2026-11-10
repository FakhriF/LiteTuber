const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Typical spectral shape of each vowel across the five bands. Matching is done
// on mean-removed vectors, so a loud/quiet voice or a different mic colour does
// not change the classification.
const VOWEL_TEMPLATES = {
  aa: [0.03, 0.4, 0.45, 0.1, 0.02],
  ih: [0.2, 0.1, 0.1, 0.35, 0.25],
  ou: [0.42, 0.34, 0.14, 0.07, 0.03],
  ee: [0.06, 0.22, 0.34, 0.3, 0.08],
  oh: [0.18, 0.4, 0.32, 0.08, 0.02],
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const centered = (a) => {
  const m = mean(a);
  return a.map((v) => v - m);
};
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

const TEMPLATES = Object.fromEntries(
  Object.entries(VOWEL_TEMPLATES).map(([name, shape]) => {
    const c = centered(shape);
    return [name, { c, norm: Math.sqrt(dot(c, c)) }];
  }),
);

export function vowelWeights(s0, s1, s2, s3, s4, level) {
  const bands = [s0, s1, s2, s3, s4];
  const spread = Math.max(...bands) - Math.min(...bands);
  if (level <= 0 || spread < 0.02) {
    return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  }

  const input = centered(bands);
  const inputNorm = Math.sqrt(dot(input, input)) || 1;
  const scores = {};
  let max = -Infinity;
  for (const [name, { c, norm }] of Object.entries(TEMPLATES)) {
    const score = dot(input, c) / (inputNorm * norm || 1);
    scores[name] = score;
    if (score > max) max = score;
  }

  // Softmax keeps the winning vowel dominant while still allowing blends
  // between neighbouring shapes during a transition.
  const temp = 0.12;
  const weights = {};
  let sum = 0;
  for (const [name, score] of Object.entries(scores)) {
    const w = Math.exp((score - max) / temp);
    weights[name] = w;
    sum += w;
  }
  for (const name of Object.keys(weights)) {
    weights[name] = clamp01(level * (weights[name] / sum));
  }
  return weights;
}

export class MicMouth {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.timeData = null;
    this.freqData = null;
    this.level = 0;
    this.weights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, level: 0 };
    this.running = false;
    this.sampleRate = 48000;
    this.blocked = false;
  }

  async start(deviceId) {
    if (this.running) return;
    // Prefer a raw signal: AGC and noise suppression flatten exactly the
    // spectral differences the vowel matcher needs.
    const raw = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
    const attempts = [];
    if (deviceId) attempts.push({ audio: { ...raw, deviceId: { exact: deviceId } } });
    attempts.push({ audio: raw });
    attempts.push({ audio: true });

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
    if (!this.stream) throw lastError || new Error("Mic tidak tersedia");
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") {
      await Promise.race([
        this.ctx.resume().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
    }
    this.suspended = this.ctx.state !== "running";
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.highpass = this.ctx.createBiquadFilter();
    this.highpass.type = "highpass";
    this.highpass.frequency.value = 120;
    this.highpass.Q.value = 0.7;
    source.connect(this.highpass);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.3;
    this.highpass.connect(this.analyser);
    this.timeData = new Float32Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.sampleRate = this.ctx.sampleRate;
    this.running = true;
  }

  async resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      await this.ctx.resume().catch(() => {});
      this.suspended = this.ctx.state !== "running";
    }
  }

  stop() {
    this.running = false;
    this.level = 0;
    this.weights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, level: 0 };
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.analyser = null;
    }
  }

  read(dt, gain) {
    if (!this.running || !this.analyser) return null;

    this.analyser.getFloatTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = this.timeData[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.timeData.length);
    const db = 20 * Math.log10(rms + 1e-7);

    let target = clamp01((db + 56) / 34);
    target = Math.pow(target, 1.35) * gain;
    target = clamp01(target);

    const attack = 1 - Math.exp(-dt / 0.025);
    const release = 1 - Math.exp(-dt / 0.13);
    const k = target > this.level ? attack : release;
    this.level += (target - this.level) * k;

    this.analyser.getByteFrequencyData(this.freqData);
    const binHz = this.sampleRate / this.analyser.fftSize;
    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(this.freqData.length - 1, Math.ceil(hi / binHz));
      let s = 0;
      for (let i = a; i <= b; i++) s += this.freqData[i];
      return s / Math.max(1, b - a + 1) / 255;
    };

    const b0 = band(110, 350);
    const b1 = band(350, 800);
    const b2 = band(800, 1400);
    const b3 = band(1400, 2600);
    const b4 = band(2600, 4200);
    const total = b0 + b1 + b2 + b3 + b4 + 1e-4;
    const s0 = b0 / total;
    const s1 = b1 / total;
    const s2 = b2 / total;
    const s3 = b3 / total;
    const s4 = b4 / total;

    Object.assign(this.weights, vowelWeights(s0, s1, s2, s3, s4, this.level));
    this.weights.level = this.level;
    return this.weights;
  }
}
