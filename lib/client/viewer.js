/**
 * FAUCHAR Workspace — STL viewer.
 *
 * Dependency-free WebGL viewer for welded STL meshes produced by stl-worker.js.
 * Orbit / pan / zoom, view presets, fit, millimetre grid, Y-up or Z-up models,
 * per-mesh visibility and wireframe. Renders on demand.
 */
export function initViewer() {
  if (typeof window === "undefined") return;
  if (window.FaucharViewer) return;
  "use strict";

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lin = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
  };

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  function lookAt(eye, target, up) {
    const z = norm(sub(eye, target));
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return { m: new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]), x, y, z };
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

  const VS = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aColor;
    uniform mat4 uVP; uniform mat3 uModel;
    uniform float uUseVC;
    varying vec3 vPos; varying vec3 vNor; varying vec3 vColor;
    void main(){
      vec3 p=uModel*aPos; vPos=p; vNor=uModel*aNor;
      vColor = uUseVC > 0.5 ? aColor : vec3(-1.0);
      gl_Position=uVP*vec4(p,1.0);
    }`;

  const FS = `
    precision highp float;
    varying vec3 vPos; varying vec3 vNor; varying vec3 vColor;
    uniform vec3 uEye; uniform vec3 uL1; uniform vec3 uL2;
    uniform vec3 uBase; uniform float uSpec; uniform float uGloss; uniform float uSSS;
    uniform float uLine; uniform vec4 uLineCol; uniform float uAlpha;
    uniform vec4 uClip; uniform float uClipOn;
    void main(){
      if(uLine>0.5){ gl_FragColor=uLineCol; return; }
      if(uClipOn>0.5){
        if(dot(vPos,uClip.xyz)>uClip.w) discard;
        // Seen through the cut, the far inner wall reads as the section face.
        if(!gl_FrontFacing){ vec3 b=vColor.x>=0.0?vColor:uBase; gl_FragColor=vec4(pow(b*0.55+vec3(0.02),vec3(1.0/2.2)),1.0); return; }
      }
      vec3 N=normalize(vNor);
      if(!gl_FrontFacing) N=-N;
      vec3 V=normalize(uEye-vPos);
      float d1=max((dot(N,uL1)+uSSS)/(1.0+uSSS),0.0);
      float d2=max(dot(N,uL2),0.0);
      vec3 amb=mix(vec3(0.05,0.045,0.04),vec3(0.17,0.18,0.19),N.y*0.5+0.5);
      float sp=pow(max(dot(N,normalize(uL1+V)),0.0),uGloss)*uSpec;
      float fr=pow(1.0-max(dot(N,V),0.0),4.0);
      vec3 base = vColor.x >= 0.0 ? vColor : uBase;
      vec3 col=base*(amb*1.5+d1*vec3(1.0,0.98,0.95)*0.95+d2*vec3(0.55,0.62,0.72)*0.32);
      col+=sp+fr*0.14*vec3(0.75,0.85,0.95);
      col=col/(1.0+col*0.3);
      gl_FragColor=vec4(pow(col,vec3(1.0/2.2)),uAlpha);
    }`;

  const PRESETS = {
    front: [0, 0.15, 1],
    back: [0, 0.15, -1],
    left: [-1, 0.15, 0],
    right: [1, 0.15, 0],
    top: [0, 1, 0.0001],
    bottom: [0, -1, 0.0001],
    iso: [-0.6, 0.65, 0.75],
  };

  class Viewer {
    constructor(canvas, { gizmo = null, onChange = null } = {}) {
      this.canvas = canvas;
      this.gizmo = gizmo;
      this.onChange = onChange;
      this.meshes = new Map();
      this.wireframe = false;
      this.grid = true;
      this.upAxis = "y";
      this.invertUp = false;
      this.overlayLines = null;
      this.overlayLineCount = 0;
      this.lineLayers = new Map();
      this.clip = null;
      this.tool = null;
      this.onFrame = null;
      this.mode = "orbit";
      this.cam = { target: [0, 0, 0], yaw: -0.6, pitch: 0.55, dist: 120 };
      this.bounds = null;
      this.tween = null;
      this.pending = false;
      this.lastVP = null;
      this.lastViewSize = [1, 1];
      this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

      const opts = { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true };
      this.gl = canvas.getContext("webgl2", opts);
      this.webgl2 = !!this.gl;
      if (!this.gl) {
        this.gl = canvas.getContext("webgl", opts);
        this.uintExt = this.gl && this.gl.getExtension("OES_element_index_uint");
      }
      if (!this.gl || (!this.webgl2 && !this.uintExt)) {
        this.supported = false;
        return;
      }
      this.supported = true;
      this.init();
      this.bindInput();
      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(() => this.render());
        this.resizeObserver.observe(canvas);
      }
    }

    init() {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      this.prog = prog;
      this.a = {
        pos: gl.getAttribLocation(prog, "aPos"),
        nor: gl.getAttribLocation(prog, "aNor"),
        color: gl.getAttribLocation(prog, "aColor"),
      };
      this.u = {};
      ["uVP", "uModel", "uEye", "uL1", "uL2", "uBase", "uSpec", "uGloss", "uSSS", "uLine", "uLineCol", "uAlpha", "uUseVC", "uClip", "uClipOn"].forEach((n) => (this.u[n] = gl.getUniformLocation(prog, n)));
      this.gridBuf = gl.createBuffer();
      this.gridNor = gl.createBuffer();
      this.gridCount = 0;
      this.overlayBuf = gl.createBuffer();
      this.overlayNor = gl.createBuffer();
    }

    /* ------------------------------------------------------------ meshes */

    addMesh(id, mesh, { color = "#c9c2b3", spec = 0.12, gloss = 18, sss = 0.25, alpha = 1, visible = true, overlay = false } = {}) {
      if (!this.supported) return;
      const gl = this.gl;
      this.removeMesh(id);
      const entry = { color: lin(color), spec, gloss, sss, alpha, visible, useVertexColor: false, overlay, groups: null };
      entry.positions = mesh.positions;
      entry.normals = mesh.normals;
      entry.indices = mesh.indices;
      entry.edges = mesh.edges;
      entry.pbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.pbuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
      entry.nbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.nbuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.DYNAMIC_DRAW);
      entry.cbuf = gl.createBuffer();
      const nVert = mesh.positions.length / 3;
      const cols = new Float32Array(nVert * 3);
      for (let i = 0; i < nVert; i++) {
        cols[i * 3] = entry.color[0];
        cols[i * 3 + 1] = entry.color[1];
        cols[i * 3 + 2] = entry.color[2];
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.cbuf);
      gl.bufferData(gl.ARRAY_BUFFER, cols, gl.DYNAMIC_DRAW);
      entry.ibuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.ibuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      entry.count = mesh.indices.length;
      entry.ebuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.ebuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.edges, gl.STATIC_DRAW);
      entry.ecount = mesh.edges.length;
      const p = mesh.positions;
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          if (p[i + k] < b[k]) b[k] = p[i + k];
          if (p[i + k] > b[k + 3]) b[k + 3] = p[i + k];
        }
      }
      entry.bbox = b;
      this.meshes.set(id, entry);
      if (!overlay) this.updateBounds();
      this.render();
    }

    /** Re-uploads moved vertices. Same topology only; addMesh replaces the rest. */
    updateMeshGeometry(id, positions, normals) {
      const entry = this.meshes.get(id);
      if (!entry) return;
      const gl = this.gl;
      entry.positions = positions;
      entry.normals = normals;
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.pbuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.nbuf);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.DYNAMIC_DRAW);
      this.render();
    }

    /** Recomputes the bounding box after an edit that may have moved the model. */
    refreshBounds(id) {
      const e = this.meshes.get(id);
      if (!e) return;
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      const p = e.positions;
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          if (p[i + k] < b[k]) b[k] = p[i + k];
          if (p[i + k] > b[k + 3]) b[k + 3] = p[i + k];
        }
      }
      e.bbox = b;
      this.updateBounds();
    }

    setMeshStyle(id, style) {
      const e = this.meshes.get(id);
      if (!e) return;
      if (style.alpha !== undefined) e.alpha = style.alpha;
      if (style.color !== undefined) e.color = lin(style.color);
      this.render();
    }

    /**
     * Splits one mesh into parts with their own visibility, tint and opacity.
     * `indices` is the triangle list reordered so each group is one contiguous range.
     */
    setMeshGroups(id, indices, groups) {
      const e = this.meshes.get(id);
      if (!e) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, e.ibuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      e.groupIndices = indices;
      e.groups = groups.map((g) => ({ visible: true, alpha: null, ...g, colorLin: g.color ? lin(g.color) : null }));
      this.render();
    }

    setGroupStyle(id, groupId, style) {
      const e = this.meshes.get(id);
      const g = e?.groups?.find((x) => x.id === groupId);
      if (!g) return;
      Object.assign(g, style);
      this.render();
    }

    /** Named world-space line segments, drawn in their own colour; `onTop` ignores depth. */
    setLineLayer(id, positions, color = [0.72, 0.95, 0.29, 1], { onTop = false } = {}) {
      if (!this.supported) return;
      const gl = this.gl;
      let layer = this.lineLayers.get(id);
      if (!positions || !positions.length) {
        if (layer) {
          gl.deleteBuffer(layer.buf);
          gl.deleteBuffer(layer.nor);
          this.lineLayers.delete(id);
        }
        this.render();
        return;
      }
      if (!layer) {
        layer = { buf: gl.createBuffer(), nor: gl.createBuffer() };
        this.lineLayers.set(id, layer);
      }
      layer.count = positions.length / 3;
      layer.color = color;
      layer.onTop = onTop;
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.buf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.nor);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions.length), gl.DYNAMIC_DRAW);
      this.render();
    }

    /** Clipping plane in world space: fragments with dot(p, normal) > d are cut away. */
    setClip(normal, d) {
      this.clip = normal ? { normal, d } : null;
      this.render();
    }

    setVertexColors(id, colors /* Float32Array rgb linear, length nVert*3 */) {
      const entry = this.meshes.get(id);
      if (!entry || !colors) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.cbuf);
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
      entry.useVertexColor = true;
      this.render();
    }

    clearVertexColors(id) {
      const entry = this.meshes.get(id);
      if (!entry) return;
      entry.useVertexColor = false;
      this.render();
    }

    removeMesh(id) {
      const entry = this.meshes.get(id);
      if (!entry) return;
      const gl = this.gl;
      [entry.pbuf, entry.nbuf, entry.cbuf, entry.ibuf, entry.ebuf].forEach((b) => b && gl.deleteBuffer(b));
      this.meshes.delete(id);
      if (!entry.overlay) this.updateBounds();
      this.render();
    }

    clear() {
      [...this.meshes.keys()].forEach((id) => this.removeMesh(id));
    }

    setVisible(id, visible) {
      const entry = this.meshes.get(id);
      if (entry) entry.visible = visible;
      this.updateBounds();
      this.render();
    }

    setWireframe(on) {
      this.wireframe = on;
      this.render();
    }

    setGrid(on) {
      this.grid = on;
      this.render();
    }

    setUpAxis(axis) {
      this.upAxis = axis === "z" ? "z" : "y";
      this.updateBounds();
      this.fit(false);
    }

    /** Flip occlusal direction after up-axis map (fixes upside-down jaws). */
    setInvertUp(on) {
      this.invertUp = !!on;
      this.updateBounds();
      this.fit(false);
    }

    /**
     * World-space line segments (xyz pairs) for cervical contours.
     * Pass null/empty to clear.
     */
    setOverlayLines(positions /* Float32Array */) {
      if (!this.supported) return;
      const gl = this.gl;
      if (!positions || !positions.length) {
        this.overlayLineCount = 0;
        this.overlayLines = null;
        this.render();
        return;
      }
      this.overlayLines = positions;
      this.overlayLineCount = positions.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      const nors = new Float32Array(positions.length);
      for (let i = 0; i < nors.length; i += 3) nors[i + 1] = 1;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayNor);
      gl.bufferData(gl.ARRAY_BUFFER, nors, gl.DYNAMIC_DRAW);
      this.render();
    }

    setMode(mode) {
      this.mode = mode;
      this.canvas.dataset.mode = mode;
    }

    /** Model matrix: Z-up scans are rotated so occlusal faces +Y; optional Y flip. */
    modelMatrix() {
      if (this.upAxis === "z") {
        // (x,y,z)->(x,z,-y) or inverted (x,-z,-y)
        return this.invertUp
          ? new Float32Array([1, 0, 0, 0, 0, -1, 0, -1, 0])
          : new Float32Array([1, 0, 0, 0, 0, -1, 0, 1, 0]);
      }
      return this.invertUp
        ? new Float32Array([1, 0, 0, 0, -1, 0, 0, 0, 1])
        : new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }

    toWorld(p) {
      let w = this.upAxis === "z" ? [p[0], p[2], -p[1]] : [p[0], p[1], p[2]];
      if (this.invertUp) w = [w[0], -w[1], w[2]];
      return w;
    }

    /** Inverse of toWorld. The model matrix is orthonormal, so its transpose undoes it. */
    toModel(w) {
      const m = this.modelMatrix();
      return [m[0] * w[0] + m[1] * w[1] + m[2] * w[2], m[3] * w[0] + m[4] * w[1] + m[5] * w[2], m[6] * w[0] + m[7] * w[1] + m[8] * w[2]];
    }

    /** Ray through a canvas pixel, in model coordinates: { o, d, world: { o, d } }. */
    screenRay(x, y) {
      if (!this.basis || !this.eye) return null;
      const [vw, vh] = this.lastViewSize;
      const nx = (x / vw) * 2 - 1;
      const ny = 1 - (y / vh) * 2;
      const b = this.basis;
      const d = norm(add(add(mul(b.z, -1), mul(b.x, nx * this.tanY * (vw / vh))), mul(b.y, ny * this.tanY)));
      return { o: this.toModel(this.eye), d: this.toModel(d), world: { o: this.eye, d } };
    }

    /** Project world XYZ to CSS pixels relative to the canvas. */
    projectToScreen(world) {
      if (!this.lastVP) return null;
      const m = this.lastVP;
      const x = world[0];
      const y = world[1];
      const z = world[2];
      const clipX = m[0] * x + m[4] * y + m[8] * z + m[12];
      const clipY = m[1] * x + m[5] * y + m[9] * z + m[13];
      const clipW = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (clipW === 0) return null;
      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;
      const ndcZ = (m[2] * x + m[6] * y + m[10] * z + m[14]) / clipW;
      if (ndcZ < -1 || ndcZ > 1) return null;
      const [vw, vh] = this.lastViewSize;
      return { x: (ndcX * 0.5 + 0.5) * vw, y: (1 - (ndcY * 0.5 + 0.5)) * vh, behind: ndcZ > 1 };
    }

    updateBounds() {
      let b = null;
      for (const e of this.meshes.values()) {
        if (!e.visible || e.overlay) continue;
        const lo = this.toWorld([e.bbox[0], e.bbox[1], e.bbox[2]]);
        const hi = this.toWorld([e.bbox[3], e.bbox[4], e.bbox[5]]);
        const mn = [Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), Math.min(lo[2], hi[2])];
        const mx = [Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), Math.max(lo[2], hi[2])];
        if (!b) b = [...mn, ...mx];
        else for (let k = 0; k < 3; k++) {
          b[k] = Math.min(b[k], mn[k]);
          b[k + 3] = Math.max(b[k + 3], mx[k]);
        }
      }
      this.bounds = b;
      this.buildGrid();
    }

    buildGrid() {
      if (!this.supported || !this.bounds) {
        this.gridCount = 0;
        return;
      }
      const b = this.bounds;
      const span = Math.max(b[3] - b[0], b[5] - b[2], 10);
      const step = span > 60 ? 10 : 5;
      const half = Math.ceil((span * 0.9) / step) * step;
      const cx = Math.round((b[0] + b[3]) / 2 / step) * step;
      const cz = Math.round((b[2] + b[5]) / 2 / step) * step;
      const y = b[1] - 0.5;
      const pts = [];
      for (let v = -half; v <= half + 1e-6; v += step) {
        pts.push(cx + v, y, cz - half, cx + v, y, cz + half);
        pts.push(cx - half, y, cz + v, cx + half, y, cz + v);
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridNor);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), gl.STATIC_DRAW);
      this.gridCount = pts.length / 3;
      this.gridStep = step;
    }

    /* ------------------------------------------------------------ camera */

    fit(animate = true) {
      if (!this.bounds) return;
      const b = this.bounds;
      const center = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 || 20;
      this.radius = radius;
      this.go({ target: center, yaw: this.cam.yaw, pitch: this.cam.pitch, dist: radius / Math.sin((14 * Math.PI) / 180) }, animate);
    }

    view(name) {
      const d = norm(PRESETS[name] || PRESETS.iso);
      if (!this.bounds) return;
      const b = this.bounds;
      const center = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 || 20;
      this.go({ target: center, yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(clamp(d[1], -1, 1)), dist: radius / Math.sin((14 * Math.PI) / 180) });
    }

    reset() {
      this.cam.yaw = -0.6;
      this.cam.pitch = 0.55;
      this.fit();
    }

    zoom(factor) {
      this.tween = null;
      this.cam.dist = clamp(this.cam.dist * factor, 5, 4000);
      this.render();
    }

    go(to, animate = true) {
      if (!animate || this.reduceMotion.matches) {
        Object.assign(this.cam, { target: to.target.slice(), yaw: to.yaw, pitch: to.pitch, dist: to.dist });
        this.tween = null;
        this.render();
        return;
      }
      let dy = to.yaw - this.cam.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.tween = { from: { ...this.cam, target: this.cam.target.slice() }, to, dy, start: performance.now(), dur: 700 };
      this.render();
    }

    /* ------------------------------------------------------------- input */

    bindInput() {
      const c = this.canvas;
      const pointers = new Map();
      let pinch = null;

      c.addEventListener("contextmenu", (e) => e.preventDefault());
      // An active tool gets the left button first; it declines by returning false, and
      // right/middle drag, shift, alt and two fingers always keep navigating.
      let toolDrag = null;
      const local = (e) => {
        const r = c.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button };
      };
      c.addEventListener("pointerdown", (e) => {
        if (this.tool && e.button === 0 && !e.altKey && !pointers.size && this.tool.down?.(local(e)) === true) {
          toolDrag = e.pointerId;
          c.setPointerCapture(e.pointerId);
          this.tween = null;
          return;
        }
        c.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, shift: e.shiftKey });
        this.tween = null;
        c.classList.add("is-dragging");
        if (pointers.size === 2) {
          const [p, q] = [...pointers.values()];
          pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
        }
      });
      c.addEventListener("pointermove", (e) => {
        if (toolDrag === e.pointerId) {
          this.tool?.move?.(local(e));
          return;
        }
        const p = pointers.get(e.pointerId);
        if (!p) {
          if (this.tool && !pointers.size) this.tool.hover?.(local(e));
          return;
        }
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (pointers.size === 2 && pinch) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          this.cam.dist = clamp(this.cam.dist * (pinch.d / d), 5, 4000);
          this.pan(mx - pinch.mx, my - pinch.my);
          pinch = { d, mx, my };
        } else if (p.button === 2 || p.button === 1 || p.shift || this.mode === "pan") {
          this.pan(dx, dy);
        } else if (this.mode === "zoom") {
          this.cam.dist = clamp(this.cam.dist * (1 + dy * 0.005), 5, 4000);
        } else {
          this.cam.yaw -= dx * 0.008;
          this.cam.pitch += dy * 0.006;
        }
        this.render();
      });
      const end = (e) => {
        if (toolDrag === e.pointerId) {
          toolDrag = null;
          this.tool?.up?.(local(e));
          return;
        }
        // A press that didn't travel is a click: tools can select on it while drags keep orbiting.
        const p = pointers.get(e.pointerId);
        if (p && e.type === "pointerup" && p.button === 0 && pointers.size === 1 && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 4) this.tool?.click?.(local(e));
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!pointers.size) c.classList.remove("is-dragging");
      };
      c.addEventListener("pointerup", end);
      c.addEventListener("pointercancel", end);
      c.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          this.tween = null;
          this.cam.dist = clamp(this.cam.dist * Math.exp(e.deltaY * 0.0012), 5, 4000);
          this.render();
        },
        { passive: false }
      );
      c.addEventListener("pointerleave", () => this.tool?.leave?.());
      c.addEventListener("dblclick", () => {
        if (!this.tool) this.fit();
      });
    }

    pan(dx, dy) {
      if (!this.basis) return;
      const scale = (this.cam.dist * Math.tan((14 * Math.PI) / 180) * 2) / (this.canvas.clientHeight || 1);
      this.cam.target = add(this.cam.target, add(mul(this.basis.x, -dx * scale), mul(this.basis.y, dy * scale)));
    }

    /* ------------------------------------------------------------ render */

    render() {
      if (!this.supported || this.pending || this.disposed) return;
      this.pending = true;
      requestAnimationFrame((t) => this.frame(t));
    }

    frame(now) {
      this.pending = false;
      if (this.disposed) return;
      let busy = false;
      if (this.tween) {
        const t = clamp((now - this.tween.start) / this.tween.dur, 0, 1);
        const e = ease(t);
        const f = this.tween.from;
        const to = this.tween.to;
        this.cam.target = [lerp(f.target[0], to.target[0], e), lerp(f.target[1], to.target[1], e), lerp(f.target[2], to.target[2], e)];
        this.cam.yaw = f.yaw + this.tween.dy * e;
        this.cam.pitch = lerp(f.pitch, to.pitch, e);
        this.cam.dist = lerp(f.dist, to.dist, e);
        if (t < 1) busy = true;
        else this.tween = null;
      }
      this.draw();
      if (busy) this.render();
      if (this.onChange) this.onChange(this);
      if (this.onFrame) this.onFrame(this);
    }

    draw() {
      const gl = this.gl;
      const c = this.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      this.cam.pitch = clamp(this.cam.pitch, -1.55, 1.55);
      const cp = Math.cos(this.cam.pitch);
      const eye = add(this.cam.target, mul([cp * Math.sin(this.cam.yaw), Math.sin(this.cam.pitch), cp * Math.cos(this.cam.yaw)], this.cam.dist));
      const up = Math.abs(this.cam.pitch) > 1.5 ? [Math.sin(this.cam.yaw) * -Math.sign(this.cam.pitch), 0, -Math.cos(this.cam.yaw) * Math.sign(this.cam.pitch)] : [0, 1, 0];
      const basis = lookAt(eye, this.cam.target, up);
      this.basis = basis;
      this.eye = eye;
      const aspect = w / h;
      const fovy = 2 * Math.atan(Math.tan((14 * Math.PI) / 180) / Math.min(aspect, 1));
      this.tanY = Math.tan(fovy / 2);
      const near = Math.max(0.5, this.cam.dist * 0.01);
      const vp = mat4mul(perspective(fovy, aspect, near, this.cam.dist * 10 + 500), basis.m);
      this.lastVP = vp;
      this.lastViewSize = [c.clientWidth, c.clientHeight];
      const L1 = norm(add(add(mul(basis.x, -0.45), mul(basis.y, 0.75)), mul(basis.z, 0.6)));
      const L2 = norm(add(add(mul(basis.x, 0.75), mul(basis.y, -0.15)), mul(basis.z, 0.5)));
      const u = this.u;
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform3fv(u.uEye, eye);
      gl.uniform3fv(u.uL1, L1);
      gl.uniform3fv(u.uL2, L2);
      gl.uniform1f(u.uClipOn, 0);
      if (this.clip) gl.uniform4f(u.uClip, this.clip.normal[0], this.clip.normal[1], this.clip.normal[2], this.clip.d);

      const bind = (pbuf, nbuf, cbuf = null) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
        gl.enableVertexAttribArray(this.a.pos);
        gl.vertexAttribPointer(this.a.pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, nbuf);
        gl.enableVertexAttribArray(this.a.nor);
        gl.vertexAttribPointer(this.a.nor, 3, gl.FLOAT, false, 0, 0);
        if (this.a.color >= 0) {
          if (cbuf) {
            gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
            gl.enableVertexAttribArray(this.a.color);
            gl.vertexAttribPointer(this.a.color, 3, gl.FLOAT, false, 0, 0);
          } else {
            gl.disableVertexAttribArray(this.a.color);
            gl.vertexAttrib3f(this.a.color, 0, 0, 0);
          }
        }
      };

      // Grid lives in world space (identity model matrix).
      if (this.grid && this.gridCount) {
        gl.uniformMatrix3fv(u.uModel, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(u.uUseVC, 0);
        bind(this.gridBuf, this.gridNor);
        gl.uniform1f(u.uLine, 1);
        gl.uniform4f(u.uLineCol, 0.96, 0.96, 0.94, 0.07);
        // No depth write: seen from below, the grid must not punch holes in the model behind it.
        gl.depthMask(false);
        gl.drawArrays(gl.LINES, 0, this.gridCount);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      const model = this.modelMatrix();
      gl.uniformMatrix3fv(u.uModel, false, model);
      // A mirrored model matrix flips triangle winding, which would light it inside out.
      const det = model[0] * (model[4] * model[8] - model[5] * model[7]) - model[3] * (model[1] * model[8] - model[2] * model[7]) + model[6] * (model[1] * model[5] - model[2] * model[4]);
      gl.frontFace(det < 0 ? gl.CW : gl.CCW);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      const items = [];
      const visibleMeshes = [...this.meshes.values()].filter((e) => e.visible);
      visibleMeshes.forEach((e) => {
        if (!e.groups) {
          items.push({ e, start: 0, count: e.count, alpha: e.alpha, color: e.color });
          return;
        }
        e.groups.forEach((g) => {
          if (g.visible && g.count) items.push({ e, start: g.start, count: g.count, alpha: g.alpha ?? e.alpha, color: g.colorLin || e.color });
        });
      });
      items.sort((a, b) => (a.e.overlay === b.e.overlay ? b.alpha - a.alpha : a.e.overlay ? 1 : -1));
      const drawItem = (it) => {
        const e = it.e;
        bind(e.pbuf, e.nbuf, e.cbuf);
        gl.uniform1f(u.uClipOn, this.clip && !e.overlay ? 1 : 0);
        gl.uniform1f(u.uLine, 0);
        gl.uniform1f(u.uUseVC, e.useVertexColor ? 1 : 0);
        gl.uniform3fv(u.uBase, it.color);
        gl.uniform1f(u.uSpec, e.spec);
        gl.uniform1f(u.uGloss, e.gloss);
        gl.uniform1f(u.uSSS, e.sss);
        gl.uniform1f(u.uAlpha, it.alpha);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, e.ibuf);
        gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, it.start * 4);
      };
      items.forEach((it) => {
        if (it.alpha >= 1) {
          drawItem(it);
          return;
        }
        // Depth pre-pass: a see-through shell shows only its nearest layer, not its own insides.
        gl.colorMask(false, false, false, false);
        drawItem(it);
        gl.colorMask(true, true, true, true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        drawItem(it);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      });
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.uniform1f(u.uClipOn, 0);

      if (this.wireframe) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        visibleMeshes.forEach((e) => {
          if (e.overlay || !e.ecount) return;
          bind(e.pbuf, e.nbuf, e.cbuf);
          gl.uniform1f(u.uUseVC, 0);
          gl.uniform1f(u.uClipOn, this.clip ? 1 : 0);
          gl.uniform1f(u.uLine, 1);
          gl.uniform4f(u.uLineCol, 0.72, 0.95, 0.29, 0.32);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, e.ebuf);
          gl.drawElements(gl.LINES, e.ecount, gl.UNSIGNED_INT, 0);
        });
        gl.uniform1f(u.uClipOn, 0);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      // Cervical / margin contours (already in world space)
      if (this.overlayLineCount) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniformMatrix3fv(u.uModel, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
        bind(this.overlayBuf, this.overlayNor);
        gl.uniform1f(u.uUseVC, 0);
        gl.uniform1f(u.uLine, 1);
        gl.lineWidth?.(2);
        gl.uniform4f(u.uLineCol, 0.22, 0.62, 1.0, 0.95);
        gl.drawArrays(gl.LINES, 0, this.overlayLineCount);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      if (this.lineLayers.size) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniformMatrix3fv(u.uModel, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
        gl.uniform1f(u.uUseVC, 0);
        gl.uniform1f(u.uLine, 1);
        for (const layer of this.lineLayers.values()) {
          if (layer.onTop) gl.disable(gl.DEPTH_TEST);
          bind(layer.buf, layer.nor);
          gl.uniform4f(u.uLineCol, layer.color[0], layer.color[1], layer.color[2], layer.color[3]);
          gl.drawArrays(gl.LINES, 0, layer.count);
          gl.enable(gl.DEPTH_TEST);
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      this.drawGizmo();
    }

    drawGizmo() {
      const g = this.gizmo;
      if (!g || !this.basis) return;
      const ctx = g.getContext("2d");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = g.clientWidth;
      if (g.width !== size * dpr) {
        g.width = size * dpr;
        g.height = size * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const c = size / 2;
      const r = size * 0.34;
      const up = this.upAxis === "z";
      const axes = [
        { d: [1, 0, 0], label: "X", color: "#e57f9a" },
        { d: up ? [0, 0, -1] : [0, 1, 0], label: "Y", color: "#B7F34A" },
        { d: up ? [0, 1, 0] : [0, 0, 1], label: "Z", color: "#5fb4d9" },
      ].map((a) => ({ ...a, x: dot(this.basis.x, a.d), y: dot(this.basis.y, a.d), z: dot(this.basis.z, a.d) }));
      axes.sort((a, b) => a.z - b.z);
      ctx.lineWidth = 1.5;
      ctx.font = "600 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      axes.forEach((a) => {
        const x = c + a.x * r;
        const y = c - a.y * r;
        ctx.globalAlpha = a.z < -0.2 ? 0.45 : 1;
        ctx.strokeStyle = a.color;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = a.color;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0b1114";
        ctx.fillText(a.label, x, y + 0.5);
      });
      ctx.globalAlpha = 1;
    }

    dispose() {
      if (!this.supported || this.disposed) return;
      this.clear();
      this.disposed = true;
      if (this.resizeObserver) this.resizeObserver.disconnect();
      const lose = this.gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }
  }

  window.FaucharViewer = Viewer;
}
