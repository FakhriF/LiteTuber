// Live pose relay between the control panel and the OBS browser source.
//
// OBS opens its own renderer with its own camera (or none), so it cannot see
// the panel's tracking state. The panel streams the smoothed pose over a local
// WebSocket and every `?ui=0` viewer applies it, which makes OBS mirror the
// browser exactly while the panel stays the only interactive surface.

const SEND_INTERVAL = 1000 / 33;
const STALE_MS = 700;
const MAX_RETRY_MS = 5000;

export class PoseSync {
  constructor(role, handlers = {}) {
    this.role = role === "viewer" ? "viewer" : "panel";
    this.onPose = handlers.onPose || null;
    this.onStatus = handlers.onStatus || null;
    this.onPeers = handlers.onPeers || null;
    this.ws = null;
    this.retry = 0;
    this.stopped = false;
    this.retryTimer = 0;
    this.lastSend = 0;
    this.lastPoseAt = 0;
    this.status = "off";
    this.viewers = 0;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get fresh() {
    return performance.now() - this.lastPoseAt < STALE_MS;
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  connect() {
    if (this.stopped) return;
    let url;
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      url = `${proto}//${location.host}/ws/pose?role=${this.role}`;
    } catch {
      return;
    }

    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.setStatus("connecting");

    ws.addEventListener("open", () => {
      this.retry = 0;
      this.setStatus("connected");
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "status") {
        this.viewers = Number.isFinite(msg.viewers) ? msg.viewers : 0;
        this.onPeers?.(this.viewers);
        return;
      }
      if (this.role !== "viewer" || msg.t !== "pose") return;
      const w = msg.w && typeof msg.w === "object" ? msg.w : null;
      const head = Array.isArray(msg.head) && msg.head.length === 4 ? msg.head : null;
      if (!w && !head) return;
      this.lastPoseAt = performance.now();
      this.onPose?.({ w, head });
    });

    const lost = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.viewers = 0;
      this.onPeers?.(0);
      this.setStatus("off");
      this.scheduleRetry();
    };
    ws.addEventListener("close", lost);
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    });
  }

  scheduleRetry() {
    if (this.stopped || this.retryTimer) return;
    this.retry += 1;
    const delay = Math.min(MAX_RETRY_MS, 400 * 2 ** (this.retry - 1));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = 0;
      this.connect();
    }, delay);
  }

  // Panel side: throttled, fire-and-forget. A slow socket must never block the
  // render loop, so messages are dropped instead of queued.
  send(weights, headArray) {
    if (this.role !== "panel" || !this.connected) return;
    const now = performance.now();
    if (now - this.lastSend < SEND_INTERVAL) return;
    if (this.ws.bufferedAmount > 64 * 1024) return;
    this.lastSend = now;
    let payload;
    try {
      payload = JSON.stringify({ t: "pose", w: weights, head: headArray });
    } catch {
      return;
    }
    try {
      this.ws.send(payload);
    } catch {
      /* the close handler will reconnect */
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.setStatus("off");
  }
}
