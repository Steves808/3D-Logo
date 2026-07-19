#!/usr/bin/env node
"use strict";
// batch-export.js — Node.js CLI for logo3d.  No DOM, no canvas.
// Usage: node batch-export.js [options] input.logo
//   --mode=rods|voxels|dots   (default: rods)
//   --shape=tetra|octa|cube   (dots only, default: tetra)
//   --dot-size=N              (dots only, default: 1.0)
//   --dot-density=N           (dots only: dots per unit length, default: 2)
//   --split-threshold=N       (voxels: segments longer than N get dots at both endpoints, default: 5.0)
//   --voxel-size=N            (voxels only, default: 1.0)
//   --sides=N                 (rods only, default: 12)
//   --min-radius=N            (rods only, default: 0.25)
//   --width-to-radius=N       (rods only, default: 0.35)
//   --out=filename.obj        (default: logo3d.obj)

const fs   = require("fs");
const path = require("path");

// ─────────────────── CLI ────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    mode: "rods", shape: "tetra", dotSize: 1.0, dotDensity: 2, splitThreshold: 5.0,
    voxelSize: 1.0, sides: 12, minRadius: 0.25, widthToRadius: 0.35,
    out: null, input: null
  };
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.+)$/.exec(a);
    if (m) {
      // convert kebab-case flag to camelCase key
      const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val  = m[2];
      if (key in opts && typeof opts[key] === "number") opts[key] = Number(val);
      else opts[key] = val;
    } else if (!a.startsWith("-")) {
      opts.input = a;
    }
  }
  return opts;
}

// ─────────────────── Math primitives ────────────────────────────────────────

function V(x=0,y=0,z=0){ return {x,y,z}; }
function add(a,b){ return V(a.x+b.x, a.y+b.y, a.z+b.z); }
function sub(a,b){ return V(a.x-b.x, a.y-b.y, a.z-b.z); }
function mul(a,s){ return V(a.x*s,   a.y*s,   a.z*s);   }
function I3(){ return [1,0,0, 0,1,0, 0,0,1]; }
function matMul(A,B){
  const C = new Array(9);
  for (let r=0;r<3;r++) for (let c=0;c<3;c++)
    C[r*3+c] = A[r*3]*B[c] + A[r*3+1]*B[3+c] + A[r*3+2]*B[6+c];
  return C;
}
function matVec(M,v){
  return V(M[0]*v.x+M[1]*v.y+M[2]*v.z, M[3]*v.x+M[4]*v.y+M[5]*v.z, M[6]*v.x+M[7]*v.y+M[8]*v.z);
}
function rotAxis(axis, rad){
  const {x,y,z} = axis, c=Math.cos(rad), s=Math.sin(rad), t=1-c;
  return [
    t*x*x+c,   t*x*y-s*z, t*x*z+s*y,
    t*x*y+s*z, t*y*y+c,   t*y*z-s*x,
    t*x*z-s*y, t*y*z+s*x, t*z*z+c
  ];
}
function norm(v){ const m=Math.hypot(v.x,v.y,v.z)||1; return V(v.x/m,v.y/m,v.z/m); }
function basisForward(R){ return norm(matVec(R,V(0,0,1))); }
function basisRight(R){   return norm(matVec(R,V(1,0,0))); }
function basisUp(R){      return norm(matVec(R,V(0,1,0))); }

// ─────────────────── Interpreter state ──────────────────────────────────────

const DEG         = Math.PI / 180;
const ARC_STEP_DEG = 3;
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
const _STOP = Object.freeze({ __stop__: true });

let segments = [];
let turtle;
const vars  = Object.create(null);
const marks = Object.create(null);
const procs = Object.create(null);

function makeTurtle(){
  return { pos: V(), R: I3(), penDown: true, color: "#ffffff", width: 1.5 };
}
function cloneTurtle(t){
  return { pos: V(t.pos.x,t.pos.y,t.pos.z), R: t.R.slice(), penDown: !!t.penDown, color: String(t.color), width: +t.width };
}
function addDrawnSegment(a,b,color,width){
  segments.push({ a:V(a.x,a.y,a.z), b:V(b.x,b.y,b.z), color, width, isSnapSpoke:false });
}
function addSnapSpokeSegment(a,b,color,width){
  segments.push({ a:V(a.x,a.y,a.z), b:V(b.x,b.y,b.z), color, width, isSnapSpoke:true });
}

