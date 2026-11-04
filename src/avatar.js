import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _qOff = new THREE.Quaternion();
const _identity = new THREE.Quaternion();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _v = new THREE.Vector3();

const IDLE_BONES = [
  "hips",
  "spine",
  "chest",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
];

export const PRESET_EXPRESSIONS = [
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "blink",
  "blinkLeft",
  "blinkRight",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
];

export function applyWorldDelta(bone, restLocal, delta) {
  if (!bone || !bone.parent) return;
  bone.parent.updateWorldMatrix(true, false);
  const parentWorld = bone.parent.getWorldQuaternion(_q1);
  const restWorld = _q2.copy(parentWorld).multiply(restLocal);
  const target = _q3.copy(delta).multiply(restWorld);
  const inv = _q4.copy(parentWorld).invert();
  bone.quaternion.copy(inv).multiply(target);
}

function bakeArmRelax(bones, rest) {
  const up = new THREE.Vector3();
  const lo = new THREE.Vector3();
  const zw = new THREE.Vector3(0, 0, 1);
  for (const side of ["left", "right"]) {
    const upper = bones[`${side}UpperArm`];
    const lower = bones[`${side}LowerArm`];
    if (!upper || !lower) continue;
    upper.updateWorldMatrix(true, false);
    upper.getWorldPosition(up);
    lower.getWorldPosition(lo);
    const dir = lo.clone().sub(up).normalize();
    if (dir.y < -0.55) continue;
    const sign = dir.x >= 0 ? -1 : 1;
    const q = new THREE.Quaternion().setFromAxisAngle(zw, sign * 1.18);
    const parentWorld = upper.parent.getWorldQuaternion(new THREE.Quaternion());
    const inv = parentWorld.clone().invert();
    rest[`${side}UpperArm`].copy(inv.multiply(q).multiply(parentWorld).multiply(rest[`${side}UpperArm`]));
  }
}

export class VrmAvatar {
  constructor(scene) {
    this.scene = scene;
    this.kind = "vrm";
    this.root = new THREE.Group();
    scene.add(this.root);
    this.vrm = null;
    this.name = "";
    this.bones = {};
    this.rest = {};
    this.available = {};
    this.headY = 1.5;
    this.height = 1.6;
    this.topY = 1.6;
    this.bottomY = 0;
    this.centerY = 0.8;
    this.headRestLocal = new THREE.Quaternion();
    this.neckRestLocal = new THREE.Quaternion();
    this.hasModel = false;
  }

