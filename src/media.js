import { RetryLoop, isFatalMediaError } from "./recovery.js";

// Camera and mic sessions: starting, stopping, recovering after a disconnect,
// and following the device list. The face tracker and mic analyser themselves
// live in face.js and audio.js.
export function createMedia({ $, settings, S, api, face, mic, toast, mediaError }) {
  const camRetry = new RetryLoop({
    onExhausted: () =>
      toast("Camera could not be recovered. Click Start camera to try again.", 8000),
  });
  const micRetry = new RetryLoop({
    onExhausted: () =>
      toast("Mic could not be recovered. Click Start mic to try again.", 8000),
  });
  let deviceChangeTimer = 0;

  function updateCamPreview() {
    const show = face.running && !settings.panelHidden;
    $("cam").classList.toggle("preview", show);
  }

  function cameraUiOff() {
    $("camBtn").textContent = "Start camera";
    $("camBtn").classList.remove("on");
    $("calBtn").disabled = true;
    updateCamPreview();
  }

  async function startCamera(deviceId, { auto = false } = {}) {
    if (face.running) return true;
    const slowHint = setTimeout(
      () =>
        toast(
          "Waiting for camera permission… check the permission popup or the camera icon in the address bar",
          6000,
        ),
      3500,
    );
    try {
      $("camBtn").textContent = "Preparing…";
      await face.openCamera(deviceId || settings.camDevice || null, $("cam"));
      clearTimeout(slowHint);
      S.camStartedAt = performance.now();
      $("camBtn").textContent = "Stop camera";
      $("camBtn").classList.add("on");
      $("calBtn").disabled = false;
      updateCamPreview();
      refreshDevices();
      api.dismissHint();
      toast("Camera on, loading the face model…", 3000);
      await face.ensureLandmarker();
      camRetry.reset();
      toast("Face tracking ready — click Calibrate at your neutral position");
      return true;
    } catch (err) {
      clearTimeout(slowHint);
      console.error(err);
      face.stop();
      cameraUiOff();
      const fatal = isFatalMediaError(err);
      if (fatal) camRetry.stop();
      // During automatic recovery the retry loop owns the schedule and the
      // final message; a manual start reports the error directly.
      if (fatal || !auto) toast(mediaError(err, "camera"), 7000);
      else toast("Camera not available yet. Retrying…", 3000);
      return false;
    }
  }

  function beginCameraRecovery() {
    if (camRetry.pending) return;
    const delay = camRetry.schedule(() => startCamera(settings.camDevice || null, { auto: true }));
    if (delay === null) {
      toast("Camera could not be recovered. Click Start camera to try again.", 8000);
    }
  }

  function onCameraLost() {
    cameraUiOff();
    S.camStartedAt = 0;
    toast("Camera disconnected. Trying to reconnect…", 5000);
    beginCameraRecovery();
  }

  function stopCamera({ silent = false } = {}) {
    camRetry.reset();
    face.stop();
    face.calibrated = false;
    cameraUiOff();
    if (!silent) toast("Camera stopped");
  }

  function toggleCamera() {
    if (face.running) stopCamera();
    else startCamera();
  }

  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      fillDevices($("camDevice"), devices.filter((d) => d.kind === "videoinput"), "Default camera", "Camera");
      fillDevices($("micDevice"), devices.filter((d) => d.kind === "audioinput"), "Default mic", "Mic");
    } catch {
      /* devices are optional */
    }
  }

  function fillDevices(select, devices, fallbackLabel, prefix) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = fallbackLabel;
    select.append(def);
    devices.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `${prefix} ${i + 1}`;
      select.append(opt);
    });
    select.hidden = devices.length < 2;
    const wanted = select === $("camDevice") ? settings.camDevice : settings.micDevice;
    select.value = current || wanted || "";
  }

  function micUiOff() {
    $("micBtn").textContent = "Start mic";
    $("micBtn").classList.remove("on");
  }

  async function startMic(deviceId, { auto = false } = {}) {
    if (mic.running) return true;
    try {
      await mic.start(deviceId || settings.micDevice || null);
      refreshDevices();
      S.micRunning = true;
      $("micBtn").textContent = "Stop mic";
      $("micBtn").classList.add("on");
      micRetry.reset();
      if (mic.suspended) {
        toast("Mic on — click once on the page so audio can start");
      } else {
        toast("Mic on for mouth movement");
      }
      return true;
    } catch (err) {
      console.error(err);
      S.micRunning = false;
      mic.stop();
      micUiOff();
      const fatal = isFatalMediaError(err);
      if (fatal) micRetry.stop();
      if (fatal || !auto) toast(mediaError(err, "mic"), 7000);
      else toast("Mic not available yet. Retrying…", 3000);
      return false;
    }
  }

  function beginMicRecovery() {
    if (micRetry.pending) return;
    const delay = micRetry.schedule(() => startMic(settings.micDevice || null, { auto: true }));
    if (delay === null) {
      toast("Mic could not be recovered. Click Start mic to try again.", 8000);
    }
  }

  function onMicLost() {
    S.micRunning = false;
    micUiOff();
    toast("Mic disconnected. Trying to reconnect…", 5000);
    beginMicRecovery();
  }

  async function toggleMic() {
    if (mic.running) {
      micRetry.reset();
      mic.stop();
      S.micRunning = false;
      micUiOff();
      return;
    }
    await startMic(settings.micDevice || null);
  }

  function calibrate() {
    if (face.calibrate()) {
      S.smoothHead.identity();
      toast("Neutral position saved");
    } else {
      toast("Face not detected yet");
    }
  }

  async function deviceListed(deviceId, kind) {
    if (!deviceId) return true;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some((d) => d.kind === kind && d.deviceId === deviceId);
    } catch {
      // Without a device list there is nothing better to fall back to.
      return true;
    }
  }

  // Unplugging a device fires `devicechange`. The refresh also covers devices
  // that appear later, and moves an active stream to the default device.
  function onDeviceChange() {
    clearTimeout(deviceChangeTimer);
    deviceChangeTimer = setTimeout(async () => {
      await refreshDevices();
      const camWanted = settings.camDevice;
      if ((face.running || camRetry.pending) && !(await deviceListed(camWanted, "videoinput"))) {
        settings.camDevice = "";
        api.commit();
        toast("The selected camera disappeared. Switching to the default camera.", 5000);
        if (face.running) {
          stopCamera({ silent: true });
          await startCamera(null, { auto: true });
        }
      }
      const micWanted = settings.micDevice;
      if ((mic.running || micRetry.pending) && !(await deviceListed(micWanted, "audioinput"))) {
        settings.micDevice = "";
        api.commit();
        toast("The selected mic disappeared. Switching to the default mic.", 5000);
        if (mic.running) {
          micRetry.reset();
          mic.stop();
          S.micRunning = false;
          micUiOff();
          await startMic(null, { auto: true });
        }
      }
    }, 400);
  }

  return {
    camRetry,
    micRetry,
    updateCamPreview,
    startCamera,
    stopCamera,
    toggleCamera,
    onCameraLost,
    beginCameraRecovery,
    refreshDevices,
    startMic,
    toggleMic,
    onMicLost,
    beginMicRecovery,
    calibrate,
    onDeviceChange,
    micUiOff,
  };
}
