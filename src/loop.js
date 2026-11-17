import { Quaternion } from "three";
import { KEYS, MOUTH_KEYS, EYE_SET, EXPR_SET, BLINK_SET } from "./pose-keys.js";

// The render loop: sampling tracking, smoothing, applying the pose to the
// avatar, drawing, and the once-per-frame status text.
export function createLoop({ $, settings, quality, S, api, face, mic, poseSync, viewer, scene, camera }) {
  const identity = new Quaternion();

  let blinkTimer = 2 + Math.random() * 2.5;
  let blinkT = -1;

  // The mic meter is cosmetic; repainting it every frame forces a style recalc
  // for no visible gain.
  let meterAt = 0;
  let meterPct = -1;
  let meterRunning = false;

  function uiMeter(now) {
    if (now - meterAt < 100) return;
    meterAt = now;
    const pct = Math.round(S.micLevel * 100);
    if (pct === meterPct && mic.running === meterRunning) return;
    meterPct = pct;
    meterRunning = mic.running;
    $("micMeter").style.setProperty("--level", `${pct}%`);
    $("micDb").textContent = mic.running ? String(pct) : "–";
  }

  function updateAutoBlink(dt) {
    if (blinkT >= 0) {
      blinkT += dt / 0.15;
      if (blinkT >= 1) {
        blinkT = -1;
        blinkTimer = 1.8 + Math.random() * 3.4;
      }
      return Math.sin(Math.min(1, blinkT) * Math.PI);
    }
    blinkTimer -= dt;
    if (blinkTimer <= 0) blinkT = 0;
    return 0;
  }

  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;
  let lastRender = 0;
  let lastStatus = 0;
  let lastTrack = 0;

  function frame(now) {
    requestAnimationFrame(frame);

    const interval = 1000 / Number(settings.fpsCap || 60);
    if (now - lastRender < interval - 1.2) return;
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
    last = now;
    lastRender = now;

    let faceActive = false;
    let faceSeen = false;
    const camMouth = settings.mouthSrc !== "mic" || !S.micRunning;
    const micMouth = settings.mouthSrc !== "cam" && S.micRunning;

    for (const key of KEYS) S.tmpTarget[key] = 0;

    if (face.running) {
      const trackMs = 1000 / Math.max(5, quality.effTrackHz || 30);
      if (now - lastTrack >= trackMs) {
        lastTrack = now;
        face.sample(now);
      }
      if (face.hasFace) {
        faceSeen = true;
        const exp = face.computeExpressions(camMouth ? "both" : "mic");
        if (settings.mirror) {
          const swap = exp.lookLeft;
          exp.lookLeft = exp.lookRight;
          exp.lookRight = swap;
        }
        for (const key of KEYS) {
          if (!settings.useEyes && EYE_SET.has(key)) continue;
          if (!settings.useExpr && EXPR_SET.has(key)) continue;
          if (!settings.useBlink && BLINK_SET.has(key)) continue;
          S.tmpTarget[key] = exp[key] || 0;
        }
        if (settings.useHead) {
          face.getHeadQuaternion(
            settings.sens,
            settings.mirror,
            { x: settings.invertX, y: settings.invertY, z: settings.invertZ },
            S.targetHead,
          );
          faceActive = true;
        }
      }
    }

    S.micLevel = 0;
    if (mic.running) {
      const m = mic.read(dt, settings.micGain);
      if (m) {
        S.micLevel = m.level;
        if (micMouth) {
          // In "both" mode mic wins while someone is speaking: camera mouth
          // shapes are too generic and would hide the vowel distinction.
          const micDominant = camMouth && m.level > 0.04;
          for (const key of MOUTH_KEYS) {
            const value = m[key] || 0;
            S.tmpTarget[key] = micDominant ? value : Math.max(S.tmpTarget[key], value);
          }
        }
      }
    }

    if (now < S.mouthTestUntil) {
      const wave = 0.5 + 0.5 * Math.sin(now / 85);
      S.tmpTarget.aa = Math.max(S.tmpTarget.aa, 0.25 + 0.75 * wave);
      S.tmpTarget.ou = Math.max(S.tmpTarget.ou, 0.4 * (1 - wave));
      S.tmpTarget.happy = Math.max(S.tmpTarget.happy, 0.55);
    }

    uiMeter(now);

    // A viewer mirrors the panel's already-smoothed values. Applying smoothing
    // again would add visible lag and soften the panel's expressions.
    const remote = viewer && S.remotePose && poseSync.fresh;

    if (!faceSeen && settings.autoBlink && !remote) {
      S.tmpTarget.blink = Math.max(S.tmpTarget.blink, updateAutoBlink(dt));
    }

    if (remote) {
      for (const key of KEYS) {
        const value = Number(S.remotePose.w?.[key]);
        S.smoothW[key] = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
      }
      const head = S.remotePose.head;
      if (Array.isArray(head) && head.every((n) => Number.isFinite(n))) {
        S.smoothHead.fromArray(head);
      }
    } else {
      const attack = 1 - Math.exp(-dt / 0.045);
      const release = 1 - Math.exp(-dt / 0.11);
      for (const key of KEYS) {
        const target = S.tmpTarget[key] || 0;
        const k = target > S.smoothW[key] ? attack : release;
        S.smoothW[key] += (target - S.smoothW[key]) * k;
      }

      const tau = 0.015 + settings.smooth * 0.24;
      const headK = 1 - Math.exp(-dt / tau);
      if (faceActive) S.smoothHead.slerp(S.targetHead, headK);
      else S.smoothHead.slerp(identity, headK * 0.35);
    }

    if (!viewer) poseSync.send(S.smoothW, S.smoothHead.toArray(S.headOut, 0));

    S.avatar.pose(
      now / 1000,
      faceActive || S.smoothHead.angleTo(identity) > 0.001 ? S.smoothHead : null,
      settings.useIdle,
    );
    S.avatar.setExpressions(S.smoothW);
    S.avatar.update(dt, settings.useSpring);

    S.renderer.render(scene, camera);
    api.adaptQuality(now, dt);

    fpsFrames += 1;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      const shown = Math.round(fpsFrames / fpsTime);
      const pct = Math.round(quality.scale * 100);
      $("fps").textContent =
        settings.autoQuality && pct !== Math.round(quality.userScale * 100)
          ? `${shown} fps · ${pct}%`
          : `${shown} fps`;
      fpsFrames = 0;
      fpsTime = 0;
    }

    if (settings.panelHidden && now - S.lastPoll > 2500) {
      S.lastPoll = now;
      api.pollServer();
    }

    if (now - lastStatus > 400) {
      lastStatus = now;
      const camEl = $("statusCam");
      if (!face.running) {
        camEl.textContent = "cam: off";
        camEl.className = "";
      } else {
        const w = face.video?.videoWidth || 0;
        const h = face.video?.videoHeight || 0;
        if (w > 0) {
          camEl.textContent = `cam: ${w}×${h}`;
          camEl.className = "good";
        } else if (now - S.camStartedAt > 3000) {
          camEl.textContent = "cam: no picture";
          camEl.className = "bad";
        } else {
          camEl.textContent = "cam: waiting…";
          camEl.className = "";
        }
      }

      const faceEl = $("statusFace");
      if (!face.running) {
        faceEl.textContent = "face: –";
        faceEl.className = "";
      } else if (face.hasFace) {
        faceEl.textContent = "face: detected";
        faceEl.className = "good";
      } else {
        faceEl.textContent = "face: not visible";
        faceEl.className = now - S.camStartedAt > 4000 ? "bad" : "";
      }

      const micEl = $("statusMic");
      if (!mic.running) {
        micEl.textContent = "mic: off";
        micEl.className = "";
      } else if (mic.suspended) {
        micEl.textContent = "mic: suspended";
        micEl.className = "bad";
      } else {
        micEl.textContent = `mic: ${Math.round(S.micLevel * 100)}%`;
        micEl.className = S.micLevel > 0.02 ? "good" : "";
      }
    }
  }

  function start() {
    requestAnimationFrame(frame);
  }

  return { start, frame };
}

