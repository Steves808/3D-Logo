// Mouse / touch / keyboard camera for a normal screen (no headset).
// Drag = look around the sculpture, wheel or pinch = closer / further, right-drag or Shift-drag = slide,
// W A S D Q E = move.

import * as THREE from "../vendor/three.module.min.js";

export class OrbitCam {
  constructor(camera, dom, slotYaw = 0) {
    this.camera = camera; this.dom = dom;
    this.target = new THREE.Vector3(0, 1.1, 0);
    this.yaw = slotYaw; this.pitch = 0.18; this.dist = 3.0;
    this.enabled = true;
    this.keys = new Set();
    const pts = new Map(); let pinch = 0;
    dom.addEventListener("contextmenu", e => e.preventDefault());
    dom.addEventListener("pointerdown", e => { dom.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }); pinch = 0; });
    dom.addEventListener("pointerup", e => { pts.delete(e.pointerId); pinch = 0; });
    dom.addEventListener("pointercancel", e => { pts.delete(e.pointerId); pinch = 0; });
    dom.addEventListener("pointermove", e => {
      const p = pts.get(e.pointerId); if (!p || !this.enabled) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.dist = clamp(this.dist * pinch / d, 0.2, 60);
        pinch = d;
        return;
      }
      if (p.pan) this.pan(-dx * this.dist * 0.0016, dy * this.dist * 0.0016);
      else { this.yaw -= dx * 0.006; this.pitch = clamp(this.pitch + dy * 0.006, -1.45, 1.45); }
    });
    dom.addEventListener("wheel", e => { e.preventDefault(); if (this.enabled) this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.0012), 0.2, 60); }, { passive: false });
    const typing = () => { const a = document.activeElement; return a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT"); };
    window.addEventListener("keydown", e => { if (!typing() && !e.ctrlKey && !e.metaKey) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }
  pan(right, up) {
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.target.addScaledVector(r, right); this.target.y += up;
  }
  lookAt(center, radius) { this.target.copy(center); this.dist = clamp(radius * 2.6, 0.5, 40); }
  update(dt) {
    if (!this.enabled) return;
    const k = this.keys, sp = Math.max(0.6, this.dist * 0.7) * dt;
    if (k.size) {
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      if (k.has("w")) this.target.addScaledVector(f, sp);
      if (k.has("s")) this.target.addScaledVector(f, -sp);
      if (k.has("d")) this.target.addScaledVector(r, sp);
      if (k.has("a")) this.target.addScaledVector(r, -sp);
      if (k.has("e")) this.target.y += sp;
      if (k.has("q")) this.target.y -= sp;
    }
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(this.target);
  }
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
