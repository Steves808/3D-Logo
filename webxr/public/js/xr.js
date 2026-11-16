// Everything that only happens with a headset on: controllers, the tablet on your hand, the laser
// that presses it, grabbing/stretching the sculpture, and thumbstick walking.

import * as THREE from "../vendor/three.module.min.js";
import { packPose, spawnFor } from "./world.js";
import { PANEL_W, PANEL_H } from "./panel.js";

const TABLET_W = 0.34, TABLET_H = TABLET_W * PANEL_H / PANEL_W;

export class XR {
  constructor(world, app, panel) {
    this.world = world; this.app = app; this.panel = panel;
    this.supported = { vr: false, ar: false };
    this.session = null; this.mode = null;
    this.hands = [];                 // one entry per controller
    this.grab = null;                // active grab of the sculpture
    this.panelVersion = -1;
    this._snapReady = true;
    this._ray = new THREE.Raycaster();
    this._build();
  }

  async detect() {
    if (!navigator.xr || !navigator.xr.isSessionSupported) return this.supported;
    try { this.supported.vr = await navigator.xr.isSessionSupported("immersive-vr"); } catch (e) {}
    try { this.supported.ar = await navigator.xr.isSessionSupported("immersive-ar"); } catch (e) {}
    return this.supported;
  }

  get presenting() { return !!this.session; }

