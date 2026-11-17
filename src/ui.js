// DOM lookup, toasts, and the messages shown when a device cannot be opened.
export const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createUi({ S }) {
  function toast(message, ms = 2400) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("on"), ms);
  }

  function mediaError(err, kind) {
    const name = err?.name || "";
    const map = {
      NotAllowedError: `${kind} permission was denied. Click the lock/camera icon in the address bar, choose Allow, then try again.`,
      PermissionDeniedError: `${kind} permission was denied.`,
      SecurityError: `Access to ${kind} needs http://127.0.0.1 or https.`,
      NotFoundError: `${kind} was not found.`,
      DevicesNotFoundError: `${kind} was not found.`,
      NotReadableError: `${kind} is being used by another app (OBS/Zoom/another browser).`,
      TrackStartError: `${kind} could not be used because another app is using it.`,
      AbortError: `${kind} could not be opened.`,
      OverconstrainedError: `${kind} does not support the requested setting.`,
      NotSupportedError: `This browser does not support ${kind} access.`,
    };
    return map[name] || `Could not access ${kind}: ${err?.message || err}`;
  }

  function dismissHint() {
    if (S.hintDismissed) return;
    S.hintDismissed = true;
    $("hint").classList.add("hidden");
  }

  let lastErrorToast = 0;
  function reportError(message) {
    if (performance.now() - lastErrorToast < 3000) return;
    lastErrorToast = performance.now();
    toast(String(message).slice(0, 180), 6000);
  }

  return { toast, mediaError, dismissHint, reportError };
}
