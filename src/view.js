import * as THREE from "three";
import { trackScaleFor } from "./track-scale.js";

// Owns the WebGL renderer, the drawing buffer size, camera framing, and the
// automatic quality ladder. Sizing only happens here, so a resize or a renderer
// swap is applied in exactly one place.
export function createView({ settings, quality, S, scene, camera, face }) {
  // The drawing buffer is expensive to resize, so a drag-resize that fires
  // dozens of events per second is coalesced into one rAF, and a size or ratio
  // that did not actually change never touches WebGL at all.
  const appliedSize = { width: 0, height: 0, ratio: 0 };

  function buildRenderer(target) {
    const r = new THREE.WebGLRenderer({
      canvas: target,
      alpha: true,
      antialias: S.antialiasActive,
      powerPreference: "high-performance",
    });
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = settings.exposure;
    return r;
  }

  // Antialias is a context attribute, so switching it means a new canvas. A
  // fresh canvas is built off-DOM first, so a failure leaves the running one
  // untouched.
  function rebuildRenderer() {
    const nextCanvas = document.createElement("canvas");
    nextCanvas.id = "stage";
    let next;
    try {
      next = buildRenderer(nextCanvas);
    } catch (err) {
      console.error("renderer rebuild failed", err);
      return false;
    }
    const old = S.renderer;
    S.canvas.replaceWith(nextCanvas);
    S.canvas = nextCanvas;
    S.renderer = next;
    // The new renderer starts at its default size, so force a real resize.
    appliedSize.width = 0;
    appliedSize.height = 0;
    appliedSize.ratio = 0;
    resize();
    // A resized canvas is cleared; draw once so switching quality never flashes
    // blank.
    S.renderer.render(scene, camera);
    try {
      old.dispose();
      old.forceContextLoss();
    } catch {
      /* ignore */
    }
    return true;
  }

  function applySize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const base = Math.max(0.4, Math.min(window.devicePixelRatio || 1, 1.5));
    const ratio = base * (quality.scale || 1);
    if (width !== appliedSize.width || height !== appliedSize.height) {
      S.renderer.setSize(width, height, false);
      appliedSize.width = width;
      appliedSize.height = height;
    }
    if (ratio !== appliedSize.ratio) {
      S.renderer.setPixelRatio(ratio);
      appliedSize.ratio = ratio;
      // setPixelRatio re-applies the logical size with a new buffer.
      S.renderer.setSize(width, height, false);
    }
  }

  function resize() {
    applySize();
    applyFraming();
  }

  function applyFraming() {
    const avatar = S.avatar;
    const h = avatar.height;
    const top = avatar.topY;
    const visible = 2 * Math.tan((camera.fov * Math.PI) / 360);
    let viewHeight;
    let targetY;
    if (settings.framing === "bust") {
      viewHeight = h * 0.34;
      targetY = top + h * 0.045 - viewHeight / 2;
    } else if (settings.framing === "upper") {
      viewHeight = h * 0.62;
      targetY = top + h * 0.04 - viewHeight / 2;
    } else {
      viewHeight = h * 1.1;
      targetY = (S.avatar.topY + S.avatar.bottomY) / 2;
    }
    const dist = viewHeight / visible / settings.zoom;
    camera.position.set(0, targetY + h * 0.01, dist);
    camera.lookAt(0, targetY, 0);
  }

  function syncQualityFromSettings() {
    quality.userScale = Number(settings.renderScale) || 1;
    quality.scale = quality.userScale;
    quality.effTrackHz = Number(settings.trackHz) || 30;
    quality.fpsEma = 0;
    applyTrackScale();
  }

  // MediaPipe cost follows pixel count, so a tight budget also gets a smaller
  // frame to look at. The visual output is unaffected: the VRM render keeps its
  // own resolution.
  function applyTrackScale() {
    face.trackScale = trackScaleFor({
      delegate: settings.delegate,
      trackHz: quality.effTrackHz,
    });
  }

  function applyAutoScale() {
    applySize();
  }

  function applyRenderScaleSetting() {
    const wantAA = quality.userScale >= 0.9;
    if (wantAA !== S.antialiasActive && rebuildRenderer()) {
      S.antialiasActive = wantAA;
      return;
    }
    resize();
  }

  // Keeps the frame budget honest on weak machines: drops render scale first,
  // then tracking rate, and walks both back up once there is headroom.
  function adaptQuality(now, dt) {
    if (!settings.autoQuality || dt <= 0) return;
    const inst = 1 / dt;
    quality.fpsEma = quality.fpsEma ? quality.fpsEma * 0.9 + inst * 0.1 : inst;
    if (now - quality.lastAdjust < 1500) return;
    quality.lastAdjust = now;

    const target = Number(settings.fpsCap) || 60;
    const minScale = 0.4;
    const fps = quality.fpsEma;
    let changed = false;

    if (fps < target * 0.8 && quality.scale > minScale) {
      quality.scale = Math.max(minScale, Math.round((quality.scale - 0.15) * 100) / 100);
      quality.lastDown = now;
      changed = true;
    } else if (fps < target * 0.9 && quality.effTrackHz > 15 && face.detectMs > 12) {
      quality.effTrackHz = quality.effTrackHz > 30 ? 30 : 15;
      applyTrackScale();
    } else if (
      fps > target * 0.97 &&
      quality.scale < quality.userScale &&
      now - quality.lastDown > 6000
    ) {
      quality.scale = Math.min(quality.userScale, Math.round((quality.scale + 0.05) * 100) / 100);
      changed = true;
    }

    if (changed) applyAutoScale();
  }

  function init(canvas) {
    S.canvas = canvas;
    S.renderer = buildRenderer(canvas);
    let resizeFrame = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resize();
      });
    });
    return S.renderer;
  }

  return {
    init,
    resize,
    applySize,
    applyFraming,
    applyRenderScaleSetting,
    applyAutoScale,
    syncQualityFromSettings,
    applyTrackScale,
    adaptQuality,
  };
}
