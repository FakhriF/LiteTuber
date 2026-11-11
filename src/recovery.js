// Camera and mic recovery rules. Kept free of DOM access so the behaviour can
// be tested without a real device.

export const RETRY_DELAYS = [2000, 5000, 10000];

// A denied permission will stay denied until the user changes it, so retrying
// would only produce noise. Everything else (unplugged device, device busy) may
// recover on its own.
export function isFatalMediaError(err) {
  const name = err?.name || "";
  return (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  );
}

export class RetryLoop {
  constructor({
    delays = RETRY_DELAYS,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (id) => clearTimeout(id),
    onExhausted = null,
  } = {}) {
    this.delays = delays;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.onExhausted = onExhausted;
    this.attempt = 0;
    this.timer = null;
    this.token = 0;
  }

  get pending() {
    return this.timer !== null;
  }

  get exhausted() {
    return this.attempt >= this.delays.length;
  }

  stop() {
    this.token += 1;
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }

  reset() {
    this.stop();
    this.attempt = 0;
  }

  // Runs `task` after the next delay. The task resolves to true when the
  // device is back, false when it failed again.
  schedule(task) {
    if (this.pending || this.exhausted) return null;
    const delay = this.delays[this.attempt];
    const token = ++this.token;
    this.attempt += 1;
    this.timer = this.setTimeoutFn(async () => {
      this.timer = null;
      if (token !== this.token) return;
      const ok = await task();
      if (ok) {
        this.reset();
        return;
      }
      if (token !== this.token) return;
      if (this.attempt >= this.delays.length) {
        this.onExhausted?.();
        return;
      }
      this.schedule(task);
    }, delay);
    return delay;
  }
}