  _build() {
    const { renderer, rig } = this.world;
    // tablet
    this.tabletTex = new THREE.CanvasTexture(this.panel.canvas);
    this.tabletTex.colorSpace = THREE.SRGBColorSpace; this.tabletTex.anisotropy = 8;
    this.tablet = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(TABLET_W + 0.016, TABLET_H + 0.016, 0.008), new THREE.MeshLambertMaterial({ color: 0x20242e }));
    back.position.z = -0.0045;
    this.tabletFace = new THREE.Mesh(new THREE.PlaneGeometry(TABLET_W, TABLET_H), new THREE.MeshBasicMaterial({ map: this.tabletTex }));
    this.tablet.add(back, this.tabletFace);
    this.tablet.visible = false;
    // laser + dot
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x9fc0ff, transparent: true, opacity: 0.75 }));
    this.laser.visible = false;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.dot.visible = false;
    this.world.scene.add(this.dot);

    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);          // where it points
      const grip = renderer.xr.getControllerGrip(i);     // where it is held
      const h = { i, ray, grip, handed: null, source: null, squeezing: false, connected: false };
      const model = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.11, 12), new THREE.MeshLambertMaterial({ color: 0xd8dde8 }));
      stick.rotation.x = Math.PI / 2.6;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), new THREE.MeshLambertMaterial({ color: 0x4cc9f0 }));
      knob.position.set(0, 0.02, -0.05);
      model.add(stick, knob);
      grip.add(model);
      h.knob = knob;
      ray.addEventListener("connected", (e) => { h.connected = true; h.source = e.data; h.handed = e.data.handedness; this._assign(); });
      ray.addEventListener("disconnected", () => { h.connected = false; h.source = null; h.squeezing = false; this._assign(); });
      ray.addEventListener("selectstart", () => this._select(h));
      ray.addEventListener("squeezestart", () => { h.squeezing = true; this._grabChanged(); });
      ray.addEventListener("squeezeend", () => { h.squeezing = false; this._grabChanged(); });
      rig.add(ray, grip);
      this.hands.push(h);
    }
  }

  // Which hand holds the tablet and which one points.
  _assign() {
    const want = this.app.flags.swap ? "right" : "left";
    const live = this.hands.filter(h => h.connected);
    let tab = live.find(h => h.handed === want) || null;
    let point = live.find(h => h !== tab) || null;
    if (live.length === 1) { tab = null; point = live[0]; }       // one controller: tablet floats instead
    this.tabletHand = tab; this.pointHand = point;
    if (this.tablet.parent) this.tablet.parent.remove(this.tablet);
    if (this.laser.parent) this.laser.parent.remove(this.laser);
    if (tab) {
      tab.grip.add(this.tablet);
      this.tablet.position.set(want === "left" ? 0.02 : -0.02, 0.13, -0.10);
      this.tablet.rotation.set(-0.85, 0, 0);
    } else {
      this.world.rig.add(this.tablet);           // floats in front of where you started
      this.tablet.position.set(-0.28, 1.05, -0.5);
      this.tablet.rotation.set(-0.5, 0.45, 0);
    }
    if (point) point.ray.add(this.laser);
    this.tablet.visible = this.presenting;
  }
  reassign() { this._assign(); }

  async enter(mode) {
    if (this.session) { this.session.end(); return; }
    const type = mode === "ar" ? "immersive-ar" : "immersive-vr";
    const session = await navigator.xr.requestSession(type, { optionalFeatures: ["local-floor", "bounded-floor"] });
    const { renderer, rig } = this.world;
    this.session = session; this.mode = mode;
    this._saved = { pos: rig.position.clone(), quat: rig.quaternion.clone(), camPos: this.world.camera.position.clone(), camQuat: this.world.camera.quaternion.clone() };
    const sp = spawnFor(this.app.slot());
    rig.position.set(sp.x, 0, sp.z); rig.rotation.set(0, sp.yaw, 0);
    session.addEventListener("end", () => this._ended());
    await renderer.xr.setSession(session);
    this._assign();
    this.app.onXR(true, mode);
  }

  _ended() {
    const { rig, camera } = this.world;
    this.session = null; this.mode = null; this.grab = null;
    for (const h of this.hands) h.squeezing = false;
    if (this._saved) { rig.position.copy(this._saved.pos); rig.quaternion.copy(this._saved.quat); camera.position.copy(this._saved.camPos); camera.quaternion.copy(this._saved.camQuat); }
    this.tablet.visible = false; this.laser.visible = false; this.dot.visible = false;
    this.app.onXR(false, null);
  }

  _pulse(h, strength, ms) {
    try { const gp = h.source && h.source.gamepad; const a = gp && gp.hapticActuators && gp.hapticActuators[0]; if (a && a.pulse) a.pulse(strength, ms); } catch (e) {}
  }

  _select(h) {
    if (h !== this.pointHand || !this._hit) return;
    if (this.panel.press(this._hit.u, this._hit.v)) this._pulse(h, 0.5, 35);
  }

  // ----- grabbing the sculpture -----
  _handPos(h, out) { return h.grip.getWorldPosition(out); }
  _grabChanged() {
    const held = this.hands.filter(h => h.squeezing && h.connected);
    const root = this.world.viewRoot;
    if (!held.length) {
      if (this.grab) { this.grab = null; this.app.viewFromLocal(true); }
      return;
    }
    root.updateMatrix();
    const g = { hands: held, M0: root.matrix.clone() };
    if (held.length === 1) {
      held[0].grip.updateWorldMatrix(true, false);
      g.inv = held[0].grip.matrixWorld.clone().invert();
    } else {
      const a = this._handPos(held[0], new THREE.Vector3()), b = this._handPos(held[1], new THREE.Vector3());
      g.mid0 = a.clone().add(b).multiplyScalar(0.5);
      g.d0 = Math.max(0.02, a.distanceTo(b));
      g.dir0 = b.clone().sub(a).normalize();
    }
    this.grab = g;
    for (const h of held) this._pulse(h, 0.3, 25);
  }
  _updateGrab() {
    const g = this.grab; if (!g) return;
    const root = this.world.viewRoot;
    const M = new THREE.Matrix4();
    if (g.hands.length === 1) {
      g.hands[0].grip.updateWorldMatrix(true, false);
      M.multiplyMatrices(g.hands[0].grip.matrixWorld, g.inv).multiply(g.M0);
    } else {
      const a = this._handPos(g.hands[0], new THREE.Vector3()), b = this._handPos(g.hands[1], new THREE.Vector3());
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const s = Math.max(0.02, a.distanceTo(b)) / g.d0;
      const rot = new THREE.Quaternion().setFromUnitVectors(g.dir0, b.clone().sub(a).normalize());
      M.makeTranslation(mid.x, mid.y, mid.z)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(rot))
        .multiply(new THREE.Matrix4().makeScale(s, s, s))
        .multiply(new THREE.Matrix4().makeTranslation(-g.mid0.x, -g.mid0.y, -g.mid0.z))
        .multiply(g.M0);
    }
    M.decompose(root.position, root.quaternion, root.scale);
    const s = (root.scale.x + root.scale.y + root.scale.z) / 3;
    root.scale.setScalar(Math.min(100, Math.max(1e-5, s)));
    this.app.viewFromLocal(false);
  }

  // ----- every frame while the headset is on -----
  update(dt) {
    if (!this.session) return;
    const { rig, camera } = this.world;

    if (this.panel.version !== this.panelVersion) { this.panelVersion = this.panel.version; this.tabletTex.needsUpdate = true; }

    // thumbsticks
    let mx = 0, my = 0, turn = 0, lift = 0;
    for (const h of this.hands) {
      const gp = h.source && h.source.gamepad; if (!gp) continue;
      const ax = gp.axes.length >= 4 ? gp.axes[2] : (gp.axes[0] || 0), ay = gp.axes.length >= 4 ? gp.axes[3] : (gp.axes[1] || 0);
      if (h.handed === "left") { mx = ax; my = ay; } else { turn = ax; lift = ay; }
    }
    const dead = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    mx = dead(mx); my = dead(my);
    if (mx || my) {
      const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize();
      const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0));
      rig.position.addScaledVector(f, -my * 1.6 * dt).addScaledVector(r, mx * 1.6 * dt);
    }
    if (Math.abs(lift) > 0.6 && Math.abs(turn) < 0.5) rig.position.y = Math.min(6, Math.max(-1.5, rig.position.y - Math.sign(lift) * 0.8 * dt));
    if (Math.abs(turn) > 0.7 && Math.abs(lift) < 0.6) {
      if (this._snapReady) {
        this._snapReady = false;
        const head = new THREE.Vector3(); camera.getWorldPosition(head);
        const a = -Math.sign(turn) * Math.PI / 6;
        rig.position.sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), a).add(head);
        rig.rotateY(a);
      }
    } else if (Math.abs(turn) < 0.3) this._snapReady = true;

    this._updateGrab();

    // laser -> tablet
    this._hit = null;
    const p = this.pointHand;
    if (p && this.tablet.visible) {
      p.ray.updateWorldMatrix(true, false);
      const o = new THREE.Vector3().setFromMatrixPosition(p.ray.matrixWorld);
      const d = new THREE.Vector3(0, 0, -1).transformDirection(p.ray.matrixWorld);
      this._ray.set(o, d); this._ray.far = 3;
      const hit = this._ray.intersectObject(this.tabletFace, false)[0];
      if (hit && hit.uv) {
        this._hit = { u: hit.uv.x, v: 1 - hit.uv.y };
        this.panel.hover(this._hit.u, this._hit.v);
        this.laser.visible = true; this.laser.scale.set(1, 1, hit.distance);
        this.dot.visible = true; this.dot.position.copy(hit.point);
      } else {
        this.panel.hover(null);
        this.laser.visible = true; this.laser.scale.set(1, 1, 0.6);
        this.dot.visible = false;
      }
    } else { this.laser.visible = false; this.dot.visible = false; }
  }

  // My head and hands, for the other players.
  pose() {
    const out = { h: packPose(this.world.camera), l: null, r: null };
    for (const h of this.hands) {
      if (!h.connected) continue;
      if (h.handed === "left") out.l = packPose(h.grip); else if (h.handed === "right") out.r = packPose(h.grip);
    }
    if (this.pointHand && this.laser.visible) out.ray = packPose(this.pointHand.ray).concat([Math.round(this.laser.scale.z * 100) / 100]);
    return out;
  }
}
