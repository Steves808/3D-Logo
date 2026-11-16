(() => {
  const VERSION = "c17";
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const canvas = $("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  function setStatus(msg){ if (statusEl) statusEl.textContent = msg; }
  setStatus("JS loaded ✅  Ready. Tap Run.");

  const DEG = Math.PI / 180;
  const ARC_STEP_DEG = 3; // smaller = smoother arcs (slower)
  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  function nowMs(){ return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

  // Sentinel thrown by STOP; caught by the nearest CALL handler to exit that procedure.
  const _STOP = Object.freeze({ __stop__: true });

  // Tiny localStorage wrappers (storage may be blocked on file:// or in private mode).
  function lsGet(k){ try { return window.localStorage.getItem(k); } catch(e){ return null; } }
  function lsSet(k,v){ try { window.localStorage.setItem(k, v); } catch(e){ /* ignore */ } }

  // Seeded random numbers: the same seed is replayed for Live edits, sliders and animation
  // frames (so random art holds still while you tweak it); pressing Run picks a new seed.
  let _seed = ((Math.random() * 4294967296) >>> 0) || 1;
  let _rs = _seed;
  function newSeed(){ _seed = ((Math.random() * 4294967296) >>> 0) || 1; }
  function rnd(){
    _rs = (_rs + 0x6D2B79F5) | 0;
    let t = Math.imul(_rs ^ (_rs >>> 15), 1 | _rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // 3D vector
  function V(x=0,y=0,z=0){ return {x,y,z}; }
  function add(a,b){ return V(a.x+b.x,a.y+b.y,a.z+b.z); }
  function sub(a,b){ return V(a.x-b.x,a.y-b.y,a.z-b.z); }
  function mul(a,s){ return V(a.x*s,a.y*s,a.z*s); }

  // 3x3 matrix (row-major)
  function I3(){ return [1,0,0, 0,1,0, 0,0,1]; }
  function matMul(A,B){
    const C = new Array(9);
    for(let r=0;r<3;r++) for(let c=0;c<3;c++)
      C[r*3+c] = A[r*3+0]*B[0*3+c] + A[r*3+1]*B[1*3+c] + A[r*3+2]*B[2*3+c];
    return C;
  }
  function matVec(M,v){
    return V(
      M[0]*v.x + M[1]*v.y + M[2]*v.z,
      M[3]*v.x + M[4]*v.y + M[5]*v.z,
      M[6]*v.x + M[7]*v.y + M[8]*v.z
    );
  }
  function rotAxis(axis, rad){
    const {x,y,z} = axis;
    const c = Math.cos(rad), s = Math.sin(rad), t = 1-c;
    return [
      t*x*x + c,     t*x*y - s*z,   t*x*z + s*y,
      t*x*y + s*z,   t*y*y + c,     t*y*z - s*x,
      t*x*z - s*y,   t*y*z + s*x,   t*z*z + c
    ];
  }
  function norm(v){
    const m = Math.hypot(v.x,v.y,v.z) || 1;
    return V(v.x/m, v.y/m, v.z/m);
  }
  function basisForward(R){ return norm(matVec(R, V(0,0,1))); }
  function basisRight(R){ return norm(matVec(R, V(1,0,0))); }
  function basisUp(R){ return norm(matVec(R, V(0,1,0))); }

  // Triangles of a low-poly sphere (outward-facing) — used by OBJ and STL export for BALL.
  function sphereTris(c, r, nLat = 8, nLon = 12){
    const P = (i,j) => {
      const th = i * Math.PI / nLat, ph = j * 2 * Math.PI / nLon;
      return V(c.x + r*Math.sin(th)*Math.cos(ph), c.y + r*Math.cos(th), c.z + r*Math.sin(th)*Math.sin(ph));
    };
    const tris = [];
    for (let i=0;i<nLat;i++) for (let j=0;j<nLon;j++){
      const a = P(i,j), b = P(i+1,j), cc = P(i+1,j+1), d = P(i,j+1);
      if (i < nLat-1) tris.push([a, cc, b]);
      if (i > 0)      tris.push([a, d, cc]);
    }
    return tris;
  }

  // ---------- Drawing ----------
  // Everything the turtle makes lives in `segments`, in the order it was made:
  //   line     { a, b, color, width }
  //   sheet    { ..., sheet: halfVector }          (SHEETS mode)
  //   ball     { a, b (same point), ball: radius } (BALL)
  //   label    { a, b (same point), label: text }  (LABEL)
  //   snap     { ..., isSnapSpoke: true }          (SP)
  // Each entry also carries: step (draw order, used by Watch), line (source line),
  // and, on the first copy only, R (turtle orientation right after it was drawn).
  let segments = [];
  let stepCounter = 0;
  let events = [];      // things that happen in time but draw nothing: PRINT, NOTE, REST
  let symN = 1;         // SYMMETRY n: every drawn thing is repeated n times around the up axis
  let curLine = 0;      // source line of the instruction being executed
  function clearSegments(){ segments = []; stepCounter = 0; events = []; }

  function symRot(p, k){
    if (!k) return V(p.x, p.y, p.z);
    const a = k * 2 * Math.PI / symN, c = Math.cos(a), s = Math.sin(a);
    return V(p.x*c + p.z*s, p.y, -p.x*s + p.z*c);
  }
  function pushSeg(seg){
    const step = ++stepCounter;
    for (let k = 0; k < symN; k++){
      const s = Object.assign({}, seg, { a: symRot(seg.a, k), b: symRot(seg.b, k), step, line: curLine });
      if (seg.sheet) s.sheet = symRot(seg.sheet, k);
      if (k === 0) s.R = turtle.R;
      segments.push(s);
    }
  }
  function addDrawnSegment(a, b, color, width){
    pushSeg({ a, b, color, width, isSnapSpoke:false });
  }
  // SHEETS mode: a filled rectangle from a to b, extending ±half (a vector) sideways.
  function addSheetSegment(a, b, color, width, half){
    pushSeg({ a, b, color, width, isSnapSpoke:false, sheet: half });
  }
  function addSnapSpokeSegment(a, b, color, width){
    // spokes from SP should NOT become snap geometry
    pushSeg({ a, b, color, width, isSnapSpoke:true });
  }

  // ---------- Scene look (set by GLOW / BG / GRID / HT / ST; reset at every run) ----------
  function defaultScene(){ return { bg:"#0b0f14", glow:false, grid:true, showTurtle:true }; }
  let scene = defaultScene();
  let uiLook = "classic";   // "classic" | "neon" | "glasses" (red/cyan) | "sbs" (parallel) | "sbsx" (cross-eyed)
  // Side-by-side free-viewing: depth = total angle between the two eyes' views (degrees),
  // size = how much of the half-screen each picture fills (parallel viewers need them small
  // enough that matching points are no further apart than their eyes).
  const sbs = { depth: 4, size: 100 };
  const isSbs = () => uiLook === "sbs" || uiLook === "sbsx";
  let ghostSegs = [];       // quest target shape, drawn faintly
  let confetti = [];

  // ---------- Camera ----------
  const cam = { yaw: 35*DEG, pitch: -25*DEG, dist: 420, panX:0, panY:0, target: V(0,0,0) };
  const CAM_MAX_DIST = 12000;
  let DPR = 1;

  function resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.floor(w*dpr);
    canvas.height = Math.floor(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    DPR = dpr;
  }
  window.addEventListener("resize", () => { resize(); draw(); });
  resize();

  function makeProjector(viewW, viewH, yawOffset = 0, panX = cam.panX, panY = cam.panY){
    const Ry = rotAxis(V(0,1,0), cam.yaw + yawOffset);
    const Rx = rotAxis(V(1,0,0), cam.pitch);
    const R = matMul(Rx, Ry);
    const tx = cam.target.x, ty = cam.target.y, tz = cam.target.z;
    const dist = cam.dist, f = 600, hw = viewW/2 + panX, hh = viewH/2 + panY;
    return function projectForView(p){
      const x = p.x - tx, y = p.y - ty, zz = p.z - tz;
      const px = R[0]*x + R[1]*y + R[2]*zz;
      const py = R[3]*x + R[4]*y + R[5]*zz;
      const z  = R[6]*x + R[7]*y + R[8]*zz + dist;
      const k = f / (z || 1);
      return { x: px*k + hw, y: -py*k + hh, z };
    };
  }

  function project(p){
    return makeProjector(canvas.clientWidth, canvas.clientHeight)(p);
  }

  // Number of entries in `segments` whose step is <= limit (segments are in step order).
  function countUpToStep(limit){
    if (limit == null || limit >= stepCounter) return segments.length;
    let lo = 0, hi = segments.length;
    while (lo < hi){ const mid = (lo+hi) >> 1; if (segments[mid].step <= limit) lo = mid+1; else hi = mid; }
    return lo;
  }

  function drawTurtleGlyph(outCtx, projector, pose){
    const sz = cam.dist * 0.035;
    const f = basisForward(pose.R), r = basisRight(pose.R), u = basisUp(pose.R);
    const P = pose.pos;
    const nose = add(P, mul(f, sz));
    const tail = sub(P, mul(f, sz*0.55));
    const wl = add(tail, mul(r, -sz*0.6)), wr = add(tail, mul(r, sz*0.6));
    const fin = add(tail, mul(u, sz*0.55));
    const pts = [nose, wl, wr, tail, fin, P].map(projector);
    if (pts.some(p => p.z < 1)) return;
    outCtx.lineWidth = 1.5; outCtx.lineJoin = "round";
    outCtx.beginPath(); outCtx.moveTo(pts[0].x,pts[0].y); outCtx.lineTo(pts[1].x,pts[1].y); outCtx.lineTo(pts[2].x,pts[2].y); outCtx.closePath();
    outCtx.fillStyle = "rgba(100,220,255,0.30)"; outCtx.fill();
    outCtx.strokeStyle = "#9fe8ff"; outCtx.stroke();
    outCtx.beginPath(); outCtx.moveTo(pts[0].x,pts[0].y); outCtx.lineTo(pts[3].x,pts[3].y); outCtx.lineTo(pts[4].x,pts[4].y); outCtx.closePath();
    outCtx.fillStyle = "rgba(255,214,10,0.30)"; outCtx.fill();
    outCtx.strokeStyle = "#ffd60a"; outCtx.stroke();
    // pen dot: filled with the pen colour when the pen is down, hollow when it is up
    outCtx.beginPath(); outCtx.arc(pts[5].x, pts[5].y, 3, 0, Math.PI*2);
    if (pose.penDown){ outCtx.fillStyle = pose.color || "#fff"; outCtx.fill(); }
    outCtx.strokeStyle = "#ffffff"; outCtx.lineWidth = 1; outCtx.stroke();
  }

  function drawSceneToContext(outCtx, w, h, projector, opts = {}){
    const drawGrid = opts.drawGrid !== false && scene.grid;
    const bg = opts.background || scene.bg || "#0b0f14";
    const glow = opts.glow != null ? opts.glow : (scene.glow || uiLook === "neon");
    outCtx.globalCompositeOperation = "source-over";
    outCtx.globalAlpha = 1;
    outCtx.fillStyle = "#0b0f14";
    outCtx.fillStyle = bg;
    outCtx.fillRect(0,0,w,h);

    if (drawGrid){
      outCtx.lineWidth = 1;
      outCtx.strokeStyle = "rgba(120,150,180,0.12)";
      const gridN = 20, step = 30;
      const line = (p, q) => {
        const a = projector(p), b = projector(q);
        if (a.z < 1 || b.z < 1) return;
        outCtx.beginPath(); outCtx.moveTo(a.x,a.y); outCtx.lineTo(b.x,b.y); outCtx.stroke();
      };
      for(let i=-gridN;i<=gridN;i++){
        line(V(i*step,0,-gridN*step), V(i*step,0, gridN*step));
        line(V(-gridN*step,0,i*step), V( gridN*step,0,i*step));
      }
    }

    // quest target ("ghost") — faint dashed lines to trace over
    if (opts.ghost && ghostSegs.length){
      outCtx.save();
      outCtx.setLineDash([6,6]);
      outCtx.lineWidth = 2;
      outCtx.strokeStyle = "rgba(255,255,255,0.33)";
      for (const s of ghostSegs){
        const pa = projector(s.a), pb = projector(s.b);
        if (pa.z < 1 || pb.z < 1) continue;
        outCtx.beginPath(); outCtx.moveTo(pa.x,pa.y); outCtx.lineTo(pb.x,pb.y); outCtx.stroke();
      }
      outCtx.restore();
    }

    const n = countUpToStep(opts.limit);
    const drawn = [];
    for (let i = 0; i < n; i++){
      const s = segments[i];
      if (s.sheet){
        const hv = s.sheet;
        const q = [projector(sub(s.a,hv)), projector(add(s.a,hv)), projector(add(s.b,hv)), projector(sub(s.b,hv))];
        if (q[0].z < 1 || q[1].z < 1 || q[2].z < 1 || q[3].z < 1) continue;
        drawn.push({ k:1, q, color:s.color, z:(q[0].z+q[1].z+q[2].z+q[3].z)/4 });
      } else if (s.ball){
        const c = projector(s.a);
        if (c.z < 1) continue;
        drawn.push({ k:2, c, r: s.ball * 600 / c.z, color:s.color, z:c.z });
      } else if (s.label != null){
        const c = projector(s.a);
        if (c.z < 1) continue;
        drawn.push({ k:3, c, text:s.label, px: clamp(12 * (s.width/1.5) * 600 / c.z, 7, 220), color:s.color, z:c.z });
      } else {
        const pa = projector(s.a), pb = projector(s.b);
        if (pa.z < 1 || pb.z < 1) continue;
        drawn.push({ k:0, pa, pb, color:s.color, width:s.width, z:(pa.z+pb.z)/2 });
      }
    }
    drawn.sort((u,v)=> v.z - u.z);

    outCtx.lineCap = "round";
    for(const s of drawn){
      if (s.k === 1){
        outCtx.beginPath();
        outCtx.moveTo(s.q[0].x, s.q[0].y);
        for (let k=1;k<4;k++) outCtx.lineTo(s.q[k].x, s.q[k].y);
        outCtx.closePath();
        outCtx.fillStyle = s.color;
        if (glow){ outCtx.globalCompositeOperation = "lighter"; outCtx.globalAlpha = 0.55; }
        outCtx.fill();
        outCtx.globalCompositeOperation = "source-over";
        outCtx.globalAlpha = 1;
        if (!glow){
          // thin darker edge so neighbouring sheets read as separate planes
          outCtx.lineWidth = 1;
          outCtx.strokeStyle = "rgba(0,0,0,0.18)";
          outCtx.stroke();
        }
        continue;
      }
      if (s.k === 2){
        const r = Math.max(0.5, s.r);
        outCtx.beginPath(); outCtx.arc(s.c.x, s.c.y, r, 0, Math.PI*2);
        outCtx.fillStyle = s.color; outCtx.fill();
        const g = outCtx.createRadialGradient(s.c.x - r*0.35, s.c.y - r*0.4, r*0.05, s.c.x, s.c.y, r);
        g.addColorStop(0, "rgba(255,255,255,0.75)");
        g.addColorStop(0.45, "rgba(255,255,255,0)");
        g.addColorStop(1, "rgba(0,0,0,0.45)");
        outCtx.fillStyle = g; outCtx.fill();
        continue;
      }
      if (s.k === 3){
        outCtx.font = "600 " + s.px.toFixed(1) + "px system-ui, sans-serif";
        outCtx.textAlign = "center"; outCtx.textBaseline = "middle";
        outCtx.fillStyle = s.color;
        outCtx.fillText(s.text, s.c.x, s.c.y);
        continue;
      }
      outCtx.strokeStyle = s.color;
      if (glow){
        // soft additive halo under a normal, solid core line
        outCtx.globalCompositeOperation = "lighter";
        outCtx.globalAlpha = 0.10;
        outCtx.lineWidth = Math.max(1, s.width) * 5 + 3;
        outCtx.beginPath(); outCtx.moveTo(s.pa.x, s.pa.y); outCtx.lineTo(s.pb.x, s.pb.y); outCtx.stroke();
        outCtx.globalAlpha = 1;
        outCtx.globalCompositeOperation = "source-over";
      }
      outCtx.lineWidth = Math.max(1, s.width);
      outCtx.beginPath();
      outCtx.moveTo(s.pa.x, s.pa.y);
      outCtx.lineTo(s.pb.x, s.pb.y);
      outCtx.stroke();
    }
    outCtx.globalCompositeOperation = "source-over";
    outCtx.globalAlpha = 1;

    if (opts.turtle) drawTurtleGlyph(outCtx, projector, opts.turtle);
  }

  // Where the turtle is right now (or, during Watch playback, where it was at that moment).
  function currentPose(){
    if (play.active){
      let i = countUpToStep(play.pos) - 1;
      if (i < 0) return { pos: V(0,0,0), R: I3(), penDown:true, color:"#ffffff" };
      const step = segments[i].step;
      while (i > 0 && segments[i-1].step === step) i--;
      const s = segments[i];
      return { pos: s.b, R: s.R || I3(), penDown:true, color: s.color };
    }
    return { pos: turtle.pos, R: turtle.R, penDown: turtle.penDown, color: turtle.color };
  }

  const _eyeCanvas = [null, null];
  function draw(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const o = { drawGrid:true, ghost:true, limit: play.active ? play.pos : null,
                turtle: scene.showTurtle ? currentPose() : null };
    if (uiLook === "glasses"){
      // Red/cyan anaglyph: left eye in the red channel, right eye in green+blue.
      for (let e = 0; e < 2; e++){
        let oc = _eyeCanvas[e];
        if (!oc) oc = _eyeCanvas[e] = document.createElement("canvas");
        if (oc.width !== canvas.width || oc.height !== canvas.height){ oc.width = canvas.width; oc.height = canvas.height; }
        const ox = oc.getContext("2d", { alpha:false });
        ox.setTransform(DPR,0,0,DPR,0,0);
        drawSceneToContext(ox, w, h, makeProjector(w, h, (e === 0 ? -1 : 1) * 1.3 * DEG),
                           Object.assign({}, o, { background:"#000000", glow:false }));
        ox.setTransform(1,0,0,1,0,0);
        ox.globalCompositeOperation = "multiply";
        ox.fillStyle = e === 0 ? "#ff0000" : "#00ffff";
        ox.fillRect(0, 0, oc.width, oc.height);
        ox.globalCompositeOperation = "source-over";
      }
      ctx.save();
      ctx.setTransform(1,0,0,1,0,0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(_eyeCanvas[0], 0, 0);
      ctx.drawImage(_eyeCanvas[1], 0, 0);
      ctx.restore();
    } else if (isSbs()){
      // Two live pictures side by side for free-viewing. Each eye is drawn at half the view
      // width, then placed (optionally shrunk) left and right of the centre line.
      // Parallel: left picture is the left eye's view.  Cross-eyed: the two are swapped.
      const hw = Math.max(40, Math.floor(w / 2));
      for (let e = 0; e < 2; e++){
        let oc = _eyeCanvas[e];
        if (!oc) oc = _eyeCanvas[e] = document.createElement("canvas");
        const cw = Math.floor(hw * DPR), ch = canvas.height;
        if (oc.width !== cw || oc.height !== ch){ oc.width = cw; oc.height = ch; }
        const ox = oc.getContext("2d", { alpha:false });
        ox.setTransform(DPR,0,0,DPR,0,0);
        drawSceneToContext(ox, hw, h, makeProjector(hw, h, (e === 0 ? -1 : 1) * (sbs.depth / 2) * DEG, cam.panX / 2, cam.panY), o);
      }
      const k = clamp(sbs.size, 20, 100) / 100;
      const pw = Math.floor(hw * k), ph = Math.floor(h * k), gap = k < 1 ? 6 : 0;
      const top = Math.floor((h - ph) / 2);
      const leftImg = uiLook === "sbsx" ? _eyeCanvas[1] : _eyeCanvas[0];
      const rightImg = uiLook === "sbsx" ? _eyeCanvas[0] : _eyeCanvas[1];
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(leftImg,  w/2 - gap/2 - pw, top, pw, ph);
      ctx.drawImage(rightImg, w/2 + gap/2,      top, pw, ph);
      // divider + two fusion dots (line the dots up into three, the middle one is the 3D view)
      ctx.fillStyle = "#000"; ctx.fillRect(w/2 - Math.max(1, gap/2), top, Math.max(2, gap), ph);
      ctx.fillStyle = "#ffffff";
      for (const cx of [w/2 - gap/2 - pw/2, w/2 + gap/2 + pw/2]){
        ctx.beginPath(); ctx.arc(cx, top + 10, 3, 0, Math.PI*2); ctx.fill();
      }
    } else {
      drawSceneToContext(ctx, w, h, project, o);
    }
    drawConfetti(ctx);
  }

  // ---------- Touch orbit/zoom/pan ----------
  let pointers = new Map();
  let last = null;

  // Batch event-driven redraws so at most one draw() fires per display frame.
  let _rafPending = false;
  function scheduleRedraw(){
    if (!_rafPending){ _rafPending = true; requestAnimationFrame(() => { _rafPending = false; draw(); }); }
  }

  // Orbit momentum: velocity carries over after pointer release.
  let _velYaw = 0, _velPitch = 0, _momentumLive = false;
  function _momentumTick(){
    if (!_momentumLive) return;
    _velYaw  *= 0.88;
    _velPitch *= 0.88;
    cam.yaw   += _velYaw;
    cam.pitch  = clamp(cam.pitch + _velPitch, -1.35, 1.35);
    draw();
    if (Math.abs(_velYaw) > 2e-4 || Math.abs(_velPitch) > 2e-4)
      requestAnimationFrame(_momentumTick);
    else
      _momentumLive = false;
  }

  function getTouchInfo(){
    const pts = [...pointers.values()];
    if (pts.length === 0) return null;
    if (pts.length === 1) return { mode:"orbit", p: pts[0] };
    const p0 = pts[0], p1 = pts[1];
    const cx = (p0.x+p1.x)/2, cy=(p0.y+p1.y)/2;
    const dist = Math.hypot(p1.x-p0.x, p1.y-p0.y);
    return { mode:"pinch", cx, cy, dist };
  }

  canvas.addEventListener("pointerdown", (e)=>{
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    _momentumLive = false;
    _velYaw = 0; _velPitch = 0;
    last = getTouchInfo();
  });

  canvas.addEventListener("pointermove", (e)=>{
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    const now = getTouchInfo();
    if (!last || !now) { last = now; return; }

    if (now.mode==="orbit" && last.mode==="orbit"){
      const dx = now.p.x - last.p.x;
      const dy = now.p.y - last.p.y;
      _velYaw   = dx * 0.008;
      _velPitch = dy * 0.008;
      cam.yaw  += _velYaw;
      cam.pitch = clamp(cam.pitch + _velPitch, -1.35, 1.35);
    } else if (now.mode==="pinch" && last.mode==="pinch"){
      cam.dist = clamp(cam.dist - (now.dist-last.dist)*0.7, 60, CAM_MAX_DIST);
      cam.panX += (now.cx-last.cx);
      cam.panY += (now.cy-last.cy);
    }
    last = now;
    scheduleRedraw();
  });

  canvas.addEventListener("pointerup", (e)=>{
    pointers.delete(e.pointerId);
    last = getTouchInfo();
    if (Math.abs(_velYaw) > 2e-4 || Math.abs(_velPitch) > 2e-4){
      _momentumLive = true;
      requestAnimationFrame(_momentumTick);
    }
  });

  canvas.addEventListener("pointercancel", (e)=>{
    pointers.delete(e.pointerId);
    last = getTouchInfo();
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.dist = clamp(cam.dist + e.deltaY * 0.8, 60, CAM_MAX_DIST);
    scheduleRedraw();
  }, { passive: false });

  canvas.addEventListener("dblclick", () => { fitCamera(); draw(); });

  // Frame the whole drawing: aim the camera at its middle and back off until it fits.
  function fitCamera(){
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity,n=0;
    const grow = (p, r) => {
      n++;
      if (p.x-r<minX)minX=p.x-r; if (p.x+r>maxX)maxX=p.x+r;
      if (p.y-r<minY)minY=p.y-r; if (p.y+r>maxY)maxY=p.y+r;
      if (p.z-r<minZ)minZ=p.z-r; if (p.z+r>maxZ)maxZ=p.z+r;
    };
    for (const s of segments){
      if (s.sheet){ for (const p of [sub(s.a,s.sheet), add(s.a,s.sheet), add(s.b,s.sheet), sub(s.b,s.sheet)]) grow(p, 0); }
      else { grow(s.a, s.ball || 0); grow(s.b, s.ball || 0); }
    }
    for (const s of ghostSegs){ grow(s.a, 0); grow(s.b, 0); }
    cam.panX = 0; cam.panY = 0;
    if (!n){ cam.target = V(0,0,0); cam.dist = 420; return; }
    cam.target = V((minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2);
    const rad = Math.max(10, Math.hypot(maxX-minX, maxY-minY, maxZ-minZ) / 2);
    const viewW = (canvas.clientWidth || 600) / (isSbs() ? 2 : 1);
    const view = Math.max(120, Math.min(viewW, canvas.clientHeight || 600));
    cam.dist = clamp(rad * 600 / (0.62 * view) + rad * 0.5, 60, CAM_MAX_DIST);
  }

  // ---------- Turtle + vars + marks + procedures ----------
  function makeTurtle(){
    return { pos: V(0,0,0), R: I3(), penDown:true, color:"#ffffff", width:1.5, sheets:false, sheetW:0 };
  }
  let turtle = makeTurtle();

  // variables can be number OR string OR nested array from PICK
  const vars  = Object.create(null);
  const marks = Object.create(null);
  const procs = Object.create(null);

  function cloneTurtle(t){
    return {
      pos: V(t.pos.x, t.pos.y, t.pos.z),
      R: t.R.slice(0),
      penDown: !!t.penDown,
      color: String(t.color),
      width: +t.width,
      sheets: !!t.sheets,
      sheetW: +t.sheetW || 0
    };
  }

  // Run-time state used by the newer language features
  const repStack = [];            // REPCOUNT values of the enclosing REPEATs
  let timeNow = 0, frameNow = 0;  // TIME (seconds) and FRAME for animated programs
  let usesTime = false;           // set when a program reads TIME or FRAME -> it gets animated
  let tempoBpm = 120;             // TEMPO for NOTE / REST
  const sliderState = new Map();  // SLIDER name -> { min, max, value }
  let sliderSeen = [];            // sliders declared by the latest run, in order

  // ---------- Tokenizer / parser ----------
  // Returns an array of UPPERCASE token strings with two parallel arrays attached:
  //   tokens.lines[i] = 1-based source line,  tokens.raws[i] = the token as typed (for text).
  function tokenize(src){
    // normalize NBSP -> space (iPad paste fix)
    src = String(src).replace(/ /g, " ");

    const t0 = [], l0 = [], r0 = [];
    src.split("\n").forEach((line, li) => {
      const ci = line.indexOf(";");               // strip ; comments
      if (ci >= 0) line = line.slice(0, ci);
      line = line.replace(/#timeout\s*=\s*[0-9.]+/gi, ""); // remove #timeout directives
      // split into: [, ], or "anything not whitespace or brackets"
      const m = line.match(/\[|\]|[^\s\[\]]+/g) || [];
      for (const t of m){
        r0.push(t);
        t0.push(/^#[0-9a-fA-F]{3,8}$/.test(t) ? t : t.toUpperCase()); // uppercase except hex colors
        l0.push(li + 1);
      }
    });

    // Join arithmetic that was typed with spaces, so  fd 2 * :r / 72  works like  fd 2*:r/72.
    // A token is glued to the previous one when the previous ends with an operator / "(" / ","
    // or when it starts with * / ^ % ) , or is a lone + or -.  ("fd a -5" is left alone.)
    const endsOpen   = (t) => t !== "[" && t !== "]" && /[+\-*\/^%(,]$/.test(t);
    const startsJoin = (t) => t !== "[" && t !== "]" && (/^[*\/^%),]/.test(t) || t === "+" || t === "-");
    const toks = [], lines = [], raws = [];
    let textDepth = 0;            // inside PRINT [ ... ] / LABEL [ ... ]: leave the words alone
    for (let i = 0; i < t0.length; i++){
      const t = t0[i];
      if (textDepth > 0){
        if (t === "[") textDepth++; else if (t === "]") textDepth--;
        toks.push(t); lines.push(l0[i]); raws.push(r0[i]);
        continue;
      }
      if ((t0[i-1] === "PRINT" || t0[i-1] === "LABEL" || t0[i-1] === "SAY") && t === "["){
        textDepth = 1;
        toks.push(t); lines.push(l0[i]); raws.push(r0[i]);
        continue;
      }
      const prev = toks.length ? toks[toks.length-1] : null;
      if (prev !== null && prev !== "[" && prev !== "]" && t !== "[" && t !== "]" &&
          !/^#[0-9a-fA-F]{3,8}$/.test(t) && (endsOpen(prev) || startsJoin(t))){
        toks[toks.length-1] = prev + t;
        raws[raws.length-1] += r0[i];
        continue;
      }
      toks.push(t); lines.push(l0[i]); raws.push(r0[i]);
    }
    toks.lines = lines; toks.raws = raws;
    return toks;
  }
  function sliceTokens(tokens, a, b){
    const out = tokens.slice(a, b);
    out.lines = (tokens.lines || []).slice(a, b);
    out.raws  = (tokens.raws  || []).slice(a, b);
    return out;
  }
  function parseError(msg, tokens, i){
    const e = new Error(msg);
    const L = tokens && tokens.lines;
    if (L && L.length) e.line = L[Math.min(i, L.length-1)];
    return e;
  }

  function parseList(tokens, i){
    // nested lists supported; nested list is stored as an Array
    if (tokens[i] !== "[") throw parseError("Expected [", tokens, i);
    const start = i;
    i++;
    const items = [];
    while (i < tokens.length){
      const tok = tokens[i];
      if (tok === "]") return { items, next: i+1 };
      if (tok === "["){
        const inner = parseList(tokens, i);
        items.push(inner.items);
        i = inner.next;
        continue;
      }
      items.push(tok);
      i++;
    }
    throw parseError("This [ is never closed with a ]", tokens, start);
  }

  function parseValueToken(tokens, i){
    const tok = tokens[i];

    if (tok === "PICK"){
      if (tokens[i+1] !== "[") throw parseError("PICK must be followed by [ ... ]", tokens, i);
      const lst = parseList(tokens, i+1);
      return { value: { fn:"PICK", items: lst.items }, next: lst.next };
    }

    if (tok === "RANDOM"){
      const mx = tokens[i+1];
      if (mx == null) throw parseError("RANDOM needs a max", tokens, i);
      return { value: { fn:"RANDOM", max: mx }, next: i+2 };
    }

    return { value: tok, next: i+1 };
  }

  // Friendly long names -> the short command they mean.
  const ALIASES = {
    FORWARD:"FD", BACK:"BK", BACKWARD:"BK", LEFT:"LT", RIGHT:"RT",
    PENUP:"PU", PENDOWN:"PD", HIDETURTLE:"HT", SHOWTURTLE:"ST",
    SYM:"SYMMETRY", SPHERE3D:"BALL", SAY:"PRINT", BACKGROUND:"BG",
    ARCRIGHT:"AR", ARCLEFT:"AL", ARCUP:"AU", ARCDOWN:"AD"
  };
  // Commands added in cu16. If a program (or an earlier run) defines its own procedure with
  // one of these names, the procedure wins — so older scripts keep working unchanged.
  const NEW_KEYWORDS = new Set([
    "FORWARD","BACK","BACKWARD","LEFT","RIGHT","PENUP","PENDOWN","HIDETURTLE","SHOWTURTLE","HT","ST",
    "COLOR","SETPC","BG","BACKGROUND","HUE","BALL","SPHERE3D","LABEL","PRINT","SAY","NOTE","REST","TEMPO",
    "SYMMETRY","SYM","GLOW","GRID","FOR","WHILE","SLIDER"
  ]);
  const KNOWN_COMMANDS = [
    "FD","BK","LT","RT","UP","DN","RL","RR","AR","AL","AU","AD","PU","PD","HOME","CENTER","CS","CLEAR",
    "SC","SETCOLOR","COLOR","WIDTH","MAKE","REPEAT","RPT","IF","ELSE","TO","END","STOP","OMARK","GOTO","SP",
    "SHEETS","NONSHEETS","SHEETW","PICK","RANDOM","FORWARD","BACK","LEFT","RIGHT","PENUP","PENDOWN",
    "HT","ST","BG","HUE","BALL","LABEL","PRINT","NOTE","REST","TEMPO","SYMMETRY","GLOW","GRID","FOR","WHILE","SLIDER"
  ];

  // arities = map of procedure name → number of colon-params it declares.
  // Collected in a pre-pass so call sites know how many tokens to consume as arguments.
  function parseBlock(tokens, i, arities = Object.create(null)){
    const block = [];
    const L = tokens.lines || [];
    const put = (ins, at) => { ins.line = L[at] || 0; block.push(ins); };
    while (i < tokens.length){
      let tok = tokens[i];
      const at = i;
      if (tok === "]") return { block, next: i+1 };

      // A user procedure named like a cu16 command takes priority over the command.
      const shadowed = NEW_KEYWORDS.has(tok) && (arities[tok] !== undefined || procs[tok]);
      if (!shadowed && ALIASES[tok]) tok = ALIASES[tok];

      // TO <name> [:param ...] ... END
      if (tok === "TO"){
        const name = tokens[i+1];
        if (!name) throw parseError("TO needs a procedure name", tokens, i);
        let j = i+2;
        const params = [];
        while (j < tokens.length && String(tokens[j]).startsWith(":")) {
          params.push(String(tokens[j]).slice(1).toUpperCase());
          j++;
        }
        const bodyStart = j;
        while (j < tokens.length && tokens[j] !== "END") j++;
        if (j >= tokens.length) throw parseError("TO " + name + " is missing END", tokens, i);
        const inner = parseBlock(sliceTokens(tokens, bodyStart, j), 0, arities);
        put({ op:"PROCDEF", name: String(name).toUpperCase(), params, body: inner.block }, at);
        i = j + 1;
        continue;
      }

      // REPEAT/RPT n [ ... ]
      if (tok === "REPEAT" || tok === "RPT"){
        const countTok = tokens[i+1];
        if (countTok == null) throw parseError(tok + " needs a count", tokens, i);
        if (tokens[i+2] !== "[") throw parseError(tok + " must be followed by [ ... ]", tokens, i);
        const inner = parseBlock(tokens, i+3, arities);
        put({ op:"REPEAT", count: countTok, body: inner.block }, at);
        i = inner.next;
        continue;
      }

      // FOR var from to [ ... ]   (counts up or down by 1, both ends included)
      if (tok === "FOR" && !shadowed){
        const name = tokens[i+1], a = tokens[i+2], b = tokens[i+3];
        if (name == null || a == null || b == null || tokens[i+4] !== "[")
          throw parseError("FOR looks like:  FOR I 1 10 [ ... ]", tokens, i);
        const inner = parseBlock(tokens, i+5, arities);
        put({ op:"FOR", name: String(name).replace(/^[:"]/, "").toUpperCase(), from: a, to: b, body: inner.block }, at);
        i = inner.next;
        continue;
      }

      // IF <cond...> [ ... ] (ELSE [ ... ])?      WHILE <cond...> [ ... ]
      if (tok === "IF" || (tok === "WHILE" && !shadowed)){
        let j = i+1;
        const cond = [];
        while (j < tokens.length && tokens[j] !== "[") { cond.push(tokens[j]); j++; }
        if (tokens[j] !== "[") throw parseError(tok + " missing [ ... ]", tokens, i);
        const thenInner = parseBlock(tokens, j+1, arities);
        let k = thenInner.next;
        if (tok === "WHILE"){
          put({ op:"WHILE", cond, body: thenInner.block }, at);
          i = k;
          continue;
        }
        let elseBody = null;
        if (tokens[k] === "ELSE"){
          if (tokens[k+1] !== "[") throw parseError("ELSE must be followed by [ ... ]", tokens, k);
          const elseInner = parseBlock(tokens, k+2, arities);
          elseBody = elseInner.block;
          k = elseInner.next;
        }
        put({ op:"IF", cond, thenBody: thenInner.block, elseBody }, at);
        i = k;
        continue;
      }

      // SC value  OR  SC [r g b]     (COLOR / SETPC are the same thing; BG sets the background)
      if (tok === "SC" || tok === "SETCOLOR" || (!shadowed && (tok === "COLOR" || tok === "SETPC" || tok === "BG"))){
        const op = tok === "BG" ? "BG" : "SC";
        const n1 = tokens[i+1];
        if (n1 == null) throw parseError(tok + " needs a color", tokens, i);

        if (n1 === "["){
          const lst = parseList(tokens, i+1);
          put({ op, value: lst.items }, at);
          i = lst.next;
          continue;
        }
        const pv = parseValueToken(tokens, i+1);
        put({ op, value: pv.value }, at);
        i = pv.next;
        continue;
      }

      // MAKE A=...  or MAKE A ...   (also accepted: MAKE A = ...,  MAKE "A ...)
      if (tok === "MAKE"){
        let a1 = tokens[i+1];
        if (!a1) throw parseError("MAKE needs a variable", tokens, i);
        a1 = String(a1).replace(/^[":]/, "");
        const eq = a1.indexOf("=");
        if (eq >= 0 && eq < a1.length-1){
          put({ op:"MAKE", a1 }, at);
          i += 2;
          continue;
        }
        let vi = i+2;
        if (eq >= 0) a1 = a1.slice(0, eq);                    // "A=" then the value
        else if (tokens[vi] === "=") vi++;                     // "A" "=" value
        let pv;
        if (tokens[vi] != null && /^=./.test(tokens[vi])) pv = { value: tokens[vi].slice(1), next: vi+1 }; // "A" "=5"
        else pv = parseValueToken(tokens, vi);
        if (pv.value == null) throw parseError("MAKE " + a1 + " needs a value", tokens, i);
        put({ op:"MAKE", a1, a2: pv.value }, at);
        i = pv.next;
        continue;
      }

      // no-arg ops
      if (["PU","PD","HOME","CENTER","CS","CLEAR","STOP"].includes(tok) ||
          (!shadowed && ["HT","ST","REST"].includes(tok))){
        put({ op: tok }, at);
        i += 1;
        continue;
      }

      // SHEETS / NONSHEETS (plane mode on / off) — aliases accepted
      if (["SHEETS","SHEET"].includes(tok)){ put({ op:"SHEETS" }, at); i += 1; continue; }
      if (["NONSHEETS","NONSHEET","NOSHEETS","NOSHEET"].includes(tok)){
        put({ op:"NONSHEETS" }, at);
        i += 1;
        continue;
      }

      // PRINT / LABEL: a [ list of words ] (kept as typed) or a single value
      if (!shadowed && (tok === "PRINT" || tok === "LABEL")){
        if (tokens[i+1] === "["){
          const R = tokens.raws || tokens;
          let depth = 1, j = i+2;
          const words = [];
          while (j < tokens.length && depth > 0){
            if (tokens[j] === "[") depth++;
            else if (tokens[j] === "]"){ depth--; if (!depth) break; }
            words.push(R[j]);
            j++;
          }
          if (depth) throw parseError("This [ is never closed with a ]", tokens, i+1);
          put({ op: tok, words }, at);
          i = j + 1;
          continue;
        }
        const pv = parseValueToken(tokens, i+1);
        if (pv.value == null) throw parseError(tok + " needs something to show", tokens, i);
        put({ op: tok, arg: pv.value, raw: (tokens.raws || tokens)[i+1] }, at);
        i = pv.next;
        continue;
      }

      // SLIDER name min max start
      if (tok === "SLIDER" && !shadowed){
        const name = tokens[i+1], mn = tokens[i+2], mx = tokens[i+3], st = tokens[i+4];
        if (name == null || mn == null || mx == null || st == null)
          throw parseError("SLIDER looks like:  SLIDER SIZE 10 200 80   (name, smallest, biggest, start)", tokens, i);
        put({ op:"SLIDER", name: String(name).replace(/^[:"]/, "").toUpperCase(), min: mn, max: mx, start: st }, at);
        i += 5;
        continue;
      }

      // one-arg ops (value token allowed)
      const oneArgOps = ["FD","BK","LT","RT","UP","DN","RL","RR","WIDTH","OMARK","GOTO","PAUSE","SLY","SP","SHEETW"];
      const newOneArgOps = ["BALL","HUE","SYMMETRY","GLOW","GRID","NOTE","TEMPO"];
      if (oneArgOps.includes(tok) || (!shadowed && newOneArgOps.includes(tok))){
        const pv = parseValueToken(tokens, i+1);
        if (pv.value == null || pv.value === "]") throw parseError(tokens[i] + " needs a number after it", tokens, i);
        put({ op: tok, arg: pv.value }, at);
        i = pv.next;
        continue;
      }

      // two-arg arc ops (ARCRIGHT/ARCLEFT/ARCUP/ARCDOWN are long-form aliases)
      if (["AR","AL","AU","AD"].includes(tok)){
        const a1 = tokens[i+1], a2 = tokens[i+2];
        if (a1 == null || a2 == null) throw parseError(tokens[i] + " needs 2 args (angle radius)", tokens, i);
        put({ op: tok, a1, a2 }, at);
        i += 3;
        continue;
      }

      // IMPORT <lib> (ignore)
      if (tok === "IMPORT"){
        i += 2;
        continue;
      }

      // fallback: procedure call — consume as many tokens as the procedure declares params
      {
        const callName = String(tokens[i]).toUpperCase();
        const arity = arities[callName] !== undefined ? arities[callName]
                    : (procs[callName] && procs[callName].params ? procs[callName].params.length : 0);
        const args = [];
        for (let k = 0; k < arity; k++) args.push(tokens[i + 1 + k]);
        put({ op:"CALL", name: callName, args }, at);
        i += 1 + arity;
      }
    }
    return { block, next: i };
  }

  function parseProgram(src){
    const tokens = tokenize(src);
    // Pre-pass: collect each procedure's parameter count so call sites consume the right
    // number of argument tokens.
    const arities = Object.create(null);
    for (let i = 0; i < tokens.length; i++){
      if (tokens[i] === "TO" && i + 1 < tokens.length){
        const name = String(tokens[i+1]).toUpperCase();
        let j = i+2, arity = 0;
        while (j < tokens.length && String(tokens[j]).startsWith(":")) { arity++; j++; }
        arities[name] = arity;
      }
    }
    return parseBlock(tokens, 0, arities).block;
  }

  // ---------- Numeric expression evaluator ----------
  // Supports + - * / % ^, parentheses, variables, and functions (angles in degrees):
  //   SIN COS TAN ASIN ACOS ATAN SQRT ABS INT ROUND FLOOR CEIL SIGN MIN MAX MOD POW RANDOM
  // plus the built-in values PI, TIME, FRAME and REPCOUNT.
  // Each distinct expression is compiled once and cached (animated programs re-run every frame).
  const FUNCS = {
    SIN:(a)=>Math.sin(a*DEG), COS:(a)=>Math.cos(a*DEG), TAN:(a)=>Math.tan(a*DEG),
    ASIN:(a)=>Math.asin(a)/DEG, ACOS:(a)=>Math.acos(a)/DEG,
    ATAN:(a,b)=> b === undefined ? Math.atan(a)/DEG : Math.atan2(a,b)/DEG,
    SQRT:(a)=>Math.sqrt(a), ABS:(a)=>Math.abs(a), INT:(a)=>Math.trunc(a), ROUND:(a)=>Math.round(a),
    FLOOR:(a)=>Math.floor(a), CEIL:(a)=>Math.ceil(a), SIGN:(a)=>Math.sign(a),
    MIN:(...a)=>Math.min(...a), MAX:(...a)=>Math.max(...a),
    MOD:(a,b)=>((a % b) + b) % b, POW:(a,b)=>Math.pow(a,b), POWER:(a,b)=>Math.pow(a,b),
    RANDOM:(a)=>Math.floor(rnd() * (a || 1)), RND:(a)=>Math.floor(rnd() * (a || 1))
  };
  function builtinValue(name){
    switch(name){
      case "PI": return Math.PI;
      case "TIME": usesTime = true; return timeNow;
      case "FRAME": usesTime = true; return frameNow;
      case "REPCOUNT": return repStack.length ? repStack[repStack.length-1] : 0;
    }
    return undefined;
  }
  function getVarNumber(name){
    const v = vars[name];
    if (v != null){
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error("Variable not numeric: " + name);
      return n;
    }
    const b = builtinValue(name);
    if (b !== undefined) return b;
    throw new Error("Unknown variable: " + name + suggestFor(name, Object.keys(vars)));
  }

  const _exprCache = new Map();
  function compileExpr(src){
    const tokens = [];
    const re = /\s*([A-Z_][A-Z0-9_]*|\d+(?:\.\d+)?|\.\d+|[()+\-*\/^%,])\s*/g;
    let m;
    while ((m = re.exec(src)) !== null) tokens.push(m[1]);
    if (tokens.length === 0) throw new Error("Empty expression");
    let p = 0;
    const bad = () => new Error("Bad expression: " + src);

    function parseAdd(){
      let left = parseMul();
      while (tokens[p] === "+" || tokens[p] === "-"){
        const op = tokens[p++], l = left, r = parseMul();
        left = op === "+" ? () => l() + r() : () => l() - r();
      }
      return left;
    }
    function parseMul(){
      let left = parseUnary();
      while (tokens[p] === "*" || tokens[p] === "/" || tokens[p] === "%"){
        const op = tokens[p++], l = left, r = parseUnary();
        left = op === "*" ? () => l() * r() : op === "/" ? () => l() / r() : () => l() % r();
      }
      return left;
    }
    function parseUnary(){
      if (tokens[p] === "-"){ p++; const v = parseUnary(); return () => -v(); }
      if (tokens[p] === "+"){ p++; return parseUnary(); }
      return parsePow();
    }
    function parsePow(){
      const base = parseAtom();
      if (tokens[p] === "^"){ p++; const ex = parseUnary(); return () => Math.pow(base(), ex()); }
      return base;
    }
    function parseAtom(){
      const t = tokens[p];
      if (t === undefined) throw bad();
      if (/^\d/.test(t) || /^\.\d/.test(t)){ p++; const n = Number(t); return () => n; }
      if (t === "("){
        p++;
        const v = parseAdd();
        if (tokens[p] !== ")") throw new Error("Mismatched parentheses in " + src);
        p++;
        return v;
      }
      if (/^[A-Z_]/.test(t)){
        p++;
        if (tokens[p] === "(" && FUNCS[t]){
          p++;
          const args = [];
          if (tokens[p] !== ")"){
            args.push(parseAdd());
            while (tokens[p] === ","){ p++; args.push(parseAdd()); }
          }
          if (tokens[p] !== ")") throw new Error("Mismatched parentheses in " + src);
          p++;
          const fn = FUNCS[t];
          return () => fn(...args.map(a => a()));
        }
        return () => getVarNumber(t);
      }
      if (t === ")") throw new Error("Mismatched parentheses in " + src);
      throw bad();
    }

    const root = parseAdd();
    if (p < tokens.length){
      if (tokens[p] === ")" ) throw new Error("Mismatched parentheses in " + src);
      throw bad();
    }
    return root;
  }
  function evalExpr(expr){
    // Normalise colon-prefixed variables (:name → name) before lexing.
    const key = String(expr).trim().toUpperCase().replace(/:[A-Z_][A-Z0-9_]*/g, s => s.slice(1));
    let fn = _exprCache.get(key);
    if (!fn){
      fn = compileExpr(key);
      if (_exprCache.size > 5000) _exprCache.clear();
      _exprCache.set(key, fn);
    }
    return fn();
  }

  // resolveAny: returns number/string/array
  function resolveAny(tok){
    if (tok && typeof tok === "object" && !Array.isArray(tok)){
      if (tok.fn === "RANDOM"){
        const mx = resolveNumber(tok.max);
        return Math.floor(rnd() * (mx || 1));
      }
      if (tok.fn === "PICK"){
        const items = tok.items || [];
        if (!items.length) throw new Error("PICK [] is empty");
        const idx = Math.floor(rnd() * items.length);
        return items[idx]; // may be string or nested list
      }
    }

    if (Array.isArray(tok)) return tok;
    if (typeof tok === "number") return tok;

    tok = String(tok).trim().toUpperCase();
    if (tok.startsWith(":")) tok = tok.slice(1); // colon-variable: :name → name

    if (tok === "GC" || tok === "GETCOLOR") return turtle.color;

    // direct variable lookup
    if (/^[A-Z_][A-Z0-9_]*$/.test(tok) && vars[tok] != null) return vars[tok];

    // numeric literal?
    if (/^-?\d+(\.\d+)?$/.test(tok) || /^-?\.\d+$/.test(tok)) return Number(tok);

    // otherwise treat as numeric expression (will error if not numeric)
    return evalExpr(tok);
  }

  function resolveNumber(tok){
    const v = resolveAny(tok);
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("Expected number, got: " + String(v));
    return n;
  }

  // Evaluate an IF / WHILE condition token array.
  // Handles:  CC=1 | :D=0 | CC GT 5 | A > 5 | A<=B | A != 3 | NOT A=1 | A>1 AND B<5 | A=1 OR A=2
  const _CMP = {
    GT:(a,b)=>a>b, LT:(a,b)=>a<b, GE:(a,b)=>a>=b, LE:(a,b)=>a<=b,
    EQ:(a,b)=>a===b, NE:(a,b)=>a!==b, NEQ:(a,b)=>a!==b,
    ">":(a,b)=>a>b, "<":(a,b)=>a<b, ">=":(a,b)=>a>=b, "<=":(a,b)=>a<=b,
    "=":(a,b)=>a===b, "==":(a,b)=>a===b, "!=":(a,b)=>a!==b, "<>":(a,b)=>a!==b
  };
  function evalClause(toks){
    let neg = false;
    while (toks.length && toks[0] === "NOT"){ neg = !neg; toks = toks.slice(1); }
    let res;
    if (!toks.length) res = false;
    else {
      const wi = toks.findIndex((t, k) => k > 0 && k < toks.length-1 && /^(GT|LT|GE|LE|EQ|NE|NEQ)$/.test(t));
      if (wi > 0){
        try { res = _CMP[toks[wi]](resolveNumber(toks.slice(0, wi).join("")), resolveNumber(toks.slice(wi+1).join(""))); }
        catch(e){ res = false; }
      } else {
        const joined = toks.join("");
        const m = /^(.+?)(>=|<=|<>|!=|==|=|>|<)(.+)$/.exec(joined);
        if (m){
          try { res = _CMP[m[2]](resolveNumber(m[1]), resolveNumber(m[3])); }
          catch(e){ res = false; }
        } else if (toks.length === 1){
          try { res = resolveNumber(toks[0]) !== 0; } catch(e){ res = false; }
        } else res = true; // unrecognised form — default truthy (preserves old behaviour)
      }
    }
    return neg ? !res : res;
  }
  function evalCondition(cond){
    if (!cond || cond.length === 0) return false;
    const toks = cond.map(t => String(t).toUpperCase());
    const split = (arr, word) => {
      const out = [[]];
      for (const t of arr){ if (t === word) out.push([]); else out[out.length-1].push(t); }
      return out;
    };
    return split(toks, "OR").some(group => split(group, "AND").every(evalClause));
  }

  function hueToRgb(h){
    h = ((h % 360) + 360) % 360;
    const c = 1, x = 1 - Math.abs((h / 60) % 2 - 1);
    let r = 0, g = 0, b = 0;
    if (h < 60){ r = c; g = x; } else if (h < 120){ r = x; g = c; } else if (h < 180){ g = c; b = x; }
    else if (h < 240){ g = x; b = c; } else if (h < 300){ r = x; b = c; } else { r = c; b = x; }
    return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
  }

  const NAMED_COLORS = {
    WHITE:"#ffffff", BLACK:"#000000",
    RED:"#ff3b30", ORANGE:"#ff9f0a", YELLOW:"#ffd60a",
    GREEN:"#34c759", BLUE:"#0a84ff", PURPLE:"#bf5af2",
    MAGENTA:"#ff2d55", CYAN:"#64d2ff", PINK:"#ff2d55", GRAY:"#8e8e93"
  };

  // IMPORTANT: handle RC and named colors WITHOUT numeric eval
  function colorFromValue(val){
    // If it's a PICK/RANDOM object, resolve to an item (string or nested list)
    if (val && typeof val === "object" && !Array.isArray(val)) {
      val = resolveAny(val);
    }

    // list -> rgb (0..99 scale)
    if (Array.isArray(val)){
      const r = clamp(Number(resolveNumber(val[0])), 0, 99);
      const g = clamp(Number(resolveNumber(val[1])), 0, 99);
      const b = clamp(Number(resolveNumber(val[2])), 0, 99);
      return `rgb(${Math.round(r/99*255)},${Math.round(g/99*255)},${Math.round(b/99*255)})`;
    }

    const tok = String(val).trim();
    const up = tok.toUpperCase();

    if (up === "RC"){
      const rr = Math.floor(rnd()*256);
      const gg = Math.floor(rnd()*256);
      const bb = Math.floor(rnd()*256);
      return `rgb(${rr},${gg},${bb})`;
    }

    if (/^#[0-9A-F]{3,8}$/i.test(tok)) return tok;
    if (/^rgb\(/i.test(tok)) return tok;

    if (NAMED_COLORS[up]) return NAMED_COLORS[up];

    // Variable holding a color (string or list)
    if (/^[A-Z_][A-Z0-9_]*$/.test(up) && vars[up] != null){
      return colorFromValue(vars[up]);
    }

    // raw CSS fallback
    return tok;
  }

  // "Did you mean …?" helper for typos.
  function editDistance(a, b){
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 9;
    let prev = Array.from({ length: n+1 }, (_, j) => j);
    for (let i = 1; i <= m; i++){
      const cur = [i];
      for (let j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function suggestFor(word, candidates){
    word = String(word).toUpperCase();
    let best = null, bestD = 3;
    for (const c of candidates){
      if (c === word) continue;
      const d = editDistance(word, c);
      const limit = Math.min(2, Math.max(1, Math.floor(Math.max(word.length, c.length) / 3)));
      if (d <= limit && d < bestD){ best = c; bestD = d; }
    }
    return best ? "  — did you mean " + best + "?" : "";
  }

  // NOTE values: a MIDI number (60 = middle C) or a note name like C4, F#4, BB3.
  function noteToFreq(tok){
    let midi = null;
    const s = String(tok).toUpperCase();
    const m = /^([A-G])([#B]?)(-?\d)$/.exec(s);
    if (m && vars[s] == null){
      const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[m[1]];
      midi = base + (m[2] === "#" ? 1 : m[2] === "B" ? -1 : 0) + (Number(m[3]) + 1) * 12;
    } else midi = resolveNumber(tok);
    midi = clamp(midi, 0, 127);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function fmtNumber(n){ return String(+Number(n).toFixed(4)); }
  function textFromIns(ins){
    if (ins.words){
      return ins.words.map(w => {
        if (/^:[A-Za-z_]/.test(w)){
          const v = vars[w.slice(1).toUpperCase()];
          if (v != null) return typeof v === "number" ? fmtNumber(v) : String(v);
        }
        return w;
      }).join(" ");
    }
    try {
      const v = resolveAny(ins.arg);
      return typeof v === "number" ? fmtNumber(v) : String(v);
    } catch(e){ return String(ins.raw != null ? ins.raw : ins.arg); }
  }

  // ---------- SP helper: closest ray-segment ----------
  function closestRaySegment(o, d, a, b) {
    const ab = sub(b, a);
    const ao = sub(o, a);

    const dd = d.x*d.x + d.y*d.y + d.z*d.z;
    const ab2 = ab.x*ab.x + ab.y*ab.y + ab.z*ab.z;
    if (ab2 < 1e-12) return null;

    const dab = d.x*ab.x + d.y*ab.y + d.z*ab.z;
    const dao = d.x*ao.x + d.y*ao.y + d.z*ao.z;
    const abo = ab.x*ao.x + ab.y*ao.y + ab.z*ao.z;

    const denom = dd*ab2 - dab*dab;

    let t, u;

    if (Math.abs(denom) < 1e-12) {
      u = clamp(-abo / ab2, 0, 1);
      const ps = add(a, mul(ab, u));
      const op = sub(ps, o);
      t = Math.max(0, (op.x*d.x + op.y*d.y + op.z*d.z) / dd);
    } else {
      t = (dab*abo - ab2*dao) / denom;
      u = (dd*abo - dab*dao) / denom;

      if (t < 0) t = 0;
      u = clamp(u, 0, 1);

      const ps = add(a, mul(ab, u));
      const op = sub(ps, o);
      t = Math.max(0, (op.x*d.x + op.y*d.y + op.z*d.z) / dd);
    }

    const pr = add(o, mul(d, t));
    const ps = add(a, mul(ab, u));
    const dx = pr.x-ps.x, dy = pr.y-ps.y, dz = pr.z-ps.z;
    const dist2 = dx*dx + dy*dy + dz*dz;

    return { t, dist2, ps };
  }

  // ---------- Interpreter ----------
  function execBlock(block, safety){
    for (const ins of block){
      if (--safety.stepsLeft <= 0) throw new Error("Stopped: too many steps (infinite loop?)");
      curLine = ins.line;

      switch(ins.op){
        case "PROCDEF":
          procs[ins.name] = { body: ins.body, params: ins.params || [] };
          break;

        case "CALL": {
          const procDef = procs[ins.name];
          if (!procDef) throw new Error("Unknown procedure: " + ins.name +
            suggestFor(ins.name, KNOWN_COMMANDS.concat(Object.keys(procs))));
          // Support both new {body,params} format and legacy plain-array format.
          const body   = Array.isArray(procDef) ? procDef : procDef.body;
          const params = Array.isArray(procDef) ? []      : (procDef.params || []);
          const callArgs = ins.args || [];
          // Bind colon-params as local variables, saving any shadowed globals.
          // (All arguments are worked out first, so "t :b :a" swaps correctly.)
          const vals = params.map((p, k) => k < callArgs.length && callArgs[k] !== undefined ? resolveAny(callArgs[k]) : undefined);
          const saved = {};
          for (let k = 0; k < params.length; k++){
            saved[params[k]] = vars[params[k]];
            vars[params[k]] = vals[k];
          }
          if ((safety.depth = (safety.depth || 0) + 1) > 20000)
            throw new Error("Stopped: " + ins.name + " keeps calling itself (add an IF ... [STOP])");
          try { execBlock(body, safety); }
          catch(e){ if (e !== _STOP) throw e; } // STOP = normal procedure exit
          finally {
            safety.depth--;
            for (const p of params){
              if (saved[p] === undefined) delete vars[p]; else vars[p] = saved[p];
            }
          }
          break;
        }

        case "STOP":
          throw _STOP;

        case "IF": {
          const ok = evalCondition(ins.cond);
          if (ok) execBlock(ins.thenBody, safety);
          else if (ins.elseBody) execBlock(ins.elseBody, safety);
          break;
        }

        case "WHILE":
          while (evalCondition(ins.cond)){
            if (--safety.stepsLeft <= 0) throw new Error("Stopped: too many steps (infinite loop?)");
            execBlock(ins.body, safety);
          }
          break;

        case "FOR": {
          const a = resolveNumber(ins.from), b = resolveNumber(ins.to);
          const dir = b >= a ? 1 : -1;
          for (let v = a; dir > 0 ? v <= b + 1e-9 : v >= b - 1e-9; v += dir){
            if (--safety.stepsLeft <= 0) throw new Error("Stopped: too many steps (infinite loop?)");
            vars[ins.name] = v;
            execBlock(ins.body, safety);
          }
          break;
        }

        case "CS":
        case "CLEAR":
          clearSegments();
          break;

        case "HOME":
        case "CENTER":
          turtle = makeTurtle();
          cam.panX = 0; cam.panY = 0;
          break;

        case "PU":
          turtle.penDown = false;
          break;

        case "PD":
          turtle.penDown = true;
          break;

        case "HT": scene.showTurtle = false; break;
        case "ST": scene.showTurtle = true; break;

        case "SC":
          turtle.color = colorFromValue(ins.value);
          break;

        case "BG":
          scene.bg = colorFromValue(ins.value);
          break;

        case "HUE":
          turtle.color = hueToRgb(resolveNumber(ins.arg));
          break;

        case "GLOW": scene.glow = resolveNumber(ins.arg) !== 0; break;
        case "GRID": scene.grid = resolveNumber(ins.arg) !== 0; break;

        case "SYMMETRY":
          symN = clamp(Math.round(resolveNumber(ins.arg)), 1, 64);
          break;

        case "BALL": {
          const r = resolveNumber(ins.arg);
          if (r > 0) pushSeg({ a: turtle.pos, b: turtle.pos, color: turtle.color, width: turtle.width, isSnapSpoke:false, ball: r });
          break;
        }

        case "LABEL":
          pushSeg({ a: turtle.pos, b: turtle.pos, color: turtle.color, width: turtle.width, isSnapSpoke:false, label: textFromIns(ins) });
          break;

        case "PRINT":
          if (events.length < 5000) events.push({ step: stepCounter, type:"print", text: textFromIns(ins) });
          break;

        case "TEMPO":
          tempoBpm = clamp(resolveNumber(ins.arg), 20, 960);
          break;

        case "NOTE":
          if (events.length < 5000) events.push({ step: stepCounter, type:"note", freq: noteToFreq(ins.arg), dur: 60 / tempoBpm });
          break;

        case "REST":
          if (events.length < 5000) events.push({ step: stepCounter, type:"rest", dur: 60 / tempoBpm });
          break;

        case "SLIDER": {
          const mn = resolveNumber(ins.min), mx = resolveNumber(ins.max);
          const lo = Math.min(mn, mx), hi = Math.max(mn, mx);
          let st = sliderState.get(ins.name);
          if (!st || st.min !== lo || st.max !== hi){
            st = { min: lo, max: hi, value: clamp(resolveNumber(ins.start), lo, hi) };
            sliderState.set(ins.name, st);
          }
          if (!sliderSeen.includes(ins.name)) sliderSeen.push(ins.name);
          vars[ins.name] = st.value;
          break;
        }

        case "SHEETS":
          turtle.sheets = true;
          break;

        case "NONSHEETS":
          turtle.sheets = false;
          break;

        case "SHEETW": {
          const w = resolveNumber(ins.arg);
          if (!Number.isFinite(w) || w < 0) throw new Error("SHEETW needs a width >= 0 (0 = square sheets)");
          turtle.sheetW = w;
          break;
        }

        case "WIDTH": {
          const w = resolveNumber(ins.arg);
          if (Number.isFinite(w) && w > 0) turtle.width = w;
          break;
        }

        case "MAKE": {
          const a1 = String(ins.a1).toUpperCase();
          let name, rhs;
          if (a1.includes("=")){
            const eq = a1.indexOf("=");
            name = a1.slice(0, eq); rhs = a1.slice(eq + 1);
            if (!name || rhs === "") throw new Error("Bad MAKE syntax: " + a1);
          } else {
            name = a1; rhs = ins.a2;
          }
          // a color word can be stored in a variable:  make c red   ...   sc c
          if (typeof rhs === "string" && (NAMED_COLORS[rhs] || rhs === "RC") && vars[rhs] == null) vars[name] = rhs;
          else vars[name] = resolveAny(rhs);
          break;
        }

        case "OMARK": {
          const key = String(ins.arg).toUpperCase();
          marks[key] = cloneTurtle(turtle);
          break;
        }

        case "GOTO": {
          const key = String(ins.arg).toUpperCase();
          const m = marks[key];
          if (!m) throw new Error("No mark named: " + key + suggestFor(key, Object.keys(marks)));
          turtle = cloneTurtle(m);
          break;
        }

        case "FD":
        case "BK": {
          const dist = resolveNumber(ins.arg);
          const fwd = basisForward(turtle.R);
          const step = mul(fwd, ins.op==="FD" ? dist : -dist);

          const a = turtle.pos;
          const b = add(turtle.pos, step);
          turtle.pos = b;

          if (turtle.penDown){
            if (turtle.sheets){
              const w = turtle.sheetW > 0 ? turtle.sheetW : Math.abs(dist); // default: square sheet
              addSheetSegment(a, b, turtle.color, turtle.width, mul(basisRight(turtle.R), w/2));
            } else addDrawnSegment(a, b, turtle.color, turtle.width);
          }
          break;
        }

        case "LT":
        case "RT": {
          const deg = resolveNumber(ins.arg);
          const rad = (ins.op==="LT" ? deg : -deg) * DEG;
          turtle.R = matMul(rotAxis(basisUp(turtle.R), rad), turtle.R);
          break;
        }

        case "UP":
        case "DN": {
          const deg = resolveNumber(ins.arg);
          const rad = (ins.op==="UP" ? deg : -deg) * DEG;
          turtle.R = matMul(rotAxis(basisRight(turtle.R), rad), turtle.R);
          break;
        }

        case "RL":
        case "RR": {
          const deg = resolveNumber(ins.arg);
          const rad = (ins.op==="RL" ? deg : -deg) * DEG;
          turtle.R = matMul(rotAxis(basisForward(turtle.R), rad), turtle.R);
          break;
        }

        case "AR":
        case "AL":
        case "AU":
        case "AD": {
          const ang = resolveNumber(ins.a1);
          const radius = Math.max(0.0001, resolveNumber(ins.a2));
          const steps = Math.max(8, Math.ceil(Math.abs(ang) / ARC_STEP_DEG));
          const stepAng = ang / steps;

          const isYaw = (ins.op === "AR" || ins.op === "AL");
          const axisFn = isYaw ? basisUp : basisRight;

          const neg = (ins.op === "AR" || ins.op === "AD");

          for (let k=0;k<steps;k++){
            const turnRad = (neg ? -stepAng : stepAng) * DEG;
            turtle.R = matMul(rotAxis(axisFn(turtle.R), turnRad), turtle.R);

            const arcLen = (Math.abs(stepAng) * DEG) * radius;
            const fwd = basisForward(turtle.R);
            const a = turtle.pos;
            const b = add(turtle.pos, mul(fwd, arcLen));
            turtle.pos = b;

            if (turtle.penDown){
              if (turtle.sheets){
                // arcs become a curved ribbon; width = SHEETW, or the arc radius if SHEETW is 0
                const w = turtle.sheetW > 0 ? turtle.sheetW : radius;
                addSheetSegment(a, b, turtle.color, turtle.width, mul(basisRight(turtle.R), w/2));
              } else addDrawnSegment(a, b, turtle.color, turtle.width);
            }
          }
          break;
        }

        case "SP": {
          const maxDist = resolveNumber(ins.arg);

          const o = turtle.pos;
          const d = basisForward(turtle.R);

          const tol = Math.max(1.5, (turtle.width || 1) * 0.75);
          const tol2 = tol * tol;

          let bestT = Infinity;
          let bestHit = null;

          for (const s of segments) {
            if (s.isSnapSpoke) continue;
            const hit = closestRaySegment(o, d, s.a, s.b);
            if (!hit) continue;
            if (hit.t <= 0 || hit.t > maxDist) continue;
            if (hit.dist2 > tol2) continue;

            if (hit.t < bestT) {
              bestT = hit.t;
              bestHit = hit.ps;
            }
          }

          if (bestHit) {
            if (turtle.penDown) addSnapSpokeSegment(o, bestHit, turtle.color, turtle.width);
            turtle.pos = V(bestHit.x, bestHit.y, bestHit.z);
          }
          break;
        }

        case "REPEAT": {
          const n = Math.floor(resolveNumber(ins.count));
          if (!Number.isFinite(n) || n < 0) throw new Error("REPEAT count must be >= 0");
          repStack.push(0);
          try {
            for (let k=0;k<n;k++){ repStack[repStack.length-1] = k+1; execBlock(ins.body, safety); }
          } finally { repStack.pop(); }
          break;
        }

        case "PAUSE":
        case "SLY":
          break;

        default:
          throw new Error("Unhandled op: " + ins.op);
      }
    }
  }

  // ---------- Running programs ----------
  let srcLines = [];
  let lastRunMs = 0;
  const play = { active:false, paused:false, pos:0, total:0, acc:0, evIdx:0 };   // Watch playback
  const anim = { active:false, ast:null, t0:0, frame:0 };                        // TIME animation

  function wipe(obj){ for (const k in obj) delete obj[k]; }
  function resetWorld(){
    clearSegments();
    turtle = makeTurtle();
    wipe(vars); wipe(marks); wipe(procs);
  }

  // Parse + execute. Returns null on success or the Error (with .line set) on failure.
  function execSource(src, ast){
    symN = 1; scene = defaultScene(); repStack.length = 0; curLine = 0; tempoBpm = 120;
    sliderSeen = []; events = []; _rs = _seed;
    try { execBlock(ast || parseProgram(src), { stepsLeft: 800000 }); }
    catch(e){
      if (e === _STOP) return null;           // top-level STOP ends the program normally
      const err = e instanceof Error ? e : new Error(String(e));
      if (e instanceof RangeError && /call stack/i.test(e.message || ""))
        err.message = "Stopped: a procedure keeps calling itself (add an IF ... [STOP])";
      if (err.line == null && curLine) err.line = curLine;
      return err;
    }
    return null;
  }
  function formatError(e){
    return (e.line ? "Line " + e.line + ": " : "") + (e.message || String(e));
  }

  // opts: fresh (start from an empty world), watch (play it back step by step),
  //       quiet (typing/slider re-run: no sound, softer errors), keepSeed (same random numbers)
  function runProgram(opts = {}){
    stopPlay(); stopAnim();
    const src = $("code")?.value ?? "";
    srcLines = src.split("\n");
    if (opts.fresh) resetWorld();
    if (!opts.keepSeed) newSeed();
    usesTime = false; timeNow = 0; frameNow = 0;
    const t0 = nowMs();
    const err = execSource(src);
    lastRunMs = nowMs() - t0;
    syncSliders();
    if (err){
      flushEvents(false);
      draw();
      setStatus((opts.quiet ? "Hmm… " : "Error: ") + formatError(err));
      return false;
    }
    if (opts.watch && stepCounter > 0){ startPlay(false); return true; }
    flushEvents(!opts.quiet);
    if (usesTime) startAnim(src);
    draw();
    setStatus("OK ✅  Segments: " + segments.length + (anim.active ? "   ▶ animating (uses TIME) — Clear stops it" : ""));
    checkQuest();
    return true;
  }

  // ---------- Export OBJ + MTL (tubes, width-based) ----------
  const _kdCache = new Map();
  function parseCssColorToKd(colorStr){
    const s = String(colorStr || "").trim() || "#ffffff";
    const hit = _kdCache.get(s);
    if (hit) return hit;
    let out = null;
    // Fast paths (no canvas): rgb(r,g,b) and #rgb / #rrggbb — these are what the interpreter emits.
    let m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
    if (m) out = { r: +m[1]/255, g: +m[2]/255, b: +m[3]/255 };
    else if ((m = /^#([0-9a-f]{6})/i.exec(s))) out = { r: parseInt(m[1].slice(0,2),16)/255, g: parseInt(m[1].slice(2,4),16)/255, b: parseInt(m[1].slice(4,6),16)/255 };
    else if ((m = /^#([0-9a-f]{3})$/i.exec(s))) out = { r: parseInt(m[1][0]+m[1][0],16)/255, g: parseInt(m[1][1]+m[1][1],16)/255, b: parseInt(m[1][2]+m[1][2],16)/255 };
    else out = parseCssColorToKdCanvas(s);
    _kdCache.set(s, out);
    return out;
  }
  function parseCssColorToKdCanvas(s){
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; // known fallback if s is invalid CSS
    x.fillStyle = s;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return { r: d[0]/255, g: d[1]/255, b: d[2]/255 };
  }

  // Points that bound a segment: its ends, or the 4 corners for a SHEETS rectangle.
  function segmentPoints(s){
    if (!s.sheet) return [s.a, s.b];
    const h = s.sheet;
    return [sub(s.a,h), add(s.a,h), add(s.b,h), sub(s.b,h)];
  }

  function objExportTubesWithMtl(segments, opts = {}){
    const sides = opts.sides ?? 12;
    const minRadius = opts.minRadius ?? 0.25;
    const widthToRadius = opts.widthToRadius ?? 0.35;
    const capEnds = opts.capEnds ?? true;
    const mtlFilename = opts.mtlFilename ?? "logo3d.mtl";
    const exportScale = Number.isFinite(Number(opts.scale)) && Number(opts.scale) > 0 ? Number(opts.scale) : 1;
    // Material modes:
    //   "colors"  – one MTL material per Logo3D color (default)
    //   "single"  – one white MTL material (assign your own material in Unity)
    //   "texture" – NO .mtl at all; planar UVs (front view, X-Y plane) are written so a
    //               photo can be dropped onto the mesh as a texture in Unity
    const materialMode = opts.materialMode || (opts.singleMaterial ? "single" : "colors");
    const singleMaterial = materialMode !== "colors";
    const writeMtl = materialMode !== "texture";
    const writeUV  = materialMode === "texture";
    // sheetUV: "planar" = one image spread across the whole model (front view);
    //          "persheet" = every sheet gets the full 0..1 image (a picture on each plane)
    //          "strip" = one image flows along each connected run of sheets (default)
    const sheetUV  = ["persheet","planar"].includes(opts.sheetUV) ? opts.sheetUV : "strip";


    const cross = (a,b)=>V(a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x);
    const len = (a)=>Math.hypot(a.x,a.y,a.z);
    const norm2 = (a)=>{ const L=len(a)||1; return V(a.x/L,a.y/L,a.z/L); };

    const drawSegs = segments.filter(s => !s.isSnapSpoke && s.label == null);
    // Strip UVs: walk sheets in drawing order; a sheet continues the current run when it
    // starts where the previous one ended with the same sideways vector (FD + UP/DN chains).
    // v runs 0..1 along the whole run, u 0..1 across the sheet width.
    const stripV = new Map();
    if (writeUV && sheetUV === "strip"){
      let run = [], runLen = 0, prev = null;
      const close = ()=>{ for (const e of run) stripV.set(e.s, [e.v0/(runLen||1), e.v1/(runLen||1)]); run = []; runLen = 0; };
      for (const sg of drawSegs){
        if (!sg.sheet){ continue; }
        const L = Math.hypot(sg.b.x-sg.a.x, sg.b.y-sg.a.y, sg.b.z-sg.a.z);
        const tol = 1e-6 * Math.max(1, L);
        const joins = prev &&
          Math.hypot(prev.b.x-sg.a.x, prev.b.y-sg.a.y, prev.b.z-sg.a.z) <= tol*10 &&
          Math.hypot(prev.sheet.x-sg.sheet.x, prev.sheet.y-sg.sheet.y, prev.sheet.z-sg.sheet.z) <= tol*10;
        if (!joins) close();
        run.push({ s: sg, v0: runLen, v1: runLen + L });
        runLen += L;
        prev = sg;
      }
      close();
    }
    // Group by color. A drawing using RC (random color per segment) can have hundreds of
    // thousands of distinct colors; importers can't take that many material slots, so when
    // there are more than maxMaterials distinct colors, quantize to a 6×6×6 (216) palette.
    const maxMaterials = opts.maxMaterials ?? 64;
    let groups = new Map();
    let quantized = false;
    const groupKey = (s)=> singleMaterial ? "#ffffff" : String(s.color || "#ffffff");
    for (const s of drawSegs){
      const key = groupKey(s);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    if (groups.size > maxMaterials){
      quantized = true;
      const q = new Map();
      const lvl = (x)=>Math.round(x*5)*51; // 0,51,...,255
      for (const s of drawSegs){
        const kd = parseCssColorToKd(s.color);
        const key = `rgb(${lvl(kd.r)},${lvl(kd.g)},${lvl(kd.b)})`;
        if (!q.has(key)) q.set(key, []);
        q.get(key).push(s);
      }
      groups = q;
    }

    // Bounding box in Logo units (padded by the largest tube radius) — used for
    // planar UVs and reported in the header / status so the scale is verifiable.
    const bb = { minX:Infinity, minY:Infinity, minZ:Infinity, maxX:-Infinity, maxY:-Infinity, maxZ:-Infinity };
    let maxR = 0;
    for (const s of drawSegs){
      const r = s.sheet ? 0 : s.ball ? s.ball : Math.max(minRadius, Number(s.width ?? 1) * widthToRadius);
      if (r > maxR) maxR = r;
      for (const p of segmentPoints(s)){
        if (p.x < bb.minX) bb.minX = p.x; if (p.x > bb.maxX) bb.maxX = p.x;
        if (p.y < bb.minY) bb.minY = p.y; if (p.y > bb.maxY) bb.maxY = p.y;
        if (p.z < bb.minZ) bb.minZ = p.z; if (p.z > bb.maxZ) bb.maxZ = p.z;
      }
    }
    if (!drawSegs.length){ bb.minX=bb.minY=bb.minZ=0; bb.maxX=bb.maxY=bb.maxZ=0; }
    bb.minX -= maxR; bb.minY -= maxR; bb.minZ -= maxR;
    bb.maxX += maxR; bb.maxY += maxR; bb.maxZ += maxR;
    const spanX = (bb.maxX - bb.minX) || 1;
    const spanY = (bb.maxY - bb.minY) || 1;
    const sizeScaled = {
      x: (bb.maxX - bb.minX) * exportScale,
      y: (bb.maxY - bb.minY) * exportScale,
      z: (bb.maxZ - bb.minZ) * exportScale,
    };

    let mtl = "";
    const colorToMtlName = new Map();
    let matIdx = 0;
    for (const [color] of groups){
      const name = `mat_${matIdx++}`;
      colorToMtlName.set(color, name);
      const kd = parseCssColorToKd(color);
      mtl += `newmtl ${name}\n`;
      mtl += `Kd ${kd.r} ${kd.g} ${kd.b}\n`;
      mtl += "Ka 0 0 0\nKs 0 0 0\nd 1\n\n";
    }

    const f6 = (n)=>Number(n).toFixed(6);
    // The OBJ is accumulated as an array of chunks (never one giant string) so that
    // sculptures with hundreds of thousands of segments don't hit the JS max string
    // length ("Invalid string length"). Download it with downloadTextParts().
    const parts = [];
    let buf = "";
    const flush = ()=>{ if (buf){ parts.push(buf); buf = ""; } };
    const emit = (line)=>{ buf += line; if (buf.length > 1_000_000) flush(); };
    emit(`# logo3d tube export\n`);
    emit(`# export scale: ${exportScale} (1 Logo unit = ${exportScale} OBJ units)\n`);
    emit(`# material mode: ${materialMode}${writeUV ? " (planar UVs on X-Y plane, no .mtl)" : ""}\n`);
    emit(`# bounding box (OBJ units): ${f6(sizeScaled.x)} x ${f6(sizeScaled.y)} x ${f6(sizeScaled.z)}\n`);
    emit(`# sheets: ${drawSegs.filter(q=>q.sheet).length}${writeUV ? `, sheet UVs: ${sheetUV}` : ""}\n`);
    emit(`# segments: ${drawSegs.length}, sides per tube: ${sides}, materials: ${groups.size}${quantized ? " (colors quantized to 216-color palette)" : ""}\n`);
    if (writeMtl) emit(`mtllib ${mtlFilename}\n`);
    let vCount = 0;

    function addVertex(p, uv){
      emit(`v ${f6(p.x * exportScale)} ${f6(p.y * exportScale)} ${f6(p.z * exportScale)}\n`);
      if (writeUV){
        // explicit uv (per-sheet mode), else planar projection from the front:
        // u across X, v up Y, normalized to the bbox
        const u = uv ? uv[0] : (p.x - bb.minX) / spanX;
        const v = uv ? uv[1] : (p.y - bb.minY) / spanY;
        emit(`vt ${f6(u)} ${f6(v)}\n`);
      }
      vCount += 1;
      return vCount;
    }
    function addFace(i,j,k){
      emit(writeUV ? `f ${i}/${i} ${j}/${j} ${k}/${k}\n` : `f ${i} ${j} ${k}\n`);
    }

    function addCylinderMesh(p0, p1, r, nSides, cap){
      const axis = sub(p1,p0);
      const L = len(axis);
      if (L < 1e-6) return;
      const d = norm2(axis);

      const helper = Math.abs(d.y) < 0.9 ? V(0,1,0) : V(1,0,0);
      let u = norm2(cross(d, helper));
      let v = norm2(cross(d, u));

      const ring0 = [];
      const ring1 = [];
      for (let i=0;i<nSides;i++){
        const t = (i/nSides) * Math.PI*2;
        const cu = Math.cos(t), su = Math.sin(t);
        const off = add(mul(u, r*cu), mul(v, r*su));
        ring0.push(add(p0, off));
        ring1.push(add(p1, off));
      }

      const idx0 = ring0.map(p => addVertex(p));
      const idx1 = ring1.map(p => addVertex(p));

      for (let i=0;i<nSides;i++){
        const j = (i+1)%nSides;
        const a = idx0[i], b = idx1[i], c = idx1[j], d0 = idx0[j];
        addFace(a,b,c);
        addFace(a,c,d0);
      }

      if (cap){
        const c0 = addVertex(p0);
        const c1 = addVertex(p1);
        for (let i=0;i<nSides;i++){
          const j = (i+1)%nSides;
          addFace(c0, idx0[j], idx0[i]);
        }
        for (let i=0;i<nSides;i++){
          const j = (i+1)%nSides;
          addFace(c1, idx1[i], idx1[j]);
        }
      }
    }

    // BALL → low-poly sphere
    function addSphereMesh(c, r){
      for (const t of sphereTris(c, r)){
        const i = addVertex(t[0]), j = addVertex(t[1]), k = addVertex(t[2]);
        addFace(i, j, k);
      }
    }

    // SHEETS rectangle → double-sided flat quad. Front and back use SEPARATE vertices so
    // Unity computes proper normals for each side (shared vertices would cancel to zero).
    // Per-sheet UVs: u across the sheet's width, v along the turtle path (a→b);
    // the back face mirrors u so the image isn't reversed when seen from behind.
    let sheetCount = 0;
    function addSheetQuad(s){
      const h = s.sheet;
      const c0 = sub(s.a,h), c1 = add(s.a,h), c2 = add(s.b,h), c3 = sub(s.b,h);
      // v0/v1 = where this sheet sits along the image: whole image (persheet) or its slice of the strip
      const [v0, v1] = sheetUV === "persheet" ? [0,1] : (stripV.get(s) || [0,1]);
      const own = sheetUV !== "planar";
      const f0 = addVertex(c0, own ? [0,v0] : null), f1 = addVertex(c1, own ? [1,v0] : null);
      const f2 = addVertex(c2, own ? [1,v1] : null), f3 = addVertex(c3, own ? [0,v1] : null);
      addFace(f0,f1,f2); addFace(f0,f2,f3);
      const b0 = addVertex(c0, own ? [1,v0] : null), b1 = addVertex(c1, own ? [0,v0] : null);
      const b2 = addVertex(c2, own ? [0,v1] : null), b3 = addVertex(c3, own ? [1,v1] : null);
      addFace(b0,b2,b1); addFace(b0,b3,b2);
      sheetCount++;
    }

    for (const [color, segs] of groups){
      if (writeMtl) emit(`\nusemtl ${colorToMtlName.get(color)}\n`);
      for (const s of segs){
        if (s.ball){ addSphereMesh(s.a, s.ball); continue; }
        if (s.sheet){ addSheetQuad(s); continue; }
        const w = Number(s.width ?? 1);
        const r = Math.max(minRadius, w * widthToRadius);
        // Coordinates and radius are scaled together by scaling generated vertices in addVertex().
        addCylinderMesh(s.a, s.b, r, sides, capEnds);
      }
    }

    flush();
    return {
      objParts: parts,                       // pass to downloadTextParts()
      get objText(){ return parts.join(""); }, // legacy: may throw for huge exports
      mtlText: writeMtl ? mtl : "", size: sizeScaled, vertexCount: vCount,
      segmentCount: drawSegs.length, scale: exportScale, materialMode,
      materialCount: groups.size, quantized, sheetCount, sheetUV,
    };
  }

  // Bounding box of drawn segments in Logo units (padded by tube radius) — cheap, no geometry.
  function segmentsBoundingBox(segments, opts = {}){
    const minRadius = opts.minRadius ?? 0.25, widthToRadius = opts.widthToRadius ?? 0.35;
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity,maxR=0,n=0;
    for (const s of segments){
      if (s.isSnapSpoke || s.label != null) continue;
      n++;
      const r = s.sheet ? 0 : s.ball ? s.ball : Math.max(minRadius, Number(s.width ?? 1) * widthToRadius); if (r>maxR) maxR=r;
      for (const p of segmentPoints(s)){
        if (p.x<minX)minX=p.x; if (p.x>maxX)maxX=p.x; if (p.y<minY)minY=p.y; if (p.y>maxY)maxY=p.y; if (p.z<minZ)minZ=p.z; if (p.z>maxZ)maxZ=p.z;
      }
    }
    if (!n) return { x:0, y:0, z:0, count:0 };
    return { x: maxX-minX+2*maxR, y: maxY-minY+2*maxR, z: maxZ-minZ+2*maxR, count:n };
  }

  // ---------- Export OBJ + MTL (dots — small primitives at segment midpoints) ----------
  const _DOT_SHAPES = {
    tetra: {
      verts: [
        [0, 1, 0],
        [2*Math.SQRT2/3, -1/3, 0],
        [-Math.SQRT2/3, -1/3,  Math.sqrt(2/3)],
        [-Math.SQRT2/3, -1/3, -Math.sqrt(2/3)]
      ],
      // outward CCW winding (verified per face)
      faces: [[0,2,1],[0,1,3],[0,3,2],[1,2,3]]
    },
    octa: {
      verts: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],
      faces: [
        [2,4,0],[2,1,4],[2,5,1],[2,0,5],
        [3,0,4],[3,4,1],[3,1,5],[3,5,0]
      ]
    },
    cube: {
      verts: [
        [-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],
        [-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]
      ],
      faces: [
        [0,1,2],[0,2,3], [4,6,5],[4,7,6],
        [0,4,5],[0,5,1], [2,6,7],[2,7,3],
        [1,5,6],[1,6,2], [0,7,4],[0,3,7]
      ]
    }
  };

  function objExportDotsWithMtl(segs, opts = {}){
    const shape = opts.shape ?? "tetra";
    const dotSize = opts.dotSize ?? 1.0;
    const dotDensity = opts.dotDensity ?? 2;
    const mtlFilename = opts.mtlFilename ?? "logo3d_dots.mtl";

    const prim = _DOT_SHAPES[shape] ?? _DOT_SHAPES.tetra;
    const drawSegs = segs.filter(s => !s.isSnapSpoke && s.label == null);

    const groups = new Map();
    for (const s of drawSegs){
      const key = String(s.color || "#ffffff");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    let mtl = "";
    const colorToMtlName = new Map();
    let matIdx = 0;
    for (const [color] of groups){
      const name = `mat_${matIdx++}`;
      colorToMtlName.set(color, name);
      const kd = parseCssColorToKd(color);
      mtl += `newmtl ${name}\nKd ${kd.r.toFixed(6)} ${kd.g.toFixed(6)} ${kd.b.toFixed(6)}\nKa 0 0 0\nKs 0 0 0\nd 1\n\n`;
    }

    let obj = `# logo3d dots export (${shape})\nmtllib ${mtlFilename}\n`;
    let vCount = 0;

    function placeDot(cx, cy, cz){
      const base = vCount;
      for (const [vx, vy, vz] of prim.verts){
        obj += `v ${(cx + vx*dotSize).toFixed(6)} ${(cy + vy*dotSize).toFixed(6)} ${(cz + vz*dotSize).toFixed(6)}\n`;
        vCount++;
      }
      for (const [a, b, c] of prim.faces)
        obj += `f ${base+a+1} ${base+b+1} ${base+c+1}\n`;
    }

    for (const [color, segList] of groups){
      obj += `\nusemtl ${colorToMtlName.get(color)}\n`;
      for (const s of segList){
        const segLen = Math.hypot(s.b.x-s.a.x, s.b.y-s.a.y, s.b.z-s.a.z);
        const count = Math.max(1, Math.round(segLen * dotDensity));
        for (let i = 0; i < count; i++){
          const t = (i + 0.5) / count;
          placeDot(
            s.a.x + (s.b.x - s.a.x) * t,
            s.a.y + (s.b.y - s.a.y) * t,
            s.a.z + (s.b.z - s.a.z) * t
          );
        }
      }
    }

    return { objText: obj, mtlText: mtl };
  }

  // Blob + object URL: no data: URI, no encodeURIComponent — works for files of hundreds of MB.
  function downloadTextParts(filename, parts, mimeType = "text/plain"){
    const blob = new Blob(Array.isArray(parts) ? parts : [String(parts)], { type: mimeType + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 10000);
    return blob.size;
  }
  function downloadTextFile(filename, text, mimeType){
    return downloadTextParts(filename, [text], mimeType);
  }

  function downloadCanvasPng(filename, outCanvas){
    outCanvas.toBlob((blob) => {
      if (!blob) { setStatus("PNG export failed."); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }

  function getNumberInput(id, fallback, min, max){
    const el = $(id);
    let v = el ? parseFloat(el.value) : fallback;
    if (!Number.isFinite(v)) v = fallback;
    return clamp(v, min, max);
  }

  function viewYawOffset(index, totalViews, parallaxDeg){
    const n = Math.max(1, totalViews|0);
    if (n === 1) return 0;
    const t = (index / (n - 1)) - 0.5;
    return t * parallaxDeg * DEG;
  }

  function renderViewCanvas(viewIndex, totalViews, tileW, tileH, parallaxDeg){
    const out = document.createElement("canvas");
    out.width = tileW; out.height = tileH;
    const outCtx = out.getContext("2d", { alpha:false });
    const yawOffset = viewYawOffset(viewIndex, totalViews, parallaxDeg);
    const projector = makeProjector(tileW, tileH, yawOffset, 0, 0);
    drawSceneToContext(outCtx, tileW, tileH, projector, { drawGrid:false });
    return out;
  }

  function renderQuiltCanvas(cols, rows, tileW, tileH, totalViews, parallaxDeg){
    const quilt = document.createElement("canvas");
    quilt.width = cols * tileW; quilt.height = rows * tileH;
    const qctx = quilt.getContext("2d", { alpha:false });
    qctx.fillStyle = "#0b0f14";
    qctx.fillRect(0,0,quilt.width,quilt.height);
    for(let i=0; i<totalViews; i++){
      const x = (i % cols) * tileW;
      const y = Math.floor(i / cols) * tileH;
      const view = renderViewCanvas(i, totalViews, tileW, tileH, parallaxDeg);
      qctx.drawImage(view, x, y);
    }
    return quilt;
  }

  function exportSbsFromViews(leftIndex, rightIndex, totalViews, tileW, tileH, parallaxDeg){
    const left = renderViewCanvas(leftIndex, totalViews, tileW, tileH, parallaxDeg);
    const right = renderViewCanvas(rightIndex, totalViews, tileW, tileH, parallaxDeg);
    const sbs = document.createElement("canvas");
    sbs.width = tileW * 2; sbs.height = tileH;
    const sctx = sbs.getContext("2d", { alpha:false });
    sctx.drawImage(left, 0, 0);
    sctx.drawImage(right, tileW, 0);
    return sbs;
  }

  function stlExportFromSegments(segs, opts = {}){
    const sides = opts.sides ?? 12;
    const minRadius = opts.minRadius ?? 0.25;
    const widthToRadius = opts.widthToRadius ?? 0.35;
    const capEnds = opts.capEnds ?? true;

    const cross = (a,b)=>V(a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x);
    const lenV = (a)=>Math.hypot(a.x,a.y,a.z);
    const norm2 = (a)=>{ const L=lenV(a)||1; return V(a.x/L,a.y/L,a.z/L); };

    const drawSegs = segs.filter(s => !s.isSnapSpoke && s.label == null);
    let out = "solid logo3d\n";

    function addTri(a, b, c){
      const n = norm2(cross(sub(b,a), sub(c,a)));
      out += `  facet normal ${n.x} ${n.y} ${n.z}\n    outer loop\n`;
      out += `      vertex ${a.x} ${a.y} ${a.z}\n`;
      out += `      vertex ${b.x} ${b.y} ${b.z}\n`;
      out += `      vertex ${c.x} ${c.y} ${c.z}\n`;
      out += `    endloop\n  endfacet\n`;
    }

    function addCylinder(p0, p1, r, nSides, cap){
      const axis = sub(p1, p0);
      const L = lenV(axis);
      if (L < 1e-6) return;
      const d = norm2(axis);
      const helper = Math.abs(d.y) < 0.9 ? V(0,1,0) : V(1,0,0);
      const u = norm2(cross(d, helper));
      const vv = norm2(cross(d, u));

      const ring0 = [], ring1 = [];
      for (let i = 0; i < nSides; i++){
        const t = (i / nSides) * Math.PI * 2;
        const off = add(mul(u, r * Math.cos(t)), mul(vv, r * Math.sin(t)));
        ring0.push(add(p0, off));
        ring1.push(add(p1, off));
      }

      for (let i = 0; i < nSides; i++){
        const j = (i + 1) % nSides;
        addTri(ring0[i], ring1[i], ring1[j]);
        addTri(ring0[i], ring1[j], ring0[j]);
      }

      if (cap){
        for (let i = 0; i < nSides; i++){
          const j = (i + 1) % nSides;
          addTri(p0, ring0[j], ring0[i]);
          addTri(p1, ring1[i], ring1[j]);
        }
      }
    }

    // SHEETS rectangle → closed thin slab (a zero-thickness plane isn't printable).
    // Thickness = 2 × tube radius for the segment's WIDTH.
    function addSlab(s, r){
      const h = s.sheet;
      const fwd = sub(s.b, s.a);
      const n = mul(norm2(cross(fwd, h)), r);
      const c = [sub(s.a,h), add(s.a,h), add(s.b,h), sub(s.b,h)];
      const T = c.map(p => add(p, n)), B = c.map(p => sub(p, n));
      addTri(T[0],T[1],T[2]); addTri(T[0],T[2],T[3]);
      addTri(B[0],B[2],B[1]); addTri(B[0],B[3],B[2]);
      for (let i=0;i<4;i++){
        const j=(i+1)%4;
        addTri(B[i],B[j],T[j]); addTri(B[i],T[j],T[i]);
      }
    }

    for (const s of drawSegs){
      const w = Number(s.width ?? 1);
      const r = Math.max(minRadius, (Number.isFinite(w) ? w : 1) * widthToRadius);
      if (s.ball){ for (const t of sphereTris(s.a, s.ball)) addTri(t[0], t[1], t[2]); continue; }
      if (s.sheet){ addSlab(s, r); continue; }
      addCylinder(s.a, s.b, r, sides, capEnds);
    }

    out += "endsolid logo3d\n";
    return out;
  }

  // ---------- Console (PRINT output) ----------
  let consoleLines = [];
  function renderConsole(){
    const el = $("console");
    if (!el) return;
    if (consoleLines.length > 300) consoleLines = consoleLines.slice(-300);
    el.textContent = consoleLines.join("\n");
    el.style.display = consoleLines.length ? "block" : "none";
    el.scrollTop = el.scrollHeight;
  }

  // ---------- Sound (NOTE / REST / TEMPO) — plain Web Audio, no files ----------
  let actx = null;
  let liveOscs = [];
  function audio(){
    if (actx) return actx;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); } catch(e){ /* no sound */ }
    return actx;
  }
  function tone(freq, when, dur){
    const ac = audio();
    if (!ac) return;
    try {
      if (ac.state === "suspended" && ac.resume) ac.resume();
      const t = Math.max(ac.currentTime, when || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "triangle"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.06, dur * 0.95));
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.05);
      liveOscs.push(o);
      if (liveOscs.length > 800) liveOscs = liveOscs.slice(-400);
    } catch(e){ /* ignore audio errors */ }
  }
  function stopTune(){
    for (const o of liveOscs){ try { o.stop(); } catch(e){ /* already stopped */ } }
    liveOscs = [];
  }

  // After an instant run: show every PRINT, and (if sound is wanted) play the NOTEs as a tune.
  function flushEvents(sound){
    stopTune();
    consoleLines = [];
    const ac = sound && events.some(e => e.type === "note") ? audio() : null;
    const base = ac ? ac.currentTime + 0.05 : 0;
    let t = 0, notes = 0;
    for (const e of events){
      if (e.type === "print") consoleLines.push(e.text);
      else if (e.type === "note"){ if (ac && notes++ < 600) tone(e.freq, base + t, e.dur); t += e.dur; }
      else if (e.type === "rest") t += e.dur;
    }
    renderConsole();
  }

  // ---------- One animation loop for Watch playback, TIME animation, Spin and confetti ----------
  let spinOn = false;
  let loopOn = false, lastTs = 0;
  function needLoop(){ return (play.active && !play.paused) || anim.active || spinOn || confetti.length > 0; }
  function kick(){
    if (!loopOn && needLoop()){ loopOn = true; lastTs = 0; requestAnimationFrame(tick); }
  }
  function tick(ts){
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    if (spinOn && pointers.size === 0 && !_momentumLive) cam.yaw += dt * 0.35;
    if (play.active && !play.paused) advancePlay(dt);
    if (anim.active) animFrame(ts);
    updateConfetti(dt);
    draw();
    if (needLoop()) requestAnimationFrame(tick); else loopOn = false;
  }

  // ---------- Watch: replay the drawing one step at a time ----------
  function setHud(text){ const el = $("hud"); if (el){ el.textContent = text || ""; el.style.display = text ? "block" : "none"; } }
  function updateWatchBtn(){
    const b = $("watchBtn");
    if (b) b.textContent = !play.active ? "👁 Watch" : play.paused ? "▶ Resume" : "⏸ Pause";
  }
  function speedRate(){
    const v = parseFloat($("speedInput")?.value);
    return 2 * Math.pow(10, (Number.isFinite(v) ? v : 45) / 25);   // 2 … 20,000 steps per second
  }
  function startPlay(paused){
    play.active = true; play.paused = !!paused;
    play.pos = 0; play.total = stepCounter; play.acc = 0; play.evIdx = 0;
    consoleLines = []; renderConsole(); stopTune();
    updateWatchBtn();
    setPlayPos(paused ? 1 : 0);
    kick(); draw();
  }
  function setPlayPos(p){
    play.pos = Math.min(play.total, p);
    let notes = 0, dirty = false;
    while (play.evIdx < events.length && events[play.evIdx].step <= play.pos){
      const e = events[play.evIdx++];
      if (e.type === "print"){ consoleLines.push(e.text); dirty = true; }
      else if (e.type === "note" && notes++ < 3) tone(e.freq, 0, e.dur);
    }
    if (dirty) renderConsole();
    const i = countUpToStep(play.pos) - 1;
    const ln = i >= 0 ? segments[i].line : 0;
    setHud("step " + play.pos + " / " + play.total + (ln ? "   ·   line " + ln + ":  " + String(srcLines[ln-1] || "").trim().slice(0, 70) : ""));
    if (play.pos >= play.total) finishPlay();
  }
  function advancePlay(dt){
    const rate = Math.max(speedRate(), play.total / 45);   // never longer than ~45 s
    play.acc += rate * dt;
    const n = Math.floor(play.acc);
    if (n > 0){ play.acc -= n; setPlayPos(play.pos + n); }
  }
  function finishPlay(){
    play.active = false;
    setHud(""); updateWatchBtn();
    if (usesTime) startAnim($("code")?.value ?? "");
    setStatus("OK ✅  Segments: " + segments.length);
    checkQuest();
  }
  function stopPlay(){
    if (!play.active) return;
    play.active = false;
    setHud(""); updateWatchBtn();
  }

  // ---------- TIME animation: programs that read TIME or FRAME are re-run every frame ----------
  function startAnim(src){
    try { anim.ast = parseProgram(src); } catch(e){ return; }
    anim.active = true; anim.t0 = 0; anim.frame = 0;
    kick();
  }
  function stopAnim(){ anim.active = false; anim.ast = null; }
  function animFrame(ts){
    if (!anim.t0) anim.t0 = ts;
    timeNow = (ts - anim.t0) / 1000;
    frameNow = ++anim.frame;
    resetWorld();
    const err = execSource("", anim.ast);
    if (events.length){ consoleLines = events.filter(e => e.type === "print").map(e => e.text); renderConsole(); }
    if (err){ stopAnim(); setStatus("Error: " + formatError(err)); }
  }

  // ---------- SLIDER controls ----------
  let sliderSig = "";
  function syncSliders(){
    const box = $("sliders");
    if (!box) return;
    const sig = sliderSeen.map(n => { const s = sliderState.get(n); return n + ":" + s.min + ":" + s.max; }).join("|");
    if (sig === sliderSig) return;
    sliderSig = sig;
    box.textContent = "";
    box.style.display = sliderSeen.length ? "" : "none";
    for (const name of sliderSeen){
      const st = sliderState.get(name);
      const row = document.createElement("label");
      row.className = "slider-row";
      const cap = document.createElement("span");
      cap.textContent = name.toLowerCase() + " = " + fmtNumber(st.value);
      const inp = document.createElement("input");
      const range = st.max - st.min;
      inp.type = "range"; inp.min = st.min; inp.max = st.max;
      inp.step = (Number.isInteger(st.min) && Number.isInteger(st.max) && range >= 20) ? 1 : (range / 200 || 0.01);
      inp.value = st.value;
      inp.addEventListener("input", () => {
        st.value = parseFloat(inp.value);
        cap.textContent = name.toLowerCase() + " = " + fmtNumber(st.value);
        if (!anim.active) runProgram({ fresh:true, quiet:true, keepSeed:true });
      });
      row.appendChild(cap); row.appendChild(inp);
      box.appendChild(row);
    }
  }

  // ---------- Confetti (quest solved!) ----------
  function confettiBurst(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const cols = ["#ff3b30","#ff9f0a","#ffd60a","#34c759","#0a84ff","#bf5af2","#64d2ff"];
    for (let i = 0; i < 140; i++){
      const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 420;
      confetti.push({ x: w/2, y: h*0.45, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 220,
                      c: cols[i % cols.length], life: 1.6 + Math.random()*1.2, s: 4 + Math.random()*5 });
    }
    kick();
  }
  function updateConfetti(dt){
    if (!confetti.length) return;
    for (const p of confetti){ p.vy += 620*dt; p.x += p.vx*dt; p.y += p.vy*dt; p.life -= dt; }
    confetti = confetti.filter(p => p.life > 0);
  }
  function drawConfetti(outCtx){
    if (!confetti.length) return;
    for (const p of confetti){
      outCtx.globalAlpha = clamp(p.life, 0, 1);
      outCtx.fillStyle = p.c;
      outCtx.fillRect(p.x, p.y, p.s, p.s * 0.6);
    }
    outCtx.globalAlpha = 1;
  }

  // ---------- Quests: small coding challenges with a target shape that is checked for you ----------
  // Quest text lives in quests.txt (same idea as examples.txt) so it can be edited without code.
  const quest = { list: [], idx: -1, solved: false };

  function parseQuests(text){
    const blocks = [];
    let cur = null;
    String(text).replace(/\r/g, "").split("\n").forEach(line => {
      if (/^\/{10,}\s*$/.test(line)){ cur = []; blocks.push(cur); }
      else if (cur) cur.push(line);
    });
    const out = [];
    for (const lines of blocks){
      while (lines.length && !lines[0].trim()) lines.shift();
      if (!lines.length) continue;
      const q = { title: lines[0].trim(), goal: "", hint: "", start: "", solution: "" };
      let sec = null;
      for (const line of lines.slice(1)){
        const m = /^(GOAL|HINT|START|SOLUTION):\s?(.*)$/.exec(line);
        if (m){ sec = m[1].toLowerCase(); if (m[2]) q[sec] += m[2] + "\n"; continue; }
        if (sec) q[sec] += line + "\n";
      }
      for (const k of ["goal","hint","start","solution"]) q[k] = q[k].replace(/\s+$/, "");
      if (q.title && q.solution) out.push(q);
    }
    return out;
  }

  // Run a program without disturbing what is on screen; returns the lines it would draw.
  function runSandbox(src){
    const keep = { segments, stepCounter, events, turtle, symN, scene, sliderSeen, seed:_seed, rs:_rs, usesTime, tempoBpm,
                   vars: Object.assign({}, vars), marks: Object.assign({}, marks), procs: Object.assign({}, procs) };
    resetWorld();
    const err = execSource(src);
    const out = err ? [] : segments.filter(s => !s.isSnapSpoke && s.label == null);
    segments = keep.segments; stepCounter = keep.stepCounter; events = keep.events; turtle = keep.turtle;
    symN = keep.symN; scene = keep.scene; sliderSeen = keep.sliderSeen; _seed = keep.seed; _rs = keep.rs;
    usesTime = keep.usesTime; tempoBpm = keep.tempoBpm;
    wipe(vars); Object.assign(vars, keep.vars);
    wipe(marks); Object.assign(marks, keep.marks);
    wipe(procs); Object.assign(procs, keep.procs);
    return out;
  }

  function pointSegDist2(p, a, b){
    const abx = b.x-a.x, aby = b.y-a.y, abz = b.z-a.z;
    const ab2 = abx*abx + aby*aby + abz*abz;
    let t = ab2 > 1e-12 ? ((p.x-a.x)*abx + (p.y-a.y)*aby + (p.z-a.z)*abz) / ab2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = a.x + abx*t - p.x, dy = a.y + aby*t - p.y, dz = a.z + abz*t - p.z;
    return dx*dx + dy*dy + dz*dz;
  }
  // Fraction of sample points along `from` that lie on (within tol of) some line in `onto`.
  function coverage(from, onto, tol){
    let total = 0, hit = 0;
    const tol2 = tol * tol;
    for (const s of from){
      const len = Math.hypot(s.b.x-s.a.x, s.b.y-s.a.y, s.b.z-s.a.z);
      const n = Math.max(1, Math.ceil(len / 4));
      for (let k = 0; k <= n; k++){
        const t = k / n;
        const p = V(s.a.x + (s.b.x-s.a.x)*t, s.a.y + (s.b.y-s.a.y)*t, s.a.z + (s.b.z-s.a.z)*t);
        total++;
        for (const o of onto){ if (pointSegDist2(p, o.a, o.b) <= tol2){ hit++; break; } }
      }
    }
    return total ? hit / total : 0;
  }
  // 0..1 — how closely the drawing matches the quest target (colour and draw order don't matter).
  function questScore(){
    const mine = segments.filter(s => !s.isSnapSpoke && s.label == null);
    if (!mine.length || !ghostSegs.length || mine.length > 6000) return 0;
    return Math.min(coverage(ghostSegs, mine, 2.5), coverage(mine, ghostSegs, 2.5));
  }

  function questStars(){ try { return JSON.parse(lsGet("logo3d.stars") || "{}") || {}; } catch(e){ return {}; } }
  function mkBtn(label, onClick){
    const b = document.createElement("button");
    b.className = "toolbar-btn"; b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderQuestCard(message){
    const card = $("questCard");
    if (!card) return;
    card.textContent = "";
    if (quest.idx < 0){ card.style.display = "none"; return; }
    const q = quest.list[quest.idx];
    card.style.display = "block";
    const h = document.createElement("div");
    h.className = "quest-title";
    h.textContent = (quest.solved ? "⭐ " : "☆ ") + "Quest " + (quest.idx + 1) + " of " + quest.list.length + " — " + q.title;
    const goal = document.createElement("div");
    goal.className = "quest-goal"; goal.textContent = q.goal;
    const msg = document.createElement("div");
    msg.className = "quest-msg"; msg.textContent = message || "Make your drawing cover the dashed shape, then press Run.";
    const row = document.createElement("div");
    row.className = "row";
    if (q.hint) row.appendChild(mkBtn("💡 Hint", () => { msg.textContent = "Hint: " + q.hint; }));
    row.appendChild(mkBtn("↺ Start over", () => { startQuest(quest.idx); }));
    if (quest.idx < quest.list.length - 1) row.appendChild(mkBtn("Next ▸", () => { startQuest(quest.idx + 1); }));
    row.appendChild(mkBtn("✕ Leave quest", () => { exitQuest(); }));
    card.appendChild(h); card.appendChild(goal); card.appendChild(msg); card.appendChild(row);
  }

  function startQuest(i){
    if (i < 0 || i >= quest.list.length) return;
    const q = quest.list[i];
    quest.idx = i; quest.solved = false;
    ghostSegs = runSandbox(q.solution);
    const code = $("code");
    if (code){ code.value = q.start || ""; lsSet("logo3d.code", code.value); }
    renderQuestCard();
    runProgram({ fresh:true, quiet:true });
    fitCamera(); draw();
  }
  function exitQuest(){
    if (quest.idx < 0) return;
    quest.idx = -1; quest.solved = false; ghostSegs = [];
    renderQuestCard(); draw();
  }
  function checkQuest(){
    if (quest.idx < 0 || quest.solved) return;
    const score = questScore();
    if (score >= 0.97){
      quest.solved = true;
      const stars = questStars();
      stars[quest.list[quest.idx].title] = 1;
      lsSet("logo3d.stars", JSON.stringify(stars));
      renderQuestCard("⭐ Solved! " + (quest.idx < quest.list.length - 1 ? "Press Next for the next quest." : "That was the last quest — you are a 3D turtle master!"));
      confettiBurst();
      [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(f, (audio() ? audio().currentTime : 0) + 0.05 + k * 0.12, 0.25));
    } else {
      renderQuestCard("Match so far: " + Math.round(score * 100) + "%.  Cover the dashed shape, then press Run.");
    }
  }

  function openQuestList(){
    const old = document.getElementById("_logoModal");
    if (old) old.remove();
    const overlay = document.createElement("div");
    overlay.id = "_logoModal";
    overlay.className = "modal-overlay";
    const box = document.createElement("div");
    box.className = "modal-box";
    const h2 = document.createElement("h2");
    h2.textContent = "⭐ Quests — learn to code in 3D";
    box.appendChild(h2);
    const list = document.createElement("div");
    list.className = "quest-list";
    if (!quest.list.length){
      const p = document.createElement("p");
      p.textContent = "Could not load quests.txt.\n\nIf you opened this page straight from a file (file://) in Chrome, the browser blocks it. Open it from a web server, or use Firefox.";
      p.style.whiteSpace = "pre-wrap";
      list.appendChild(p);
    }
    const stars = questStars();
    quest.list.forEach((q, i) => {
      const b = mkBtn((stars[q.title] ? "⭐ " : "☆ ") + (i + 1) + ". " + q.title, () => { overlay.remove(); startQuest(i); });
      list.appendChild(b);
    });
    box.appendChild(list);
    box.appendChild(mkBtn("Close", () => overlay.remove()));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  if (typeof fetch === "function"){
    fetch("./quests.txt")
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(text => { quest.list = parseQuests(text); })
      .catch(() => { /* Quests button explains if the file could not be loaded */ });
  }
  $("questBtn")?.addEventListener("click", openQuestList);

  // ---------- Share link: the whole program travels inside the URL (#p=...) ----------
  function encodeProgram(src){
    const bytes = new TextEncoder().encode(src);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeProgram(s){
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  $("shareBtn")?.addEventListener("click", () => {
    const src = $("code")?.value ?? "";
    if (!src.trim()){ setStatus("Nothing to share yet — write a program first."); return; }
    const url = String(location.href).split("#")[0] + "#p=" + encodeProgram(src);
    try { history.replaceState(null, "", url); } catch(e){ /* file:// may refuse */ }
    const done = () => setStatus("Link copied ✅  Paste it to a friend — it opens your program and runs it.\n" + (url.length > 300 ? "" : url));
    const fallback = () => setStatus("Copy this link to share your program:\n" + url);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
    else fallback();
  });

  // ---------- UI wiring ----------
  let liveOn = lsGet("logo3d.live") !== "0";
  function setToggle(id, on, label){
    const b = $(id);
    if (!b) return;
    b.classList.toggle("on", !!on);
    if (label) b.textContent = label;
  }

  $("runBtn")?.addEventListener("click", () => {
    // Live on: Run always starts from a clean page. Live off: classic behaviour — each Run
    // adds to what is already drawn and the turtle carries on from where it stopped.
    runProgram({ fresh: liveOn });
  });

  $("watchBtn")?.addEventListener("click", () => {
    if (play.active){ play.paused = !play.paused; updateWatchBtn(); kick(); return; }
    runProgram({ fresh:true, watch:true });
  });

  $("stepBtn")?.addEventListener("click", () => {
    if (!play.active){
      if (!runProgram({ fresh:true, watch:true })) return;
      if (!play.active) return;
      play.paused = true; updateWatchBtn();
      setPlayPos(1); draw();
      return;
    }
    play.paused = true; updateWatchBtn();
    setPlayPos(play.pos + 1); draw();
  });

  $("clearBtn")?.addEventListener("click", () => {
    stopPlay(); stopAnim(); stopTune();
    clearSegments(); scene = defaultScene(); symN = 1;
    consoleLines = []; renderConsole();
    draw(); setStatus("Cleared.");
  });

  $("liveBtn")?.addEventListener("click", () => {
    liveOn = !liveOn;
    lsSet("logo3d.live", liveOn ? "1" : "0");
    setToggle("liveBtn", liveOn, liveOn ? "Live: on" : "Live: off");
    setStatus(liveOn ? "Live is on: the drawing updates while you type, and Run starts from a clean page."
                     : "Live is off: press Run to draw. Each Run adds to the picture (use Clear to start over).");
  });
  setToggle("liveBtn", liveOn, liveOn ? "Live: on" : "Live: off");

  $("spinBtn")?.addEventListener("click", () => {
    spinOn = !spinOn;
    setToggle("spinBtn", spinOn);
    kick();
  });

  $("fitBtn")?.addEventListener("click", () => { fitCamera(); draw(); });

  (function initLook(){
    const sel = $("lookSel");
    const LOOKS = ["classic","neon","glasses","sbs","sbsx"];
    const saved = lsGet("logo3d.look");
    if (LOOKS.includes(saved)) uiLook = saved;
    let lastSbs = lsGet("logo3d.sbsMode") === "sbsx" ? "sbsx" : "sbs";
    const d = parseFloat(lsGet("logo3d.sbsDepth")), z = parseFloat(lsGet("logo3d.sbsSize"));
    if (Number.isFinite(d)) sbs.depth = clamp(d, 0.5, 16);
    if (Number.isFinite(z)) sbs.size = clamp(z, 20, 100);

    function apply(look){
      uiLook = LOOKS.includes(look) ? look : "classic";
      if (isSbs()){ lastSbs = uiLook; lsSet("logo3d.sbsMode", lastSbs); }
      lsSet("logo3d.look", uiLook);
      if (sel && [...sel.options].some(o => o.value === uiLook)) sel.value = uiLook;
      setToggle("sbsBtn", isSbs(), isSbs() ? (uiLook === "sbsx" ? "Split 3D: cross-eyed" : "Split 3D: parallel") : "Split 3D: off");
      draw();
    }
    if (sel) sel.addEventListener("change", () => apply(sel.value || "classic"));
    // One button cycles: off -> parallel -> cross-eyed -> off
    $("sbsBtn")?.addEventListener("click", () => apply(uiLook === "sbs" ? "sbsx" : uiLook === "sbsx" ? "classic" : "sbs"));

    const depthEl = $("sbsDepthInput"), sizeEl = $("sbsSizeInput");
    if (depthEl){
      depthEl.value = sbs.depth;
      depthEl.addEventListener("input", () => { sbs.depth = clamp(parseFloat(depthEl.value) || 4, 0.5, 16); lsSet("logo3d.sbsDepth", String(sbs.depth)); draw(); });
    }
    if (sizeEl){
      sizeEl.value = sbs.size;
      sizeEl.addEventListener("input", () => { sbs.size = clamp(parseFloat(sizeEl.value) || 100, 20, 100); lsSet("logo3d.sbsSize", String(sbs.size)); draw(); });
    }
    apply(uiLook);
  })();

  $("exportPngBtn")?.addEventListener("click", () => {
    draw();
    downloadCanvasPng("logo3d.png", canvas);
    setStatus("Saved picture ✅ (logo3d.png)");
  });

  // Typing: remember the program, and (Live) redraw shortly after the last keystroke.
  let liveTimer = null;
  $("code")?.addEventListener("input", () => {
    const src = $("code").value;
    lsSet("logo3d.code", src);
    if (!liveOn) return;
    if (liveTimer) clearTimeout(liveTimer);
    if (lastRunMs > 1500){ setStatus("Big program — press Run to redraw."); return; }
    liveTimer = setTimeout(() => {
      liveTimer = null;
      runProgram({ fresh:true, quiet:true, keepSeed:true });
    }, lastRunMs > 250 ? 900 : 350);
  });

  // Ctrl+Enter (or ⌘+Enter) runs the program from the keyboard.
  $("code")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); runProgram({ fresh: liveOn }); }
  });

  $("homeBtn")?.addEventListener("click", () => {
    turtle = makeTurtle(); draw(); setStatus("Home.");
  });

  $("exportBtn")?.addEventListener("click", () => {
    try {
      if (!segments.length) { setStatus("Nothing to export (run something first)."); return; }
      const stl = stlExportFromSegments(segments, { sides: 14, capEnds: true });
      downloadTextFile("logo3d.stl", stl, "model/stl");
      setStatus("Exported STL ✅ (tubes)");
    } catch (e) {
      setStatus("STL export error: " + (e.message || e));
    }
  });

  $("exportObjBtn")?.addEventListener("click", () => {
    try {
      if (!segments.length) { setStatus("Nothing to export (run something first)."); return; }
      const mtlFilename = "logo3d.mtl";
      const { objParts, mtlText } = objExportTubesWithMtl(segments, {
        sides: 14,
        capEnds: true,
        minRadius: 0.25,
        widthToRadius: 0.35,
        mtlFilename,
      });
      downloadTextParts("logo3d.obj", objParts, "text/plain");
      downloadTextFile(mtlFilename, mtlText, "text/plain");
      setStatus("Exported OBJ+MTL ✅ (tubes, width-based)");
    } catch (e) {
      setStatus("OBJ export error: " + (e.message || e));
    }
  });

  $("exportUnityObjBtn")?.addEventListener("click", () => {
    try {
      if (!segments.length) { setStatus("Nothing to export (run something first)."); return; }
      const materialMode = $("unityMaterialMode")?.value || "colors";
      // Scale: "Fit (m)" wins if filled — the model's largest dimension becomes exactly that
      // many Unity units (meters). Otherwise "Unity 1/N" (default 40) is used.
      const divisor = Math.max(0.0001, parseFloat($("unityScaleDivInput")?.value) || 40);
      const fitMeters = parseFloat($("unityFitInput")?.value);
      let scale = 1 / divisor;
      let scaleLabel = `1/${divisor} scale`;
      if (Number.isFinite(fitMeters) && fitMeters > 0){
        const bbox = segmentsBoundingBox(segments, { minRadius: 0.25, widthToRadius: 0.35 });
        const maxDim = Math.max(bbox.x, bbox.y, bbox.z) || 1;
        scale = fitMeters / maxDim;
        scaleLabel = `fit to ${fitMeters} m (scale ${scale.toFixed(6)})`;
      }
      // Sides per tube: 14 is smooth; 6 keeps huge sculptures (100k+ segments) importable.
      const sides = Math.min(32, Math.max(3, Math.round(parseFloat($("unitySidesInput")?.value) || 8)));
      const mtlFilename = "logo3d_unity.mtl";
      // Size guard: browsers crash the tab somewhere past ~300–400 MB of generated text.
      // Estimate ≈ per-segment bytes for vertex + (uv) + face lines, measured at ~1.2 KB per 8-sided segment.
      const nSeg = segments.filter(s => !s.isSnapSpoke).length;
      const perSeg = (materialMode === "texture" ? 60 : 34) * (sides*2+2) + (materialMode === "texture" ? 30 : 20) * (sides*4);
      const estMB = nSeg * perSeg / 1048576;
      if (estMB > 300){
        setStatus(`Unity OBJ export refused: ~${Math.round(estMB)} MB estimated (${nSeg.toLocaleString()} segments × ${sides} sides) — the browser would run out of memory and Unity could not import it.\n`
          + `Reduce the drawing for export: fewer arc steps (smaller n), fewer repeats (smaller t), or set Sides to 4. Target under ~50,000 segments.`);
        return;
      }
      setStatus(`Building Unity OBJ… ${nSeg.toLocaleString()} segments, ~${Math.round(estMB)} MB (large sculptures take a while)`);
      const res = objExportTubesWithMtl(segments, {
        sides,
        capEnds: true,
        minRadius: 0.25,
        widthToRadius: 0.35,
        mtlFilename,
        scale,
        materialMode,
        sheetUV: $("unitySheetUvMode")?.value || "strip",
      });
      const bytes = downloadTextParts("logo3d_unity.obj", res.objParts, "text/plain");
      if (res.mtlText) downloadTextFile(mtlFilename, res.mtlText, "text/plain");
      const dims = `${res.size.x.toFixed(3)} × ${res.size.y.toFixed(3)} × ${res.size.z.toFixed(3)}`;
      const mb = (bytes / 1048576).toFixed(1);
      const modeText = materialMode === "texture"
                       ? ((!res.sheetCount ? "planar UVs"
                          : res.sheetUV === "persheet" ? "sheets: full image on each sheet"
                          : res.sheetUV === "strip"    ? "sheets: one image flowing along each run"
                          : "planar UVs") + ", NO .mtl — assign a photo material in Unity")
                     : materialMode === "single"  ? "one white material"
                     : `Logo3D colors (${res.materialCount} materials${res.quantized ? ", quantized to a 216-color palette" : ""})`;
      setStatus(`Exported Unity OBJ ✅ ${scaleLabel}, ${modeText}\nModel size in Unity units (meters): ${dims}\n${res.sheetCount ? res.sheetCount + " sheets + " : ""}${res.segmentCount - (res.sheetCount||0)} tube segments × ${sides} sides → ${res.vertexCount.toLocaleString()} vertices, ${mb} MB`
        + (bytes > 300*1048576 ? "\n⚠ Very large file — Unity import will be slow; try fewer Sides or a simpler script." : ""));
    } catch (e) {
      setStatus("Unity OBJ export error: " + (e.message || e));
    }
  });

  $("exportDotsBtn")?.addEventListener("click", () => {
    try {
      if (!segments.length) { setStatus("Nothing to export (run something first)."); return; }
      const mtlFilename = "logo3d_dots.mtl";
      const dotSize    = Math.max(0.001, parseFloat($("dotSizeInput")?.value)    || 1.0);
      const dotDensity = Math.max(0.01,  parseFloat($("dotDensityInput")?.value) || 2);
      const { objText, mtlText } = objExportDotsWithMtl(segments, {
        shape: "tetra",
        dotSize,
        dotDensity,
        mtlFilename,
      });
      downloadTextFile("logo3d_dots.obj", objText, "text/plain");
      downloadTextFile(mtlFilename, mtlText, "text/plain");
      setStatus("Exported Dots OBJ+MTL ✅ (tetrahedra)");
    } catch (e) {
      setStatus("Dots export error: " + (e.message || e));
    }
  });


  $("exportQuiltBtn")?.addEventListener("click", () => {
    try {
      if (!segments.length) { setStatus("Nothing to export (run something first)."); return; }
      const cols = Math.round(getNumberInput("quiltColsInput", 8, 1, 16));
      const rows = Math.round(getNumberInput("quiltRowsInput", 6, 1, 16));
      const totalViews = Math.min(cols * rows, Math.round(getNumberInput("quiltViewsInput", cols * rows, 1, cols * rows)));
      const tileW = Math.round(getNumberInput("quiltTileWInput", 420, 64, 2048));
      const tileH = Math.round(getNumberInput("quiltTileHInput", 420, 64, 2048));
      const parallaxDeg = getNumberInput("quiltParallaxInput", 10, 0, 90);
      const quilt = renderQuiltCanvas(cols, rows, tileW, tileH, totalViews, parallaxDeg);
      downloadCanvasPng(`logo3d_quilt_${cols}x${rows}_${totalViews}views.png`, quilt);
      setStatus(`Exported quilt PNG ✅ ${cols}x${rows}, ${totalViews} views, ${tileW}x${tileH} tiles, ${parallaxDeg}° parallax`);
    } catch (e) {
      setStatus("Quilt export error: " + (e.message || e));
    }
  });

  $("exportSbsBtn")?.addEventListener("click", () => {
    try {
      if (!segments.length) { setStatus("Nothing to export (run something first)."); return; }
      const cols = Math.round(getNumberInput("quiltColsInput", 8, 1, 16));
      const rows = Math.round(getNumberInput("quiltRowsInput", 6, 1, 16));
      const totalViews = Math.min(cols * rows, Math.round(getNumberInput("quiltViewsInput", cols * rows, 1, cols * rows)));
      const tileW = Math.round(getNumberInput("quiltTileWInput", 420, 64, 2048));
      const tileH = Math.round(getNumberInput("quiltTileHInput", 420, 64, 2048));
      const parallaxDeg = getNumberInput("quiltParallaxInput", 10, 0, 90);
      let leftIndex = Math.round(getNumberInput("sbsLeftInput", Math.floor(totalViews * 0.38), 0, totalViews - 1));
      let rightIndex = Math.round(getNumberInput("sbsRightInput", Math.floor(totalViews * 0.62), 0, totalViews - 1));
      if (leftIndex === rightIndex) rightIndex = clamp(rightIndex + 1, 0, totalViews - 1);
      const sbs = exportSbsFromViews(leftIndex, rightIndex, totalViews, tileW, tileH, parallaxDeg);
      downloadCanvasPng(`logo3d_SBS_L${leftIndex}_R${rightIndex}.png`, sbs);
      setStatus(`Exported SBS stereo PNG ✅ left view ${leftIndex}, right view ${rightIndex}. Wider spacing = stronger/hyperstereo.`);
    } catch (e) {
      setStatus("SBS export error: " + (e.message || e));
    }
  });

  // ---------- Help / Acknowledgements modals ----------
  function openTextModal(title, rawText, withSearch){
    const existing = document.getElementById("_logoModal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "_logoModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box";

    const box = document.createElement("div");
    box.style.cssText = "background:#1a1f28;border:1px solid rgba(127,127,127,.35);border-radius:14px;padding:20px;max-width:720px;width:100%;max-height:85vh;display:flex;flex-direction:column;color:#e0e0e0";

    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-shrink:0";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    h2.style.cssText = "margin:0;font-size:17px;font-weight:600;color:#fff";
    const xBtn = document.createElement("button");
    xBtn.textContent = "✕";
    xBtn.style.cssText = "background:none;border:none;font-size:18px;cursor:pointer;color:#999;padding:2px 8px;border-radius:6px;line-height:1";
    xBtn.onclick = () => overlay.remove();
    hdr.appendChild(h2); hdr.appendChild(xBtn);
    box.appendChild(hdr);

    if (withSearch){
      const inp = document.createElement("input");
      inp.type = "text"; inp.placeholder = "Search commands…";
      inp.style.cssText = "width:100%;box-sizing:border-box;padding:7px 11px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.15);color:#e0e0e0;font-size:13px;margin-bottom:10px;flex-shrink:0;outline:none";
      box.appendChild(inp);

      const wrap = document.createElement("div");
      wrap.style.cssText = "overflow-y:auto;flex:1;font-family:monospace;font-size:12.5px;line-height:1.55";

      const blockEls = rawText.split(/\n{2,}/).map(chunk => {
        const d = document.createElement("div");
        d.style.cssText = "padding:5px 2px;border-bottom:1px solid rgba(127,127,127,.08);white-space:pre-wrap;word-break:break-word";
        d.textContent = chunk;
        wrap.appendChild(d);
        return d;
      });

      inp.addEventListener("input", () => {
        const q = inp.value.toLowerCase();
        for (const el of blockEls)
          el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? "" : "none";
      });

      box.appendChild(wrap);
      setTimeout(() => inp.focus(), 50);
    } else {
      const pre = document.createElement("pre");
      pre.style.cssText = "overflow-y:auto;flex:1;font-family:monospace;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:0";
      pre.textContent = rawText;
      box.appendChild(pre);
    }

    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function loadAndShowModal(url, title, withSearch){
    fetch(url)
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(text => openTextModal(title, text, withSearch))
      .catch(err => openTextModal(title,
        "Could not load " + url + "\n\n" +
        "If running from a file:// URL in Chrome, fetch() is blocked by the browser.\n" +
        "Open the app from a local web server, or use Firefox, to view this content.\n\n" +
        "Error: " + err.message, false));
  }

  $("helpBtn")?.addEventListener("click", () => loadAndShowModal("./commands.txt", "List of Commands", true));
  $("ackBtn")?.addEventListener("click",  () => loadAndShowModal("./acknowledge.txt", "Acknowledge", false));

  // ---------- Examples dropdown ----------
  (function initExamples() {
    const sel = $("exampleSel");
    if (!sel) return;

    // Populate options from examples.txt on page load
    fetch("./examples.txt")
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(text => {
        const blocks = [];
        let current = null;
        text.replace(/\r/g, "").split("\n").forEach(line => {
          if (/^\/{10,}\s*$/.test(line)) { current = []; blocks.push(current); }
          else if (current !== null) { current.push(line); }
        });
        blocks.forEach(lines => {
          while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
          if (lines.length < 2) return;
          const name = lines[0].trim();
          if (!name) return;
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          opt._logoCode = lines.slice(1).join("\n");
          sel.appendChild(opt);
        });
      })
      .catch(() => { /* leave dropdown at placeholder if fetch fails */ });

    // Load selected example's code into the editor (no auto-run)
    sel.addEventListener("change", () => {
      const opt = sel.options[sel.selectedIndex];
      if (!opt || !opt._logoCode) return;
      exitQuest();
      $("code").value = opt._logoCode;
      lsSet("logo3d.code", opt._logoCode);
      setStatus("Loaded: " + opt.textContent + "\nPress Run to draw it, or Watch to see the turtle build it step by step.");
    });

    // Surprise: load a random example and run it straight away.
    $("surpriseBtn")?.addEventListener("click", () => {
      const opts = [...sel.options].filter(o => o._logoCode);
      if (!opts.length){ setStatus("No examples loaded (examples.txt could not be read)."); return; }
      const opt = opts[Math.floor(Math.random() * opts.length)];
      exitQuest();
      sel.value = opt.value;
      $("code").value = opt._logoCode;
      lsSet("logo3d.code", opt._logoCode);
      if (runProgram({ fresh:true })){
        fitCamera(); draw();
        setStatus("🎲 " + opt.textContent + " — " + segments.length + " segments. Change a number and see what happens!");
      }
    });
  })();

  // ---------- Pull-down menus (<details class="menu">) ----------
  // Close open menus when clicking outside them; opening one top-level menu closes the others.
  function closeMenus(except) {
    document.querySelectorAll("details.menu[open]").forEach(d => {
      if (!except || !d.contains(except)) d.open = false;
    });
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest("details.menu")) closeMenus(null);
  });
  document.querySelectorAll("details.menu").forEach(d => {
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      const parent = d.parentElement.closest("details.menu");
      if (!parent) closeMenus(d);
      else parent.querySelectorAll(":scope details.menu[open]").forEach(o => { if (o !== d && !o.contains(d)) o.open = false; });
    });
  });

  // Picking something from a menu closes it — except controls marked class="stay"
  // (toggles and settings you may want to press several times).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn && btn.closest("details.menu") && !btn.classList.contains("stay")) closeMenus(null);
  });
  $("exampleSel")?.addEventListener("change", () => closeMenus(null));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){ const m = document.getElementById("_logoModal"); if (m) m.remove(); closeMenus(null); }
  });

  // ---------- Start-up: a shared link wins, otherwise bring back what was typed last time ----------
  (function initProgram(){
    const code = $("code");
    if (!code) return;
    let shared = null;
    try {
      const m = /[#&]p=([^&]+)/.exec(String(location.hash || ""));
      if (m) shared = decodeProgram(m[1]);
    } catch(e){ shared = null; }
    if (shared != null && shared.trim()){
      code.value = shared;
      if (runProgram({ fresh:true })){ fitCamera(); draw(); setStatus("Opened a shared program ✅  Segments: " + segments.length + "\nChange it and make it yours!"); }
      return;
    }
    const saved = lsGet("logo3d.code");
    if (saved && !code.value) code.value = saved;
  })();

  // Small scripting hook (used by tests and other tools): run Logo source without the page UI.
  window.Logo3D = {
    version: VERSION,
    runSource(src, opts = {}){
      if (opts.fresh !== false) resetWorld();
      if (opts.seed != null) _seed = (opts.seed >>> 0) || 1; else if (!opts.keepSeed) newSeed();
      usesTime = false;
      timeNow = Number(opts.time) || 0; frameNow = Number(opts.frame) || 0;
      const err = execSource(String(src));
      return { error: err ? formatError(err) : null, segments, events, usesTime, scene, sliders: sliderSeen.slice(),
               // added for the WebXR "Together" build: where the turtle ended up, and slider details
               turtle: { pos: turtle.pos, R: turtle.R, penDown: turtle.penDown, color: turtle.color },
               sliderInfo: sliderSeen.map(n => { const s = sliderState.get(n); return { name:n, min:s.min, max:s.max, value:s.value }; }) };
    },
    // added for the WebXR "Together" build: set a SLIDER's value from outside (then call runSource again)
    setSlider(name, value){
      const s = sliderState.get(String(name).toUpperCase()) || sliderState.get(String(name));
      if (!s) return false;
      s.value = clamp(Number(value), s.min, s.max);
      return true;
    },
    tokenize, parseQuests, runSandbox,
    objExport: (o) => objExportTubesWithMtl(segments, o || {}),
    dotsExport: (o) => objExportDotsWithMtl(segments, o || {}),
    stlExport: (o) => stlExportFromSegments(segments, o || {}),
    questScoreAgainst(solutionSrc){ const keep = ghostSegs; ghostSegs = runSandbox(solutionSrc); const s = questScore(); ghostSegs = keep; return s; },
    encodeProgram, decodeProgram, fitCamera, draw, sphereTris
  };

  draw();
})();
