/**
 * FAUCHAR Design — homepage CAD demo.
 *
 * Dependency-free WebGL viewer for a real crown case on tooth 22: upper and lower
 * jaw scans and the crown seated in scan coordinates. Geometry, margin, axes and
 * every map and measurement come from demo-22.bin/.json, built from the case files
 * by scripts/build-demo22.py.
 *
 * The crown is a reference design made in CAD software. No AI runs here: the
 * "AI auto-design" button plays a labelled simulation of the planned workflow.
 */
const ASSET_JSON = "/assets/sample/demo-22.json";
const ASSET_BIN = "/assets/sample/demo-22.bin";

export function initCad() {
  "use strict";
  if (typeof document === "undefined") return;

  const root = document.getElementById("cad");
  const canvas = document.getElementById("cad-canvas");
  if (!root || !canvas) return;
  if (root.classList.contains("is-ready") || root.dataset.faucharCad === "1") return;
  root.dataset.faucharCad = "1";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionOK = () => !reduceMotion.matches;

  const gl =
    canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false }) ||
    canvas.getContext("experimental-webgl");

  if (!gl) {
    root.classList.add("no-webgl");
    return;
  }

  /* ------------------------------------------------------------------ math */

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lin = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
  };
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const Y = [0, 1, 0];

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  function lookAt(eyePos, target, up) {
    const z = norm(sub(eyePos, target));
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return {
      m: new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eyePos), -dot(y, eyePos), -dot(z, eyePos), 1]),
      x,
      y,
      z,
    };
  }

  function mat4mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    }
    return o;
  }

  function computeNormals(pos, idx) {
    const nor = new Float32Array(pos.length);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      const e1x = pos[b] - pos[a];
      const e1y = pos[b + 1] - pos[a + 1];
      const e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a];
      const e2y = pos[c + 1] - pos[a + 1];
      const e2z = pos[c + 2] - pos[a + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      for (const v of [a, b, c]) {
        nor[v] += nx;
        nor[v + 1] += ny;
        nor[v + 2] += nz;
      }
    }
    for (let v = 0; v < nor.length; v += 3) {
      const l = Math.hypot(nor[v], nor[v + 1], nor[v + 2]) || 1;
      nor[v] /= l;
      nor[v + 1] /= l;
      nor[v + 2] /= l;
    }
    return nor;
  }

  /* -------------------------------------------------------------- palette */

  const COL = {
    stone: lin("#d6cbb2"),
    lowerStone: lin("#b9bfc3"),
    dentin: lin("#e8cf9c"),
    crown: lin("#f4f1ea"),
    lime: lin("#b7f34a"),
    highlight: lin("#7fc4ff"),
    capStone: lin("#6f6a60"),
    capCrown: lin("#8fbf3a"),
  };

  const MAP_STOPS = [
    [-0.1, lin("#d9363e")],
    [0.0, lin("#f2a33a")],
    [0.05, lin("#58c46b")],
    [0.15, lin("#3fb6d6")],
    [0.35, lin("#3e63dd")],
  ];

  // Occlusal distance reads over a wider range: most of the palatal surface sits clear of the antagonist.
  const OCCLUSAL_STOPS = [
    [0.0, lin("#d9363e")],
    [0.15, lin("#f2a33a")],
    [0.35, lin("#58c46b")],
    [0.7, lin("#3fb6d6")],
    [1.2, lin("#3e63dd")],
  ];

  const THICK_STOPS = [
    [0.3, lin("#d9363e")],
    [0.5, lin("#f2a33a")],
    [0.8, lin("#b7f34a")],
    [1.2, lin("#58c46b")],
    [1.7, lin("#3fb6d6")],
    [2.4, lin("#3e63dd")],
  ];

  function mapColor(d, stops) {
    if (d <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (d <= stops[i][0]) {
        const t = (d - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
        return mix3(stops[i - 1][1], stops[i][1], t);
      }
    }
    return stops === THICK_STOPS ? stops[stops.length - 1][1] : null;
  }

  /* ------------------------------------------------------------- GL setup */

  const VS = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec4 aCol;
    uniform mat4 uVP;
    varying vec3 vPos; varying vec3 vNor; varying vec4 vCol;
    void main(){ vPos=aPos; vNor=aNor; vCol=aCol; gl_Position=uVP*vec4(aPos,1.0); }`;

  const FS = `
    precision highp float;
    varying vec3 vPos; varying vec3 vNor; varying vec4 vCol;
    uniform vec3 uEye; uniform vec3 uL1; uniform vec3 uL2;
    uniform vec3 uBase; uniform float uUseV;
    uniform float uSpec; uniform float uGloss; uniform float uEmit; uniform float uSSS;
    uniform float uClipOn; uniform vec4 uPlane; uniform vec3 uCap;
    uniform float uLine; uniform vec4 uLineCol; uniform float uAlpha;
    void main(){
      if(uClipOn>0.5 && dot(vPos,uPlane.xyz)+uPlane.w>0.0) discard;
      if(uLine>0.5){ gl_FragColor=uLineCol; return; }
      vec3 N=normalize(vNor);
      if(!gl_FrontFacing){
        if(uClipOn>0.5){ gl_FragColor=vec4(pow(uCap,vec3(1.0/2.2)),1.0); return; }
        N=-N;
      }
      vec3 V=normalize(uEye-vPos);
      vec3 alb=mix(uBase,vCol.rgb,uUseV);
      float ao=vCol.a;
      float d1=max((dot(N,uL1)+uSSS)/(1.0+uSSS),0.0);
      float d2=max(dot(N,uL2),0.0);
      vec3 amb=mix(vec3(0.07,0.065,0.06),vec3(0.17,0.18,0.19),N.y*0.5+0.5);
      vec3 H=normalize(uL1+V);
      float sp=pow(max(dot(N,H),0.0),uGloss)*uSpec;
      float fr=pow(1.0-max(dot(N,V),0.0),4.0);
      vec3 col=alb*(amb*1.5+d1*vec3(1.0,0.98,0.95)*0.95+d2*vec3(0.55,0.62,0.72)*0.32)*ao;
      col+=sp*vec3(1.0)*mix(0.6,1.0,ao)+fr*0.16*vec3(0.75,0.85,0.95)*(0.3+uSpec);
      col+=alb*uSSS*0.14*vec3(1.0,0.55,0.35)*(1.0-d1);
      col=mix(col,alb*1.1,uEmit);
      col=col/(1.0+col*0.3);
      gl_FragColor=vec4(pow(col,vec3(1.0/2.2)),uAlpha);
    }`;

  function shader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    root.classList.add("no-webgl");
    return;
  }
  gl.useProgram(prog);

  const A = {
    pos: gl.getAttribLocation(prog, "aPos"),
    nor: gl.getAttribLocation(prog, "aNor"),
    col: gl.getAttribLocation(prog, "aCol"),
  };
  const U = {};
  ["uVP", "uEye", "uL1", "uL2", "uBase", "uUseV", "uSpec", "uGloss", "uEmit", "uSSS", "uClipOn", "uPlane", "uCap", "uLine", "uLineCol", "uAlpha"].forEach(
    (name) => (U[name] = gl.getUniformLocation(prog, name))
  );

  function makeObject(pos, nor, col, idx, opts) {
    const obj = Object.assign({ useV: 1, spec: 0.3, gloss: 40, sss: 0.3, emit: 0, base: [1, 1, 1], cap: COL.capStone, clip: true, drawCount: null }, opts);
    const usage = opts.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
    obj.pbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, obj.pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, usage);
    obj.nbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, obj.nbuf);
    gl.bufferData(gl.ARRAY_BUFFER, nor, gl.STATIC_DRAW);
    if (col) {
      obj.cbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, obj.cbuf);
      gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
    }
    obj.ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    obj.idx = idx;
    obj.count = idx.length;
    obj.tris = idx.length / 3;
    obj.verts = pos.length / 3;
    return obj;
  }

  /** Wireframe edges are built on first use: they are only needed in mesh mode. */
  function ensureLines(obj) {
    if (obj.lbuf || !obj.wire) return;
    const tri = obj.idx;
    const lines = new Uint16Array(tri.length * 2);
    for (let t = 0, o = 0; t < tri.length; t += 3) {
      lines[o++] = tri[t];
      lines[o++] = tri[t + 1];
      lines[o++] = tri[t + 1];
      lines[o++] = tri[t + 2];
      lines[o++] = tri[t + 2];
      lines[o++] = tri[t];
    }
    obj.lbuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.lbuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lines, gl.STATIC_DRAW);
    obj.lcount = lines.length;
  }

  function tube(points, radius, sides, ref) {
    const n = points.length;
    const pos = new Float32Array(n * sides * 3);
    const nor = new Float32Array(n * sides * 3);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const tng = norm(sub(points[(i + 1) % n], points[(i - 1 + n) % n]));
      const b1 = norm(cross(tng, ref));
      const b2 = cross(b1, tng);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const d = add(mul(b1, Math.cos(a)), mul(b2, Math.sin(a)));
        pos.set(add(p, mul(d, radius)), (i * sides + k) * 3);
        nor.set(d, (i * sides + k) * 3);
      }
    }
    const idx = new Uint16Array(n * sides * 6);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        idx.set([i * sides + k, i2 * sides + k, i * sides + k2, i * sides + k2, i2 * sides + k, i2 * sides + k2], o);
        o += 6;
      }
    }
    return { pos, nor, idx };
  }

  /** Surface of revolution around `axis`; profile entries are [radius, distance along axis]. */
  function lathe(profile, origin, axis, sides) {
    const u = norm(cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const w = cross(axis, u);
    const rows = profile.length;
    const pos = new Float32Array(rows * sides * 3);
    const nor = new Float32Array(rows * sides * 3);
    for (let i = 0; i < rows; i++) {
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const d = add(mul(u, Math.cos(a)), mul(w, Math.sin(a)));
        pos.set(add(add(origin, mul(axis, profile[i][1])), mul(d, profile[i][0])), (i * sides + k) * 3);
        nor.set(d, (i * sides + k) * 3);
      }
    }
    const idx = [];
    for (let i = 0; i < rows - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        const a = i * sides + k;
        const b = i * sides + k2;
        const c = (i + 1) * sides + k;
        const e = (i + 1) * sides + k2;
        idx.push(a, b, c, b, e, c);
      }
    }
    return { pos, nor, idx: new Uint16Array(idx) };
  }

  /* ---------------------------------------------------------- state & case */

  const objects = [];
  let CASE = null;
  let F = { center: [0, 0, 0], marginCenter: [0, 0, 0], occlusal: [0, -1, 0], mesial: [-1, 0, 0], facial: [0, 0, 1], archCenter: [0, 7, 0] };
  let upper = null;
  let lower = null;
  let crown = null;
  let marginTube = null;
  let crownBase = null;
  let crownFields = null;
  let upperColors = null;
  let upperDie = null;
  const reveal = { value: 1 };

  const state = {
    step: "design",
    map: "none",
    section: false,
    mesh: false,
    spin: false,
    xray: false,
    layers: { jaw: true, antagonist: false, crown: true, margin: false, axis: false },
  };

  /* --------------------------------------------------------------- camera */

  const cam = { target: [0, 5, 0], yaw: 0.15, pitch: 0.05, dist: 130 };
  const fromDir = (d) => ({ yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(clamp(d[1], -1, 1)) });
  const blend = (...parts) => parts.reduce((acc, [v, s]) => add(acc, mul(v, s)), [0, 0, 0]);

  function preset(name) {
    const { facial: B, mesial: M, occlusal: O, center: c } = F;
    const at = (dir, dist, target = c) => Object.assign({ target, dist }, fromDir(norm(dir)));
    switch (name) {
      case "overview":
        return at([0.22, 0.04, 1], 152, F.archCenter);
      case "occlusal":
        return at(blend([O, 1], [B, 0.14]), 46);
      case "buccal":
        return at(blend([B, 1], [O, 0.12]), 46);
      case "lingual":
        return at(blend([B, -1], [O, 1]), 46);
      case "mesial":
        return at(blend([M, 1], [O, 0.7], [B, 0.6]), 42);
      case "distal":
        return at(blend([M, -1], [O, 0.7], [B, 0.6]), 42);
      case "axis":
        return at(blend([B, 1], [M, 0.55], [O, -0.1]), 66, add(c, mul(O, 5)));
      case "contacts":
        return at(blend([M, 0.75], [B, 0.75], [O, 0.3]), 34);
      case "occlusion":
        return at(blend([B, -1], [O, 0.9], [M, 0.15]), 44);
      case "section":
        return at(blend([M, 1], [B, 0.12]), 40);
      case "design":
      default:
        return at(blend([B, 1], [O, 0.3], [M, -0.22]), 50);
    }
  }

  let camTween = null;

  function setCamera(p, animate = true) {
    if (!animate || !motionOK()) {
      Object.assign(cam, { target: p.target.slice(), yaw: p.yaw, pitch: p.pitch, dist: p.dist });
      camTween = null;
      requestRender();
      return Promise.resolve();
    }
    const from = { target: cam.target.slice(), yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist };
    let dy = p.yaw - from.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return new Promise((resolve) => {
      camTween = { from, to: p, dy, start: performance.now(), dur: 900, resolve };
      requestRender();
    });
  }

  /* ------------------------------------------------------------ rendering */

  let VP = null;
  let viewBasis = null;
  let eye = [0, 0, 0];
  let frameRequested = false;
  let visible = true;
  const tweens = [];

  function requestRender() {
    if (frameRequested || !visible) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  function tween(dur, fn) {
    return new Promise((resolve) => {
      if (!motionOK()) {
        fn(1);
        requestRender();
        resolve();
        return;
      }
      tweens.push({ start: performance.now(), dur, fn, resolve });
      requestRender();
    });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function frame(now) {
    frameRequested = false;
    let busy = false;

    if (camTween) {
      const t = clamp((now - camTween.start) / camTween.dur, 0, 1);
      const e = ease(t);
      const f = camTween.from;
      const to = camTween.to;
      cam.target = [lerp(f.target[0], to.target[0], e), lerp(f.target[1], to.target[1], e), lerp(f.target[2], to.target[2], e)];
      cam.yaw = f.yaw + camTween.dy * e;
      cam.pitch = lerp(f.pitch, to.pitch, e);
      cam.dist = lerp(f.dist, to.dist, e);
      if (t >= 1) {
        const done = camTween.resolve;
        camTween = null;
        done();
      } else busy = true;
    }

    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      const t = clamp((now - tw.start) / tw.dur, 0, 1);
      tw.fn(ease(t));
      if (t >= 1) {
        tweens.splice(i, 1);
        tw.resolve();
      } else busy = true;
    }

    if (state.spin && motionOK() && !dragging) {
      cam.yaw += 0.004;
      busy = true;
    }

    draw();
    if (busy) requestRender();
  }

  function draw() {
    resize();
    const w = canvas.width;
    const h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    cam.pitch = clamp(cam.pitch, -1.53, 1.53);
    const cp = Math.cos(cam.pitch);
    eye = add(cam.target, mul([cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)], cam.dist));
    viewBasis = lookAt(eye, cam.target, Y);
    // Keep at least a 26° horizontal field of view so portrait screens don't crop the model.
    const aspect = w / h;
    const fovy = 2 * Math.atan(Math.tan((13 * Math.PI) / 180) / Math.min(aspect, 1));
    const proj = perspective(fovy, aspect, 2, 600);
    updateScaleBar(fovy);
    VP = mat4mul(proj, viewBasis.m);

    const right = viewBasis.x;
    const up = viewBasis.y;
    const back = viewBasis.z;
    const L1 = norm(add(add(mul(right, -0.45), mul(up, 0.75)), mul(back, 0.6)));
    const L2 = norm(add(add(mul(right, 0.75), mul(up, -0.15)), mul(back, 0.5)));

    gl.uniformMatrix4fv(U.uVP, false, VP);
    gl.uniform3fv(U.uEye, eye);
    gl.uniform3fv(U.uL1, L1);
    gl.uniform3fv(U.uL2, L2);
    gl.uniform4f(U.uPlane, F.mesial[0], F.mesial[1], F.mesial[2], -dot(F.mesial, F.center));

    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);

    const drawTris = (obj) => {
      bindObject(obj);
      setMaterial(obj);
      gl.uniform1f(U.uLine, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.ibuf);
      const count = obj.drawCount === null ? obj.count : obj.drawCount;
      if (count > 0) gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    };

    objects.forEach((obj) => {
      if (isVisible(obj) && alphaOf(obj) === 1) drawTris(obj);
    });

    // Translucent pass: antagonist and X-ray crown, drawn after the opaque scene.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    objects.forEach((obj) => {
      if (isVisible(obj) && alphaOf(obj) < 1) drawTris(obj);
    });
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.disable(gl.POLYGON_OFFSET_FILL);

    if (state.mesh) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      objects.forEach((obj) => {
        if (!obj.wire || !isVisible(obj)) return;
        ensureLines(obj);
        bindObject(obj);
        setMaterial(obj);
        gl.uniform1f(U.uLine, 1);
        gl.uniform4f(U.uLineCol, 0.72, 0.95, 0.29, obj === crown ? 0.5 : 0.16);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.lbuf);
        gl.drawElements(gl.LINES, obj.lcount, gl.UNSIGNED_SHORT, 0);
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    placeLabels();
    drawGizmo();
  }

  function alphaOf(obj) {
    if (obj === crown && state.xray) return 0.42;
    return 1;
  }

  /* Millimetre scale bar at the camera's focus distance. */
  const scaleBar = document.getElementById("cad-scale-bar");
  const scaleLabel = document.getElementById("cad-scale-label");
  let lastScale = "";
  function updateScaleBar(fovy) {
    if (!scaleBar) return;
    const pxPerMm = canvas.clientHeight / (2 * cam.dist * Math.tan(fovy / 2));
    const mm = [1, 2, 5, 10, 20].filter((v) => v * pxPerMm <= 110).pop() || 1;
    const key = `${mm}:${Math.round(mm * pxPerMm)}`;
    if (key === lastScale) return;
    lastScale = key;
    scaleBar.style.width = `${Math.round(mm * pxPerMm)}px`;
    scaleLabel.textContent = `${mm} mm`;
  }

  function isVisible(obj) {
    if (obj.group === "antagonist") return state.layers.antagonist;
    if (obj.group === "jaw") return state.layers.jaw;
    if (obj.group === "crown") return state.layers.crown && reveal.value > 0.001;
    if (obj.group === "margin") return state.layers.margin;
    if (obj.group === "axis") return state.layers.axis;
    return true;
  }

  function bindObject(obj) {
    gl.bindBuffer(gl.ARRAY_BUFFER, obj.pbuf);
    gl.enableVertexAttribArray(A.pos);
    gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, obj.nbuf);
    gl.enableVertexAttribArray(A.nor);
    gl.vertexAttribPointer(A.nor, 3, gl.FLOAT, false, 0, 0);
    if (obj.cbuf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, obj.cbuf);
      gl.enableVertexAttribArray(A.col);
      gl.vertexAttribPointer(A.col, 4, gl.FLOAT, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(A.col);
      gl.vertexAttrib4f(A.col, 1, 1, 1, 1);
    }
  }

  function setMaterial(obj) {
    gl.uniform3fv(U.uBase, obj.base);
    gl.uniform1f(U.uUseV, obj.useV);
    gl.uniform1f(U.uSpec, obj.spec);
    gl.uniform1f(U.uGloss, obj.gloss);
    gl.uniform1f(U.uSSS, obj.sss);
    gl.uniform1f(U.uEmit, obj.emit);
    gl.uniform1f(U.uClipOn, state.section && obj.clip ? 1 : 0);
    gl.uniform3fv(U.uCap, obj.cap);
    gl.uniform1f(U.uAlpha, alphaOf(obj));
  }

  function project(p) {
    const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12];
    const y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13];
    const w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
    if (w <= 0) return null;
    return [(x / w) * 0.5 + 0.5, 1 - ((y / w) * 0.5 + 0.5)];
  }

  /* --------------------------------------------------------------- labels */

  const labelLayer = document.getElementById("cad-labels");
  const labels = [];

  function addLabel(text, posFn, cls, when) {
    if (!labelLayer) return;
    const el = document.createElement("span");
    el.className = `cad-label ${cls || ""}`;
    el.textContent = text;
    el.hidden = true;
    labelLayer.appendChild(el);
    labels.push({ el, posFn, when });
  }

  function placeLabels() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    labels.forEach((l) => {
      const show = !l.when || l.when();
      const p = show ? project(l.posFn()) : null;
      if (!p || p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) {
        l.el.hidden = true;
        return;
      }
      l.el.hidden = false;
      l.el.style.transform = `translate(${(p[0] * cw).toFixed(1)}px, ${(p[1] * ch).toFixed(1)}px)`;
    });
  }

  /* ---------------------------------------------------------------- gizmo */

  const gizmo = document.getElementById("cad-gizmo");
  const gctx = gizmo ? gizmo.getContext("2d") : null;

  function drawGizmo() {
    if (!gctx || !viewBasis) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = gizmo.clientWidth;
    if (gizmo.width !== size * dpr) {
      gizmo.width = size * dpr;
      gizmo.height = size * dpr;
    }
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const r = size * 0.34;
    const axes = [
      { d: F.occlusal, label: "O", color: "#B7F34A" },
      { d: F.facial, label: "F", color: "#e57f9a" },
      { d: F.mesial, label: "M", color: "#5fb4d9" },
    ].map((a) => ({ ...a, x: dot(viewBasis.x, a.d), y: dot(viewBasis.y, a.d), z: dot(viewBasis.z, a.d) }));
    axes.sort((a, b) => a.z - b.z);
    gctx.lineWidth = 1.5;
    gctx.font = "600 9px Inter, sans-serif";
    gctx.textAlign = "center";
    gctx.textBaseline = "middle";
    axes.forEach((a) => {
      const x = c + a.x * r;
      const y = c - a.y * r;
      gctx.globalAlpha = a.z < -0.2 ? 0.45 : 1;
      gctx.strokeStyle = a.color;
      gctx.beginPath();
      gctx.moveTo(c, c);
      gctx.lineTo(x, y);
      gctx.stroke();
      gctx.fillStyle = a.color;
      gctx.beginPath();
      gctx.arc(x, y, 7, 0, Math.PI * 2);
      gctx.fill();
      gctx.fillStyle = "#0b1114";
      gctx.fillText(a.label, x, y + 0.5);
    });
    gctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------- interaction */

  let dragging = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, type: event.pointerType };
    camTween = null;
    canvas.setPointerCapture(event.pointerId);
    root.classList.add("is-dragging");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    cam.yaw -= dx * 0.008;
    if (dragging.type !== "touch") cam.pitch += dy * 0.006;
    requestRender();
  });

  const endDrag = (event) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    dragging = null;
    root.classList.remove("is-dragging");
    requestRender();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener(
    "wheel",
    (event) => {
      // Zoom only on pinch / ctrl+wheel so normal page scrolling is never hijacked.
      if (!event.ctrlKey) return;
      event.preventDefault();
      cam.dist = clamp(cam.dist * (1 + event.deltaY * 0.01), 14, 220);
      requestRender();
    },
    { passive: false }
  );

  canvas.addEventListener("dblclick", () => setCamera(preset(STEPS[state.step].cam)));

  /* ---------------------------------------------------------------- steps */

  const STEPS = {
    scan: {
      cam: "overview",
      layers: { jaw: true, antagonist: true, crown: false, margin: false, axis: false },
      map: "none",
      title: "Scan",
      hint: "Upper and lower jaw scans of the demo case, shown in their recorded bite relationship.",
    },
    margin: {
      cam: "occlusal",
      layers: { jaw: true, antagonist: false, crown: false, margin: true, axis: false },
      map: "none",
      title: "Margin",
      hint: "Margin line of 22 from the design file, shown on the prepared tooth.",
    },
    axis: {
      cam: "axis",
      layers: { jaw: true, antagonist: false, crown: false, margin: true, axis: true },
      map: "none",
      title: "Insertion axis",
      hint: "Insertion axis of 22 from the design file: the crown's path onto the preparation.",
    },
    design: {
      cam: "design",
      layers: { jaw: true, antagonist: false, crown: true, margin: false, axis: false },
      map: "none",
      title: "Design",
      hint: "Reference crown, designed in CAD software, seated on 22 in its recorded position. The AI auto-design run is a simulation.",
    },
    contacts: {
      cam: "contacts",
      layers: { jaw: false, antagonist: false, crown: true, margin: false, axis: false },
      map: "contacts",
      title: "Contacts",
      hint: "Proximal distance map against the scanned neighbours 21 (mesial) and 23 (distal).",
    },
    occlusion: {
      cam: "occlusion",
      layers: { jaw: true, antagonist: false, crown: true, margin: false, axis: false },
      map: "occlusion",
      title: "Occlusion",
      hint: "Palatal view. Distance map measured against the lower jaw scan. Switch on the lower jaw in the scene list to see the bite.",
    },
    export: {
      cam: "design",
      layers: { jaw: false, antagonist: false, crown: true, margin: false, axis: false },
      map: "none",
      title: "Export",
      hint: "Crown with its intaglio, in scan coordinates. Export writes this demo crown as an STL.",
    },
  };

  const stepButtons = [...root.querySelectorAll("[data-step]")];
  const viewButtons = [...root.querySelectorAll("[data-cam]")];
  const layerButtons = [...root.querySelectorAll("[data-layer]")];
  const toolButtons = [...root.querySelectorAll("[data-tool]")];
  const mapButtons = [...root.querySelectorAll("[data-map]")];
  const hintEl = document.getElementById("cad-hint");
  const stepTitle = document.getElementById("cad-step-title");
  const legend = document.getElementById("cad-legend");
  const legendTitle = document.getElementById("cad-legend-title");
  const legendBar = root.querySelector(".cad-legend-bar");
  const legendScale = root.querySelector(".cad-legend-scale");
  const statusEl = document.getElementById("cad-status");
  const aiEl = document.getElementById("cad-ai");
  const aiText = document.getElementById("cad-ai-text");
  const aiLive = document.getElementById("cad-live");
  const autoBtn = document.getElementById("cad-auto");
  const loadingEl = document.getElementById("cad-loading");
  const loadingBar = document.getElementById("cad-loading-bar");
  const loadingText = document.getElementById("cad-loading-text");

  let seq = 0;

  const LEGENDS = {
    contacts: { title: "Proximal distance (mm)", stops: MAP_STOPS },
    occlusion: { title: "Distance to antagonist (mm)", stops: OCCLUSAL_STOPS },
    thickness: { title: "Wall thickness (mm)", stops: THICK_STOPS },
  };
  const toHex = (c) => "#" + c.map((x) => Math.round(Math.pow(x, 1 / 2.2) * 255).toString(16).padStart(2, "0")).join("");

  function syncMap() {
    mapButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.map === state.map ? "true" : "false"));
    const L = LEGENDS[state.map];
    if (legend) legend.hidden = !L;
    if (!L) return;
    const lo = L.stops[0][0];
    const hi = L.stops[L.stops.length - 1][0];
    const pct = (v) => ((v - lo) / (hi - lo)) * 100;
    if (legendTitle) legendTitle.textContent = L.title;
    if (legendBar) legendBar.style.background = `linear-gradient(90deg, ${L.stops.map(([v, c]) => `${toHex(c)} ${pct(v).toFixed(1)}%`).join(", ")})`;
    if (legendScale) {
      let last = -100;
      legendScale.innerHTML = L.stops
        .filter(([v], i) => {
          const keep = i === L.stops.length - 1 || pct(v) - last >= 18;
          if (keep) last = pct(v);
          return keep;
        })
        .map(([v], i, arr) => `<span style="left:${pct(v).toFixed(1)}%;${i === 0 ? "transform:none" : i === arr.length - 1 ? "transform:translateX(-100%)" : ""}">${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}</span>`)
        .join("");
    }
  }

  function paintCrown() {
    if (!crown) return;
    const { colors, outer, thickness, occlusal, proximal } = crownFields;
    const base = COL.crown;
    const field = state.map === "contacts" ? proximal : state.map === "occlusion" ? occlusal : state.map === "thickness" ? thickness : null;
    const stops = state.map === "thickness" ? THICK_STOPS : state.map === "occlusion" ? OCCLUSAL_STOPS : MAP_STOPS;
    const n = outer.length;
    for (let v = 0; v < n; v++) {
      let c = base;
      if (field && outer[v]) {
        const m = mapColor(field[v] / 1000, stops);
        if (m) c = m;
      }
      colors[v * 4] = c[0];
      colors[v * 4 + 1] = c[1];
      colors[v * 4 + 2] = c[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, crown.cbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
  }

  /** Tints the prepared tooth while the simulated run "locates" it. */
  function highlightDie(amount) {
    if (!upper) return;
    const n = upperDie.length;
    for (let v = 0; v < n; v++) {
      const t = upperDie[v] * amount;
      upperColors[v * 4] = lerp(COL.stone[0], COL.highlight[0], t);
      upperColors[v * 4 + 1] = lerp(COL.stone[1], COL.highlight[1], t);
      upperColors[v * 4 + 2] = lerp(COL.stone[2], COL.highlight[2], t);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, upper.cbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, upperColors);
  }

  function applyReveal() {
    if (!crown) return;
    const s = 0.25 + 0.75 * reveal.value;
    const c = F.marginCenter;
    const pos = new Float32Array(crownBase.length);
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = c[0] + (crownBase[i] - c[0]) * s;
      pos[i + 1] = c[1] + (crownBase[i + 1] - c[1]) * s;
      pos[i + 2] = c[2] + (crownBase[i + 2] - c[2]) * s;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, crown.pbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
  }

  mapButtons.forEach((b) =>
    b.addEventListener("click", () => {
      state.map = b.dataset.map;
      if (state.map !== "none") state.layers.crown = true;
      syncLayerButtons();
      paintCrown();
      syncMap();
      requestRender();
    })
  );

  function syncLayerButtons() {
    layerButtons.forEach((b) => b.setAttribute("aria-pressed", state.layers[b.dataset.layer] ? "true" : "false"));
  }

  function syncTools() {
    toolButtons.forEach((b) => {
      const t = b.dataset.tool;
      const on = t === "section" ? state.section : t === "mesh" ? state.mesh : t === "xray" ? state.xray : false;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function revealStep(button) {
    const scroller = button.closest(".cad-steps");
    const item = button.parentElement;
    if (!scroller || !item) return;
    const scrollerBox = scroller.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    if (itemBox.left < scrollerBox.left + 4) {
      scroller.scrollLeft -= scrollerBox.left - itemBox.left + 8;
    } else if (itemBox.right > scrollerBox.right - 4) {
      scroller.scrollLeft += itemBox.right - scrollerBox.right + 8;
    }
  }

  function setStep(name, { camera = true, cancel = true } = {}) {
    if (cancel) cancelSequence();
    const st = STEPS[name];
    state.step = name;
    state.map = st.map;
    state.layers = { ...st.layers };
    state.spin = name === "export";
    stepButtons.forEach((b) => {
      const on = b.dataset.step === name;
      b.setAttribute("aria-current", on ? "step" : "false");
      if (on) revealStep(b);
    });
    if (hintEl) hintEl.textContent = st.hint;
    if (stepTitle) stepTitle.textContent = st.title;
    syncMap();
    root.dataset.step = name;
    syncLayerButtons();
    paintCrown();
    if (statusEl) statusEl.textContent = `${st.title} · tooth 22`;
    if (camera) setCamera(preset(st.cam));
    requestRender();
  }

  stepButtons.forEach((b) => b.addEventListener("click", () => setStep(b.dataset.step)));

  viewButtons.forEach((b) =>
    b.addEventListener("click", () => {
      state.spin = false;
      // The opposing jaw would block any view from the occlusal side of the upper arch.
      if (b.dataset.cam === "occlusal" || b.dataset.cam === "lingual") {
        state.layers.antagonist = false;
        syncLayerButtons();
      }
      setCamera(preset(b.dataset.cam));
    })
  );

  layerButtons.forEach((b) =>
    b.addEventListener("click", () => {
      const key = b.dataset.layer;
      state.layers[key] = !state.layers[key];
      syncLayerButtons();
      requestRender();
    })
  );

  toolButtons.forEach((b) =>
    b.addEventListener("click", () => {
      const tool = b.dataset.tool;
      if (tool === "section") {
        state.section = !state.section;
        if (state.section) {
          state.layers.crown = true;
          state.layers.jaw = true;
          state.layers.antagonist = false;
          syncLayerButtons();
          state.spin = false;
          setCamera(preset("section"));
        }
      } else if (tool === "mesh") {
        state.mesh = !state.mesh;
      } else if (tool === "xray") {
        state.xray = !state.xray;
        if (state.xray) {
          state.layers.crown = true;
          state.layers.margin = true;
          syncLayerButtons();
        }
      } else if (tool === "zoom-in") {
        cam.dist = clamp(cam.dist * 0.82, 14, 220);
      } else if (tool === "zoom-out") {
        cam.dist = clamp(cam.dist * 1.2, 14, 220);
      } else if (tool === "fit") {
        setCamera(preset(STEPS[state.step].cam));
      }
      syncTools();
      requestRender();
    })
  );

  /* --------------------------------------------- simulated auto-design run */

  const wait = (ms) => new Promise((r) => setTimeout(r, motionOK() ? ms : 0));

  function cancelSequence() {
    seq++;
    tweens.splice(0).forEach((tw) => tw.resolve());
    root.classList.remove("is-running");
    if (autoBtn) autoBtn.disabled = !CASE;
    if (aiEl) aiEl.dataset.state = "idle";
    reveal.value = 1;
    if (marginTube) marginTube.drawCount = null;
    highlightDie(0);
    applyReveal();
  }

  function announce(text) {
    if (aiText) aiText.textContent = text;
    if (aiLive) aiLive.textContent = text;
    if (statusEl) statusEl.textContent = text;
  }

  async function autoDesign() {
    cancelSequence();
    const id = seq;
    const alive = () => id === seq;
    root.classList.add("is-running");
    if (autoBtn) autoBtn.disabled = true;
    if (aiEl) aiEl.dataset.state = "running";

    setStep("scan", { cancel: false, camera: false });
    reveal.value = 0;
    applyReveal();
    announce("Reading jaw scans (simulated)");
    await setCamera(preset("overview"));
    if (!alive()) return;
    await wait(500);
    if (!alive()) return;

    announce("Locating preparation 22 (simulated)");
    state.layers.antagonist = false;
    syncLayerButtons();
    setCamera(preset("occlusal"));
    await tween(1200, highlightDie);
    if (!alive()) return;

    announce("Tracing margin line (simulated)");
    state.layers.margin = true;
    marginTube.drawCount = 0;
    syncLayerButtons();
    const points = CASE.margin.length;
    await tween(1400, (t) => {
      marginTube.drawCount = Math.round(t * points) * marginTube.segment;
    });
    marginTube.drawCount = null;
    if (!alive()) return;
    await wait(300);
    if (!alive()) return;

    announce("Showing crown proposal (simulated)");
    highlightDie(0);
    state.layers.crown = true;
    syncLayerButtons();
    setCamera(preset("design"));
    await tween(1800, (t) => {
      reveal.value = t;
      applyReveal();
    });
    if (!alive()) return;

    setStep("design", { camera: false, cancel: false });
    if (aiEl) aiEl.dataset.state = "done";
    announce("Reference crown shown · AI run simulated");
    root.classList.remove("is-running");
    if (autoBtn) autoBtn.disabled = false;
  }

  if (autoBtn) {
    autoBtn.disabled = true;
    autoBtn.addEventListener("click", autoDesign);
  }

  /* --------------------------------------------------------------- export */

  const exportBtn = document.getElementById("cad-export");
  const exportNote = document.getElementById("cad-export-note");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      if (!crown) return;
      const idx = crown.idx;
      const tris = idx.length / 3;
      const buf = new ArrayBuffer(84 + tris * 50);
      const dv = new DataView(buf);
      const header = "FAUCHAR demo crown 22 - not for clinical use";
      for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 32);
      dv.setUint32(80, tris, true);
      // Back to scan coordinates, so the file lines up with the jaw scans.
      const at = (k) => [crownBase[k * 3], -crownBase[k * 3 + 2], crownBase[k * 3 + 1]];
      let o = 84;
      for (let t = 0; t < idx.length; t += 3) {
        const p = [at(idx[t]), at(idx[t + 1]), at(idx[t + 2])];
        const n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
        [n, p[0], p[1], p[2]].forEach((vec) => {
          vec.forEach((value) => {
            dv.setFloat32(o, value, true);
            o += 4;
          });
        });
        dv.setUint16(o, 0, true);
        o += 2;
      }
      const url = URL.createObjectURL(new Blob([buf], { type: "model/stl" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "fauchar-demo-crown-22.stl";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (exportNote) exportNote.hidden = false;
    });
  }

  /* -------------------------------------------------------- measurements */

  function showMeasurements(stats) {
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const mm = (v) => `${v.toFixed(2)} mm`;
    const d = stats.design;
    set("d-cement", `${Math.round(d.cementGap * 1000)} µm`);
    set("d-thickness", mm(d.minThickness));
    set("d-margin-thickness", mm(d.minThicknessMargin));
    set("d-antagonist", mm(d.antagonistDistance));
    set("m-md", mm(stats.mesiodistal));
    set("m-bl", mm(stats.faciolingual));
    set("m-h", mm(stats.height));
    set("m-fit", mm(stats.marginFit));
    set("m-thick", mm(stats.minThickness));
    set("m-min", mm(d.minThickness));
    const thickOK = stats.minThickness >= d.minThickness;
    const row = document.getElementById("m-thick-row");
    if (row) row.classList.toggle("is-warn", !thickOK);

    const check = (id, ok, text) => {
      const li = document.getElementById(id);
      if (!li) return ok;
      li.classList.toggle("is-ok", ok);
      li.classList.toggle("is-warn", !ok);
      li.querySelector("em").textContent = text;
      return ok;
    };
    const touching = stats.contactMesial <= 0.05 && stats.contactDistal <= 0.05;
    const results = [
      check("v-thick", thickOK, thickOK ? `≥ ${mm(d.minThickness)}` : `${mm(stats.minThickness)} < ${mm(d.minThickness)}`),
      check("v-contact", touching, touching ? "In contact · 21, 23" : "Open contact"),
      check("v-occl", stats.occlusalMin >= 0, mm(stats.occlusalMin)),
      check("v-cement", true, `${Math.round(d.cementGap * 1000)} µm`),
      check("v-margin", stats.marginFit <= 0.1, `Closed · ${stats.marginPoints} pts`),
    ];
    set("v-summary", `${results.filter(Boolean).length} / ${results.length} passed`);
  }

  /* ---------------------------------------------------------- case loading */

  function decodePositions(buffer, mesh) {
    const q = new Uint16Array(buffer, mesh.pos[0], mesh.pos[1]);
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i += 3) {
      for (let k = 0; k < 3; k++) out[i + k] = mesh.min[k] + (q[i + k] / 65535) * (mesh.max[k] - mesh.min[k]);
    }
    return out;
  }

  function colorsFor(buffer, mesh, rgb) {
    const ao = new Uint8Array(buffer, mesh.ao[0], mesh.ao[1]);
    const out = new Float32Array(ao.length * 4);
    for (let v = 0; v < ao.length; v++) {
      out[v * 4] = rgb[0];
      out[v * 4 + 1] = rgb[1];
      out[v * 4 + 2] = rgb[2];
      out[v * 4 + 3] = ao[v] / 255;
    }
    return out;
  }

  function buildScene(meta, buffer) {
    CASE = meta;
    F = meta.frame;
    const m = meta.meshes;
    const indices = (mesh) => new Uint16Array(buffer, mesh.idx[0], mesh.idx[1]);

    const uPos = decodePositions(buffer, m.upper);
    const uIdx = indices(m.upper);
    upperColors = colorsFor(buffer, m.upper, COL.stone);
    upperDie = new Uint8Array(buffer, m.upper.die[0], m.upper.die[1]);
    upper = makeObject(uPos, computeNormals(uPos, uIdx), upperColors, uIdx, { group: "jaw", spec: 0.1, gloss: 16, sss: 0.2, wire: true });

    const lPos = decodePositions(buffer, m.lower);
    const lIdx = indices(m.lower);
    lower = makeObject(lPos, computeNormals(lPos, lIdx), colorsFor(buffer, m.lower, COL.lowerStone), lIdx, { group: "antagonist", spec: 0.1, gloss: 16, sss: 0.2, wire: true, clip: true });

    crownBase = decodePositions(buffer, m.crown);
    const cIdx = indices(m.crown);
    const cColors = colorsFor(buffer, m.crown, COL.crown);
    crownFields = {
      colors: cColors,
      outer: new Uint8Array(buffer, m.crown.outer[0], m.crown.outer[1]),
      thickness: new Int16Array(buffer, m.crown.thickness[0], m.crown.thickness[1]),
      occlusal: new Int16Array(buffer, m.crown.occlusal[0], m.crown.occlusal[1]),
      proximal: new Int16Array(buffer, m.crown.proximal[0], m.crown.proximal[1]),
    };
    crown = makeObject(crownBase.slice(), computeNormals(crownBase, cIdx), cColors, cIdx, { group: "crown", dynamic: true, spec: 0.55, gloss: 60, sss: 0.25, cap: COL.capCrown, wire: true });

    const t = tube(meta.margin, 0.07, 8, F.occlusal);
    marginTube = makeObject(t.pos, t.nor, null, t.idx, { group: "margin", useV: 0, base: COL.lime, emit: 0.6, spec: 0.3, gloss: 30, sss: 0, clip: false });
    marginTube.segment = 8 * 6;

    // Arrow along the insertion path, pointing down onto the preparation.
    const a = lathe([[0.1, 19], [0.1, 10], [0.42, 10], [0, 8]], F.marginCenter, F.occlusal, 20);
    const axisArrow = makeObject(a.pos, a.nor, null, a.idx, { group: "axis", useV: 0, base: COL.lime, emit: 0.4, spec: 0.4, gloss: 30, sss: 0, clip: false });

    objects.push(upper, lower, crown, marginTube, axisArrow);

    const P = meta.points;
    const side = (pt, dir) => add(add(pt, mul(dir, 3.2)), mul(F.facial, 2));
    const jawOn = () => state.layers.jaw;
    addLabel("22", () => add(F.center, mul(F.facial, 4.2)), "is-key", () => state.layers.crown || state.layers.margin);
    addLabel("21", () => side(P.contactMesial, F.mesial), "", jawOn);
    addLabel("23", () => side(P.contactDistal, mul(F.mesial, -1)), "", jawOn);
    addLabel("Margin line", () => add(meta.margin[Math.round(meta.margin.length * 0.25)], mul(F.occlusal, -1.2)), "is-callout", () => state.layers.margin && !state.layers.crown);
    addLabel("Insertion axis", () => add(F.marginCenter, mul(F.occlusal, 19.6)), "is-callout", () => state.layers.axis);
    addLabel("21 · in contact", () => P.contactMesial, "is-value", () => state.map === "contacts");
    addLabel("23 · in contact", () => P.contactDistal, "is-value", () => state.map === "contacts");
    addLabel(`Min ${meta.stats.minThickness.toFixed(2)} mm`, () => P.thickness, "is-value", () => state.map === "thickness" && state.layers.crown);
    addLabel(`Min ${meta.stats.occlusalMin.toFixed(2)} mm`, () => P.occlusal, "is-value", () => state.map === "occlusion" && state.layers.crown);

    showMeasurements(meta.stats);
    const statTris = document.getElementById("cad-tris");
    if (statTris) {
      const tris = upper.tris + lower.tris + crown.tris;
      const verts = upper.verts + lower.verts + crown.verts;
      statTris.textContent = `${tris.toLocaleString("en-US")} triangles · ${verts.toLocaleString("en-US")} vertices`;
    }

    setStep("design", { camera: false });
    setCamera(preset("design"), false);
    if (aiText) aiText.textContent = "Reference crown · AI run simulated";
    if (autoBtn) autoBtn.disabled = false;
  }

  async function loadCase() {
    if (loadingEl) loadingEl.hidden = false;
    try {
      const metaRes = await fetch(ASSET_JSON);
      if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
      const meta = await metaRes.json();
      const res = await fetch(ASSET_BIN);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (loadingBar && total) loadingBar.style.width = `${Math.min(100, (got / total) * 100).toFixed(0)}%`;
      }
      const bytes = new Uint8Array(got);
      let o = 0;
      chunks.forEach((c) => {
        bytes.set(c, o);
        o += c.length;
      });
      buildScene(meta, bytes.buffer);
      if (loadingEl) loadingEl.hidden = true;
    } catch (error) {
      console.error(error);
      if (loadingText) loadingText.textContent = "The 3D case could not be loaded. Reload the page to try again.";
      if (loadingBar) loadingBar.parentElement.hidden = true;
    }
  }

  /* ---------------------------------------------------------------- start */

  if ("ResizeObserver" in window) new ResizeObserver(() => requestRender()).observe(canvas);
  else window.addEventListener("resize", requestRender);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) requestRender();
    }).observe(canvas);
    // The case is about 2 MB, so fetch it only as the section approaches.
    const loader = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        loader.disconnect();
        loadCase();
      },
      { rootMargin: "900px 0px" }
    );
    loader.observe(root);
  } else {
    loadCase();
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    root.classList.add("no-webgl");
  });

  function revealCurrentStep() {
    const current = stepButtons.find((b) => b.getAttribute("aria-current") === "step");
    if (current) revealStep(current);
  }

  syncTools();
  root.classList.add("is-ready");
  requestAnimationFrame(revealCurrentStep);
  if (document.fonts) document.fonts.ready.then(revealCurrentStep);
  let stepBarWidth = 0;
  window.addEventListener("resize", () => {
    const scroller = root.querySelector(".cad-steps");
    if (!scroller || scroller.clientWidth === stepBarWidth) return;
    stepBarWidth = scroller.clientWidth;
    revealCurrentStep();
  });
}
