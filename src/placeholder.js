import * as THREE from "three";
import { applyWorldDelta } from "./avatar.js";

const SKIN = 0xf2d2c0;
const HAIR = 0x3c3550;
const CLOTH = 0x5a6ee0;

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02, ...extra });
}

export class PlaceholderAvatar {
  constructor(scene) {
    this.kind = "placeholder";
    this.name = "placeholder";
    this.hasModel = true;
    this.height = 1.62;
    this.headY = 1.46;
    this.topY = 1.63;
    this.bottomY = 0;
    this.centerY = 0.8;

    this.root = new THREE.Group();
    scene.add(this.root);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.145, 0.42, 8, 20), mat(CLOTH));
    body.position.y = 1.08;
    body.scale.z = 0.72;
    this.root.add(body);

    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.185, 20, 16), mat(CLOTH));
    shoulders.position.y = 1.29;
    shoulders.scale.set(1, 0.62, 0.72);
    this.root.add(shoulders);

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.34, 6, 14), mat(CLOTH));
      arm.position.set(side * 0.2, 1.08, 0);
      arm.rotation.z = side * 0.12;
      this.root.add(arm);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), mat(SKIN));
      hand.position.set(side * 0.225, 0.87, 0);
      this.root.add(hand);
    }

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.1, 14), mat(SKIN));
    neck.position.y = 1.36;
    this.root.add(neck);

    this.head = new THREE.Group();
    this.head.position.y = 1.4;
    this.root.add(this.head);
    this.headRestLocal = new THREE.Quaternion();

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 22), mat(SKIN));
    skull.position.y = 0.07;
    skull.scale.set(1, 1.08, 0.98);
    this.head.add(skull);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.142, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.4),
      mat(HAIR, { roughness: 0.55 }),
    );
    hair.position.set(0, 0.075, -0.004);
    hair.scale.set(1, 1.14, 1.02);
    this.head.add(hair);

    const bang = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), mat(HAIR));
    bang.position.set(0.01, 0.156, 0.104);
    bang.rotation.z = -0.14;
    this.head.add(bang);

    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 12), mat(0x23252e, { roughness: 0.25 }));
      eye.position.set(side * 0.052, 0.075, 0.122);
      eye.scale.set(1, 1.35, 0.6);
      this.head.add(eye);
      this.eyes.push(eye);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.012), mat(HAIR));
      brow.position.set(side * 0.054, 0.108, 0.126);
      brow.rotation.z = side * 0.08;
      this.head.add(brow);
    }

    const mouthGeo = new THREE.SphereGeometry(0.026, 16, 12);
    this.mouth = new THREE.Mesh(mouthGeo, mat(0x7a3a45, { roughness: 0.4 }));
    this.mouth.position.set(0, 0.022, 0.128);
    this.mouth.scale.set(1.3, 0.35, 0.5);
    this.head.add(this.mouth);

    this.blink = 0;
    this.root.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  setExpressions(w) {
    const open = Math.min(1, Math.max(w.aa || 0, (w.oh || 0) * 0.8, (w.ou || 0) * 0.6));
    const wide = w.happy || 0;
    this.mouth.scale.set(1.3 + wide * 0.5, 0.3 + open * 4.2, 0.5);
    this.mouth.position.y = 0.022 - open * 0.014;

    const blink = w.blink || 0;
    for (const eye of this.eyes) eye.scale.y = 1.35 * Math.max(0.08, 1 - blink);
  }

  resetExpressions() {
    this.setExpressions({});
  }

  pose(t, headDelta) {
    const sway = Math.sin(t * 0.41);
    this.root.rotation.y = sway * 0.02;
    this.root.position.x = sway * 0.006;
    if (headDelta) {
      applyWorldDelta(this.head, this.headRestLocal, headDelta);
    } else {
      this.head.quaternion.identity();
      this.head.rotation.y = sway * 0.08;
      this.head.rotation.x = Math.sin(t * 0.7) * 0.02;
    }
  }

  update() {}

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.root.removeFromParent();
  }
}