// ─────────────────── Color ──────────────────────────────────────────────────

const NAMED_CSS = {
  WHITE:"#ffffff", BLACK:"#000000",
  RED:"#ff3b30", ORANGE:"#ff9f0a", YELLOW:"#ffd60a",
  GREEN:"#34c759", BLUE:"#0a84ff", PURPLE:"#bf5af2",
  MAGENTA:"#ff2d55", CYAN:"#64d2ff", PINK:"#ff2d55", GRAY:"#8e8e93"
};

function colorFromValue(val){
  if (val && typeof val==="object" && !Array.isArray(val)) val = resolveAny(val);
  if (Array.isArray(val)){
    const r=clamp(Number(resolveNumber(val[0])),0,99);
    const g=clamp(Number(resolveNumber(val[1])),0,99);
    const b=clamp(Number(resolveNumber(val[2])),0,99);
    return `rgb(${Math.round(r/99*255)},${Math.round(g/99*255)},${Math.round(b/99*255)})`;
  }
  const tok = String(val).trim(), up = tok.toUpperCase();
  if (up === "RC"){
    return `rgb(${Math.floor(Math.random()*256)},${Math.floor(Math.random()*256)},${Math.floor(Math.random()*256)})`;
  }
  if (/^#[0-9A-F]{3,8}$/i.test(tok)) return tok;
  if (NAMED_CSS[up]) return NAMED_CSS[up];
  if (/^[A-Z_][A-Z0-9_]*$/.test(up) && vars[up] != null) return colorFromValue(vars[up]);
  return tok;
}

// Pure-JS CSS color parser (no canvas required).
function parseCssColorToKd(colorStr){
  const s = String(colorStr || "").trim().toLowerCase() || "#ffffff";

  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return { r:parseInt(m[1]+m[1],16)/255, g:parseInt(m[2]+m[2],16)/255, b:parseInt(m[3]+m[3],16)/255 };

  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(s);
  if (m) return { r:parseInt(m[1],16)/255, g:parseInt(m[2],16)/255, b:parseInt(m[3],16)/255 };

  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (m) return { r:parseInt(m[1])/255, g:parseInt(m[2])/255, b:parseInt(m[3])/255 };

  const fixed = {
    "#ffffff":[1,1,1], "#000000":[0,0,0],
    "#ff3b30":[1,0.231,0.188], "#ff9f0a":[1,0.624,0.039], "#ffd60a":[1,0.839,0.039],
    "#34c759":[0.204,0.780,0.349], "#0a84ff":[0.039,0.518,1], "#bf5af2":[0.749,0.353,0.949],
    "#ff2d55":[1,0.176,0.333], "#64d2ff":[0.392,0.824,1], "#8e8e93":[0.557,0.557,0.576]
  };
  if (fixed[s]) { const [r,g,b]=fixed[s]; return {r,g,b}; }

  return { r:1, g:1, b:1 };
}

// ─────────────────── Tokenizer ───────────────────────────────────────────────

function tokenize(src){
  src = src.replace(/ /g, " ");
  src = src.split("\n").map(line => {
    const i = line.indexOf(";");
    return i >= 0 ? line.slice(0,i) : line;
  }).join("\n");
  src = src.replace(/#timeout\s*=\s*[0-9.]+/gi, "");
  const raw = src.match(/\[|\]|[^\s\[\]]+/g) || [];
  return raw.map(t => {
    if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return t;
    return t.toUpperCase();
  });
}

// ─────────────────── Parser ──────────────────────────────────────────────────

function parseList(tokens, i){
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

function parseBlock(tokens, i, arities = Object.create(null)){
  const block = [];
  while (i < tokens.length){
    const tok = tokens[i];
    if (tok === "]") return { block, next: i+1 };

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

    if (tok === "REPEAT" || tok === "RPT"){
      const countTok = tokens[i+1];
      if (countTok == null) throw new Error(tok + " needs a count");
      if (tokens[i+2] !== "[") throw new Error(tok + " must be followed by [ ... ]");
      const inner = parseBlock(tokens, i+3, arities);
      block.push({ op:"REPEAT", count: countTok, body: inner.block });
      i = inner.next;
      continue;
    }

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

    if (tok === "SC" || tok === "SETCOLOR" || tok === "COLOR"){
      const n1 = tokens[i+1];
      if (n1 == null) throw new Error(tok + " needs an argument");
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

    if (["PU","PD","HOME","CENTER","CS","CLEAR","STOP"].includes(tok)){
      block.push({ op: tok });
      i += 1;
      continue;
    }

    const oneArgOps = ["FD","BK","LT","RT","UP","DN","RL","RR","WIDTH","OMARK","GOTO","PAUSE","SLY","SP"];
    if (oneArgOps.includes(tok)){
      const pv = parseValueToken(tokens, i+1);
      if (pv.value == null) throw new Error(tok + " needs an argument");
      block.push({ op: tok, arg: pv.value });
      i = pv.next;
      continue;
    }

    if (["AR","AL","AU","AD","ARCRIGHT","ARCLEFT","ARCUP","ARCDOWN"].includes(tok)){
      const op = tok === "ARCRIGHT" ? "AR" : tok === "ARCLEFT" ? "AL" :
                 tok === "ARCUP"    ? "AU" : tok === "ARCDOWN"  ? "AD" : tok;
      const a1 = tokens[i+1], a2 = tokens[i+2];
      if (a1 == null || a2 == null) throw new Error(tok + " needs 2 args");
      block.push({ op, a1, a2 });
      i += 3;
      continue;
    }

    if (tok === "IMPORT"){ i += 2; continue; }

    {
      const callName = String(tok).toUpperCase();
      const arity = arities[callName] || 0;
      const args = [];
      for (let k=0; k<arity; k++) args.push(tokens[i+1+k]);
      block.push({ op:"CALL", name: callName, args });
      i += 1 + arity;
    }
  }
  return { block, next: i };
}

function parseProgram(src){
  const tokens = tokenize(src);
  const arities = Object.create(null);
  for (let i=0; i<tokens.length; i++){
    if (tokens[i] === "TO" && i+1 < tokens.length){
      const name = String(tokens[i+1]).toUpperCase();
      let j = i+2, arity = 0;
      while (j < tokens.length && String(tokens[j]).startsWith(":")) { arity++; j++; }
      arities[name] = arity;
    }
  }
  return parseBlock(tokens, 0, arities).block;
}

// ─────────────────── Expression evaluator ───────────────────────────────────

function evalExpr(expr){
  expr = String(expr).trim().toUpperCase().replace(/:[A-Z_][A-Z0-9_]*/g, s => s.slice(1));
  const tokens = [];
  const re = /\s*([A-Z_][A-Z0-9_]*|\d+(?:\.\d+)?|\.\d+|[()+\-*/])\s*/g;
  let m;
  while ((m = re.exec(expr)) !== null) tokens.push(m[1]);
  if (!tokens.length) throw new Error("Empty expression");

  const out=[], ops=[];
  const prec={"u-":3,"*":2,"/":2,"+":1,"-":1};
  const rightAssoc={"u-":true};
  function isOp(t){ return t==="+"||t==="-"||t==="*"||t==="/"||t==="u-"; }

  for (let i=0; i<tokens.length; i++){
    let t = tokens[i];
    if (t==="-"){
      const prev=tokens[i-1];
      if (i===0||prev==="("||isOp(prev)) t="u-";
    }
    if (/^\d/.test(t)||/^\.\d/.test(t))         { out.push({type:"num",v:Number(t)}); }
    else if (/^[A-Z_]/.test(t))                  { out.push({type:"var",v:t}); }
    else if (t==="(")                             { ops.push(t); }
    else if (t===")"){
      while (ops.length&&ops[ops.length-1]!=="(") out.push({type:"op",v:ops.pop()});
      if (!ops.length) throw new Error("Mismatched parentheses");
      ops.pop();
    } else if (isOp(t)){
      while (ops.length){
        const top=ops[ops.length-1];
        if (!isOp(top)) break;
        const pTop=prec[top], pT=prec[t];
        if (pTop>pT||(pTop===pT&&!rightAssoc[t])) out.push({type:"op",v:ops.pop()});
        else break;
      }
      ops.push(t);
    } else { throw new Error("Bad token in expression: "+t); }
  }
  while (ops.length){
    const op=ops.pop();
    if (op==="("||op===")") throw new Error("Mismatched parentheses");
    out.push({type:"op",v:op});
  }

  const stack=[];
  for (const item of out){
    if (item.type==="num") stack.push(item.v);
    else if (item.type==="var"){
      if (vars[item.v]==null) throw new Error("Unknown variable: "+item.v);
      const n=Number(vars[item.v]);
      if (!Number.isFinite(n)) throw new Error("Variable not numeric: "+item.v);
      stack.push(n);
    } else {
      if (item.v==="u-"){
        if (stack.length<1) throw new Error("Bad unary minus");
        stack.push(-stack.pop());
      } else {
        if (stack.length<2) throw new Error("Bad operator: "+item.v);
        const b=stack.pop(), a=stack.pop();
        switch(item.v){
          case "+": stack.push(a+b); break;
          case "-": stack.push(a-b); break;
          case "*": stack.push(a*b); break;
          case "/": stack.push(a/b); break;
        }
      }
    }
  }
  if (stack.length!==1) throw new Error("Bad expression: "+expr);
  return stack[0];
}

function resolveAny(tok){
  if (tok && typeof tok==="object" && !Array.isArray(tok)){
    if (tok.fn==="RANDOM"){ const mx=resolveNumber(tok.max); return Math.floor(Math.random()*(mx||1)); }
    if (tok.fn==="PICK"){
      const items=tok.items||[];
      if (!items.length) throw new Error("PICK [] is empty");
      return items[Math.floor(Math.random()*items.length)];
    }
  }
  if (Array.isArray(tok)) return tok;
  tok = String(tok).trim().toUpperCase();
  if (tok.startsWith(":")) tok = tok.slice(1);
  if (tok==="GC"||tok==="GETCOLOR") return turtle.color;
  if (/^[A-Z_][A-Z0-9_]*$/.test(tok)&&vars[tok]!=null) return vars[tok];
  if (/^-?\d+(\.\d+)?$/.test(tok)||/^-?\.\d+$/.test(tok)) return Number(tok);
  return evalExpr(tok);
}

function resolveNumber(tok){
  const v=resolveAny(tok), n=Number(v);
  if (!Number.isFinite(n)) throw new Error("Expected number, got: "+String(v));
  return n;
}

function evalCondition(cond){
  if (!cond||!cond.length) return false;
  if (cond.length>=3){
    const op=String(cond[1]).toUpperCase();
    const cmp={GT:(a,b)=>a>b,LT:(a,b)=>a<b,GE:(a,b)=>a>=b,LE:(a,b)=>a<=b,
               "=":(a,b)=>a===b,EQ:(a,b)=>a===b,NE:(a,b)=>a!==b,NEQ:(a,b)=>a!==b};
    if (cmp[op]){
      try { return cmp[op](resolveNumber(cond[0]),resolveNumber(cond[2])); } catch(e){ return false; }
    }
  }
  if (cond.length===1){
    const tok=String(cond[0]), eq=tok.indexOf("=");
    if (eq>0){
      try { return resolveNumber(tok.slice(0,eq))===resolveNumber(tok.slice(eq+1)); } catch(e){ return false; }
    }
    try { return resolveNumber(tok)!==0; } catch(e){ return false; }
  }
  return true;
}

// ─────────────────── SP helper ───────────────────────────────────────────────

function closestRaySegment(o,d,a,b){
  const ab=sub(b,a), ao=sub(o,a);
  const dd=d.x*d.x+d.y*d.y+d.z*d.z;
  const ab2=ab.x*ab.x+ab.y*ab.y+ab.z*ab.z;
  if (ab2<1e-12) return null;
  const dab=d.x*ab.x+d.y*ab.y+d.z*ab.z;
  const dao=d.x*ao.x+d.y*ao.y+d.z*ao.z;
  const abo=ab.x*ao.x+ab.y*ao.y+ab.z*ao.z;
  const denom=dd*ab2-dab*dab;
  let t,u;
  if (Math.abs(denom)<1e-12){
    u=clamp(-abo/ab2,0,1);
    const ps=add(a,mul(ab,u)), op=sub(ps,o);
    t=Math.max(0,(op.x*d.x+op.y*d.y+op.z*d.z)/dd);
  } else {
    t=(dab*abo-ab2*dao)/denom;
    u=clamp((dd*abo-dab*dao)/denom,0,1);
    if (t<0) t=0;
    const ps=add(a,mul(ab,u)), op=sub(ps,o);
    t=Math.max(0,(op.x*d.x+op.y*d.y+op.z*d.z)/dd);
  }
  const pr=add(o,mul(d,t)), ps=add(a,mul(ab,u));
  const dx=pr.x-ps.x, dy=pr.y-ps.y, dz=pr.z-ps.z;
  return { t, dist2:dx*dx+dy*dy+dz*dz, ps };
}

// ─────────────────── Interpreter ─────────────────────────────────────────────

function execBlock(block, safety){
  for (const ins of block){
    if (--safety.stepsLeft<=0) throw new Error("Stopped: too many steps (infinite loop?)");
    switch(ins.op){
      case "PROCDEF":
        procs[ins.name] = { body: ins.body, params: ins.params || [] };
        break;

      case "CALL": {
        const procDef=procs[ins.name];
        if (!procDef) throw new Error("Unknown procedure: "+ins.name);
        const body  =Array.isArray(procDef)?procDef:procDef.body;
        const params=Array.isArray(procDef)?[]:(procDef.params||[]);
        const callArgs=ins.args||[];
        const saved={};
        for (let k=0;k<params.length;k++){
          saved[params[k]]=vars[params[k]];
          vars[params[k]]=k<callArgs.length?resolveAny(callArgs[k]):undefined;
        }
        try { execBlock(body,safety); }
        catch(e){ if(e!==_STOP) throw e; }
        finally { for (const p of params){ if(saved[p]===undefined) delete vars[p]; else vars[p]=saved[p]; } }
        break;
      }

      case "STOP": throw _STOP;

      case "IF": {
        const ok=evalCondition(ins.cond);
        if (ok) execBlock(ins.thenBody,safety);
        else if (ins.elseBody) execBlock(ins.elseBody,safety);
        break;
      }

      case "CS": case "CLEAR": segments=[]; break;

      case "HOME": case "CENTER": turtle=makeTurtle(); break;

      case "PU": turtle.penDown=false; break;
      case "PD": turtle.penDown=true;  break;

      case "SC": turtle.color=colorFromValue(ins.value); break;

      case "WIDTH": {
        const w=resolveNumber(ins.arg);
        if (Number.isFinite(w)&&w>0) turtle.width=w;
        break;
      }

      case "MAKE": {
        const a1=String(ins.a1).toUpperCase();
        if (a1.includes("=")){
          const [name,...rest]=a1.split("=");
          if (!name||rest.join("=")==null) throw new Error("Bad MAKE syntax: "+a1);
          vars[name.toUpperCase()]=resolveAny(rest.join("="));
        } else {
          vars[a1.toUpperCase()]=resolveAny(ins.a2);
        }
        break;
      }

      case "OMARK": marks[String(ins.arg).toUpperCase()]=cloneTurtle(turtle); break;

      case "GOTO": {
        const key=String(ins.arg).toUpperCase();
        const m=marks[key];
        if (!m) throw new Error("No mark named: "+key);
        turtle=cloneTurtle(m);
        break;
      }

      case "FD": case "BK": {
        const dist=resolveNumber(ins.arg);
        const fwd=basisForward(turtle.R);
        const step=mul(fwd,ins.op==="FD"?dist:-dist);
        const a=turtle.pos, b=add(turtle.pos,step);
        turtle.pos=b;
        if (turtle.penDown) addDrawnSegment(a,b,turtle.color,turtle.width);
        break;
      }

      case "LT": case "RT": {
        const deg=resolveNumber(ins.arg);
        const rad=(ins.op==="LT"?deg:-deg)*DEG;
        turtle.R=matMul(rotAxis(basisUp(turtle.R),rad),turtle.R);
        break;
      }

      case "UP": case "DN": {
        const deg=resolveNumber(ins.arg);
        const rad=(ins.op==="UP"?deg:-deg)*DEG;
        turtle.R=matMul(rotAxis(basisRight(turtle.R),rad),turtle.R);
        break;
      }

      case "RL": case "RR": {
        const deg=resolveNumber(ins.arg);
        const rad=(ins.op==="RL"?deg:-deg)*DEG;
        turtle.R=matMul(rotAxis(basisForward(turtle.R),rad),turtle.R);
        break;
      }

      case "AR": case "AL": case "AU": case "AD": {
        const ang=resolveNumber(ins.a1);
        const radius=Math.max(0.0001,resolveNumber(ins.a2));
        const steps=Math.max(8,Math.ceil(Math.abs(ang)/ARC_STEP_DEG));
        const stepAng=ang/steps;
        const isYaw=(ins.op==="AR"||ins.op==="AL");
        const axisFn=isYaw?basisUp:basisRight;
        const neg=(ins.op==="AR"||ins.op==="AD");
        for (let k=0;k<steps;k++){
          const turnRad=(neg?-stepAng:stepAng)*DEG;
          turtle.R=matMul(rotAxis(axisFn(turtle.R),turnRad),turtle.R);
          const arcLen=(Math.abs(stepAng)*DEG)*radius;
          const fwd=basisForward(turtle.R);
          const a=turtle.pos, b=add(turtle.pos,mul(fwd,arcLen));
          turtle.pos=b;
          if (turtle.penDown) addDrawnSegment(a,b,turtle.color,turtle.width);
        }
        break;
      }

      case "SP": {
        const maxDist=resolveNumber(ins.arg);
        const o=turtle.pos, d=basisForward(turtle.R);
        const tol=Math.max(1.5,(turtle.width||1)*0.75), tol2=tol*tol;
        let bestT=Infinity, bestHit=null;
        for (const s of segments){
          if (s.isSnapSpoke) continue;
          const hit=closestRaySegment(o,d,s.a,s.b);
          if (!hit||hit.t<=0||hit.t>maxDist||hit.dist2>tol2) continue;
          if (hit.t<bestT){ bestT=hit.t; bestHit=hit.ps; }
        }
        if (bestHit){
          if (turtle.penDown) addSnapSpokeSegment(o,bestHit,turtle.color,turtle.width);
          turtle.pos=V(bestHit.x,bestHit.y,bestHit.z);
        }
        break;
      }

      case "REPEAT": {
        const n=Math.floor(resolveNumber(ins.count));
        if (!Number.isFinite(n)||n<0) throw new Error("REPEAT count must be >= 0");
        for (let k=0;k<n;k++) execBlock(ins.body,safety);
        break;
      }

      case "PAUSE": case "SLY": break;

      default: throw new Error("Unhandled op: "+ins.op);
    }
  }
}

// ─────────────────── Shared geometry helpers ─────────────────────────────────

function placementPoints(s, splitThreshold){
  const len = Math.hypot(s.b.x-s.a.x, s.b.y-s.a.y, s.b.z-s.a.z);
  if (len > splitThreshold)
    return [s.a, s.b];
  return [{ x:(s.a.x+s.b.x)/2, y:(s.a.y+s.b.y)/2, z:(s.a.z+s.b.z)/2 }];
}

function buildMtl(groups, colorToMtlName){
  let mtl = "";
  let idx = 0;
  for (const [color] of groups){
    const name = `mat_${idx++}`;
    colorToMtlName.set(color, name);
    const kd = parseCssColorToKd(color);
    mtl += `newmtl ${name}\nKd ${kd.r.toFixed(6)} ${kd.g.toFixed(6)} ${kd.b.toFixed(6)}\nKa 0 0 0\nKs 0 0 0\nd 1\n\n`;
  }
  return mtl;
}

function groupByColor(segs){
  const groups = new Map();
  for (const s of segs.filter(s => !s.isSnapSpoke)){
    const key = String(s.color || "#ffffff");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return groups;
}

// ─────────────────── Export: rods ────────────────────────────────────────────

function exportRods(segs, opts){
  const sides         = opts.sides         ?? 12;
  const minRadius     = opts.minRadius     ?? 0.25;
  const widthToRadius = opts.widthToRadius ?? 0.35;
  const capEnds       = true;
  const mtlFilename   = path.basename(opts.out || "logo3d.obj").replace(/\.obj$/i, ".mtl");

  const cross = (a,b)=>V(a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x);
  const lenV  = (a)=>Math.hypot(a.x,a.y,a.z);
  const n2    = (a)=>{ const L=lenV(a)||1; return V(a.x/L,a.y/L,a.z/L); };

  const groups         = groupByColor(segs);
  const colorToMtlName = new Map();
  const mtl            = buildMtl(groups, colorToMtlName);

  let obj     = `# logo3d rods export\nmtllib ${mtlFilename}\n`;
  let vCount  = 0;

  function addV(p){ obj += `v ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${p.z.toFixed(6)}\n`; return ++vCount; }
  function addF(i,j,k){ obj += `f ${i} ${j} ${k}\n`; }

  function addCylinder(p0,p1,r,nSides){
    const axis=sub(p1,p0), L=lenV(axis);
    if (L<1e-6) return;
    const d=n2(axis);
    const helper=Math.abs(d.y)<0.9?V(0,1,0):V(1,0,0);
    const u=n2(cross(d,helper)), v=n2(cross(d,u));
    const ring0=[], ring1=[];
    for (let i=0;i<nSides;i++){
      const t=(i/nSides)*Math.PI*2, cu=Math.cos(t), su=Math.sin(t);
      const off=add(mul(u,r*cu),mul(v,r*su));
      ring0.push(add(p0,off)); ring1.push(add(p1,off));
    }
    const i0=ring0.map(addV), i1=ring1.map(addV);
    for (let i=0;i<nSides;i++){
      const j=(i+1)%nSides;
      addF(i0[i],i1[i],i1[j]); addF(i0[i],i1[j],i0[j]);
    }
    if (capEnds){
      const c0=addV(p0), c1=addV(p1);
      for (let i=0;i<nSides;i++){ const j=(i+1)%nSides; addF(c0,i0[j],i0[i]); addF(c1,i1[i],i1[j]); }
    }
  }

  for (const [color,segList] of groups){
    obj += `\nusemtl ${colorToMtlName.get(color)}\n`;
    for (const s of segList){
      const w=Number(s.width??1), r=Math.max(minRadius,w*widthToRadius);
      addCylinder(s.a,s.b,r,sides);
    }
  }
  return { objText: obj, mtlText: mtl };
}

// ─────────────────── Export: voxels ──────────────────────────────────────────

function exportVoxels(segs, opts){
  const voxelSize      = opts.voxelSize      ?? 1.0;
  const splitThreshold = opts.splitThreshold ?? 5.0;
  const mtlFilename    = path.basename(opts.out || "logo3d.obj").replace(/\.obj$/i, ".mtl");
  const h              = voxelSize / 2;

  const groups         = groupByColor(segs);
  const colorToMtlName = new Map();
  const mtl            = buildMtl(groups, colorToMtlName);

  // collect unique voxels with first-seen color
  const voxelMap = new Map();
  for (const [color, segList] of groups){
    for (const s of segList){
      for (const p of placementPoints(s, splitThreshold)){
        const ix=Math.round(p.x/voxelSize), iy=Math.round(p.y/voxelSize), iz=Math.round(p.z/voxelSize);
        const key=`${ix},${iy},${iz}`;
        if (!voxelMap.has(key)) voxelMap.set(key, { cx:ix*voxelSize, cy:iy*voxelSize, cz:iz*voxelSize, color });
      }
    }
  }

  let obj    = `# logo3d voxels export\nmtllib ${mtlFilename}\n`;
  let vCount = 0;
  function addV(x,y,z){ obj += `v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`; return ++vCount; }
  function addF(a,b,c){ obj += `f ${a} ${b} ${c}\n`; }

  // group voxels by color for usemtl batching
  const voxByColor = new Map();
  for (const [, v] of voxelMap){
    if (!voxByColor.has(v.color)) voxByColor.set(v.color, []);
    voxByColor.get(v.color).push(v);
  }

  // cube vertex/face template (outward normals, CCW winding)
  //  local indices 0-7 correspond to offsets applied to (cx,cy,cz)
  const CV = [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]];
  const CF = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[2,6,7],[2,7,3],[1,5,6],[1,6,2],[0,7,4],[0,3,7]];

  for (const [color, voxList] of voxByColor){
    obj += `\nusemtl ${colorToMtlName.get(color)}\n`;
    for (const {cx,cy,cz} of voxList){
      const base = vCount;
      for (const [ox,oy,oz] of CV) addV(cx+ox*h, cy+oy*h, cz+oz*h);
      for (const [a,b,c] of CF) addF(base+a+1, base+b+1, base+c+1);
    }
  }

  return { objText: obj, mtlText: mtl };
}

// ─────────────────── Export: dots ────────────────────────────────────────────

const DOT_SHAPES = {
  tetra: {
    verts: [
      [0, 1, 0],
      [2*Math.SQRT2/3, -1/3, 0],
      [-Math.SQRT2/3, -1/3,  Math.sqrt(2/3)],
      [-Math.SQRT2/3, -1/3, -Math.sqrt(2/3)]
    ],
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
    verts: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]],
    faces: [
      [0,1,2],[0,2,3],[4,6,5],[4,7,6],
      [0,4,5],[0,5,1],[2,6,7],[2,7,3],
      [1,5,6],[1,6,2],[0,7,4],[0,3,7]
    ]
  }
};

function exportDots(segs, opts){
  const shape      = opts.shape      ?? "tetra";
  const dotSize    = opts.dotSize    ?? 1.0;
  const dotDensity = opts.dotDensity ?? 2;
  const mtlFilename = path.basename(opts.out || "logo3d.obj").replace(/\.obj$/i, ".mtl");

  const prim   = DOT_SHAPES[shape] ?? DOT_SHAPES.tetra;
  const groups = groupByColor(segs);
  const colorToMtlName = new Map();
  const mtl    = buildMtl(groups, colorToMtlName);

  let obj    = `# logo3d dots export (${shape}, size=${dotSize}, density=${dotDensity})\nmtllib ${mtlFilename}\n`;
  let vCount = 0;

  function placeDot(cx, cy, cz){
    const base = vCount;
    for (const [vx,vy,vz] of prim.verts){
      obj += `v ${(cx+vx*dotSize).toFixed(6)} ${(cy+vy*dotSize).toFixed(6)} ${(cz+vz*dotSize).toFixed(6)}\n`;
      vCount++;
    }
    for (const [a,b,c] of prim.faces)
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

// ─────────────────── Main ────────────────────────────────────────────────────

const opts = parseArgs(process.argv);

let src;
try {
  src = opts.input ? fs.readFileSync(opts.input, "utf8")
                   : fs.readFileSync(0, "utf8"); // fd 0 = stdin
} catch (e) {
  process.stderr.write([
    "Usage: node batch-export.js [options] input.logo",
    "  --mode=rods|voxels|dots      (default: rods)",
    "  --shape=tetra|octa|cube      (dots mode, default: tetra)",
    "  --dot-size=1.0               (dots mode, default: 1.0)",
    "  --dot-density=2              (dots mode: dots placed per unit length, default: 2)",
    "  --split-threshold=5.0        (voxels: segments longer than N get dots at both endpoints)",
    "  --voxel-size=1.0             (voxels mode)",
    "  --sides=12                   (rods mode)",
    "  --out=logo3d.obj",
    ""
  ].join("\n"));
  process.exit(1);
}

// reset interpreter state
segments = [];
turtle = makeTurtle();
for (const k of Object.keys(vars))  delete vars[k];
for (const k of Object.keys(marks)) delete marks[k];
for (const k of Object.keys(procs)) delete procs[k];

let ast;
try { ast = parseProgram(src); }
catch (e){ process.stderr.write("Parse error: " + e.message + "\n"); process.exit(1); }

try { execBlock(ast, { stepsLeft: 800000 }); }
catch (e){
  if (e !== _STOP){ process.stderr.write("Runtime error: " + e.message + "\n"); process.exit(1); }
}

const drawnCount = segments.filter(s => !s.isSnapSpoke).length;
const outFile    = opts.out || "logo3d.obj";
const mtlFile    = outFile.replace(/\.obj$/i, ".mtl");

let result;
if      (opts.mode === "dots")   result = exportDots(segments, opts);
else if (opts.mode === "voxels") result = exportVoxels(segments, opts);
else                              result = exportRods(segments, opts);

fs.writeFileSync(outFile, result.objText, "utf8");
fs.writeFileSync(mtlFile, result.mtlText, "utf8");

const modeInfo = opts.mode === "dots"
  ? ` shape=${opts.shape} dot-size=${opts.dotSize} dot-density=${opts.dotDensity}`
  : opts.mode === "voxels"
  ? ` voxel-size=${opts.voxelSize}`
  : ` sides=${opts.sides}`;

process.stdout.write(`Wrote ${outFile}  (${drawnCount} segments, mode=${opts.mode}${modeInfo})\n`);
process.stdout.write(`Wrote ${mtlFile}\n`);
