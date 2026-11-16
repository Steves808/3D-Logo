// Turns the engine's list of drawn things into fast Three.js objects.
// Lines become one batch of tubes (a single draw call), so big sculptures stay smooth on a headset.
// Logo space: x right, y up, z forward.  Three.js space: z is flipped (forward = -z).

import * as THREE from "../vendor/three.module.min.js";

const MAX_INSTANCES = 150000;
const MAX_LABELS = 80;

const _colorCache = new Map();
const _c = new THREE.Color();
export function cssColor(str) {
  let c = _colorCache.get(str);
  if (!c) {
    c = new THREE.Color();
    try { c.set(str); } catch (e) { c.set("#ffffff"); }
    if (_colorCache.size > 5000) _colorCache.clear();
    _colorCache.set(str, c);
  }
  return c;
}

function tubeGeometry(sides, capped) {
  const g = new THREE.CylinderGeometry(1, 1, 1, sides, 1, !capped);
  return g;   // unit radius, unit height along Y, centred
}

function labelSprite(text, color) {
  const pad = 12, font = "600 64px system-ui, -apple-system, Segoe UI, sans-serif";
  const cv = document.createElement("canvas");
  let g = cv.getContext("2d");
  g.font = font;
  const w = Math.min(1024, Math.ceil(g.measureText(text).width) + pad * 2);
  cv.width = w; cv.height = 88;
  g = cv.getContext("2d");
  g.font = font; g.textBaseline = "middle"; g.textAlign = "center";
  g.lineWidth = 8; g.strokeStyle = "rgba(0,0,0,0.75)"; g.strokeText(text, w / 2, 46, w - pad);
  g.fillStyle = color; g.fillText(text, w / 2, 46, w - pad);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.userData.aspect = w / 88;
  return sp;
}

export class Sculpture {
  constructor() {
    this.group = new THREE.Group();          // lives inside the shared "view" transform
    this.group.name = "sculpture";
    this.parts = [];
    this.result = null;
    this.minR = 0;
    this.limit = null;
    this.bounds = { center: new THREE.Vector3(), radius: 1, empty: true };
    this.turtle = makeTurtleMarker();
    this.group.add(this.turtle);
    this.info = { tubes: 0, balls: 0, sheets: 0, labels: 0, hidden: 0 };
  }

  dispose() {
    this._sig = null;
    for (const o of this.parts) {
      this.group.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    }
    this.parts = [];
  }

  // result: what engine.run() returned.  minR: thinnest allowed tube radius, in Logo units.
  build(result, minR) {
    this.result = result;
    this.minR = minR || 0;
    const segs = result.segs;
    const glow = !!(result.scene && result.scene.glow);

    let nT = 0, nB = 0, nS = 0, nL = 0;
    for (const s of segs) { if (s.sheet) nS++; else if (s.ball) nB++; else if (s.label != null) nL++; else nT++; }
    const hidden = Math.max(0, nT - MAX_INSTANCES);
    nT = Math.min(nT, MAX_INSTANCES); nB = Math.min(nB, 20000);

    const tier = nT <= 4000 ? 2 : nT <= 20000 ? 1 : 0;
    const sides = [3, 5, 8][tier];
    // Animated programs are rebuilt many times a second with the same number of things in them:
    // when nothing changed but positions and colours, the old objects are reused (no stutter).
    let labelSig = "";
    if (nL) for (const s of segs) if (s.label != null) labelSig += s.label + "|" + s.color + "|" + s.width + "\n";
    const sig = [nT, nB, nS, nL, glow, tier, labelSig].join("/");
    const reuse = sig === this._sig && this.parts.length > 0;
    if (!reuse) this.dispose();
    this._sig = sig;
    const makeMat = () => glow
      ? new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
      : new THREE.MeshLambertMaterial();

    const box = new THREE.Box3(); box.makeEmpty();
    const P = new THREE.Vector3(), Q = new THREE.Vector3(), D = new THREE.Vector3(), mid = new THREE.Vector3();
    const quat = new THREE.Quaternion(), scl = new THREE.Vector3(), M = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);

