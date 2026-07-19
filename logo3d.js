(() => {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const canvas = $("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  function setStatus(msg){ if (statusEl) statusEl.textContent = msg; }
  setStatus("JS loaded ✅  Ready. Tap Run.");

  const DEG = Math.PI / 180;
  const ARC_STEP_DEG = 3; // smaller = smoother arcs (slower)
  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }

  // Sentinel thrown by STOP; caught by the nearest CALL handler to exit that procedure.
  const _STOP = Object.freeze({ __stop__: true });

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

  // ---------- Drawing ----------
  let segments = [];
  function clearSegments(){ segments = []; }

  function addDrawnSegment(a, b, color, width){
    segments.push({ a: V(a.x,a.y,a.z), b: V(b.x,b.y,b.z), color, width, isSnapSpoke:false });
  }
  function addSnapSpokeSegment(a, b, color, width){
    // spokes from SP should NOT become snap geometry
    segments.push({ a: V(a.x,a.y,a.z), b: V(b.x,b.y,b.z), color, width, isSnapSpoke:true });
  }

  // ---------- Camera ----------
  const cam = { yaw: 35*DEG, pitch: -25*DEG, dist: 420, panX:0, panY:0 };

  function resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.floor(w*dpr);
    canvas.height = Math.floor(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener("resize", () => { resize(); draw(); });
  resize();

  function makeProjector(viewW, viewH, yawOffset = 0, panX = cam.panX, panY = cam.panY){
    return function projectForView(p){
      const Ry = rotAxis(V(0,1,0), cam.yaw + yawOffset);
      const Rx = rotAxis(V(1,0,0), cam.pitch);
      const R = matMul(Rx, Ry);
      const pc = matVec(R, p);
      const z = pc.z + cam.dist;
      const f = 600;
      const sx = (pc.x * f) / (z || 1);
      const sy = (pc.y * f) / (z || 1);
      return { x: sx + viewW/2 + panX, y: -sy + viewH/2 + panY, z };
    };
  }

  function project(p){
    return makeProjector(canvas.clientWidth, canvas.clientHeight)(p);
  }

  function drawSceneToContext(outCtx, w, h, projector, opts = {}){
    const drawGrid = opts.drawGrid !== false;
    const bg = opts.background || "#0b0f14";
    outCtx.fillStyle = bg;
    outCtx.fillRect(0,0,w,h);

    if (drawGrid){
      outCtx.lineWidth = 1;
      outCtx.strokeStyle = "rgba(120,150,180,0.12)";
      const gridN = 20, step = 30;
      for(let i=-gridN;i<=gridN;i++){
        const a = projector(V(i*step,0,-gridN*step));
        const b = projector(V(i*step,0, gridN*step));
        outCtx.beginPath(); outCtx.moveTo(a.x,a.y); outCtx.lineTo(b.x,b.y); outCtx.stroke();
        const c = projector(V(-gridN*step,0,i*step));
        const d = projector(V( gridN*step,0,i*step));
        outCtx.beginPath(); outCtx.moveTo(c.x,c.y); outCtx.lineTo(d.x,d.y); outCtx.stroke();
      }
    }

    const drawn = segments.map(s => {
      const pa = projector(s.a), pb = projector(s.b);
      return { pa, pb, color:s.color, width:s.width, z:(pa.z+pb.z)/2 };
    }).sort((u,v)=> v.z - u.z);

    for(const s of drawn){
      outCtx.strokeStyle = s.color;
      outCtx.lineWidth = Math.max(1, s.width);
      outCtx.beginPath();
      outCtx.moveTo(s.pa.x, s.pa.y);
      outCtx.lineTo(s.pb.x, s.pb.y);
      outCtx.stroke();
    }
  }

  function draw(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    drawSceneToContext(ctx, w, h, project, { drawGrid:true });
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
      cam.dist = clamp(cam.dist - (now.dist-last.dist)*0.7, 60, 4000);
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
    cam.dist = clamp(cam.dist + e.deltaY * 0.8, 60, 4000);
    scheduleRedraw();
  }, { passive: false });

  // ---------- Turtle + vars + marks + procedures ----------
  function makeTurtle(){
    return { pos: V(0,0,0), R: I3(), penDown:true, color:"#ffffff", width:1.5 };
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
      width: +t.width
    };
  }

  // ---------- Tokenizer / parser ----------
  function tokenize(src){
    // normalize NBSP -> space (iPad paste fix)
    src = src.replace(/\u00A0/g, " ");

    // strip ; comments
    src = src.split("\n").map(line => {
      const i = line.indexOf(";");
      return i >= 0 ? line.slice(0,i) : line;
    }).join("\n");

    // remove #timeout directives
    src = src.replace(/#timeout\s*=\s*[0-9.]+/gi, "");

    // split into: [, ], or "anything not whitespace or brackets"
    const raw = src.match(/\[|\]|[^\s\[\]]+/g) || [];

    // uppercase except hex colors
    return raw.map(t => {
      if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return t;
      return t.toUpperCase();
    });
  }

  function parseList(tokens, i){
    // nested lists supported; nested list is stored as an Array
    if (tokens[i] !== "[") throw new Error("Expected [");
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
    throw new Error("Unclosed [ ... ] list");
  }

  function parseValueToken(tokens, i){
    const tok = tokens[i];

    if (tok === "PICK"){
      if (tokens[i+1] !== "[") throw new Error("PICK must be followed by [ ... ]");
      const lst = parseList(tokens, i+1);
      return { value: { fn:"PICK", items: lst.items }, next: lst.next };
    }

    if (tok === "RANDOM"){
      const mx = tokens[i+1];
      if (mx == null) throw new Error("RANDOM needs a max");
      return { value: { fn:"RANDOM", max: mx }, next: i+2 };
    }

    return { value: tok, next: i+1 };
  }

  // arities = map of procedure name → number of colon-params it declares.
  // Collected in a pre-pass so call sites know how many tokens to consume as arguments.
  function parseBlock(tokens, i, arities = Object.create(null)){
    const block = [];
    while (i < tokens.length){
      const tok = tokens[i];
      if (tok === "]") return { block, next: i+1 };

      // TO <name> [:param ...] ... END
      if (tok === "TO"){
        const name = tokens[i+1];
        if (!name) throw new Error("TO needs a procedure name");
        let j = i+2;
        const params = [];
        while (j < tokens.length && String(tokens[j]).startsWith(":")) {
          params.push(String(tokens[j]).slice(1).toUpperCase());
          j++;
        }
        const bodyTokens = [];
        while (j < tokens.length && tokens[j] !== "END") { bodyTokens.push(tokens[j]); j++; }
        if (j >= tokens.length) throw new Error("TO " + name + " is missing END");
        const inner = parseBlock(bodyTokens, 0, arities);
        block.push({ op:"PROCDEF", name: String(name).toUpperCase(), params, body: inner.block });
        i = j + 1;
        continue;
      }

      // REPEAT/RPT n [ ... ]
      if (tok === "REPEAT" || tok === "RPT"){
        const countTok = tokens[i+1];
        if (countTok == null) throw new Error(tok + " needs a count");
        if (tokens[i+2] !== "[") throw new Error(tok + " must be followed by [ ... ]");
        const inner = parseBlock(tokens, i+3, arities);
        block.push({ op:"REPEAT", count: countTok, body: inner.block });
        i = inner.next;
        continue;
      }

      // IF <cond...> [ ... ] (ELSE [ ... ])?
      if (tok === "IF"){
        let j = i+1;
        const cond = [];
        while (j < tokens.length && tokens[j] !== "[") { cond.push(tokens[j]); j++; }
        if (tokens[j] !== "[") throw new Error("IF missing [ ... ]");
        const thenInner = parseBlock(tokens, j+1, arities);
        let k = thenInner.next;
        let elseBody = null;
        if (tokens[k] === "ELSE"){
          if (tokens[k+1] !== "[") throw new Error("ELSE must be followed by [ ... ]");
          const elseInner = parseBlock(tokens, k+2, arities);
          elseBody = elseInner.block;
          k = elseInner.next;
        }
        block.push({ op:"IF", cond, thenBody: thenInner.block, elseBody });
        i = k;
        continue;
      }

      // SC value  OR  SC [r g b]
      if (tok === "SC" || tok === "SETCOLOR"){
        const n1 = tokens[i+1];
        if (n1 == null) throw new Error("SC needs an argument");

        if (n1 === "["){
          const lst = parseList(tokens, i+1);
          block.push({ op:"SC", value: lst.items });
          i = lst.next;
          continue;
        }
        const pv = parseValueToken(tokens, i+1);
        block.push({ op:"SC", value: pv.value });
        i = pv.next;
        continue;
      }

      // MAKE A=...  or MAKE A ...
      if (tok === "MAKE"){
        const a1 = tokens[i+1];
        if (!a1) throw new Error("MAKE needs a variable");
        if (String(a1).includes("=")){
          block.push({ op:"MAKE", a1 });
          i += 2;
          continue;
        }
        const pv = parseValueToken(tokens, i+2);
        if (pv.value == null) throw new Error("MAKE " + a1 + " needs a value");
        block.push({ op:"MAKE", a1, a2: pv.value });
        i = pv.next;
        continue;
      }

      // no-arg ops
      if (["PU","PD","HOME","CENTER","CS","CLEAR","STOP"].includes(tok)){
        block.push({ op: tok });
        i += 1;
        continue;
      }

      // one-arg ops (value token allowed)
      const oneArgOps = ["FD","BK","LT","RT","UP","DN","RL","RR","WIDTH","OMARK","GOTO","PAUSE","SLY","SP"];
      if (oneArgOps.includes(tok)){
        const pv = parseValueToken(tokens, i+1);
        if (pv.value == null) throw new Error(tok + " needs an argument");
        block.push({ op: tok, arg: pv.value });
        i = pv.next;
        continue;
      }

      // two-arg arc ops (ARCRIGHT/ARCLEFT/ARCUP/ARCDOWN are long-form aliases)
      if (["AR","AL","AU","AD","ARCRIGHT","ARCLEFT","ARCUP","ARCDOWN"].includes(tok)){
        const op = tok === "ARCRIGHT" ? "AR" : tok === "ARCLEFT" ? "AL" :
                   tok === "ARCUP"    ? "AU" : tok === "ARCDOWN"  ? "AD" : tok;
        const a1 = tokens[i+1], a2 = tokens[i+2];
        if (a1 == null || a2 == null) throw new Error(tok + " needs 2 args (angle radius)");
        block.push({ op, a1, a2 });
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
        const callName = String(tok).toUpperCase();
        const arity = arities[callName] || 0;
        const args = [];
        for (let k = 0; k < arity; k++) args.push(tokens[i + 1 + k]);
        block.push({ op:"CALL", name: callName, args });
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
  function evalExpr(expr){
    // Normalise colon-prefixed variables (:name → name) before lexing.
    expr = String(expr).trim().toUpperCase().replace(/:[A-Z_][A-Z0-9_]*/g, s => s.slice(1));

    const tokens = [];
    const re = /\s*([A-Z_][A-Z0-9_]*|\d+(?:\.\d+)?|\.\d+|[()+\-*/])\s*/g;
    let m;
    while ((m = re.exec(expr)) !== null) tokens.push(m[1]);
    if (tokens.length === 0) throw new Error("Empty expression");

    const out = [];
    const ops = [];
    const prec = { "u-": 3, "*": 2, "/": 2, "+": 1, "-": 1 };
    const rightAssoc = { "u-": true };
    function isOp(t){ return t === "+" || t === "-" || t === "*" || t === "/" || t === "u-"; }

    for (let i=0;i<tokens.length;i++){
      let t = tokens[i];
      if (t === "-"){
        const prev = tokens[i-1];
        const isUnary = (i === 0) || (prev === "(") || isOp(prev);
        if (isUnary) t = "u-";
      }

      if (/^\d/.test(t) || /^\.\d/.test(t)){
        out.push({type:"num", v: Number(t)});
      } else if (/^[A-Z_]/.test(t)){
        out.push({type:"var", v: t});
      } else if (t === "("){
        ops.push(t);
      } else if (t === ")"){
        while (ops.length && ops[ops.length-1] !== "(") out.push({type:"op", v: ops.pop()});
        if (!ops.length) throw new Error("Mismatched parentheses");
        ops.pop();
      } else if (isOp(t)){
        while (ops.length){
          const top = ops[ops.length-1];
          if (!isOp(top)) break;
          const pTop = prec[top], pT = prec[t];
          if (pTop > pT || (pTop === pT && !rightAssoc[t])) out.push({type:"op", v: ops.pop()});
          else break;
        }
        ops.push(t);
      } else {
        throw new Error("Bad token in expression: " + t);
      }
    }
    while (ops.length){
      const op = ops.pop();
      if (op === "(" || op === ")") throw new Error("Mismatched parentheses");
      out.push({type:"op", v: op});
    }

    const stack = [];
    for (const item of out){
      if (item.type === "num") stack.push(item.v);
      else if (item.type === "var") {
        if (vars[item.v] == null) throw new Error("Unknown variable: " + item.v);
        const n = Number(vars[item.v]);
        if (!Number.isFinite(n)) throw new Error("Variable not numeric: " + item.v);
        stack.push(n);
      } else if (item.type === "op") {
        if (item.v === "u-"){
          if (stack.length < 1) throw new Error("Bad unary minus");
          stack.push(-stack.pop());
        } else {
          if (stack.length < 2) throw new Error("Bad operator: " + item.v);
          const b = stack.pop(), a = stack.pop();
          switch(item.v){
            case "+": stack.push(a+b); break;
            case "-": stack.push(a-b); break;
            case "*": stack.push(a*b); break;
            case "/": stack.push(a/b); break;
          }
        }
      }
    }
    if (stack.length !== 1) throw new Error("Bad expression: " + expr);
    return stack[0];
  }

  // resolveAny: returns number/string/array
  function resolveAny(tok){
    if (tok && typeof tok === "object" && !Array.isArray(tok)){
      if (tok.fn === "RANDOM"){
        const mx = resolveNumber(tok.max);
        return Math.floor(Math.random() * (mx || 1));
      }
      if (tok.fn === "PICK"){
        const items = tok.items || [];
        if (!items.length) throw new Error("PICK [] is empty");
        const idx = Math.floor(Math.random() * items.length);
        return items[idx]; // may be string or nested list
      }
    }

    if (Array.isArray(tok)) return tok;

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

  // Evaluate an IF condition token array.
  // Handles:  ["CC=1"]  |  [":D=0"]  |  ["CC","GT","5"]  |  ["CT","LT","100"]
  function evalCondition(cond){
    if (!cond || cond.length === 0) return false;

    // Three-token form: EXPR  OP  EXPR  (e.g. "CC GT 5" or ":N LT 1" or "CC = 1")
    if (cond.length >= 3){
      const op = String(cond[1]).toUpperCase();
      const cmp = { GT:(a,b)=>a>b, LT:(a,b)=>a<b, GE:(a,b)=>a>=b, LE:(a,b)=>a<=b,
                    "=":(a,b)=>a===b, EQ:(a,b)=>a===b, NE:(a,b)=>a!==b, NEQ:(a,b)=>a!==b };
      if (cmp[op]){
        try { return cmp[op](resolveNumber(cond[0]), resolveNumber(cond[2])); }
        catch(e){ return false; }
      }
    }

    // Single token with embedded "=": "CC=1"  or  ":D=0"
    if (cond.length === 1){
      const tok = String(cond[0]);
      const eq = tok.indexOf("=");
      if (eq > 0){
        try { return resolveNumber(tok.slice(0, eq)) === resolveNumber(tok.slice(eq + 1)); }
        catch(e){ return false; }
      }
      try { return resolveNumber(tok) !== 0; } catch(e){ return false; }
    }

    return true; // unrecognised form — default truthy (preserves old behaviour)
  }

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
      const rr = Math.floor(Math.random()*256);
      const gg = Math.floor(Math.random()*256);
      const bb = Math.floor(Math.random()*256);
      return `rgb(${rr},${gg},${bb})`;
    }

    if (/^#[0-9A-F]{3,8}$/i.test(tok)) return tok;

    const named = {
      WHITE:"#ffffff", BLACK:"#000000",
      RED:"#ff3b30", ORANGE:"#ff9f0a", YELLOW:"#ffd60a",
      GREEN:"#34c759", BLUE:"#0a84ff", PURPLE:"#bf5af2",
      MAGENTA:"#ff2d55", CYAN:"#64d2ff", PINK:"#ff2d55", GRAY:"#8e8e93"
    };
    if (named[up]) return named[up];

    // Variable holding a color (string or list)
    if (/^[A-Z_][A-Z0-9_]*$/.test(up) && vars[up] != null){
      return colorFromValue(vars[up]);
    }

    // raw CSS fallback
    return tok;
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

      switch(ins.op){
        case "PROCDEF":
          procs[ins.name] = { body: ins.body, params: ins.params || [] };
          break;

        case "CALL": {
          const procDef = procs[ins.name];
          if (!procDef) throw new Error("Unknown procedure: " + ins.name);
          // Support both new {body,params} format and legacy plain-array format.
          const body   = Array.isArray(procDef) ? procDef : procDef.body;
          const params = Array.isArray(procDef) ? []      : (procDef.params || []);
          const callArgs = ins.args || [];
          // Bind colon-params as local variables, saving any shadowed globals.
          const saved = {};
          for (let k = 0; k < params.length; k++){
            saved[params[k]] = vars[params[k]];
            vars[params[k]] = k < callArgs.length ? resolveAny(callArgs[k]) : undefined;
          }
          try { execBlock(body, safety); }
          catch(e){ if (e !== _STOP) throw e; } // STOP = normal procedure exit
          finally {
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

        case "SC":
          turtle.color = colorFromValue(ins.value);
          break;

        case "WIDTH": {
          const w = resolveNumber(ins.arg);
          if (Number.isFinite(w) && w > 0) turtle.width = w;
          break;
        }

        case "MAKE": {
          const a1 = String(ins.a1).toUpperCase();
          if (a1.includes("=")){
            const [name, rhs] = a1.split("=");
            if (!name || rhs == null) throw new Error("Bad MAKE syntax: " + a1);
            vars[name.toUpperCase()] = resolveAny(rhs);
          } else {
            const name = a1.toUpperCase();
            vars[name] = resolveAny(ins.a2);
          }
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
          if (!m) throw new Error("No mark named: " + key);
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

          if (turtle.penDown) addDrawnSegment(a, b, turtle.color, turtle.width);
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

            if (turtle.penDown) addDrawnSegment(a, b, turtle.color, turtle.width);
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
          for (let k=0;k<n;k++) execBlock(ins.body, safety);
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

  function runProgram(){
    const src = $("code")?.value ?? "";
    const ast = parseProgram(src);
    try { execBlock(ast, { stepsLeft: 800000 }); }
    catch(e){ if (e !== _STOP) throw e; } // top-level STOP ends the program normally
    draw();
    setStatus("OK ✅  Segments: " + segments.length);
  }

  // ---------- Export OBJ + MTL (tubes, width-based) ----------
  function parseCssColorToKd(colorStr){
    const s = String(colorStr || "").trim() || "#ffffff";
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; // known fallback if s is invalid CSS
    x.fillStyle = s;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return { r: d[0]/255, g: d[1]/255, b: d[2]/255 };
  }

  function objExportTubesWithMtl(segments, opts = {}){
    const sides = opts.sides ?? 12;
    const minRadius = opts.minRadius ?? 0.25;
    const widthToRadius = opts.widthToRadius ?? 0.35;
    const capEnds = opts.capEnds ?? true;
    const mtlFilename = opts.mtlFilename ?? "logo3d.mtl";

    const cross = (a,b)=>V(a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x);
    const len = (a)=>Math.hypot(a.x,a.y,a.z);
    const norm2 = (a)=>{ const L=len(a)||1; return V(a.x/L,a.y/L,a.z/L); };

    const drawSegs = segments.filter(s => !s.isSnapSpoke);
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
      mtl += `newmtl ${name}\n`;
      mtl += `Kd ${kd.r} ${kd.g} ${kd.b}\n`;
      mtl += "Ka 0 0 0\nKs 0 0 0\nd 1\n\n";
    }

    let obj = `# logo3d tube export\nmtllib ${mtlFilename}\n`;
    let vCount = 0;

    function addVertex(p){
      obj += `v ${p.x} ${p.y} ${p.z}\n`;
      vCount += 1;
      return vCount;
    }
    function addFace(i,j,k){ obj += `f ${i} ${j} ${k}\n`; }

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

      const idx0 = ring0.map(addVertex);
      const idx1 = ring1.map(addVertex);

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

    for (const [color, segs] of groups){
      obj += `\nusemtl ${colorToMtlName.get(color)}\n`;
      for (const s of segs){
        const w = Number(s.width ?? 1);
        const r = Math.max(minRadius, w * widthToRadius);
        addCylinderMesh(s.a, s.b, r, sides, capEnds);
      }
    }

    return { objText: obj, mtlText: mtl };
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
    const drawSegs = segs.filter(s => !s.isSnapSpoke);

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

  function downloadTextFile(filename, text, mimeType){
    const a = document.createElement("a");
    a.href = "data:" + mimeType + ";charset=utf-8," + encodeURIComponent(text);
    a.download = filename;
    a.click();
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


  function readMultiviewSettings(){
    const cols = Math.round(getNumberInput("quiltColsInput", 8, 1, 16));
    const rows = Math.round(getNumberInput("quiltRowsInput", 6, 1, 16));
    const totalViews = Math.min(cols * rows, Math.round(getNumberInput("quiltViewsInput", cols * rows, 1, cols * rows)));
    const tileW = Math.round(getNumberInput("quiltTileWInput", 420, 64, 2048));
    const tileH = Math.round(getNumberInput("quiltTileHInput", 420, 64, 2048));
    const parallaxDeg = getNumberInput("quiltParallaxInput", 10, 0, 90);
    let leftIndex = Math.round(getNumberInput("sbsLeftInput", Math.floor(totalViews * 0.38), 0, totalViews - 1));
    let rightIndex = Math.round(getNumberInput("sbsRightInput", Math.floor(totalViews * 0.62), 0, totalViews - 1));
    if (leftIndex === rightIndex) rightIndex = clamp(rightIndex + 1, 0, totalViews - 1);
    return { cols, rows, totalViews, tileW, tileH, parallaxDeg, leftIndex, rightIndex };
  }

  function openMultiviewPreview(){
    if (!segments.length) { setStatus("Nothing to preview (run something first)."); return; }

    const existing = document.getElementById("_logoPreviewModal");
    if (existing) existing.remove();

    const settings = readMultiviewSettings();
    const views = [];
    let quiltCanvas = null;
    let animTimer = null;
    let animDir = 1;

    setStatus(`Rendering ${settings.totalViews} preview views...`);
    for (let i = 0; i < settings.totalViews; i++)
      views.push(renderViewCanvas(i, settings.totalViews, settings.tileW, settings.tileH, settings.parallaxDeg));

    const overlay = document.createElement("div");
    overlay.id = "_logoPreviewModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9998;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box";

    const box = document.createElement("div");
    box.style.cssText = "background:#111821;border:1px solid rgba(180,200,220,.28);border-radius:14px;padding:12px;width:min(96vw,1180px);height:min(92vh,900px);display:grid;grid-template-rows:auto 1fr auto;gap:10px;color:#e8eef8;box-sizing:border-box";

    const top = document.createElement("div");
    top.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";
    const title = document.createElement("div");
    title.textContent = `Multiview Preview: ${settings.totalViews} views, ${settings.parallaxDeg}° parallax`;
    title.style.cssText = "font-weight:650;margin-right:auto";
    const close = document.createElement("button");
    close.textContent = "✕";
    close.style.cssText = "padding:5px 10px;border-radius:8px";
    close.onclick = () => { if (animTimer) clearInterval(animTimer); overlay.remove(); };
    top.appendChild(title); top.appendChild(close);
    box.appendChild(top);

    const stage = document.createElement("div");
    stage.style.cssText = "background:#05080c;border:1px solid rgba(127,127,127,.25);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:auto;min-height:0";
    const preview = document.createElement("canvas");
    preview.style.cssText = "max-width:100%;max-height:100%;object-fit:contain";
    const pctx = preview.getContext("2d", { alpha:false });
    stage.appendChild(preview);
    box.appendChild(stage);

    const controls = document.createElement("div");
    controls.style.cssText = "display:grid;grid-template-columns:1fr;gap:8px;font-size:13px";

    const row1 = document.createElement("div");
    row1.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";
    const mode = document.createElement("select");
    mode.innerHTML = '<option value="single">Single view</option><option value="sbs">SBS selected L/R</option><option value="quilt">Quilt sheet</option>';
    mode.style.cssText = "padding:5px 8px;border-radius:8px";
    const animate = document.createElement("button");
    animate.textContent = "Animate wiggle";
    animate.style.cssText = "padding:5px 8px;border-radius:8px";
    const viewLabel = document.createElement("span");
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export current preview PNG";
    exportBtn.style.cssText = "padding:5px 8px;border-radius:8px";
    row1.append("Mode:", mode, animate, exportBtn, viewLabel);

    const row2 = document.createElement("div");
    row2.style.cssText = "display:grid;grid-template-columns:auto 1fr auto auto auto;gap:8px;align-items:center";
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "0"; slider.max = String(settings.totalViews - 1); slider.value = String(Math.floor(settings.totalViews / 2));
    const leftBox = document.createElement("input");
    leftBox.type = "number"; leftBox.min = "0"; leftBox.max = String(settings.totalViews - 1); leftBox.value = String(settings.leftIndex); leftBox.style.cssText = "width:60px";
    const rightBox = document.createElement("input");
    rightBox.type = "number"; rightBox.min = "0"; rightBox.max = String(settings.totalViews - 1); rightBox.value = String(settings.rightIndex); rightBox.style.cssText = "width:60px";
    row2.append("View:", slider, "L:", leftBox, rightBox);

    const note = document.createElement("div");
    note.textContent = "Tip: in SBS mode, make the L/R view numbers farther apart to simulate stronger depth or hyperstereo. If depth feels inside-out, swap L and R.";
    note.style.cssText = "opacity:.82";
    controls.append(row1, row2, note);
    box.appendChild(controls);

    function clampIndex(v){
      v = Math.round(Number(v));
      if (!Number.isFinite(v)) v = 0;
      return clamp(v, 0, settings.totalViews - 1);
    }

    function drawPreview(){
      const m = mode.value;
      const idx = clampIndex(slider.value);
      const li = clampIndex(leftBox.value);
      const ri = clampIndex(rightBox.value);
      leftBox.value = String(li); rightBox.value = String(ri);

      if (m === "quilt"){
        if (!quiltCanvas){
          quiltCanvas = document.createElement("canvas");
          quiltCanvas.width = settings.cols * settings.tileW;
          quiltCanvas.height = settings.rows * settings.tileH;
          const qctx = quiltCanvas.getContext("2d", { alpha:false });
          qctx.fillStyle = "#0b0f14"; qctx.fillRect(0,0,quiltCanvas.width,quiltCanvas.height);
          for (let i = 0; i < views.length; i++) qctx.drawImage(views[i], (i % settings.cols) * settings.tileW, Math.floor(i / settings.cols) * settings.tileH);
        }
        preview.width = quiltCanvas.width; preview.height = quiltCanvas.height;
        pctx.drawImage(quiltCanvas, 0, 0);
        viewLabel.textContent = ` Quilt ${settings.cols}×${settings.rows}`;
      } else if (m === "sbs"){
        preview.width = settings.tileW * 2; preview.height = settings.tileH;
        pctx.fillStyle = "#0b0f14"; pctx.fillRect(0,0,preview.width,preview.height);
        pctx.drawImage(views[li], 0, 0);
        pctx.drawImage(views[ri], settings.tileW, 0);
        viewLabel.textContent = ` SBS L${li} / R${ri}  separation ${Math.abs(ri-li)} views`;
      } else {
        preview.width = settings.tileW; preview.height = settings.tileH;
        pctx.drawImage(views[idx], 0, 0);
        viewLabel.textContent = ` View ${idx} of ${settings.totalViews - 1}`;
      }
    }

    function stopAnim(){
      if (animTimer) { clearInterval(animTimer); animTimer = null; animate.textContent = "Animate wiggle"; }
    }

    animate.onclick = () => {
      if (animTimer) { stopAnim(); return; }
      mode.value = "single";
      animate.textContent = "Stop animation";
      animTimer = setInterval(() => {
        let v = clampIndex(slider.value) + animDir;
        if (v >= settings.totalViews - 1) { v = settings.totalViews - 1; animDir = -1; }
        if (v <= 0) { v = 0; animDir = 1; }
        slider.value = String(v);
        drawPreview();
      }, 90);
    };
    exportBtn.onclick = () => downloadCanvasPng("logo3d_multiview_preview.png", preview);
    mode.onchange = () => { stopAnim(); drawPreview(); };
    slider.oninput = drawPreview;
    leftBox.oninput = drawPreview;
    rightBox.oninput = drawPreview;
    overlay.onclick = (e) => { if (e.target === overlay) { stopAnim(); overlay.remove(); } };

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    drawPreview();
    setStatus(`Preview ready ✅ ${settings.totalViews} views. Use the slider, SBS mode, or Animate wiggle.`);
  }

  function stlExportFromSegments(segs, opts = {}){
    const sides = opts.sides ?? 12;
    const minRadius = opts.minRadius ?? 0.25;
    const widthToRadius = opts.widthToRadius ?? 0.35;
    const capEnds = opts.capEnds ?? true;

    const cross = (a,b)=>V(a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x);
    const lenV = (a)=>Math.hypot(a.x,a.y,a.z);
    const norm2 = (a)=>{ const L=lenV(a)||1; return V(a.x/L,a.y/L,a.z/L); };

    const drawSegs = segs.filter(s => !s.isSnapSpoke);
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

    for (const s of drawSegs){
      const w = Number(s.width ?? 1);
      const r = Math.max(minRadius, (Number.isFinite(w) ? w : 1) * widthToRadius);
      addCylinder(s.a, s.b, r, sides, capEnds);
    }

    out += "endsolid logo3d\n";
    return out;
  }

  // ---------- UI wiring ----------
  $("runBtn")?.addEventListener("click", () => {
    try { runProgram(); } catch(e){ setStatus("Error: " + (e.message || e)); }
  });

  $("clearBtn")?.addEventListener("click", () => {
    clearSegments(); draw(); setStatus("Cleared.");
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
      const { objText, mtlText } = objExportTubesWithMtl(segments, {
        sides: 14,
        capEnds: true,
        minRadius: 0.25,
        widthToRadius: 0.35,
        mtlFilename,
      });
      downloadTextFile("logo3d.obj", objText, "text/plain");
      downloadTextFile(mtlFilename, mtlText, "text/plain");
      setStatus("Exported OBJ+MTL ✅ (tubes, width-based)");
    } catch (e) {
      setStatus("OBJ export error: " + (e.message || e));
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


  $("previewQuiltBtn")?.addEventListener("click", () => {
    try { openMultiviewPreview(); }
    catch (e) { setStatus("Preview error: " + (e.message || e)); }
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

  $("helpBtn")?.addEventListener("click", () => loadAndShowModal("./commands.txt", "Command Reference", true));
  $("ackBtn")?.addEventListener("click",  () => loadAndShowModal("./acknowledge.txt", "Acknowledgements", false));

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
        text.split("\n").forEach(line => {
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
      $("code").value = opt._logoCode;
    });
  })();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){ const m = document.getElementById("_logoModal"); if (m) m.remove(); }
  });

  draw();
})();