  async load(buffer, name) {
    this.dispose();
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });

    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("File ini bukan VRM yang valid.");

    try {
      if (typeof VRMUtils.removeUnnecessaryVertices === "function") {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
      }
    } catch {
      /* optional optimization */
    }
    try {
      if (typeof VRMUtils.combineSkeletons === "function") VRMUtils.combineSkeletons(gltf.scene);
    } catch {
      /* optional optimization */
    }
    VRMUtils.rotateVRM0(vrm);

    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    this.vrm = vrm;
    this.name = name || "avatar";
    this.root.add(vrm.scene);
    this.root.updateMatrixWorld(true);

    const humanoid = vrm.humanoid;
    const names = [
      ...IDLE_BONES,
      "head",
      "neck",
      "leftHand",
      "rightHand",
      "leftFoot",
      "rightFoot",
    ];
    for (const key of names) {
      const node = humanoid.getNormalizedBoneNode(key);
      if (!node) continue;
      this.bones[key] = node;
      this.rest[key] = node.quaternion.clone();
    }

    if (this.bones.head) this.headRestLocal.copy(this.bones.head.quaternion);
    if (this.bones.neck) this.neckRestLocal.copy(this.bones.neck.quaternion);

    _box.setFromObject(vrm.scene);
    _box.getSize(_size);
    _box.getCenter(_center);
    this.height = Math.max(0.5, _size.y);
    this.topY = _box.max.y;
    this.bottomY = _box.min.y;
    this.centerY = _center.y;
    this.root.position.x -= _center.x;
    this.root.position.z -= _center.z;
    this.root.updateMatrixWorld(true);

    this.headY = this.height;
    if (this.bones.head) {
      this.bones.head.getWorldPosition(_v);
      this.headY = _v.y;
    }

    if (this.rest.leftUpperArm || this.rest.rightUpperArm) {
      try {
        bakeArmRelax(this.bones, this.rest);
      } catch {
        /* keep original pose */
      }
    }

    const manager = vrm.expressionManager;
    this.available = {};
    if (manager) {
      for (const key of PRESET_EXPRESSIONS) {
        if (manager.getExpression(key)) this.available[key] = true;
      }
    }
    this.hasModel = true;
    return this;
  }

  setExpressions(weights) {
    const manager = this.vrm?.expressionManager;
    if (!manager) return;
    for (const key in this.available) {
      const value = weights[key] || 0;
      manager.setValue(key, Math.max(0, Math.min(1, value)));
    }
  }

  resetExpressions() {
    this.setExpressions({});
  }

  pose(t, headDelta, idleOn = true) {
    const b = this.bones;
    const breathe = idleOn ? Math.sin(t * 1.7) : 0;
    const sway = idleOn ? Math.sin(t * 0.41) : 0;
    const sway2 = idleOn ? Math.sin(t * 0.29 + 1.3) : 0;

    if (b.chest) {
      _qOff.setFromEuler(_e.set(breathe * 0.012, sway * 0.03, sway2 * 0.008, "YXZ"));
      b.chest.quaternion.copy(this.rest.chest).multiply(_qOff);
    }
    if (b.spine) {
      _qOff.setFromEuler(_e.set(breathe * -0.006, sway * 0.018, 0, "YXZ"));
      b.spine.quaternion.copy(this.rest.spine).multiply(_qOff);
    }
    if (b.hips) {
      _qOff.setFromEuler(_e.set(0, sway * 0.012, sway2 * 0.01, "YXZ"));
      b.hips.quaternion.copy(this.rest.hips).multiply(_qOff);
    }

    const armSwing = idleOn ? Math.sin(t * 0.9) * 0.03 : 0;
    for (const side of ["left", "right"]) {
      const s = side === "left" ? 1 : -1;
      if (b[`${side}Shoulder`]) {
        _qOff.setFromEuler(_e.set(0, 0, s * breathe * 0.012, "YXZ"));
        b[`${side}Shoulder`].quaternion.copy(this.rest[`${side}Shoulder`]).multiply(_qOff);
      }
      if (b[`${side}UpperArm`]) {
        _qOff.setFromEuler(_e.set(armSwing * s, 0, s * (0.02 + breathe * 0.008), "YXZ"));
        b[`${side}UpperArm`].quaternion.copy(this.rest[`${side}UpperArm`]).multiply(_qOff);
      }
      if (b[`${side}LowerArm`]) {
        _qOff.setFromEuler(_e.set(0, 0, s * 0.01, "YXZ"));
        b[`${side}LowerArm`].quaternion.copy(this.rest[`${side}LowerArm`]).multiply(_qOff);
      }
    }

    if (headDelta) {
      if (b.neck) {
        _qOff.copy(headDelta).slerp(_identity, 0.7);
        applyWorldDelta(b.neck, this.neckRestLocal, _qOff);
      }
      if (b.head) {
        _qOff.copy(headDelta).slerp(_identity, 0.3);
        applyWorldDelta(b.head, this.headRestLocal, _qOff);
      }
    } else {
      if (b.neck) b.neck.quaternion.copy(this.neckRestLocal);
      if (b.head) {
        _qOff.setFromEuler(_e.set(breathe * 0.004, sway * 0.05, 0, "YXZ"));
        b.head.quaternion.copy(this.headRestLocal).multiply(_qOff);
      }
    }
  }

  update(dt, spring = true) {
    const vrm = this.vrm;
    if (!vrm) return;
    if (vrm.humanoid) vrm.humanoid.update();
    if (vrm.lookAt) vrm.lookAt.update(dt);
    if (vrm.expressionManager) vrm.expressionManager.update();
    if (vrm.nodeConstraintManager) vrm.nodeConstraintManager.update();
    if (spring && vrm.springBoneManager) vrm.springBoneManager.update(dt);
    if (vrm.materials) {
      for (const material of vrm.materials) {
        if (material.update) material.update(dt);
      }
    }
  }

  dispose() {
    if (this.vrm) {
      this.root.remove(this.vrm.scene);
      try {
        VRMUtils.deepDispose(this.vrm.scene);
      } catch {
        /* ignore */
      }
      this.vrm = null;
    }
    this.bones = {};
    this.rest = {};
    this.available = {};
    this.hasModel = false;
  }
}