    // ----- tubes -----
    const tubes = reuse ? this._tubes : nT ? new THREE.InstancedMesh(tubeGeometry(sides, tier === 2), makeMat(), nT) : null;
    const joints = reuse ? this._joints : (nT && tier === 2) ? new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), makeMat(), nT) : null;
    const tubeSteps = new Uint32Array(nT);
    // ----- balls -----
    const balls = reuse ? this._balls : nB ? new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, nB > 3000 ? 1 : 2), makeMat(), nB) : null;
    const ballSteps = new Uint32Array(nB);
    // ----- sheets -----
    const sheetPos = (reuse && this._sheets) ? this._sheets.geometry.attributes.position.array : new Float32Array(nS * 18);
    const sheetCol = (reuse && this._sheets) ? this._sheets.geometry.attributes.color.array : new Float32Array(nS * 18);
    const sheetSteps = new Uint32Array(nS);
    // ----- labels -----
    const labels = reuse ? this._labels : [];

    let iT = 0, iB = 0, iS = 0, iL = 0;
    for (const s of segs) {
      P.set(s.a.x, s.a.y, -s.a.z);
      if (s.sheet) {
        Q.set(s.b.x, s.b.y, -s.b.z);
        const hx = s.sheet.x, hy = s.sheet.y, hz = -s.sheet.z;
        const v = [P.x - hx, P.y - hy, P.z - hz, P.x + hx, P.y + hy, P.z + hz, Q.x + hx, Q.y + hy, Q.z + hz, Q.x - hx, Q.y - hy, Q.z - hz];
        const idx = [0, 1, 2, 0, 2, 3], o = iS * 18, col = cssColor(s.color);
        for (let k = 0; k < 6; k++) {
          sheetPos[o + k * 3] = v[idx[k] * 3]; sheetPos[o + k * 3 + 1] = v[idx[k] * 3 + 1]; sheetPos[o + k * 3 + 2] = v[idx[k] * 3 + 2];
          sheetCol[o + k * 3] = col.r; sheetCol[o + k * 3 + 1] = col.g; sheetCol[o + k * 3 + 2] = col.b;
        }
        for (let k = 0; k < 4; k++) box.expandByPoint(D.set(v[k * 3], v[k * 3 + 1], v[k * 3 + 2]));
        sheetSteps[iS++] = s.step;
      } else if (s.ball) {
        if (iB >= nB) continue;
        M.compose(P, quat.identity(), scl.setScalar(s.ball));
        balls.setMatrixAt(iB, M); balls.setColorAt(iB, cssColor(s.color));
        box.expandByPoint(D.copy(P).addScalar(s.ball)); box.expandByPoint(D.copy(P).addScalar(-s.ball));
        ballSteps[iB++] = s.step;
      } else if (s.label != null) {
        box.expandByPoint(P);
        if (reuse) { if (iL < labels.length) { labels[iL].position.copy(P); labels[iL].userData.step = s.step; iL++; } }
        else if (labels.length < MAX_LABELS) {
          const sp = labelSprite(String(s.label).slice(0, 60), "#" + cssColor(s.color).getHexString());
          const h = 8 * (Number(s.width) || 1.5);
          sp.scale.set(h * sp.userData.aspect, h, 1);
          sp.position.copy(P);
          sp.userData.step = s.step;
          labels.push(sp);
        }
      } else {
        if (iT >= nT) continue;
        Q.set(s.b.x, s.b.y, -s.b.z);
        box.expandByPoint(P); box.expandByPoint(Q);
        D.subVectors(Q, P);
        const len = D.length();
        const r = Math.max(this.minR, (Number(s.width) || 1.5) * 0.35);
        if (len > 1e-9) quat.setFromUnitVectors(UP, D.multiplyScalar(1 / len)); else quat.identity();
        mid.addVectors(P, Q).multiplyScalar(0.5);
        M.compose(mid, quat, scl.set(r, Math.max(len, 1e-6), r));
        const col = cssColor(s.color);
        tubes.setMatrixAt(iT, M); tubes.setColorAt(iT, col);
        if (joints) { M.compose(Q, quat.identity(), scl.setScalar(r)); joints.setMatrixAt(iT, M); joints.setColorAt(iT, col); }
        tubeSteps[iT++] = s.step;
      }
    }

    const add = (o) => { if (reuse) return; o.frustumCulled = false; this.group.add(o); this.parts.push(o); };
    if (tubes) { tubes.count = iT; tubes.instanceMatrix.needsUpdate = true; if (tubes.instanceColor) tubes.instanceColor.needsUpdate = true; add(tubes); }
    if (joints) { joints.count = iT; joints.instanceMatrix.needsUpdate = true; if (joints.instanceColor) joints.instanceColor.needsUpdate = true; add(joints); }
    if (balls) { balls.count = iB; balls.instanceMatrix.needsUpdate = true; if (balls.instanceColor) balls.instanceColor.needsUpdate = true; add(balls); }
    let sheets = reuse ? this._sheets : null;
    if (reuse && sheets) {
      sheets.geometry.attributes.position.needsUpdate = true; sheets.geometry.attributes.color.needsUpdate = true;
      sheets.geometry.computeVertexNormals();
    } else if (nS) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(sheetPos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(sheetCol, 3));
      g.computeVertexNormals();
      const mat = glow
        ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
        : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      sheets = new THREE.Mesh(g, mat);
      add(sheets);
    }
    for (const sp of labels) add(sp);

    this._tubes = tubes; this._joints = joints; this._balls = balls; this._sheets = sheets; this._labels = labels;
    this._tubeSteps = tubeSteps.subarray(0, iT); this._ballSteps = ballSteps.subarray(0, iB); this._sheetSteps = sheetSteps;
    this._counts = { t: iT, b: iB, s: nS };
    this.info = { tubes: iT, balls: iB, sheets: nS, labels: labels.length, hidden };

    if (box.isEmpty()) { this.bounds = { center: new THREE.Vector3(), radius: 50, empty: true }; }
    else {
      const sph = new THREE.Sphere(); box.getBoundingSphere(sph);
      this.bounds = { center: sph.center.clone(), radius: Math.max(sph.radius, 1), empty: false };
    }
    this.limit = undefined;
    this.setLimit(null);
  }

  // Watch playback: show only what had been drawn by step `limit` (null = everything).
  setLimit(limit) {
    if (limit === this.limit) return;
    this.limit = limit;
    const upTo = (arr, n) => {
      if (limit == null) return n;
      let lo = 0, hi = n;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= limit) lo = m + 1; else hi = m; }
      return lo;
    };
    if (this._tubes) { const n = upTo(this._tubeSteps, this._counts.t); this._tubes.count = n; if (this._joints) this._joints.count = n; }
    if (this._balls) this._balls.count = upTo(this._ballSteps, this._counts.b);
    if (this._sheets) this._sheets.geometry.setDrawRange(0, upTo(this._sheetSteps, this._counts.s) * 6);
    for (const sp of this._labels || []) sp.visible = limit == null || sp.userData.step <= limit;
    this._placeTurtle();
  }

  // The engine line number being drawn at the current playhead (for highlighting the code).
  lineAtLimit() {
    const r = this.result; if (!r || this.limit == null) return 0;
    const segs = r.segs; let lo = 0, hi = segs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (segs[m].step <= this.limit) lo = m + 1; else hi = m; }
    return lo > 0 ? segs[lo - 1].line : 0;
  }

  _placeTurtle() {
    const r = this.result; if (!r) return;
    let pos = r.turtle.pos, R = r.turtle.R, color = r.turtle.color;
    if (this.limit != null) {
      const segs = r.segs; let lo = 0, hi = segs.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (segs[m].step <= this.limit) lo = m + 1; else hi = m; }
      let i = lo - 1;
      if (i < 0) { pos = { x: 0, y: 0, z: 0 }; R = [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
      else {
        const step = segs[i].step;
        while (i > 0 && segs[i - 1].step === step) i--;
        pos = segs[i].b; R = segs[i].R || R; color = segs[i].color;
      }
    }
    placeMarker(this.turtle, pos, R, color);
  }

  setTurtleSize(logoUnits) { this.turtle.scale.setScalar(logoUnits); }
  setTurtleVisible(v) { this.turtle.visible = v; }
}

function makeTurtleMarker() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 12), new THREE.MeshLambertMaterial({ color: 0x35d07f }));
  body.rotation.x = -Math.PI / 2;            // cone tip points along -Z (= Logo "forward")
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  fin.position.set(0, 0.35, 0.25);           // little fin shows which way is "up"
  const pen = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  pen.position.z = -0.7;
  g.add(body, fin, pen);
  g.userData.pen = pen;
  g.name = "turtle";
  return g;
}

const _m = new THREE.Matrix4();
function placeMarker(marker, pos, R, color) {
  // R is the engine's row-major 3x3; columns are right / up / forward in Logo space.
  const rx = R[0], ry = R[3], rz = -R[6];
  const ux = R[1], uy = R[4], uz = -R[7];
  const fx = R[2], fy = R[5], fz = -R[8];
  _m.set(rx, ux, -fx, 0,
         ry, uy, -fy, 0,
         rz, uz, -fz, 0,
         0, 0, 0, 1);
  marker.quaternion.setFromRotationMatrix(_m);
  marker.position.set(pos.x, pos.y, -pos.z);
  if (color) marker.userData.pen.material.color.copy(cssColor(color));
}
