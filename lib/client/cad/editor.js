/**
 * FAUCHAR manual CAD editor: objects, undo history, pointer tools and colour maps on top of the
 * WebGL viewer. Geometry itself lives in ops.js; the panel UI lives in panel.js.
 *
 * Edits never touch the imported files: every object keeps its original vertices, and each
 * command is a sparse vertex delta, so any step can be undone or reverted on its own.
 */
import { BVH, V, clamp, computeNormals, meshStats, parseBinarySTL, uniqueEdges, vertexAt, writeBinarySTL } from "./mesh.js";
import * as ops from "./ops.js";
import { anchorJobTooth, archIndexAt, detectTeeth, jawOfFdi, labelTeeth, renumberFromTooth, toothBoundaryLines, toothGeometry } from "./teeth.js";
import { readouts, renderPanel, TOOLS, BRUSHES } from "./panel.js";
import { KernelWorker } from "./worker-client.js";
import { addLibraryModel, listLibraryModels, getLibraryModel } from "./restoration-library.js";
import { scanContext, requestToothCraft } from "./toothcraft.js";
import { profileForTooth } from "./crown-builder.js";
import { seatTooth } from "./seat-tooth.js";
import { loadLibraryTooth, shellRim } from "./tooth-library-stl.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const hexLin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
};

export const MAPS = {
  occlusion: { label: "Occlusal distance", unit: "mm", stops: [[-0.2, "#7a0f1c"], [0, "#e5343f"], [0.05, "#f58a2c"], [0.1, "#f4d33f"], [0.25, "#6fcf5f"], [0.6, "#3f8fd6"], [1.5, "#2a3a4a"]] },
  contact: { label: "Proximal distance", unit: "mm", stops: [[-0.2, "#7a0f1c"], [-0.02, "#e5343f"], [0.02, "#6fcf5f"], [0.1, "#f4d33f"], [0.3, "#3f8fd6"], [1, "#2a3a4a"]] },
  thickness: { label: "Wall thickness", unit: "mm", stops: [[0, "#7a0f1c"], [0.3, "#e5343f"], [0.5, "#f4d33f"], [0.8, "#6fcf5f"], [1.5, "#3f8fd6"], [3, "#2a3a4a"]] },
  cement: { label: "Cement gap", unit: "mm", stops: [[-0.05, "#7a0f1c"], [0, "#e5343f"], [0.03, "#f4d33f"], [0.06, "#6fcf5f"], [0.12, "#39c1c9"], [0.3, "#2a4a8a"]] },
  deviation: { label: "Edited vs original", unit: "mm", stops: [[-0.5, "#2a4ad6"], [-0.1, "#39c1c9"], [0, "#e9e6dc"], [0.1, "#f58a2c"], [0.5, "#d6242f"]] },
  curvature: { label: "Anatomy curvature", unit: "", stops: [[-2.5, "#2a5ad6"], [-0.6, "#8fb2d6"], [0, "#e9e6dc"], [0.6, "#e9b98a"], [2.5, "#d6562a"]] },
  regions: { label: "Surface regions", unit: "", categories: [["#f4d33f", "Occlusal"], ["#6fcf5f", "Facial"], ["#3f8fd6", "Lingual"], ["#e58a9a", "Mesial"], ["#b58ae5", "Distal"], ["#8a929a", "Intaglio"]] },
};
Object.values(MAPS).forEach((m) => {
  if (m.stops) m.lin = m.stops.map(([v, h]) => [v, hexLin(h)]);
});

function rampColor(stops, value, out, o) {
  if (value <= stops[0][0]) { out[o] = stops[0][1][0]; out[o + 1] = stops[0][1][1]; out[o + 2] = stops[0][1][2]; return; }
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i][0]) {
      const t = (value - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      const a = stops[i - 1][1], b = stops[i][1];
      out[o] = a[0] + (b[0] - a[0]) * t; out[o + 1] = a[1] + (b[1] - a[1]) * t; out[o + 2] = a[2] + (b[2] - a[2]) * t;
      return;
    }
  }
  const l = stops[stops.length - 1][1];
  out[o] = l[0]; out[o + 1] = l[1]; out[o + 2] = l[2];
}

const PAINT_TOOLS = ["sculpt", "anatomy", "occlusion", "contacts"];
const RESTORATION_STYLE = { color: "#F5F4EF", spec: 0.72, gloss: 72, sss: 0.35 };
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(d));

export class CadEditor {
  constructor({ viewer, caseData, hud, ribbon, panel, legend, statusEl, io, sampleDesign = null }) {
    Object.assign(this, { viewer, caseData, hud, ribbon, panelEl: panel, legend, statusEl, io, sampleDesign });
    this.objects = new Map();
    this.stack = [];
    this.cursor = 0;
    this.tool = "sculpt";
    this.selectedId = null;
    this.margin = null;
    this.marginOriginal = null;
    this.marginSel = -1;
    this.marginDraft = null;
    this.marginDraftHistory = [];
    this.marginStroke = null;
    this.marginTraced = false;
    this.marginSub = "move";
    this.marginCtrl = null;
    this.marginTooth = null;
    this.margins = new Map();
    this.magnet = false;
    this.teethData = {};
    this.teethJaw = null;
    this.selectedTooth = null;
    this.pendingTooth = null;
    this.savedTeeth = null;
    this.showMargin = true;
    this.mapKind = null;
    this.compare = "edited";
    this.measures = [];
    this.measureSub = "distance";
    this.measureDraft = [];
    this.section = { on: false, axis: "mesial", offset: 0, stats: null };
    this.opts = {
      brush: "add", radius: 1.2, strength: 0.4, protect: true,
      gizmo: "move", axial: false,
      targets: { occlusal: 0.1, mesial: 0.03, distal: 0.03 },
      thickness: { min: 0.5, minMargin: 0.2, zone: 1.2 },
      cement: { gap: 0.06, marginGap: 0.02, zone: 1 },
      axisTilt: [0, 0],
      influence: 0,
      connector: { width: 3, height: 3.5, waist: 0.9, offset: 0, minArea: 9 },
      pontic: { md: 100, fl: 100, h: 100, dome: 1 },
      voxel: 0.1,
    };
    this.live = null;
    this.hover = null;
    this.stroke = null;
    this.gizmo = null;
    this.libraryModels = [];
    this.libraryBusy = false;
    this.droppedTooth = null;
    this.dirtySave = false;
    this.disposed = false;
    this.xform = null;
    this.kernel = new KernelWorker();
    this.workflow = { mode: "wizard", step: null };
    this.construction = { anatomyStyle: caseData.job?.anatomyStyle || "balanced", libraryId: "standard", profile: profileForTooth(caseData.teeth?.[0] || 22), wall: 0.8, marginWall: 0.2, relief: 1 };
    const parameters = caseData.job?.parameters;
    if (parameters) {
      if (Number.isFinite(parameters.cementGap)) this.opts.cement.gap = parameters.cementGap;
      if (Number.isFinite(parameters.marginGap)) this.opts.cement.marginGap = parameters.marginGap;
      if (Number.isFinite(parameters.minWall)) { this.opts.thickness.min = parameters.minWall; this.construction.wall = parameters.minWall; }
      if (Number.isFinite(parameters.marginWall)) { this.opts.thickness.minMargin = parameters.marginWall; this.construction.marginWall = parameters.marginWall; }
    }
    this.busy = false;
  }

  /* ----------------------------------------------------------- set-up */

  async init(fileEntries) {
    const { viewer } = this;
    this.setStatus("Preparing CAD kernel…");
    await tick();
    for (const f of fileEntries) {
      const entry = viewer.meshes.get(f.id);
      if (!entry) continue;
      const isCrown = f.jaw === "restoration";
      const obj = {
        id: f.id, vid: f.id, kind: isCrown ? "crown" : "scan", jaw: f.jaw,
        name: isCrown ? `Crown ${this.caseData.teeth?.[0] ?? ""}`.trim() : f.jaw === "upper" ? "Upper jaw" : f.jaw === "lower" ? "Lower jaw" : f.name,
        mesh: null, original: entry.positions.slice(), originalIdx: entry.indices, alpha: 1, visible: entry.visible,
      };
      // Scans are big: they get the mesh structure only when a tool asks for it.
      if (isCrown) this.attachMesh(obj, entry.positions, entry.indices);
      else obj.lazy = { positions: entry.positions, indices: entry.indices };
      this.objects.set(f.id, obj);
    }
    // Extra reference scans must never become a preparation or antagonist by accident.
    this.scanObjects = [...this.objects.values()].filter((o) => o.kind === "scan" && ["upper", "lower"].includes(o.jaw));
    const crown = [...this.objects.values()].find((o) => o.kind === "crown");
    if (crown) await this.setupCrown(crown);
    await this.setupRelations(crown);
    await this.restoreDesign();
    if (this.savedTeeth && Object.keys(this.savedTeeth).length && this.scanObjects.length) this.identifyTeeth({ keepSaved: true });
    this.bindTool();
    this.bindDrops();
    this.hud.ctx = this.hud.getContext("2d");
    viewer.onFrame = () => this.drawHud();
    this.bindKeys();
    this.setTool(crown ? "sculpt" : "margin");
    this.renderRibbon();
    this.setStatus(crown ? "Ready" : "No restoration loaded");
    this.refreshMargin();
    this.focusCrown();
    viewer.render();
  }

  /** Opens on the work itself: the crown seen from the facial side, antagonist out of the way. */
  focusCrown() {
    const crown = this.crown;
    if (!crown?.frame) return;
    if (this.antagonist) {
      this.setVisible(this.antagonist, false);
      this.io.onVisibility?.(this.antagonist, false);
    }
    const { viewer } = this;
    const f = crown.frame;
    const dir = V.norm(V.add(V.mul(f.facial, 1), V.mul(f.occlusal, 0.35)));
    const d = viewer.toWorld(dir);
    const target = viewer.toWorld(V.add(f.center, V.mul(f.occlusal, 3)));
    viewer.go({ target, yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(clamp(d[1], -1, 1)), dist: 44 }, false);
  }

  /** View buttons follow the tooth: "Occlusal" means its biting surface, in either jaw. */
  dentalView(name) {
    const f = (this.mapObject() || this.crown)?.frame;
    if (!f) return false;
    const { viewer } = this;
    const dirs = {
      front: f.facial,
      top: f.occlusal,
      left: V.mul(f.mesial, viewer.toWorld(f.mesial)[0] < 0 ? 1 : -1),
      right: V.mul(f.mesial, viewer.toWorld(f.mesial)[0] < 0 ? -1 : 1),
      iso: V.norm(V.add(V.add(f.facial, V.mul(f.occlusal, 0.6)), V.mul(f.mesial, 0.5))),
    };
    const dir = dirs[name];
    if (!dir) return false;
    const d = viewer.toWorld(V.norm(dir));
    const target = viewer.toWorld(V.add(f.center, V.mul(f.occlusal, 3)));
    viewer.go({ target, yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(clamp(d[1], -1, 1)), dist: 44 });
    return true;
  }

  attachMesh(obj, positions, indices) {
    obj.mesh = ops.makeMesh(positions, indices);
    obj.scratch = ops.newScratch(obj.mesh.count);
    if (this.viewer.meshes.has(obj.vid)) this.viewer.updateMeshGeometry(obj.vid, positions, obj.mesh.norm);
  }

  ensureMesh(obj) {
    if (!obj.mesh && obj.lazy) {
      obj.mesh = ops.makeMesh(obj.lazy.positions, obj.lazy.indices);
      obj.scratch = ops.newScratch(obj.mesh.count);
    }
    return obj.mesh;
  }

  async setupCrown(obj) {
    const { mesh } = obj;
    this.setStatus("Analysing restoration…");
    await tick();
    const seg = ops.segmentCrown(mesh);
    const share = seg.intaglio.reduce((s, x) => s + x, 0) / mesh.count;
    obj.seg = seg.rimLoop.length >= 16 && share > 0.08 && share < 0.85 ? seg : null;
    obj.original = mesh.pos.slice();
    obj.originalIdx = mesh.idx.slice();
    if (obj.seg) {
      obj.intaglioBvh = new BVH(mesh.pos, mesh.idx, obj.seg.inTris);
      this.refreshWeights(obj);
    } else {
      obj.weights = { weight: new Float32Array(mesh.count).fill(1), rimDist: new Float32Array(mesh.count).fill(99) };
    }
    if (!this.selectedId) this.selectedId = obj.id;
  }

  refreshWeights(obj) {
    if (obj.seg) obj.weights = ops.outerWeights(obj.mesh, obj.seg);
  }

  async setupRelations(crown) {
    const scans = this.scanObjects;
    const anchor = crown?.seg ? ops.crownFrame(crown.mesh, crown.seg).center : crown ? centroid(crown.mesh.pos) : null;
    this.prep = null;
    this.antagonist = null;
    this.setStatus("Locating the preparation…");
    await tick();
    if (anchor && scans.length) {
      // The prepared jaw is the scan the intaglio sits on; the other one opposes it.
      const scored = scans.map((o) => {
        const tris = ops.regionTriangles(o.lazy.positions, o.lazy.indices, anchor, 30);
        const bvh = new BVH(o.lazy.positions, o.lazy.indices, tris);
        const q = crown.seg ? bvh.closest(vertexAt(crown.mesh.pos, crown.seg.rimLoop[0]), 12)?.d ?? 99 : bvh.closest(anchor, 30)?.d ?? 99;
        o.region = bvh;
        return { o, q };
      }).sort((a, b) => a.q - b.q);
      this.prep = scored[0].o;
      this.antagonist = scored[1]?.o ?? null;
    } else if (scans.length) {
      this.prep = scans.find((o) => o.jaw === (this.caseData.teeth?.[0] > 28 ? "lower" : "upper")) || scans[0];
      this.antagonist = scans.find((o) => o !== this.prep) || null;
      for (const o of scans) o.region = new BVH(o.lazy.positions, o.lazy.indices);
    }
    if (crown) {
      const jaw = this.prep?.lazy.positions ?? null;
      crown.frame = crown.seg ? ops.crownFrame(crown.mesh, crown.seg, jaw) : defaultFrame(crown.mesh.pos);
      if (this.sampleDesign?.frame) {
        const toScan = (w) => [w[0], -w[2], w[1]];
        const f = this.sampleDesign.frame;
        crown.frame = { ...crown.frame, occlusal: toScan(f.occlusal), mesial: toScan(f.mesial), facial: toScan(f.facial) };
        this.opts.targets.occlusal = this.sampleDesign.stats?.design?.antagonistDistance ?? 0.1;
        Object.assign(this.opts.thickness, { min: this.sampleDesign.stats?.design?.minThickness ?? 0.5, minMargin: this.sampleDesign.stats?.design?.minThicknessMargin ?? 0.2 });
        this.opts.cement.gap = this.sampleDesign.stats?.design?.cementGap ?? 0.06;
      }
      this.opts.pivotFrame = crown.frame;
    }
    // Margin: the design file if the case has one, otherwise the restoration's own rim.
    if (this.sampleDesign?.margin) this.margin = this.sampleDesign.margin.map((w) => [w[0], -w[2], w[1]]);
    else if (crown?.seg) this.margin = ops.resampleLoop(Array.from(crown.seg.rimLoop, (v) => vertexAt(crown.mesh.pos, v)), 160);
    this.marginOriginal = this.margin?.map((p) => p.slice()) ?? null;
    this.marginCtrl = this.margin;
    if (this.margin && this.caseData.teeth?.length) this.marginTooth = this.caseData.teeth[0];
    this.insertionAxis = crown?.frame?.occlusal ?? null;
    // With no crown to read it from, the occlusal direction points from this jaw to the opposing one.
    if (!this.insertionAxis && this.prep) this.insertionAxis = this.occlusalGuess();
    if (this.insertionAxis) {
      const a = V.norm(this.insertionAxis);
      const m = V.norm(V.cross(Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], a));
      this.axisFrame = { occlusal: a, mesial: m, facial: V.cross(a, m) };
    }
    if (this.prep && this.margin && crown?.frame) {
      this.setStatus("Segmenting die and neighbours…");
      await tick();
      this.ensureMesh(this.prep);
      this.applyJawParts(ops.segmentJaw(this.prep.mesh, this.margin, crown.frame));
    }
  }

  /** Reorders the prepared jaw's triangles so die, neighbours and gum can be shown separately. */
  applyJawParts(parts) {
    const scan = this.prep;
    scan.drawSplit = false;
    scan.drawNeighbor = null;
    const { label } = parts;
    scan.parts = parts;
    const { idx } = scan.mesh;
    const buckets = [[], [], [], []];
    const prepTris = [], mTris = [], dTris = [];
    for (let t = 0; t < idx.length / 3; t++) {
      const a = label[idx[t * 3]], b = label[idx[t * 3 + 1]], c = label[idx[t * 3 + 2]];
      const l = a === b && b === c ? a : ops.LABEL.JAW;
      buckets[l].push(t);
      if (l === ops.LABEL.PREP) prepTris.push(t);
      if (l === ops.LABEL.NEIGHBOR_M) mTris.push(t);
      if (l === ops.LABEL.NEIGHBOR_D) dTris.push(t);
    }
    this.neighborBvh = {
      mesial: mTris.length ? new BVH(scan.mesh.pos, idx, mTris) : null,
      distal: dTris.length ? new BVH(scan.mesh.pos, idx, dTris) : null,
    };
    this.prepBvh = prepTris.length ? new BVH(scan.mesh.pos, idx, prepTris) : scan.region;
    scan.prepVerts = [];
    for (let v = 0; v < scan.mesh.count; v++) if (label[v] === ops.LABEL.PREP) scan.prepVerts.push(v);
    const draw = new Uint32Array(idx.length);
    let o = 0;
    const groups = [];
    const emit = (id, list, color) => {
      const start = o;
      for (const t of list) {
        draw[o++] = idx[t * 3]; draw[o++] = idx[t * 3 + 1]; draw[o++] = idx[t * 3 + 2];
      }
      groups.push({ id, start, count: o - start, color });
    };
    emit("jaw", buckets[0], null);
    emit("prep", buckets[1], "#d7b48c");
    emit("neighbor-m", buckets[2], null);
    emit("neighbor-d", buckets[3], null);
    this.viewer.setMeshGroups(scan.vid, draw, groups);
  }

  /* ------------------------------------------------------- object access */

  get selected() { return this.objects.get(this.selectedId) || null; }
  get units() { return [...this.objects.values()].filter((o) => o.kind !== "scan"); }
  get crown() { return [...this.objects.values()].find((o) => o.kind === "crown") || null; }
  get frame() {
    const c = this.crown;
    return this.selected?.frame || c?.frame || null;
  }

  select(id) {
    this.selectedId = id;
    this.gizmo = null;
    this.renderPanel();
    this.viewer.render();
  }

  setVisible(obj, on) {
    obj.visible = on;
    this.viewer.setVisible(obj.vid, on);
  }

  setAlpha(obj, alpha) {
    obj.alpha = alpha;
    this.viewer.setMeshStyle(obj.vid, { alpha });
  }

  setPart(part, style) {
    if (this.prep) this.viewer.setGroupStyle(this.prep.vid, part, style);
  }

  /* --------------------------------------------------------- history */

  beginGeom(obj) {
    obj.before = obj.mesh.pos.slice();
  }

  /** Records what changed since beginGeom as a sparse delta and adds it to the history. */
  commitGeom(obj, label, { extra = null } = {}) {
    const before = obj.before;
    obj.before = null;
    const { pos } = obj.mesh;
    const ids = [];
    for (let v = 0; v < pos.length / 3; v++) {
      if (pos[v * 3] !== before[v * 3] || pos[v * 3 + 1] !== before[v * 3 + 1] || pos[v * 3 + 2] !== before[v * 3 + 2]) ids.push(v);
    }
    if (!ids.length && !extra) return false;
    const delta = new Float32Array(ids.length * 3);
    ids.forEach((v, i) => {
      delta[i * 3] = pos[v * 3] - before[v * 3];
      delta[i * 3 + 1] = pos[v * 3 + 1] - before[v * 3 + 1];
      delta[i * 3 + 2] = pos[v * 3 + 2] - before[v * 3 + 2];
    });
    this.push({ label, type: "geom", objId: obj.id, ids: Uint32Array.from(ids), delta, verts: pos.length / 3, extra });
    return true;
  }

  applyDelta(cmd, sign) {
    const obj = this.objects.get(cmd.objId);
    if (!obj?.mesh || obj.mesh.count !== cmd.verts) return false;
    const { pos } = obj.mesh;
    const { ids, delta } = cmd;
    for (let i = 0; i < ids.length; i++) {
      const v = ids[i];
      pos[v * 3] += delta[i * 3] * sign;
      pos[v * 3 + 1] += delta[i * 3 + 1] * sign;
      pos[v * 3 + 2] += delta[i * 3 + 2] * sign;
    }
    cmd.extra?.(sign);
    this.geometryChanged(obj, { commit: true });
    return true;
  }

  push(cmd) {
    this.stack.length = this.cursor;
    this.stack.push(cmd);
    this.cursor = this.stack.length;
    this.afterHistory();
  }

  run(cmd, dir) {
    if (cmd.type === "geom") this.applyDelta(cmd, dir);
    else if (dir > 0) cmd.redo();
    else cmd.undo();
  }

  undo() {
    if (!this.cursor) return;
    this.cancelLive();
    this.run(this.stack[--this.cursor], -1);
    this.afterHistory();
  }

  redo() {
    if (this.cursor >= this.stack.length) return;
    this.cancelLive();
    this.run(this.stack[this.cursor++], 1);
    this.afterHistory();
  }

  jumpTo(n) {
    while (this.cursor > n) this.undo();
    while (this.cursor < n) this.redo();
  }

  /** Reverts one earlier step only, keeping everything done after it. */
  revertStep(i) {
    const cmd = this.stack[i];
    if (!cmd || cmd.type !== "geom" || i >= this.cursor) return;
    const copy = { ...cmd, label: `Revert: ${cmd.label}`, delta: cmd.delta.map((x) => -x), extra: null };
    if (this.applyDelta(copy, 1)) this.push(copy);
    else this.io.toast("This step can't be reverted on its own: the mesh was refined after it.", "warn");
  }

  afterHistory() {
    this.markDirty();
    this.renderRibbon();
    this.renderPanel();
    this.refreshMap();
    this.updateSection();
    this.viewer.render();
  }

  /** Undoable restore of one object to its imported or generated geometry. */
  resetObject(obj) {
    if (!obj?.mesh) return;
    if (obj.original.length !== obj.mesh.pos.length) {
      this.io.toast("Undo the mesh refinement first: this object has a different vertex count now.", "warn");
      return;
    }
    this.beginGeom(obj);
    obj.mesh.pos.set(obj.original);
    this.geometryChanged(obj, { commit: true });
    if (!this.commitGeom(obj, `Reset ${obj.name}`)) this.io.toast(`${obj.name} is already unmodified.`);
  }

  /* ------------------------------------------------------- geometry sync */

  geometryChanged(obj, { commit = false, touched = null } = {}) {
    const { mesh } = obj;
    computeNormals(mesh.pos, mesh.idx, mesh.norm);
    mesh.bvh.refit();
    obj.intaglioBvh?.refit();
    if (obj.kind === "scan") {
      obj.region?.refit();
      this.prepBvh?.refit();
      this.neighborBvh?.mesial?.refit();
      this.neighborBvh?.distal?.refit();
    }
    this.viewer.updateMeshGeometry(obj.vid, mesh.pos, mesh.norm);
    if (commit) {
      if (obj.seg) this.refreshWeights(obj);
      this.viewer.refreshBounds?.(obj.vid);
      this.updateGhost();
    }
    if (this.mapKind && touched && obj === this.mapObject()) this.updateMapValues(touched);
    this.viewer.render();
  }

  /* ----------------------------------------------------- live slider edits */

  /** Slider edits write from a snapshot, so dragging back and forth never accumulates error. */
  liveStart(obj, label, apply) {
    this.cancelLive();
    this.beginGeom(obj);
    this.live = { obj, label, apply, base: obj.before };
    this.setStatus(label);
  }

  liveUpdate(value) {
    const l = this.live;
    if (!l) return;
    l.apply(l.base, value);
    this.geometryChanged(l.obj);
    this.refreshReadouts();
  }

  liveCommit(labelFn, extra = null) {
    const l = this.live;
    if (!l) return;
    this.live = null;
    this.geometryChanged(l.obj, { commit: true });
    this.commitGeom(l.obj, labelFn ? labelFn() : l.label, { extra });
    this.setStatus("Ready");
  }

  cancelLive() {
    const l = this.live;
    if (!l) return;
    this.live = null;
    l.obj.mesh.pos.set(l.base);
    l.obj.before = null;
    this.geometryChanged(l.obj, { commit: true });
  }

  /** Runs a one-shot geometry operation as a single history step. */
  operate(obj, label, fn) {
    this.cancelLive();
    this.beginGeom(obj);
    const result = fn();
    this.geometryChanged(obj, { commit: true });
    const changed = this.commitGeom(obj, label);
    return { result, changed };
  }

  /* ------------------------------------------------------- dental values */

  antagonistBvh() {
    return this.antagonist?.region || null;
  }

  liveFacts() {
    const crown = this.crown;
    if (!crown?.mesh) return null;
    const stats = meshStats(crown.mesh.pos, crown.mesh.idx);
    const facts = { stats };
    const w = crown.weights.weight;
    const ant = this.antagonistBvh();
    if (ant) {
      const g = ops.gapStats(crown.mesh, w, ant, 2.5);
      facts.occlusal = g;
    }
    if (this.neighborBvh?.mesial) facts.mesial = ops.gapStats(crown.mesh, w, this.neighborBvh.mesial, 4);
    if (this.neighborBvh?.distal) facts.distal = ops.gapStats(crown.mesh, w, this.neighborBvh.distal, 4);
    if (crown.seg) {
      facts.thickness = ops.thicknessMap(crown.mesh, crown.seg, crown.intaglioBvh, this.opts.thickness.zone);
      if (this.prepBvh) facts.cement = ops.cementMap(crown.mesh, crown.seg, this.prepBvh);
    }
    if (crown.frame) {
      const bb = (a) => {
        let lo = Infinity, hi = -Infinity;
        for (let v = 0; v < crown.mesh.count; v++) {
          if (crown.seg?.intaglio[v]) continue;
          const d = crown.mesh.pos[v * 3] * a[0] + crown.mesh.pos[v * 3 + 1] * a[1] + crown.mesh.pos[v * 3 + 2] * a[2];
          if (d < lo) lo = d;
          if (d > hi) hi = d;
        }
        return hi - lo;
      };
      facts.dims = { md: bb(crown.frame.mesial), fl: bb(crown.frame.facial), h: bb(crown.frame.occlusal) };
    }
    return facts;
  }

  /* ------------------------------------------------------------ colour maps */

  mapObject() {
    const sel = this.selected;
    return sel?.mesh && sel.kind !== "scan" ? sel : this.crown;
  }

  setMap(kind) {
    this.mapKind = this.mapKind === kind ? null : kind;
    this.refreshMap();
    this.renderPanel();
  }

  refreshMap() {
    for (const o of this.units) if (o.mapped) { this.viewer.clearVertexColors(o.vid); o.mapped = false; }
    const obj = this.mapObject();
    if (!this.mapKind || !obj) {
      this.legend.hidden = true;
      this.mapValues = null;
      return;
    }
    const n = obj.mesh.count;
    this.mapValues = new Float32Array(n).fill(NaN);
    const all = new Int32Array(n);
    for (let v = 0; v < n; v++) all[v] = v;
    this.computeValues(obj, all);
    this.paintMap(obj);
    this.renderLegend();
  }

  /** Per-vertex values; during a brush stroke only the touched vertices are recomputed. */
  computeValues(obj, list) {
    const { mesh, seg } = obj;
    const values = this.mapValues;
    const kind = this.mapKind;
    const w = obj.weights?.weight;
    const inner = (v) => seg?.intaglio[v];
    if (kind === "curvature") {
      const c = ops.convexity(mesh);
      for (const v of list) values[v] = inner(v) ? NaN : c[v];
    } else if (kind === "regions") {
      const f = obj.frame || this.crown?.frame;
      if (!f) return;
      for (const v of list) {
        if (inner(v)) { values[v] = 5; continue; }
        const n = [mesh.norm[v * 3], mesh.norm[v * 3 + 1], mesh.norm[v * 3 + 2]];
        const scores = [V.dot(n, f.occlusal), V.dot(n, f.facial), -V.dot(n, f.facial), V.dot(n, f.mesial), -V.dot(n, f.mesial)];
        values[v] = scores.indexOf(Math.max(...scores));
      }
    } else if (kind === "deviation") {
      const b = this.originalBvh(obj);
      for (const v of list) {
        const c = b.closest(vertexAt(mesh.pos, v), 4);
        values[v] = c ? (c.side < 0 ? -c.d : c.d) : 4;
      }
    } else if (kind === "occlusion") {
      const ant = this.antagonistBvh();
      for (const v of list) {
        if (inner(v) || !ant) { values[v] = NaN; continue; }
        const g = ops.signedGap(ant, vertexAt(mesh.pos, v), 1.6);
        values[v] = g ? g.d : NaN;
      }
    } else if (kind === "contact") {
      const a = this.neighborBvh?.mesial, b = this.neighborBvh?.distal;
      for (const v of list) {
        if (inner(v)) { values[v] = NaN; continue; }
        const p = vertexAt(mesh.pos, v);
        const g1 = a && ops.signedGap(a, p, 1.2), g2 = b && ops.signedGap(b, p, 1.2);
        values[v] = g1 && g2 ? Math.min(g1.d, g2.d) : g1 ? g1.d : g2 ? g2.d : NaN;
      }
    } else if (kind === "thickness" && seg) {
      for (const v of list) {
        if (inner(v)) { values[v] = NaN; continue; }
        const c = obj.intaglioBvh.closest(vertexAt(mesh.pos, v), 3.2);
        values[v] = c ? c.d : 3.2;
      }
    } else if (kind === "cement" && seg && this.prepBvh) {
      for (const v of list) {
        if (!inner(v)) { values[v] = NaN; continue; }
        const g = ops.signedGap(this.prepBvh, vertexAt(mesh.pos, v), 2);
        values[v] = g ? g.d : NaN;
      }
    }
    if (w) void w;
  }

  updateMapValues(touched) {
    const obj = this.mapObject();
    if (!this.mapValues || this.mapValues.length !== obj.mesh.count || this.mapKind === "curvature") return;
    this.computeValues(obj, touched);
    this.paintMap(obj);
  }

  paintMap(obj) {
    const def = MAPS[this.mapKind];
    const base = hexLin(RESTORATION_STYLE.color);
    const col = new Float32Array(obj.mesh.count * 3);
    const values = this.mapValues;
    const cats = def.categories?.map(([h]) => hexLin(h));
    for (let v = 0; v < obj.mesh.count; v++) {
      const x = values[v];
      if (Number.isNaN(x)) { col[v * 3] = base[0] * 0.8; col[v * 3 + 1] = base[1] * 0.8; col[v * 3 + 2] = base[2] * 0.8; continue; }
      if (cats) { col.set(cats[x], v * 3); continue; }
      rampColor(def.lin, x, col, v * 3);
    }
    this.viewer.setVertexColors(obj.vid, col);
    obj.mapped = true;
  }

  renderLegend() {
    const def = MAPS[this.mapKind];
    this.legend.hidden = false;
    if (def.categories) {
      this.legend.innerHTML = `<strong>${def.label}</strong><div class="cad-legend-cats">${def.categories.map(([h, l]) => `<span><i style="background:${h}"></i>${l}</span>`).join("")}</div>`;
      return;
    }
    const [lo, hi] = [def.stops[0][0], def.stops[def.stops.length - 1][0]];
    const grad = def.stops.map(([v, h]) => `${h} ${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(",");
    // Skip ticks that would collide: the stops are dense around zero.
    let lastAt = -100;
    const ticks = def.stops.map(([v]) => {
      const at = ((v - lo) / (hi - lo)) * 100;
      if (at - lastAt < 11) return "";
      lastAt = at;
      return `<span style="left:${at.toFixed(1)}%">${v}</span>`;
    }).join("");
    this.legend.innerHTML = `<strong>${def.label}${def.unit ? ` · ${def.unit}` : ""}</strong><div class="cad-legend-bar" style="background:linear-gradient(90deg,${grad})"></div><div class="cad-legend-ticks">${ticks}</div>`;
  }

  originalBvh(obj) {
    if (!obj.origBvh || obj.origBvh.pos.length !== obj.original.length) {
      obj.origBvh = new BVH(obj.original, obj.originalIdx);
    }
    return obj.origBvh;
  }

  /* ------------------------------------------------------- compare modes */

  setCompare(mode) {
    this.compare = mode;
    const obj = this.mapObject();
    if (!obj) return;
    if (this.mapKind === "deviation" && mode !== "deviation") this.mapKind = null;
    if (mode === "deviation") this.mapKind = "deviation";
    this.refreshMap();
    this.updateGhost();
    if (mode === "original") this.viewer.setVisible(obj.vid, false);
    else this.viewer.setVisible(obj.vid, obj.visible !== false);
    this.renderPanel();
    this.viewer.render();
  }

  updateGhost() {
    const obj = this.mapObject();
    const show = obj && (this.compare === "overlay" || this.compare === "original");
    this.viewer.removeMesh("cad:ghost");
    if (!show) return;
    const norm = computeNormals(obj.original, obj.originalIdx);
    this.viewer.addMesh("cad:ghost", { positions: obj.original, normals: norm, indices: obj.originalIdx, edges: new Uint32Array(0) }, {
      overlay: true, color: this.compare === "overlay" ? "#6cb8dc" : RESTORATION_STYLE.color, alpha: this.compare === "overlay" ? 0.38 : 1, spec: 0.5, gloss: 60, sss: 0.3,
    });
  }

  /* ------------------------------------------------------------ margin */

  refreshMargin() {
    const v = this.viewer;
    const draft = this.marginDraft;
    if ((!this.margin && !draft) || !this.showMargin) {
      v.removeMesh("cad:margin");
      return;
    }
    // Raw trace preview is cheap; fit/snap the spline once when the user finishes.
    const tube = draft || this.margin;
    const handles = this.tool === "margin" ? (draft && draft.length > 48 ? [draft[0], draft[draft.length - 1]] : draft || this.marginCtrl || this.margin) : null;
    const { positions, normals, indices, colors } = marginGeometry(tube, !draft, handles, this.marginSel);
    if (!positions.length) { v.removeMesh("cad:margin"); return; }
    v.addMesh("cad:margin", { positions, normals, indices, edges: new Uint32Array(0) }, { overlay: true, color: "#39d0ff", spec: 0.2, gloss: 20, sss: 0.8 });
    v.setVertexColors("cad:margin", colors);
  }

  /** The scan the current tooth's margin lies on. */
  marginScan() {
    if (this.marginTooth) {
      const s = this.scanObjects.find((o) => o.jaw === jawOfFdi(this.marginTooth));
      if (s) return s;
    }
    return this.prep || this.scanObjects[0] || null;
  }

  marginBvh() {
    const scan = this.marginScan();
    return scan ? this.ensureMesh(scan).bvh : null;
  }

  /** The line through the technician's control points, lying on the scan. A dense point set is the line. */
  curveThrough(ctrl, closed = true) {
    if (ctrl.length >= 60 || ctrl.length < 2) return ctrl;
    const curve = ops.splineThrough(ctrl, closed);
    const bvh = this.marginBvh();
    if (!bvh) return curve;
    // Snapping alone jitters across the scan's facets. Relaxing between snaps keeps the line taut,
    // while the technician's own points stay exactly where they were put.
    let line = ops.snapLoop(curve, bvh);
    for (let it = 0; it < 3; it++) {
      const next = line.map((p, i) => {
        if (i % 10 === 0) return p;
        const a = line[(i + line.length - 1) % line.length], b = line[(i + 1) % line.length];
        return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4, (a[2] + 2 * p[2] + b[2]) / 4];
      });
      line = ops.snapLoop(next, bvh).map((p, i) => (i % 10 === 0 ? line[i] : p));
    }
    return line;
  }

  marginState() {
    return { tooth: this.marginTooth, margin: this.margin, ctrl: this.marginCtrl };
  }

  applyMarginState(st) {
    this.marginTooth = st.tooth;
    this.margin = st.margin;
    this.marginCtrl = st.ctrl;
    this.marginSel = -1;
    this.refreshMargin();
    this.renderPanel();
  }

  /** Occlusal direction of the preparation jaw: the detected cusp plane, else the scan's up axis for that jaw. */
  occlusalGuess() {
    const jaw = this.prep?.jaw || jawOfFdi(this.caseData.primaryTooth || this.caseData.teeth?.[0]);
    const detected = jaw ? this.teethData?.[jaw]?.model?.occlusal : null;
    let dir = detected || this.viewer.toModel?.([0, jaw === "upper" ? -1 : 1, 0]) || [0, 0, jaw === "upper" ? -1 : 1];
    // The opposing jaw lies on the chewing side; it only decides the sign, never the tilt.
    if (this.antagonist && this.prep) {
      const toward = V.sub(centroid(this.antagonist.lazy.positions), centroid(this.prep.lazy.positions));
      if (V.dot(toward, dir) < 0 && !detected) dir = V.mul(dir, -1);
    }
    return V.norm(dir);
  }

  /** Until the technician sets the insertion direction, it follows the margin: the normal of its best-fit plane. */
  followMarginAxis(margin) {
    if (this.crown || this.axisUserSet || !margin || margin.length < 8) return;
    const c = V.mul(margin.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / margin.length);
    let n = ops.planeNormal(margin, c);
    const ref = this.occlusalGuess();
    if (V.dot(n, ref) < 0) n = V.mul(n, -1);
    // A badly tilted plane (a margin that dips on one side) should not swing the axis far from the jaw's occlusal direction.
    if (V.dot(n, ref) < Math.cos(Math.PI / 6)) return;
    this.insertionAxis = n;
    const m = V.norm(V.cross(Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], n));
    this.axisFrame = { occlusal: n, mesial: m, facial: V.cross(n, m) };
  }

  /** Sets the line as one history step. `ctrl` are the editable points; without it every point is one. */
  setMargin(next, label, ctrl = null) {
    this.followMarginAxis(next);
    const before = this.marginState();
    const margin = next.map((p) => p.slice());
    const after = { tooth: this.marginTooth, margin, ctrl: ctrl ? ctrl.map((p) => p.slice()) : margin };
    this.applyMarginState(after);
    this.push({ label, type: "margin", undo: () => this.applyMarginState(before), redo: () => this.applyMarginState(after) });
  }

  setControl(ctrl, label) {
    this.setMargin(this.curveThrough(ctrl), label, ctrl);
  }

  /** Switches the margin tools to another tooth; each tooth keeps its own line. */
  setMarginTooth(fdi) {
    if (fdi === this.marginTooth) return;
    if (this.marginTooth) {
      if (this.margin) this.margins.set(this.marginTooth, { margin: this.margin, ctrl: this.marginCtrl });
      else this.margins.delete(this.marginTooth);
    }
    const next = this.margins.get(fdi);
    this.marginDraft = null;
    this.marginDraftHistory = [];
    this.marginStroke = null;
    this.pendingAutoSeed = false;
    this.marginTraced = false;
    this.marginTooth = fdi;
    this.margin = next?.margin ?? null;
    this.marginSub = this.margin ? "move" : "draw";
    this.marginCtrl = next?.ctrl ?? null;
    this.marginSel = -1;
    const scan = this.marginScan();
    if (scan && !this.viewer.meshes.get(scan.vid)?.visible) {
      this.setVisible(scan, true);
      this.io.onVisibility?.(scan, true);
    }
    this.refreshMargin();
    this.syncDrawingNeighbors();
    this.renderPanel();
  }

  autoDetectMargin(top = null) {
    const bvh = this.marginBvh();
    const data = this.marginTooth ? this.teethData[jawOfFdi(this.marginTooth)] : null;
    const axis = data && (this.marginTooth !== this.caseData.teeth?.[0] || !this.axisUserSet) ? data.model.occlusal : (this.insertionAxis || this.occlusalGuess());
    if (!bvh || !axis) {
      this.io.toast("Auto-detect needs a preparation scan and an insertion axis.", "warn");
      return;
    }
    const tooth = data?.model.teeth.find((t) => t.fdi === this.marginTooth);
    const c = top || (this.margin ? V.add(centerOf(this.margin), V.mul(axis, 3)) : tooth?.center ? V.add(tooth.center, V.mul(axis, 0.5)) : null);
    if (!c) {
      this.pendingAutoSeed = true;
      this.io.toast("Click the top of the preparation to start detection.");
      return;
    }
    const raw = ops.detectMargin(bvh, c, axis);
    if (!raw) {
      this.io.toast("No clear finish line found from this point. Mark the margin by hand.", "warn");
      return;
    }
    const smooth = ops.smoothLoop(ops.resampleLoop(raw, 120), 3, 0.5, bvh);
    const ctrl = ops.resampleLoop(smooth, 24);
    this.setControl(ops.snapLoop(ctrl, bvh), "Auto-detect margin");
    this.marginSub = "move";
    this.pendingAutoSeed = false;
    this.renderPanel();
    this.io.toast("Margin proposed. Review every side and move the points that are off.");
  }

  startMarginDetection() {
    this.cancelMarginDraft(false);
    this.pendingAutoSeed = true;
    this.showMargin = true;
    this.setStatus("Click the top of the prepared tooth to find its margin");
    this.renderPanel();
  }

  focusMargin(fromAxis = false) {
    const points = this.marginDraft || this.margin;
    const data = this.teethData[jawOfFdi(this.marginTooth)];
    const tooth = data?.model.teeth.find(t => t.fdi === this.marginTooth);
    const center = points?.length ? centerOf(points) : this.marginSeed || tooth?.center;
    if (!center) return false;
    const radius = points?.length ? points.reduce((r, p) => Math.max(r, V.dist(p, center)), 0) : 4;
    const camera = { target: this.viewer.toWorld(center), dist: clamp(radius * 10, 25, 100) };
    if (fromAxis && this.insertionAxis) {
      const direction = this.viewer.toWorld(this.insertionAxis);
      camera.yaw = Math.atan2(direction[0], direction[2]);
      camera.pitch = Math.asin(clamp(direction[1], -1, 1));
    }
    this.viewer.go(camera);
    return true;
  }

  startMarginDrawing() {
    this.cancelMarginDraft(false);
    this.marginSub = "draw";
    this.pendingAutoSeed = false;
    this.showMargin = true;
    this.setStatus("Trace the finish line, or click to place points. Alt-drag rotates.");
    this.renderPanel();
  }

  cancelMarginDraft(render = true) {
    this.marginDraft = null;
    this.marginDraftHistory = [];
    this.marginStroke = null;
    this.marginTraced = false;
    this.pendingAutoSeed = false;
    this.marginSub = this.margin ? "move" : "draw";
    this.refreshMargin();
    this.syncDrawingNeighbors();
    if (render) this.renderPanel();
  }

  undoMarginDraft() {
    if (!this.marginDraft?.length) return;
    const count = this.marginDraftHistory.pop() ?? Math.max(0, this.marginDraft.length - 1);
    this.marginDraft = count ? this.marginDraft.slice(0, count) : null;
    if (!this.marginDraft) this.marginTraced = false;
    this.marginStroke = null;
    this.refreshMargin();
    this.syncDrawingNeighbors();
    this.renderPanel();
  }

  smoothMargin(passes = 3) {
    const pts = this.marginCtrl || this.margin;
    if (!pts) return;
    const smooth = ops.smoothLoop(pts, passes, 0.5, this.marginBvh());
    this.setControl(smooth, "Smooth margin");
  }

  /** Changes how many editable points the line has. The line is re-fitted through the new ones. */
  resampleMargin(n) {
    if (!this.margin) return;
    const bvh = this.marginBvh();
    const ctrl = ops.resampleLoop(this.margin, n);
    this.setControl(bvh ? ops.snapLoop(ctrl, bvh) : ctrl, `${n} margin points`);
  }

  snapMargin() {
    const bvh = this.marginBvh();
    if (!this.marginCtrl || !bvh) return;
    this.setControl(ops.snapLoop(this.marginCtrl, bvh), "Snap margin to scan");
  }

  /** Reopens nothing and leaves no line: starts this tooth's margin again. */
  clearMargin() {
    if (!this.margin) return;
    const before = this.marginState();
    const after = { tooth: this.marginTooth, margin: null, ctrl: null };
    this.applyMarginState(after);
    this.push({ label: "Clear margin", type: "margin", undo: () => this.applyMarginState(before), redo: () => this.applyMarginState(after) });
  }

  applyMarginToCrown() {
    const crown = this.crown;
    if (!crown?.seg || !this.margin) return;
    if (this.marginTooth && this.caseData.teeth?.[0] && this.marginTooth !== this.caseData.teeth[0]) {
      this.io.toast(`The crown belongs to tooth ${this.caseData.teeth[0]}, not ${this.marginTooth}.`, "warn");
      return;
    }
    const { result } = this.operate(crown, "Fit crown boundary to margin", () => ops.fitRimToMargin(crown.mesh, crown.seg, this.margin));
    this.io.toast(`Crown boundary moved up to ${fmt(result.maxMove, 3)} mm to follow the margin.`);
  }

  marginFacts() {
    if (!this.margin) return null;
    const bvh = this.marginBvh();
    const fit = bvh ? ops.marginFit(this.margin, bvh) : null;
    const crown = this.crown;
    let rim = null;
    if (crown?.seg && (!this.marginTooth || this.marginTooth === this.caseData.teeth?.[0])) {
      const ds = Array.from(crown.seg.rimLoop, (v) => {
        const p = vertexAt(crown.mesh.pos, v);
        return V.dist(p, ops.closestOnLoop(p, this.margin));
      }).sort((a, b) => a - b);
      rim = { median: ds[ds.length >> 1], max: ds[ds.length - 1] };
    }
    return { points: (this.marginCtrl || this.margin).length, length: ops.loopLength(this.margin), fit, rim };
  }

  /* --------------------------------------------------------- tooth numbers */

  /** Finds and numbers the teeth on every jaw scan. Anything corrected by hand is kept. */
  identifyTeeth({ keepSaved = true } = {}) {
    const crown = this.crown;
    const caseTooth = this.caseData.primaryTooth || this.caseData.teeth?.[0];
    for (const scan of this.scanObjects) {
      if (scan.jaw !== "upper" && scan.jaw !== "lower") continue;
      const toOcclusal = this.viewer.toModel([0, scan.jaw === "upper" ? -1 : 1, 0]);
      let occlusal = toOcclusal;
      if (crown?.frame) occlusal = scan === this.prep ? crown.frame.occlusal : V.mul(crown.frame.occlusal, -1);
      // A restoration tells us one number outright, which is decisive on a partial scan.
      const anchor = crown?.frame && scan === this.prep && caseTooth && jawOfFdi(caseTooth) === scan.jaw ? { fdi: caseTooth, point: crown.frame.center } : null;
      const model = detectTeeth(scan.mesh?.pos ?? scan.lazy.positions, scan.mesh?.idx ?? scan.lazy.indices, scan.jaw, { occlusal, anchor });
      const data = { model, scan, label: null };
      const saved = keepSaved ? this.savedTeeth?.[scan.jaw] : null;
      const n = model.curve?.points.length;
      // Same scan, same arch: a different sample count (other settings, rounding) only rescales the spans.
      if (n && saved?.points && saved?.teeth?.length && Math.abs(saved.points - n) <= Math.max(3, n * 0.1)) {
        const k = (n - 1) / Math.max(1, saved.points - 1);
        model.teeth = saved.teeth.map((t) => toothGeometry(model, { ...t, from: Math.max(0, Math.min(n - 1, Math.round(t.from * k))), to: Math.max(0, Math.min(n - 1, Math.round(t.to * k))) }));
        model.status = "reviewed";
        model.jobTooth = caseTooth;
        // Only a tooth the technician confirmed or numbered counts as confirmed, not any saved edit.
        model.jobToothConfirmed = saved.jobToothConfirmed ?? model.teeth.some((t) => t.fdi === caseTooth && t.manual);
      } else if (caseTooth && jawOfFdi(caseTooth) === scan.jaw) {
        anchorJobTooth(model, caseTooth);
      }
      if (model.teeth?.length) data.label = labelTeeth(this.ensureMesh(scan), model);
      this.teethData[scan.jaw] = data;
    }
    if (!this.teethJaw) this.teethJaw = (caseTooth ? jawOfFdi(caseTooth) : null) || (this.teethData.upper ? "upper" : "lower");
    return this.allTeeth();
  }

  allTeeth() {
    const out = [];
    for (const [jaw, d] of Object.entries(this.teethData)) {
      d.model.teeth.forEach((t, i) => {
        const tip = V.add(t.center, V.mul(d.model.occlusal, 1));
        out.push({
          label: t.fdi ? String(t.fdi) : "?", fdi: t.fdi, jaw, index: i, confidence: t.confidence, width: t.width,
          labelWorld: this.viewer.toWorld(tip), selected: this.selectedTooth?.jaw === jaw && this.selectedTooth.i === i,
          meshId: d.scan.vid,
        });
      });
    }
    return out;
  }

  get teethVisible() {
    return this.tool === "teeth";
  }

  /** Colours the teeth and outlines them. Only the Teeth tool shows numbers; Margin tints its tooth. */
  paintTeeth() {
    const show = this.teethVisible;
    const selected = this.tool === "margin" && this.marginTooth;
    for (const [jaw, d] of Object.entries(this.teethData)) {
      const { scan, label, model } = d;
      if (!label || !(show || selected)) {
        this.viewer.clearVertexColors(scan.vid);
        this.viewer.setLineLayer(`teeth-${jaw}`, null);
        continue;
      }
      const n = scan.mesh.count;
      const base = this.viewer.meshes.get(scan.vid).color;
      const col = new Float32Array(n * 3);
      const palette = [hexLin("#8fc7ef"), hexLin("#6fb0e4")];
      const unsure = hexLin("#efc36a"), picked = hexLin("#b7f34a"), none = hexLin("#d98a8a");
      for (let v = 0; v < n; v++) {
        const ti = label[v];
        let c = base;
        if (ti >= 0) {
          const t = model.teeth[ti];
          // Margin work needs to see the relief, so its tooth gets a tint rather than a fill.
          if (selected) c = t.fdi === this.marginTooth ? [base[0] * 0.7 + picked[0] * 0.3, base[1] * 0.7 + picked[1] * 0.3, base[2] * 0.7 + picked[2] * 0.3] : base;
          else if (this.selectedTooth?.jaw === jaw && this.selectedTooth.i === ti) c = picked;
          else if (!t.fdi) c = none;
          else if ((t.fdi === model.jobTooth && !model.jobToothConfirmed) || t.confidence < 0.6) c = unsure;
          else c = palette[ti % 2];
        }
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
      }
      this.viewer.setVertexColors(scan.vid, col);
      const selectedIndex = this.selectedTooth?.jaw === jaw ? this.selectedTooth.i : null;
      const outline = show && this.viewer.meshes.get(scan.vid)?.visible;
      const lines = outline ? toothBoundaryLines(scan.mesh, label, p => this.viewer.toWorld(p), selectedIndex) : null;
      this.viewer.setLineLayer(`teeth-${jaw}`, lines, selectedIndex === null ? [0.1, 0.28, 0.5, 0.9] : [1, 0.76, 0.1, 1]);
    }
    this.io.onTeeth?.(show ? this.allTeeth() : []);
    this.viewer.render();
  }

  clearTeeth() {
    for (const [jaw, d] of Object.entries(this.teethData)) {
      this.viewer.clearVertexColors(d.scan.vid);
      this.viewer.setLineLayer(`teeth-${jaw}`, null);
    }
    this.teethData = {};
    this.selectedTooth = null;
    this.io.onTeeth?.([]);
  }

  selectedToothData() {
    const s = this.selectedTooth;
    const d = s && this.teethData[s.jaw];
    return d ? { ...d, tooth: d.model.teeth[s.i], i: s.i, jaw: s.jaw } : null;
  }

  selectTooth(jaw, i, { focus = false } = {}) {
    this.selectedTooth = i >= 0 ? { jaw, i } : null;
    this.teethJaw = jaw;
    if (focus && i >= 0) this.focusTooth(jaw, i);
    this.paintTeeth();
    this.renderPanel();
  }

  focusTooth(jaw, i) {
    const d = this.teethData[jaw];
    const t = d?.model.teeth[i];
    if (!t) return;
    const { viewer } = this;
    const out = V.norm(V.sub(t.center, centerOfVisible(d.scan, d.scan.mesh)));
    const dir = V.norm(V.add(V.mul(d.model.occlusal, 1), V.mul(V.sub(out, V.mul(d.model.occlusal, V.dot(out, d.model.occlusal))), 0.9)));
    const w = viewer.toWorld(dir);
    viewer.go({ target: viewer.toWorld(t.center), yaw: Math.atan2(w[0], w[2]), pitch: Math.asin(clamp(w[1], -1, 1)), dist: 40 });
  }

  /** Shows one jaw from its biting side, the antagonist out of the way. */
  showJaw(jaw) {
    this.teethJaw = jaw;
    for (const o of this.scanObjects) {
      const on = o.jaw === jaw;
      this.setVisible(o, on);
      this.io.onVisibility?.(o, on);
    }
    const d = this.teethData[jaw];
    if (d) {
      const w = this.viewer.toWorld(d.model.occlusal);
      const b = this.viewer.bounds;
      if (b) {
        const radius = Math.hypot(b[3] - b[0], b[5] - b[2]) / 2 || 30;
        this.viewer.go({ target: this.viewer.toWorld(d.model.teeth[0]?.center ? centerOf(d.model.teeth.map((t) => t.center)) : [0, 0, 0]), yaw: Math.atan2(w[0], w[2]), pitch: Math.asin(clamp(w[1], -1, 1)), dist: radius / Math.sin((14 * Math.PI) / 180) });
      }
    }
    this.paintTeeth();
    this.renderPanel();
  }

  /** Runs a numbering or boundary edit as one history step, then relabels the mesh. */
  editTeeth(jaw, label, fn) {
    const d = this.teethData[jaw];
    if (!d) return;
    const copy = () => d.model.teeth.map((t) => ({ ...t }));
    const before = copy();
    const beforeStatus = d.model.status;
    fn(d.model);
    d.model.teeth.sort((p, q) => p.from - q.from);
    d.model.teeth.forEach((t) => toothGeometry(d.model, t));
    d.model.status = "reviewed";
    const after = copy();
    const confirmed = (list) => !!d.model.jobTooth && list.some((t) => t.fdi === d.model.jobTooth && t.manual);
    const apply = (list, status) => {
      d.model.teeth = list.map((t) => ({ ...t }));
      d.model.status = status;
      d.model.jobToothConfirmed = confirmed(list);
      d.label = labelTeeth(d.scan.mesh, d.model);
      if (this.selectedTooth?.jaw === jaw && this.selectedTooth.i >= d.model.teeth.length) this.selectedTooth = null;
      this.paintTeeth();
      this.renderPanel();
    };
    apply(after, "reviewed");
    this.push({ label, type: "teeth", undo: () => apply(before, beforeStatus), redo: () => apply(after, "reviewed") });
  }

  /** The technician accepts the proposed appointment tooth as it is. */
  confirmJobTooth(jaw) {
    const d = this.teethData[jaw];
    const fdi = d?.model.jobTooth;
    if (!fdi || !d.model.teeth.some((t) => t.fdi === fdi)) return;
    this.editTeeth(jaw, `Confirm tooth ${fdi}`, (m) => { m.teeth.find((t) => t.fdi === fdi).manual = true; });
    this.io.toast(`Tooth ${fdi} confirmed. Reopening this case keeps it.`);
  }

  /** Numbers one tooth. Along the arch, the rest follow in sequence from it. */
  numberTooth(jaw, i, fdi, alongArch) {
    this.editTeeth(jaw, alongArch ? `Renumber arch from ${fdi}` : `Tooth is ${fdi}`, (m) => {
      if (alongArch) {
        renumberFromTooth(m, i, fdi);
      } else {
        m.teeth.forEach((t, k) => { if (k !== i && t.fdi === fdi) t.fdi = null; });
        m.teeth[i].fdi = fdi;
      }
      m.teeth[i].manual = true;
      m.teeth[i].confidence = 1;
    });
  }

  removeTooth(jaw, i) {
    const name = this.teethData[jaw]?.model.teeth[i]?.fdi ?? "region";
    this.selectedTooth = null;
    this.editTeeth(jaw, `Not a tooth: ${name}`, (m) => m.teeth.splice(i, 1));
  }

  mergeTeeth(jaw, i) {
    this.editTeeth(jaw, "Merge teeth", (m) => {
      const a = m.teeth[i], b = m.teeth[i + 1];
      if (!b) return;
      a.to = b.to;
      a.confidence = 1;
      a.manual = true;
      m.teeth.splice(i + 1, 1);
    });
  }

  /** Moves the cut across the arch at one side of a tooth, taking the touching neighbour's with it. */
  moveBoundary(jaw, i, side, mm) {
    const samples = Math.round(mm * 4);
    this.editTeeth(jaw, "Move tooth boundary", (m) => {
      const t = m.teeth[i];
      const key = side < 0 ? "from" : "to";
      const old = t[key];
      const next = clamp(old + samples, 0, m.curve.points.length - 1);
      if (side < 0 ? next >= t.to - 4 : next <= t.from + 4) return;
      const other = m.teeth[i + side];
      if (other && (side < 0 ? other.to === old : other.from === old)) {
        if (side < 0 ? next <= other.from + 4 : next >= other.to - 4) return;
        other[side < 0 ? "to" : "from"] = next;
      }
      t[key] = next;
      t.manual = true;
    });
  }

  /** Handles the click that follows Split or Add tooth. */
  toothPointAction(hit) {
    const { kind, jaw } = this.pendingTooth;
    this.pendingTooth = null;
    const d = this.teethData[jaw];
    const { index, distance } = archIndexAt(d.model, hit.point);
    if (distance > 10) {
      this.io.toast("That point is too far from the dental arch.", "warn");
      this.renderPanel();
      return;
    }
    if (kind === "split") {
      const i = d.model.teeth.findIndex((t) => index > t.from + 4 && index < t.to - 4);
      if (i < 0) {
        this.io.toast("Click inside a tooth region to split it.", "warn");
        this.renderPanel();
        return;
      }
      this.editTeeth(jaw, "Split tooth", (m) => {
        const t = m.teeth[i];
        m.teeth.splice(i + 1, 0, { ...t, from: index, fdi: null, confidence: 1, manual: true });
        t.to = index;
        t.manual = true;
      });
    } else {
      // A new region fills the free stretch around the click, up to a tooth's width.
      this.editTeeth(jaw, "Add tooth", (m) => {
        let from = Math.max(0, index - 16), to = Math.min(m.curve.points.length - 1, index + 16);
        for (const t of m.teeth) {
          if (t.to <= index) from = Math.max(from, t.to);
          if (t.from >= index) to = Math.min(to, t.from);
        }
        if (to - from > 8) m.teeth.push({ fdi: null, from, to, confidence: 1, manual: true });
      });
      const j = d.model.teeth.findIndex((t) => index >= t.from && index <= t.to);
      if (j >= 0) this.selectTooth(jaw, j);
    }
  }

  /* ------------------------------------------------------ insertion axis */

  axisFromTilt() {
    const f = this.crown?.frame || this.axisFrame;
    if (!f) return null;
    const [a, b] = this.opts.axisTilt.map((x) => Math.tan((x * Math.PI) / 180));
    return V.norm(V.add(f.occlusal, V.add(V.mul(f.mesial, a), V.mul(f.facial, b))));
  }

  setAxisTilt(i, deg) {
    this.axisUserSet = true;
    this.opts.axisTilt[i] = deg;
    this.insertionAxis = this.axisFromTilt();
    this.showAxis();
    this.undercutActive && this.showUndercuts();
    this.markDirty();
  }

  showAxis() {
    const a = this.insertionAxis;
    const crown = this.crown;
    const p = crown?.frame?.center || (this.margin && centerOf(this.margin));
    if (!a || !p || !["crown", "axis"].includes(this.tool)) {
      this.viewer.setLineLayer("axis", null);
      return;
    }
    const w0 = this.viewer.toWorld(V.sub(p, V.mul(a, 2)));
    const w1 = this.viewer.toWorld(V.add(p, V.mul(a, 16)));
    this.viewer.setLineLayer("axis", new Float32Array([...w0, ...w1]), [0.72, 0.95, 0.29, 1], { onTop: true });
  }

  showUndercuts() {
    const scan = this.prep;
    if (!scan?.prepVerts?.length || !this.insertionAxis) {
      this.io.toast("Undercuts need a segmented preparation.", "warn");
      return;
    }
    const u = ops.undercutMap(scan.mesh, scan.prepVerts, this.insertionAxis, scan.region);
    this.undercut = u;
    this.undercutActive = true;
    const n = scan.mesh.count;
    const col = new Float32Array(n * 3);
    const baseE = this.viewer.meshes.get(scan.vid).color;
    for (let v = 0; v < n; v++) col.set(baseE, v * 3);
    const clear = hexLin("#6fcf5f"), mid = hexLin("#f4d33f"), hot = hexLin("#e5343f");
    for (const v of scan.prepVerts) {
      const d = u.values.get(v);
      const c = d > 0.5 ? hot : d > 0.02 ? mid : clear;
      col.set(c, v * 3);
    }
    this.viewer.setVertexColors(scan.vid, col);
    this.refreshReadouts();
  }

  hideUndercuts() {
    if (this.prep) this.viewer.clearVertexColors(this.prep.vid);
    this.undercutActive = false;
    this.undercut = null;
  }

  bestAxis() {
    const scan = this.prep;
    if (!scan?.prepVerts?.length) return;
    const f = this.crown?.frame;
    this.insertionAxis = ops.bestInsertionAxis(scan.mesh, scan.prepVerts, this.insertionAxis, scan.region);
    this.axisUserSet = true;
    if (f) {
      const o = V.dot(this.insertionAxis, f.occlusal) || 1;
      this.opts.axisTilt = [(Math.atan(V.dot(this.insertionAxis, f.mesial) / o) * 180) / Math.PI, (Math.atan(V.dot(this.insertionAxis, f.facial) / o) * 180) / Math.PI];
    }
    this.showAxis();
    this.showUndercuts();
    this.renderPanel();
  }

  axisFromView() {
    const r = this.viewer.basis;
    if (!r) return;
    this.axisUserSet = true;
    const dir = this.viewer.toModel(r.z);
    const f = this.crown?.frame;
    this.insertionAxis = f && V.dot(dir, f.occlusal) < 0 ? V.mul(dir, -1) : dir;
    if (!f) {
      const a = V.norm(this.insertionAxis);
      const m = V.norm(V.cross(Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], a));
      this.axisFrame = { occlusal: a, mesial: m, facial: V.cross(a, m) };
      this.opts.axisTilt = [0, 0];
    }
    if (f) {
      const o = V.dot(this.insertionAxis, f.occlusal) || 1;
      this.opts.axisTilt = [(Math.atan(V.dot(this.insertionAxis, f.mesial) / o) * 180) / Math.PI, (Math.atan(V.dot(this.insertionAxis, f.facial) / o) * 180) / Math.PI];
    }
    this.showAxis();
    this.undercutActive && this.showUndercuts();
    this.renderPanel();
    this.markDirty();
  }

  /* -------------------------------------------------------------- bridge */

  newId(prefix) {
    this.seq = (this.seq || 0) + 1;
    return `cad:${prefix}-${this.seq}`;
  }

  addObject(obj, geometry, style) {
    obj.vid = obj.id;
    obj.alpha = 1;
    obj.visible = true;
    obj.original = geometry.positions.slice();
    obj.originalIdx = geometry.indices.slice();
    this.objects.set(obj.id, obj);
    this.uploadNew(obj, geometry, style);
  }

  uploadNew(obj, geometry, style) {
    obj.mesh = ops.makeMesh(geometry.positions, geometry.indices);
    obj.scratch = ops.newScratch(obj.mesh.count);
    this.viewer.addMesh(obj.vid, { positions: obj.mesh.pos, normals: obj.mesh.norm, indices: obj.mesh.idx, edges: uniqueEdges(obj.mesh.idx, obj.mesh.count) }, style);
    if (!obj.weights) obj.weights = { weight: new Float32Array(obj.mesh.count).fill(1), rimDist: new Float32Array(obj.mesh.count).fill(99) };
    this.viewer.setVisible(obj.vid, obj.visible);
  }

  /** History wrapper for adding or removing a whole object. */
  pushObject(obj, label, added, style) {
    const add = () => {
      this.objects.set(obj.id, obj);
      this.viewer.addMesh(obj.vid, { positions: obj.mesh.pos, normals: obj.mesh.norm, indices: obj.mesh.idx, edges: uniqueEdges(obj.mesh.idx, obj.mesh.count) }, style);
      this.viewer.setVisible(obj.vid, obj.visible);
      this.selectedId = obj.id;
    };
    const remove = () => {
      this.objects.delete(obj.id);
      this.viewer.removeMesh(obj.vid);
      if (this.selectedId === obj.id) this.selectedId = this.crown?.id ?? null;
    };
    this.push({ label, type: "object", undo: added ? remove : add, redo: added ? add : remove });
  }

  placePontic(at) {
    const crown = this.crown;
    const o = this.opts.pontic;
    const params = { at, ...o };
    const name = `Pontic ${this.units.filter((u) => u.kind === "pontic").length + 1}`;
    const geometry = this.ponticGeometry(params);
    const obj = { id: this.newId("pontic"), kind: "pontic", name, params, frame: crown ? shiftFrame(crown.frame, at) : defaultFrameAt(at) };
    const style = { color: "#F5F4EF", spec: 0.6, gloss: 60, sss: 0.35 };
    obj.style = style;
    this.addObject(obj, geometry, style);
    this.pushObject(obj, `Add ${name}`, true, style);
    this.selectedId = obj.id;
    this.renderPanel();
    return obj;
  }

  ponticGeometry(p) {
    const crown = this.crown;
    if (crown?.seg) {
      return ops.makePontic(crown.mesh, crown.seg, crown.frame, { at: p.at, scale: [p.md / 100, p.fl / 100, p.h / 100], baseDome: p.dome });
    }
    const f = crown?.frame || defaultFrameAt(p.at);
    return ops.makeEllipsoid(p.at, [f.mesial, f.facial, f.occlusal], [3.4 * (p.md / 100), 3.2 * (p.fl / 100), 4.2 * (p.h / 100)]);
  }

  /** Rebuilds a pontic or connector from its parameters as one undoable step. */
  regenerate(obj, geometry, label) {
    if (geometry.positions.length !== obj.mesh.pos.length) return;
    this.operate(obj, label, () => obj.mesh.pos.set(geometry.positions));
  }

  connectUnits(aId, bId) {
    const a = this.objects.get(aId), b = this.objects.get(bId);
    if (!a || !b || a === b) {
      this.io.toast("Choose two different units to connect.", "warn");
      return null;
    }
    const f = a.frame || this.crown?.frame || defaultFrame(a.mesh.pos);
    const pair = ops.closestPair(a.mesh, b.mesh);
    if (!pair) return null;
    const c = this.opts.connector;
    const params = { a: pair.a, b: pair.b, occlusal: f.occlusal, ...c };
    const geometry = this.connectorGeometry(params);
    const name = `Connector ${a.name} – ${b.name}`;
    const obj = { id: this.newId("connector"), kind: "connector", name, params, frame: shiftFrame(f, V.mul(V.add(pair.a, pair.b), 0.5)) };
    const style = { color: "#e6dfcf", spec: 0.4, gloss: 40, sss: 0.3 };
    obj.style = style;
    this.addObject(obj, geometry, style);
    this.pushObject(obj, `Add ${name}`, true, style);
    this.selectedId = obj.id;
    this.renderPanel();
    return obj;
  }

  connectorGeometry(p) {
    const shift = V.mul(p.occlusal, p.offset || 0);
    const g = ops.makeConnector(V.add(p.a, shift), V.add(p.b, shift), p.occlusal, { width: p.width, height: p.height, waist: p.waist });
    return g;
  }

  removeObject(obj) {
    if (!obj || obj.kind === "scan" || obj === this.crown) return;
    const style = obj.style;
    this.objects.delete(obj.id);
    this.viewer.removeMesh(obj.vid);
    if (this.selectedId === obj.id) this.selectedId = this.crown?.id ?? null;
    this.pushObject(obj, `Remove ${obj.name}`, false, style);
    this.renderPanel();
  }

  refineSelected() {
    const obj = this.selected?.mesh && this.selected.kind !== "scan" ? this.selected : this.brushTarget();
    if (!obj) return;
    if (obj.mesh.count > 150000) {
      this.io.toast("This mesh is already very dense.", "warn");
      return;
    }
    const capture = () => ({ mesh: obj.mesh, scratch: obj.scratch, seg: obj.seg, weights: obj.weights, intaglioBvh: obj.intaglioBvh });
    const prev = capture();
    // The next state is complete before anything is swapped, so a panel or map never sees half of it.
    const geometry = ops.subdivide(prev.mesh.pos, prev.mesh.idx);
    const next = { mesh: ops.makeMesh(geometry.positions, geometry.indices), seg: null, intaglioBvh: null };
    next.scratch = ops.newScratch(next.mesh.count);
    if (prev.seg) {
      const seg = ops.segmentCrown(next.mesh);
      if (seg.rimLoop.length >= 16) {
        next.seg = seg;
        next.intaglioBvh = new BVH(next.mesh.pos, next.mesh.idx, seg.inTris);
      }
    }
    next.weights = next.seg ? ops.outerWeights(next.mesh, next.seg) : { weight: new Float32Array(next.mesh.count).fill(1), rimDist: new Float32Array(next.mesh.count).fill(99) };
    const swap = (state) => {
      Object.assign(obj, state);
      this.uploadCurrent(obj);
      this.refreshMap();
      this.renderPanel();
    };
    swap(next);
    this.push({ label: `Refine ${obj.name}`, type: "topology", undo: () => swap(prev), redo: () => swap(next) });
  }

  /** Re-creates the viewer buffers after an object's triangle list has changed. */
  uploadCurrent(obj) {
    const { mesh } = obj;
    const style = obj.style || RESTORATION_STYLE;
    this.viewer.addMesh(obj.vid, { positions: mesh.pos, normals: mesh.norm, indices: mesh.idx, edges: uniqueEdges(mesh.idx, mesh.count) }, { ...style, alpha: obj.alpha ?? 1 });
    this.viewer.setVisible(obj.vid, obj.visible !== false);
  }

  /* --------------------------------------------------------- measurements */

  /** A point stored by triangle and barycentric weights follows the surface through edits. */
  measurePoint(ref) {
    const o = this.objects.get(ref.objId);
    if (!o?.mesh) return null;
    const { pos, idx } = o.mesh;
    if (ref.tri * 3 >= idx.length) return null;
    const a = vertexAt(pos, idx[ref.tri * 3]), b = vertexAt(pos, idx[ref.tri * 3 + 1]), c = vertexAt(pos, idx[ref.tri * 3 + 2]);
    const w = 1 - ref.u - ref.v;
    return [0, 1, 2].map((k) => a[k] * w + b[k] * ref.u + c[k] * ref.v);
  }

  measureValue(m) {
    const pts = m.pts.map((r) => this.measurePoint(r));
    if (pts.some((p) => !p)) return null;
    if (m.type === "distance") return { value: V.dist(pts[0], pts[1]), unit: "mm", pts };
    if (m.type === "angle") {
      const u = V.norm(V.sub(pts[0], pts[1])), v = V.norm(V.sub(pts[2], pts[1]));
      return { value: (Math.acos(clamp(V.dot(u, v), -1, 1)) * 180) / Math.PI, unit: "°", pts };
    }
    const o = this.objects.get(m.pts[0].objId);
    const n = triNormalAt(o.mesh, m.pts[0].tri);
    const start = V.sub(pts[0], V.mul(n, 1e-3));
    const hit = o.mesh.bvh.raycast(start, V.mul(n, -1));
    return hit ? { value: hit.t, unit: "mm", pts: [pts[0], hit.point] } : { value: null, unit: "mm", pts };
  }

  clearMeasures() {
    this.measures = [];
    this.measureDraft = [];
    this.renderPanel();
    this.viewer.render();
  }

  /* ------------------------------------------------------------- section */

  sectionAxis() {
    const f = this.crown?.frame;
    if (this.section.axis === "view") return this.viewer.toModel(this.viewer.basis.z);
    if (!f) return [1, 0, 0];
    return this.section.axis === "mesial" ? f.mesial : this.section.axis === "facial" ? f.facial : f.occlusal;
  }

  updateSection() {
    const v = this.viewer;
    const s = this.section;
    if (!s.on) {
      v.setClip(null);
      ["section-crown", "section-prep", "section-ant"].forEach((id) => v.setLineLayer(id, null));
      s.stats = null;
      return;
    }
    const n = V.norm(this.sectionAxis());
    const crown = this.crown;
    const ref = crown?.frame?.center ?? centerOfBounds(v);
    const d = V.dot(ref, n) + s.offset;
    v.setClip(v.toWorld(n), d);
    const f = crown?.frame;
    const axisA = f ? (s.axis === "mesial" ? f.facial : f.mesial) : [1, 0, 0];
    const axisB = f ? (s.axis === "occlusal" ? f.facial : f.occlusal) : [0, 0, 1];
    const toWorldArray = (segs) => {
      const out = new Float32Array(segs.length);
      for (let i = 0; i < segs.length; i += 3) {
        const w = v.toWorld([segs[i], segs[i + 1], segs[i + 2]]);
        out[i] = w[0]; out[i + 1] = w[1]; out[i + 2] = w[2];
      }
      return out;
    };
    if (crown) {
      const r = ops.sliceMesh(crown.mesh.pos, crown.mesh.idx, n, d, axisA, axisB);
      s.stats = r.segments.length ? { width: r.width, height: r.height, length: r.length } : null;
      v.setLineLayer("section-crown", toWorldArray(r.segments), [0.72, 0.95, 0.29, 1], { onTop: true });
    }
    const scanLine = (obj, id, color) => {
      if (!obj?.lazy || obj.visible === false) { v.setLineLayer(id, null); return; }
      const r = ops.sliceMesh(obj.lazy.positions, obj.lazy.indices, n, d);
      v.setLineLayer(id, toWorldArray(r.segments), color);
    };
    scanLine(this.prep, "section-prep", [0.95, 0.75, 0.55, 1]);
    scanLine(this.antagonist, "section-ant", [0.42, 0.72, 0.86, 1]);
  }

  /* ---------------------------------------------------------- tool switch */

  setTool(tool) {
    if (this.busy) return;
    this.cancelLive();
    this.tool = tool;
    this.session?.onToolChange(tool);
    this.measureDraft = [];
    this.marginDraft = null;
    this.marginDraftHistory = [];
    this.marginStroke = null;
    this.pendingAutoSeed = false;
    this.marginTraced = false;
    this.gizmo = null;
    this.hover = null;
    this.viewer.canvas.dataset.cadTool = tool;
    this.showAxis();
    if (tool !== "crown") this.undercutActive && this.hideUndercuts();
    // Hide the restoration while working on the die itself, so the margin can be seen.
    const crown = this.crown;
    const onScan = tool === "margin" || tool === "teeth";
    if (tool === "margin") {
      if (!this.marginTooth) this.marginTooth = this.caseData.teeth?.[0] ?? null;
      this.marginSub = this.margin ? "move" : "draw";
      this.showMargin = true;
    }
    if (crown && this.lastHiddenForMargin && !onScan) {
      this.setVisible(crown, true);
      this.io.onVisibility?.(crown, true);
      this.lastHiddenForMargin = false;
    }
    if (crown && onScan && crown.visible !== false) {
      this.setVisible(crown, false);
      this.io.onVisibility?.(crown, false);
      this.lastHiddenForMargin = true;
    }
    this.pendingTooth = null;
    // Marking one preparation must not wait for whole-arch tooth identification.
    if (tool === "teeth" && !Object.keys(this.teethData).length && this.scanObjects.length) this.identifyTeeth();
    this.paintTeeth();
    // Correcting a high contact means taking material away, so that is the brush you start with.
    if ((tool === "occlusion" || tool === "contacts") && this.opts.brush === "add") this.opts.brush = "remove";
    if (tool === "occlusion" && !this.mapKind) this.mapKind = "occlusion";
    else if (tool === "contacts" && !this.mapKind) this.mapKind = "contact";
    else if (tool !== "occlusion" && tool !== "contacts" && (this.mapKind === "occlusion" || this.mapKind === "contact") && this.autoMap) this.mapKind = null;
    this.autoMap = tool === "occlusion" || tool === "contacts";
    this.refreshMap();
    this.refreshMargin();
    this.syncDrawingNeighbors();
    this.renderRibbon();
    this.renderPanel();
    this.viewer.render();
  }

  renderPanel() {
    if (this.disposed || !this.panelEl) return;
    renderPanel(this);
    this.session?.refresh();
  }

  /** Cheap re-render of the numeric values only, while a slider is moving. */
  refreshReadouts() {
    if (this.disposed || this.readoutTimer) return;
    this.readoutTimer = setTimeout(() => {
      this.readoutTimer = null;
      if (!this.disposed) readouts(this);
    }, 120);
  }

  renderRibbon() {
    if (!this.ribbon) return;
    this.ribbon.querySelectorAll("[data-cad-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cadTool === this.tool)));
    const undo = this.ribbon.querySelector("[data-cad='undo']");
    const redo = this.ribbon.querySelector("[data-cad='redo']");
    if (undo) undo.disabled = !this.cursor;
    if (redo) redo.disabled = this.cursor >= this.stack.length;
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  /** Build an editable hollow starter from this tooth's actual scan and reviewed margin. */
  async previewToothCraft() {
    if (this.toothCraftRequest || this.busy) return;
    const request = new AbortController();
    this.toothCraftRequest = request;
    this.renderPanel();
    try {
      const scan = this.marginScan();
      if (!scan) throw new Error("Load the preparation scan first.");
      const input = scan.lazy || { positions: scan.mesh.pos, indices: scan.mesh.idx };
      const context = scanContext(input, this.margin, this.insertionAxis);
      const geometry = await requestToothCraft(context, request.signal);
      if (this.disposed || request.signal.aborted) return;
      geometry.normals = computeNormals(geometry.positions, geometry.indices);
      geometry.edges = uniqueEdges(geometry.indices, geometry.positions.length / 3);
      this.viewer.addMesh("toothcraft-preview", geometry, { color: "#80caba", alpha: .65 });
      this.viewer.render();
      this.io.toast("ToothCraft completed the local context. Inspect the green surface.");
    } catch (error) {
      if (!this.disposed && !request.signal.aborted) this.io.toast(error.message, "error");
    } finally {
      this.toothCraftRequest = null;
      if (!this.disposed) this.renderPanel();
    }
  }

  async replaceWithLibrary() {
    const old = this.crown;
    if (old) {
      this.objects.delete(old.id);
      this.viewer.removeMesh(old.vid);
      if (this.selectedId === old.id) this.selectedId = null;
      this.pushObject(old, `Remove ${old.name}`, false, old.style || RESTORATION_STYLE);
    }
    await this.createRestoration();
  }

  async createRestoration() {
    if (this.droppedTooth && !this.droppedTooth.open) return this.placeDroppedTooth();
    if (this.busy) return;
    if (this.crown) { this.io.toast("A crown is already loaded. Edit it or undo its creation first.", "warn"); return; }
    const scan = this.marginScan();
    if (!scan || !this.margin || !this.insertionAxis) { this.io.toast("Load a scan, draw a margin and set the insertion direction first.", "warn"); return; }
    this.busy = true;
    this.session?.refresh();
    this.setStatus("Building crown in background…");
    try {
      const raw = scan.lazy || { positions: scan.mesh.pos, indices: scan.mesh.idx };
      const tooth = this.marginTooth || this.caseData.primaryTooth || this.caseData.teeth?.[0];
      const common = {
        ...raw, margin: this.margin, axis: this.insertionAxis, tooth,
        ...this.construction, gap: this.opts.cement.gap, marginGap: this.opts.cement.marginGap,
      };
      let shell = null, libFrame = null;
      if (this.droppedTooth?.open) {
        shell = { positions: this.droppedTooth.positions, indices: this.droppedTooth.indices };
        libFrame = "auto";
      } else {
        this.setStatus(`Loading tooth ${tooth} from the library…`);
        try { shell = await loadLibraryTooth(tooth); } catch (error) { this.io.toast(`${error.message} Using the built-in form instead.`, "warn"); }
        if (this.disposed) return;
        this.setStatus("Fitting the tooth to the margin…");
      }
      const result = shell
        ? await this.kernel.run("crown-stl", { ...common, relief: Math.min(2, Math.max(0.3, this.construction.relief ?? 1)), shell, libFrame })
        : await this.kernel.run("crown", common);
      if (this.disposed) return;
      if (this.droppedTooth?.open) result.source = { ...result.source, type: "dropped-stl", name: this.droppedTooth.name };
      const obj = { id: this.newId("crown"), kind: "crown", name: `Crown ${result.source.tooth}`, params: null, style: RESTORATION_STYLE, source: result.source };
      this.addObject(obj, result, RESTORATION_STYLE);
      obj.seg = result.seg;
      obj.frame = shell ? { ...ops.crownFrame(obj.mesh, obj.seg, raw.positions), ...result.frame } : { ...ops.crownFrame(obj.mesh, obj.seg, raw.positions), occlusal: result.frame.occlusal };
      obj.intaglioBvh = new BVH(obj.mesh.pos, obj.mesh.idx, obj.seg.inTris);
      this.refreshWeights(obj);
      this.prep = scan;
      this.antagonist = this.scanObjects.find(o => o !== scan) || null;
      this.ensureMesh(scan);
      this.applyJawParts(ops.segmentJaw(scan.mesh, this.margin, obj.frame));
      this.selectedId = obj.id;
      this.marginOriginal = this.margin.map(p => p.slice());
      this.pushObject(obj, `Create ${obj.name} from preparation`, true, RESTORATION_STYLE);
      this.busy = false;
      this.setTool("anatomy");
      this.focusCrown();
      const placed = result.source.type === "anatomic-stl" ? `anatomic ${result.source.tooth} (${result.source.libraryLabel})`
        : result.source.type === "dropped-stl" ? result.source.name
        : result.source.libraryLabel ? `${result.source.libraryLabel} anatomic tooth` : `${result.source.profile} starter`;
      this.io.toast(`Placed an editable ${placed} on tooth ${result.source.tooth}. Shape it with the sliders or Sculpt, then review fit before export.`);
    } catch (error) {
      if (!this.disposed) this.io.toast(error.message, "error");
    } finally {
      this.busy = false;
      if (!this.disposed) { this.setStatus("Ready"); this.renderPanel(); }
    }
  }

  /* -------------------------------------------------------- pointer tools */

  ray(p) {
    return this.viewer.screenRay(p.x, p.y);
  }

  /** Nearest hit on the given objects, skipping hidden parts and anything behind the section plane. */
  pick(p, objects) {
    const r = this.ray(p);
    if (!r) return null;
    let best = null;
    for (const o of objects) {
      // Ask the viewer: layer buttons and the walkthrough can hide a model without going through here.
      if (!o || !this.viewer.meshes.get(o.vid)?.visible) continue;
      const mesh = this.ensureMesh(o);
      if (!mesh) continue;
      const hit = this.hitVisible(o, mesh, r);
      if (hit && (!best || hit.t < best.t)) best = { ...hit, obj: o };
    }
    return best;
  }

  hitVisible(o, mesh, r) {
    let origin = r.o;
    let travelled = 0;
    const clip = this.section.on ? this.clipModel() : null;
    for (let i = 0; i < 6; i++) {
      const hit = mesh.bvh.raycast(origin, r.d);
      if (!hit) return null;
      const t = hit.t + travelled;
      const hidden = (clip && V.dot(hit.point, clip.n) > clip.d) || this.partHidden(o, mesh.idx[hit.tri * 3]);
      if (!hidden) return { ...hit, t };
      origin = V.add(hit.point, V.mul(r.d, 1e-3));
      travelled = t;
    }
    return null;
  }

  partHidden(o, vert) {
    const groups = this.viewer.meshes.get(o.vid)?.groups;
    if (!groups) return false;
    if (o.drawSplit && o.drawNeighbor?.[vert] === 2) return !groups.find((g) => g.id === "draw-neighbors")?.visible;
    if (o !== this.prep || !o.parts) return false;
    const id = ["jaw", "prep", "neighbor-m", "neighbor-d"][o.parts.label[vert]];
    return !groups.find((g) => g.id === id)?.visible;
  }

  /**
   * Exocad hides the teeth beside the preparation while the finish line is being drawn,
   * then shows them again once the line is closed or cancelled.
   */
  syncDrawingNeighbors() {
    const scan = this.marginScan();
    const hide = this.tool === "margin" && this.marginSub === "draw" && !!(this.marginDraft?.length || this.marginStroke);
    if (!scan?.vid || typeof this.viewer.setGroupStyle !== "function") return;
    if (scan.parts) {
      this.viewer.setGroupStyle(scan.vid, "neighbor-m", { visible: !hide });
      this.viewer.setGroupStyle(scan.vid, "neighbor-d", { visible: !hide });
      return;
    }
    if (!hide) {
      if (scan.drawSplit && typeof this.viewer.clearMeshGroups === "function") {
        this.viewer.clearMeshGroups(scan.vid);
        scan.drawSplit = false;
        scan.drawNeighbor = null;
      }
      return;
    }
    if (scan.drawSplit || !scan.mesh) return;
    const seed = this.marginDraft?.[this.marginDraft.length - 1] || this.marginSeed;
    if (!seed) return;
    let occlusal = this.insertionAxis;
    if (!occlusal && scan.jaw && typeof this.viewer.toModel === "function") occlusal = this.viewer.toModel([0, scan.jaw === "upper" ? -1 : 1, 0]);
    const label = ops.drawingNeighborLabels(scan.mesh, seed, occlusal || [0, 0, 1]);
    if (!label) return;
    let neighbors = 0;
    for (let v = 0; v < label.length; v++) if (label[v] === 2) neighbors++;
    if (neighbors < 12 || typeof this.viewer.setMeshGroups !== "function") return;
    const { idx } = scan.mesh;
    const keep = [], side = [];
    for (let t = 0; t < idx.length / 3; t++) {
      const a = label[idx[t * 3]], b = label[idx[t * 3 + 1]], c = label[idx[t * 3 + 2]];
      (a === 2 && b === 2 && c === 2 ? side : keep).push(t);
    }
    if (!side.length) return;
    const draw = new Uint32Array(idx.length);
    let o = 0;
    const emit = (list) => {
      const start = o;
      for (const t of list) { draw[o++] = idx[t * 3]; draw[o++] = idx[t * 3 + 1]; draw[o++] = idx[t * 3 + 2]; }
      return { start, count: o - start };
    };
    const jaw = emit(keep), beside = emit(side);
    this.viewer.setMeshGroups(scan.vid, draw, [
      { id: "jaw", ...jaw },
      { id: "draw-neighbors", ...beside, visible: false },
    ]);
    scan.drawSplit = true;
    scan.drawNeighbor = label;
  }

  clipModel() {
    const n = V.norm(this.sectionAxis());
    const ref = this.crown?.frame?.center ?? centerOfBounds(this.viewer);
    return { n, d: V.dot(ref, n) + this.section.offset };
  }

  bindDrops() {
    const host = this.viewer.canvas?.parentElement;
    if (!host) return;
    const hasFile = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    this.onDragOver = (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    this.onDropFile = (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      const file = [...e.dataTransfer.files].find((f) => /\.stl$/i.test(f.name));
      if (!file) { this.io.toast("Drop a binary tooth STL.", "warn"); return; }
      void this.takeDroppedTooth(file);
    };
    host.addEventListener("dragover", this.onDragOver, true);
    host.addEventListener("drop", this.onDropFile, true);
  }

  async takeDroppedTooth(file) {
    try {
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength > 20 * 1024 * 1024) throw new Error("Drop one tooth STL, at most 20 MB.");
      const geometry = parseBinarySTL(buffer);
      const triangles = geometry.indices.length / 3;
      if (triangles < 20 || triangles > 100000) throw new Error("Drop one tooth STL, at most 100,000 triangles.");
      let open = false;
      try { const { loop } = shellRim(geometry.positions, geometry.indices); open = loop.length >= 12; } catch { open = false; }
      this.droppedTooth = { name: file.name, positions: geometry.positions, indices: geometry.indices, open };
      if (!this.disposed) this.renderPanel();
      const where = this.crown ? "Click Place to replace the current tooth with it." : this.margin && this.insertionAxis ? "Click Place to put it on the margin." : "Finish the margin and insertion direction, then click Place.";
      this.io.toast(`${file.name} is ready. ${where}`);
    } catch (error) {
      this.io.toast(error.message || "That STL could not be read.", "error");
    }
  }

  async placeDroppedTooth() {
    if (this.busy) return;
    if (this.crown) { this.io.toast("A crown is already loaded. Use Place to replace it.", "warn"); return; }
    const scan = this.marginScan();
    const tooth = this.droppedTooth;
    if (!scan || !this.margin || !this.insertionAxis || !tooth) { this.io.toast("Load a scan, draw a margin and set the insertion direction first.", "warn"); return; }
    this.busy = true;
    this.session?.refresh();
    this.setStatus("Placing STL on the margin…");
    try {
      const seated = seatTooth(tooth.positions, this.margin, this.insertionAxis);
      if (this.disposed) return;
      const name = tooth.name.replace(/\.stl$/i, "");
      const obj = { id: this.newId("crown"), kind: "crown", name, params: null, style: RESTORATION_STYLE, source: { type: "dropped-stl", name: tooth.name } };
      this.addObject(obj, { positions: seated.positions, indices: tooth.indices }, RESTORATION_STYLE);
      await this.setupCrown(obj);
      obj.frame = seated.frame;
      this.prep = scan;
      this.antagonist = this.scanObjects.find(o => o !== scan) || null;
      this.ensureMesh(scan);
      this.applyJawParts(ops.segmentJaw(scan.mesh, this.margin, obj.frame));
      this.selectedId = obj.id;
      this.marginOriginal = this.margin.map(p => p.slice());
      this.pushObject(obj, `Place ${name} on the margin`, true, RESTORATION_STYLE);
      this.busy = false;
      this.setTool("anatomy");
      this.focusCrown();
      this.io.toast(`Placed ${name} on the margin. Sculpt it, then review the fit before export.`);
    } catch (error) {
      if (!this.disposed) this.io.toast(error.message, "error");
    } finally {
      this.busy = false;
      if (!this.disposed) { this.setStatus("Ready"); this.renderPanel(); }
    }
  }

  bindTool() {
    const handlers = {
      down: (p) => this.onDown(p),
      move: (p) => this.onDrag(p),
      up: (p) => this.onUp(p),
      hover: (p) => this.onHover(p),
      leave: () => { this.hover = null; this.viewer.render(); },
      click: (p) => this.onClick(p),
    };
    this.viewer.tool = handlers;
  }

  /** Clicks select a tooth in Teeth and Margin; dragging the same model still rotates it. */
  onClick(p) {
    if (this.tool !== "teeth") return;
    const hit = this.pick(p, this.scanObjects);
    if (!hit) return;
    const d = this.teethData[hit.obj.jaw];
    if (!d?.label) return;
    const i = d.label[ops.closestTriVertex(hit.obj.mesh, hit)];
    if (i >= 0) this.selectTooth(hit.obj.jaw, i);
  }

  onHover(p) {
    if (PAINT_TOOLS.includes(this.tool)) {
      const target = this.brushTarget();
      const hit = target ? this.pick(p, [target]) : null;
      this.hover = hit ? { hit } : null;
      if (hit && this.mapValues) {
        this.hover.probe = this.mapValues[ops.closestTriVertex(target.mesh, hit)];
        this.hover.x = p.x;
        this.hover.y = p.y;
      }
    } else if (this.tool === "margin") {
      const i = this.marginSub === "draw" || this.pendingAutoSeed ? -1 : this.marginHandleAt(p);
      this.hover = i >= 0 ? { handle: i } : { p };
    } else if (this.tool === "transform") {
      this.hover = { gizmo: this.gizmoHit(p) };
    } else if (this.mapValues) {
      const obj = this.mapObject();
      const hit = obj ? this.pick(p, [obj]) : null;
      if (hit) {
        const v = ops.closestTriVertex(obj.mesh, hit);
        this.hover = { probe: this.mapValues[v], x: p.x, y: p.y };
      } else this.hover = null;
    } else this.hover = { p };
    this.viewer.render();
  }

  brushTarget() {
    const sel = this.selected;
    return sel?.mesh && sel.kind !== "scan" ? sel : this.crown;
  }

  onDown(p) {
    if (this.busy) return false;
    if (this.tool === "margin" && p.shift) return false;
    switch (this.tool) {
      case "sculpt":
      case "anatomy":
      case "occlusion":
      case "contacts":
        return this.strokeStart(p);
      case "teeth": {
        if (!this.pendingTooth) return false;
        const hit = this.pick(p, this.scanObjects);
        if (!hit) return false;
        this.toothPointAction(hit);
        return true;
      }
      case "margin":
        return this.marginDown(p);
      case "measure":
        return this.measureDown(p);
      case "transform":
        return this.gizmoDown(p);
      case "bridge":
        if (this.pendingPontic) {
          const hit = this.pick(p, [...this.scanObjects, ...this.units]);
          if (hit) {
            this.pendingPontic = false;
            this.viewer.canvas.dataset.cadPick = "";
            this.placePontic(hit.point);
            this.io.toast("Pontic placed. Sliders, Transform and Sculpt now act on it.");
            return true;
          }
        }
        return this.selectAt(p);
      default:
        return this.selectAt(p);
    }
  }

  selectAt(p) {
    const units = this.units;
    if (units.length < 2) return false;
    const hit = this.pick(p, units);
    if (hit && hit.obj.id !== this.selectedId) {
      this.select(hit.obj.id);
      return true;
    }
    return false;
  }

  onDrag(p) {
    if (this.stroke) this.strokeMove(p);
    else if (this.marginStroke) this.marginTraceMove(p);
    else if (this.marginDrag) this.marginMove(p);
    else if (this.xform) this.gizmoMove(p);
  }

  onUp(p) {
    if (this.stroke) this.strokeEnd(p);
    else if (this.marginStroke) { this.marginStroke = null; this.renderPanel(); }
    else if (this.marginDrag) this.marginUp(p);
    else if (this.xform) this.gizmoUp(p);
  }

  /* ---- sculpt */

  strokeStart(p) {
    const obj = this.brushTarget();
    if (!obj) return false;
    const hit = this.pick(p, [obj]);
    if (!hit) return false;
    this.cancelLive();
    this.beginGeom(obj);
    const o = this.opts;
    const mask = o.protect && obj.weights ? obj.weights.weight : null;
    const stroke = { obj, kind: o.brush, mask, last: hit.point, touched: new Set(), spacing: Math.max(0.05, o.radius * 0.22) };
    if (o.brush === "restore") stroke.restore = this.originalBvh(obj);
    if (o.brush === "grab") {
      const region = ops.brushRegion(obj.mesh, ops.closestTriVertex(obj.mesh, hit), hit.point, o.radius, obj.scratch);
      const r = this.ray(p);
      stroke.grab = { region, start: hit.point, viewN: r.d, base: obj.mesh.pos.slice(), axial: o.axial };
    } else {
      this.stamp(stroke, hit);
    }
    this.stroke = stroke;
    this.hover = { hit };
    this.geometryChanged(obj, { touched: Int32Array.from(stroke.touched) });
    return true;
  }

  stamp(stroke, hit) {
    const o = this.opts;
    const region = ops.brushStamp(stroke.obj.mesh, {
      kind: stroke.kind, hit, radius: o.radius, strength: o.strength, mask: stroke.mask, restore: stroke.restore, scratch: stroke.obj.scratch,
    });
    for (let i = 0; i < region.length; i += 2) stroke.touched.add(region[i]);
  }

  strokeMove(p) {
    const s = this.stroke;
    const { obj } = s;
    if (s.grab) {
      this.grabMove(s, p);
      return;
    }
    const hit = this.pick(p, [obj]);
    if (!hit) return;
    s.touched.clear();
    const d = V.dist(hit.point, s.last);
    if (d >= s.spacing) {
      // Stamps along the segment, so a fast drag leaves a continuous stroke.
      const steps = Math.min(8, Math.ceil(d / s.spacing));
      for (let i = 1; i <= steps; i++) {
        const q = V.add(s.last, V.mul(V.sub(hit.point, s.last), i / steps));
        const c = obj.mesh.bvh.closest(q, this.opts.radius * 2);
        if (c) this.stamp(s, { point: c.point, tri: c.tri });
      }
      s.last = hit.point;
      this.geometryChanged(obj, { touched: Int32Array.from(s.touched) });
    }
    this.hover = { hit };
    this.viewer.render();
  }

  grabMove(s, p) {
    const { obj, grab } = s;
    const r = this.ray(p);
    const denom = V.dot(r.d, grab.viewN);
    if (Math.abs(denom) < 1e-6) return;
    const t = V.dot(V.sub(grab.start, r.o), grab.viewN) / denom;
    let move = V.sub(V.add(r.o, V.mul(r.d, t)), grab.start);
    const f = obj.frame || this.crown?.frame;
    if (grab.axial && f) move = V.mul(f.occlusal, V.dot(move, f.occlusal));
    const { pos } = obj.mesh;
    const { region, base } = grab;
    const list = new Int32Array(region.length / 2);
    for (let i = 0; i < region.length; i += 2) {
      const v = region[i];
      const x = 1 - region[i + 1] * region[i + 1];
      const w = x * x * (s.mask ? s.mask[v] : 1);
      pos[v * 3] = base[v * 3] + move[0] * w;
      pos[v * 3 + 1] = base[v * 3 + 1] + move[1] * w;
      pos[v * 3 + 2] = base[v * 3 + 2] + move[2] * w;
      list[i / 2] = v;
    }
    this.geometryChanged(obj, { touched: list });
  }

  strokeEnd() {
    const s = this.stroke;
    this.stroke = null;
    this.geometryChanged(s.obj, { commit: true });
    const brush = BRUSHES.find((b) => b.id === s.kind);
    this.commitGeom(s.obj, `${brush?.label ?? "Sculpt"} · r ${this.opts.radius.toFixed(1)} mm`);
  }

  /* ---- margin */

  marginHandleAt(p) {
    const pts = this.marginCtrl || this.margin;
    if (!pts) return -1;
    let best = -1, bd = p.pointerType === "touch" ? 24 : 16;
    const ray = this.ray(p);
    const scan = this.marginScan();
    const front = ray && scan && this.viewer.meshes.get(scan.vid)?.visible !== false ? this.pick(p, [scan]) : null;
    pts.forEach((q, i) => {
      const s = this.viewer.projectToScreen(this.viewer.toWorld(q));
      if (!s || s.behind) return;
      // A back-side point can project onto a front-side point. Never grab it through the jaw.
      if (ray && front && V.dot(V.sub(q, ray.o), ray.d) > front.t + 0.45) return;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /** A picked point on the scan, moved onto a nearby crest if the magnet is on. */
  marginPick(p) {
    const scan = this.marginScan();
    const hit = this.pick(p, scan ? [scan] : this.units);
    if (!hit) return null;
    if (!this.magnet || !hit.obj.scratch) return hit.point;
    return ops.magnetPoint(hit.obj.mesh, hit, 0.45, hit.obj.scratch);
  }

  marginDown(p) {
    const sub = this.marginSub;
    if (this.pendingAutoSeed) {
      const point = this.marginPick(p);
      if (point) {
        this.marginSeed = point;
        this.pendingAutoSeed = false;
        this.autoDetectMargin(point);
        this.renderPanel();
        return true;
      }
      return false;
    }
    if (sub === "draw") {
      const point = this.marginPick(p);
      if (!point) return false;
      if (this.marginDraft?.length > 2) {
        const first = this.viewer.projectToScreen(this.viewer.toWorld(this.marginDraft[0]));
        if (first && !first.behind && Math.hypot(first.x - p.x, first.y - p.y) < 18 && V.dist(point, this.marginDraft[0]) < 0.7) {
          this.closeMarginDraft();
          return true;
        }
      }
      this.marginDraftHistory.push(this.marginDraft?.length || 0);
      this.marginDraft = [...(this.marginDraft || []), point];
      this.marginSeed = point;
      this.marginStroke = { last: p, point };
      this.syncDrawingNeighbors();
      this.refreshMargin();
      this.renderPanel();
      return true;
    }
    const ctrl = this.marginCtrl;
    const i = this.marginHandleAt(p);
    if (sub === "delete") {
      if (i < 0) return false;
      if (ctrl.length <= 4) {
        this.io.toast("A margin needs at least four points.", "warn");
        return true;
      }
      this.setControl(ctrl.filter((_, k) => k !== i), "Delete margin point");
      return true;
    }
    if (sub === "add") {
      if (!ctrl) return false;
      const point = this.marginPick(p);
      if (!point) return false;
      const { next, index } = this.insertMarginPoint(point);
      this.setControl(next, "Add margin point");
      this.marginSel = index;
      this.refreshMargin();
      return true;
    }
    if (i < 0) {
      // Drag the line itself to add and adjust a point in one gesture.
      if (ctrl && this.margin?.some((q, k) => {
        const a = this.viewer.projectToScreen(this.viewer.toWorld(q));
        const b = this.viewer.projectToScreen(this.viewer.toWorld(this.margin[(k + 1) % this.margin.length]));
        return a && b && !a.behind && !b.behind && segDist(p, a, b) < (p.pointerType === "touch" ? 20 : 12);
      })) {
        const point = this.marginPick(p);
        if (point && V.dist(point, ops.closestOnLoop(point, this.margin)) < 0.7) {
          const before = this.marginState();
          const { next, index } = this.insertMarginPoint(point);
          this.marginCtrl = next;
          this.margin = this.curveThrough(next);
          this.marginSel = index;
          this.marginDrag = { i: index, before, ctrl: next.map(q => q.slice()), moved: true, inserted: true };
          this.refreshMargin();
          return true;
        }
      }
      if (this.marginSel >= 0) {
        this.marginSel = -1;
        this.refreshMargin();
      }
      return false;
    }
    this.marginSel = i;
    this.marginDrag = { i, before: this.marginState(), ctrl: ctrl.map((q) => q.slice()), moved: false };
    this.refreshMargin();
    return true;
  }

  insertMarginPoint(point) {
    const ctrl = this.marginCtrl;
    let index = 0, distance = Infinity;
    ctrl.forEach((a, k) => {
      const b = ctrl[(k + 1) % ctrl.length], ab = V.sub(b, a);
      const t = clamp(V.dot(V.sub(point, a), ab) / (V.dot(ab, ab) || 1), 0, 1);
      const d = V.dist(point, V.add(a, V.mul(ab, t)));
      if (d < distance) { distance = d; index = k + 1; }
    });
    const next = ctrl.map(q => q.slice()); next.splice(index, 0, point);
    return { next, index };
  }

  marginTraceMove(p) {
    const stroke = this.marginStroke;
    if (!stroke || Math.hypot(p.x - stroke.last.x, p.y - stroke.last.y) < 5) return;
    const point = this.marginPick(p);
    if (!point || V.dist(point, stroke.point) > 2.5 || V.dist(point, stroke.point) < 0.05) return;
    if (this.marginDraft.length >= 512) return;
    const first = this.viewer.projectToScreen(this.viewer.toWorld(this.marginDraft[0]));
    if (this.marginDraft.length >= 8 && ops.loopLength(this.marginDraft) > 3 && first && Math.hypot(first.x - p.x, first.y - p.y) < 18 && V.dist(point, this.marginDraft[0]) < 0.7) {
      this.marginTraced = true;
      this.marginStroke = null;
      this.closeMarginDraft();
      return;
    }
    this.marginTraced = true;
    this.marginDraft.push(point);
    stroke.last = p; stroke.point = point;
    // No panel rebuild or spline/BVH fitting for each brush sample.
    if (!this.marginPreviewFrame) this.marginPreviewFrame = requestAnimationFrame(() => {
      this.marginPreviewFrame = null;
      if (!this.disposed) {
        this.refreshMargin();
        const progress = this.panelEl?.querySelector("[data-margin-progress]");
        if (progress && this.marginDraft) progress.textContent = `${this.marginDraft.length} samples · Continue tracing, or finish the line.`;
      }
    });
  }

  marginMove(p) {
    const d = this.marginDrag;
    const point = this.marginPick(p);
    if (!point) return;
    const base = d.ctrl;
    const move = V.sub(point, base[d.i]);
    const inf = this.opts.influence;
    const n = base.length;
    const bvh = this.marginBvh();
    const next = base.map((q) => q.slice());
    next[d.i] = point;
    if (inf > 0) {
      // Neighbours along the loop follow with a falloff, then return to the scan surface.
      for (const dir of [1, -1]) {
        let along = 0;
        for (let k = 1; k < n / 2; k++) {
          const cur = (d.i + dir * k + n * 2) % n;
          const prev = (d.i + dir * (k - 1) + n * 2) % n;
          along += V.dist(base[cur], base[prev]);
          if (along >= inf) break;
          const w = 0.5 + 0.5 * Math.cos((along / inf) * Math.PI);
          const q = V.add(base[cur], V.mul(move, w));
          next[cur] = bvh?.closest(q, 1.5)?.point ?? q;
        }
      }
    }
    this.marginCtrl = next;
    this.margin = this.curveThrough(next);
    d.moved = true;
    this.refreshMargin();
  }

  marginUp() {
    const d = this.marginDrag;
    this.marginDrag = null;
    if (!d.moved) return;
    const after = this.marginCtrl;
    const sel = d.i;
    this.applyMarginState(d.before);
    this.setControl(after, "Move margin point");
    this.marginSel = sel;
    this.refreshMargin();
  }

  /** The clicked points stay as the line's editable points. */
  closeMarginDraft() {
    const draft = this.marginDraft;
    if (!draft || draft.length < 4) {
      if (draft) this.io.toast("Keep drawing: at least four points are needed. Your points are still here.", "warn");
      this.refreshMargin();
      this.renderPanel();
      return;
    }
    const ctrl = this.marginTraced ? ops.resampleLoop(draft, Math.min(48, Math.max(12, Math.round(ops.loopLength(draft) / 0.6)))) : draft;
    this.marginDraft = null;
    this.marginDraftHistory = [];
    this.marginStroke = null;
    this.marginTraced = false;
    this.marginSub = "move";
    this.syncDrawingNeighbors();
    this.setControl(ctrl, this.marginTooth ? `Mark margin on ${this.marginTooth}` : "Mark margin");
    this.setStatus("Margin closed. Drag any point or the line to adjust it.");
  }

  /* ---- measure */

  measureDown(p) {
    const objs = [...this.units, ...this.scanObjects];
    const hit = this.pick(p, objs);
    if (!hit) return false;
    const ref = { objId: hit.obj.id, tri: hit.tri, u: hit.u, v: hit.v };
    const sub = this.measureSub;
    const need = sub === "distance" ? 2 : sub === "angle" ? 3 : 1;
    this.measureDraft.push(ref);
    if (this.measureDraft.length >= need) {
      this.measures.push({ type: sub, pts: this.measureDraft, id: ++this.measureSeq || (this.measureSeq = 1) });
      this.measureDraft = [];
      this.renderPanel();
    }
    this.viewer.render();
    return true;
  }

  /* ---- transform */

  gizmoObject() {
    return this.selected?.mesh || this.selected?.lazy ? this.selected : null;
  }

  gizmoAxes(obj) {
    const f = obj.frame || this.crown?.frame;
    return f ? [f.mesial, f.facial, f.occlusal] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  }

  gizmoPivot(obj) {
    if (obj.pivot && !this.xform) obj.pivot = null;
    if (obj.pivot) return obj.pivot;
    const mesh = this.ensureMesh(obj);
    obj.pivot = centerOfVisible(obj, mesh);
    return obj.pivot;
  }

  gizmoScreen(obj) {
    const pivot = this.gizmoPivot(obj);
    const w = (q) => this.viewer.projectToScreen(this.viewer.toWorld(q));
    const c = w(pivot);
    if (!c) return null;
    const axes = this.gizmoAxes(obj);
    const size = 5;
    const screens = axes.map((a) => w(V.add(pivot, V.mul(a, size))));
    if (screens.some((s) => !s)) return null;
    const rings = axes.map((a, i) => {
      const u = axes[(i + 1) % 3], v = axes[(i + 2) % 3];
      const pts = [];
      for (let k = 0; k <= 48; k++) {
        const th = (k / 48) * Math.PI * 2;
        const s = w(V.add(pivot, V.add(V.mul(u, Math.cos(th) * size * 0.9), V.mul(v, Math.sin(th) * size * 0.9))));
        if (s) pts.push(s);
      }
      return pts;
    });
    return { c, screens, rings, axes, size, pivot };
  }

  gizmoHit(p) {
    const obj = this.gizmoObject();
    if (!obj) return null;
    const g = this.gizmoScreen(obj);
    if (!g) return null;
    const mode = this.opts.gizmo;
    if (mode === "rotate") {
      let best = null, bd = 8;
      g.rings.forEach((pts, i) => {
        for (let k = 0; k + 1 < pts.length; k++) {
          const d = segDist(p, pts[k], pts[k + 1]);
          if (d < bd) { bd = d; best = i; }
        }
      });
      return best;
    }
    let best = null, bd = 9;
    g.screens.forEach((s, i) => {
      const d = segDist(p, g.c, s);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  gizmoDown(p) {
    const obj = this.gizmoObject();
    const axis = this.gizmoHit(p);
    if (obj && axis !== null) {
      const g = this.gizmoScreen(obj);
      this.ensureMesh(obj);
      this.beginGeom(obj);
      this.xform = {
        obj, axis, base: obj.before, mode: this.opts.gizmo, g, start: p,
        startAngle: Math.atan2(p.y - g.c.y, p.x - g.c.x), value: 0,
      };
      return true;
    }
    // A click elsewhere selects what is under the pointer, and otherwise navigates.
    const hit = this.pick(p, [...this.units, ...this.scanObjects]);
    if (hit && hit.obj.id !== this.selectedId) {
      this.select(hit.obj.id);
      return true;
    }
    return false;
  }

  gizmoMove(p) {
    const x = this.xform;
    const { g, axis, mode } = x;
    const screen = g.screens[axis];
    const sx = screen.x - g.c.x, sy = screen.y - g.c.y;
    const pixels = Math.hypot(sx, sy) || 1;
    const along = ((p.x - x.start.x) * sx + (p.y - x.start.y) * sy) / pixels;
    if (mode === "move") {
      x.value = (along / pixels) * g.size;
    } else if (mode === "scale") {
      x.value = Math.max(0.2, 1 + along / (pixels * 2));
    } else {
      let a = Math.atan2(p.y - g.c.y, p.x - g.c.x) - x.startAngle;
      // Rotation direction depends on whether the axis points at the viewer.
      const w = this.viewer.toModel(this.viewer.basis.z);
      if (V.dot(g.axes[axis], w) < 0) a = -a;
      x.value = -a;
    }
    this.applyXform(x);
    this.geometryChanged(x.obj);
    this.setStatus(this.xformLabel(x));
  }

  xformLabel(x) {
    const axisNames = x.obj.frame || this.crown?.frame ? ["mesial", "facial", "occlusal"] : ["X", "Y", "Z"];
    if (x.mode === "move") return `Move ${x.value >= 0 ? "+" : ""}${x.value.toFixed(2)} mm ${axisNames[x.axis]}`;
    if (x.mode === "scale") return `Scale ${(x.value * 100).toFixed(1)}% ${axisNames[x.axis]}`;
    return `Rotate ${((x.value * 180) / Math.PI).toFixed(1)}° about ${axisNames[x.axis]}`;
  }

  applyXform(x) {
    const { obj, base, axis, mode, value, g } = x;
    const { pos } = obj.mesh;
    const n = pos.length / 3;
    const a = g.axes[axis];
    const c = g.pivot;
    if (mode === "move") {
      for (let v = 0; v < n; v++) {
        pos[v * 3] = base[v * 3] + a[0] * value;
        pos[v * 3 + 1] = base[v * 3 + 1] + a[1] * value;
        pos[v * 3 + 2] = base[v * 3 + 2] + a[2] * value;
      }
    } else if (mode === "scale") {
      const s = value - 1;
      for (let v = 0; v < n; v++) {
        const d = (base[v * 3] - c[0]) * a[0] + (base[v * 3 + 1] - c[1]) * a[1] + (base[v * 3 + 2] - c[2]) * a[2];
        pos[v * 3] = base[v * 3] + a[0] * d * s;
        pos[v * 3 + 1] = base[v * 3 + 1] + a[1] * d * s;
        pos[v * 3 + 2] = base[v * 3 + 2] + a[2] * d * s;
      }
    } else {
      const cs = Math.cos(value), sn = Math.sin(value);
      for (let v = 0; v < n; v++) {
        const p = [base[v * 3] - c[0], base[v * 3 + 1] - c[1], base[v * 3 + 2] - c[2]];
        const r = V.add(V.add(V.mul(p, cs), V.mul(V.cross(a, p), sn)), V.mul(a, V.dot(a, p) * (1 - cs)));
        pos[v * 3] = c[0] + r[0]; pos[v * 3 + 1] = c[1] + r[1]; pos[v * 3 + 2] = c[2] + r[2];
      }
    }
  }

  /** The dental frame and, for the prepared jaw, the margin line travel with a rigid move. */
  xformExtras(x) {
    const { obj, axis, mode, value, g } = x;
    const a = g.axes[axis].slice();
    const c = g.pivot.slice();
    const apply = (p, s) => {
      if (mode === "move") return V.add(p, V.mul(a, value * s));
      if (mode === "scale") {
        const k = s > 0 ? value - 1 : 1 / value - 1;
        return V.add(p, V.mul(a, V.dot(V.sub(p, c), a) * k));
      }
      const q = V.sub(p, c);
      const th = value * s, cs = Math.cos(th), sn = Math.sin(th);
      return V.add(c, V.add(V.add(V.mul(q, cs), V.mul(V.cross(a, q), sn)), V.mul(a, V.dot(a, q) * (1 - cs))));
    };
    const rotDir = (d, s) => {
      if (mode !== "rotate") return d;
      const th = value * s, cs = Math.cos(th), sn = Math.sin(th);
      return V.add(V.add(V.mul(d, cs), V.mul(V.cross(a, d), sn)), V.mul(a, V.dot(a, d) * (1 - cs)));
    };
    return (sign) => {
      if (obj.frame) {
        obj.frame = {
          ...obj.frame, center: apply(obj.frame.center, sign),
          occlusal: rotDir(obj.frame.occlusal, sign), mesial: rotDir(obj.frame.mesial, sign), facial: rotDir(obj.frame.facial, sign),
        };
      }
      if (obj.kind === "scan") {
        // Every margin on this jaw travels with it, and tooth positions have to be found again.
        if (this.marginScan() === obj && this.margin) {
          this.margin = this.margin.map((p) => apply(p, sign));
          this.marginCtrl = this.marginCtrl?.map((p) => apply(p, sign)) ?? this.margin;
          this.refreshMargin();
        }
        for (const [fdi, m] of this.margins) {
          if (jawOfFdi(fdi) === obj.jaw) this.margins.set(fdi, { margin: m.margin.map((p) => apply(p, sign)), ctrl: m.ctrl.map((p) => apply(p, sign)) });
        }
        if (this.teethData[obj.jaw]) this.clearTeeth();
      }
      obj.pivot = null;
    };
  }

  gizmoUp() {
    const x = this.xform;
    this.xform = null;
    x.obj.pivot = null;
    this.setStatus("Ready");
    const neutral = x.mode === "scale" ? x.value === 1 : x.value === 0;
    if (neutral) {
      x.obj.before = null;
      return;
    }
    const extra = this.xformExtras(x);
    extra(1);
    this.geometryChanged(x.obj, { commit: true });
    this.commitGeom(x.obj, this.xformLabel(x), { extra });
  }

  /** Numeric and keyboard transforms go through the same path as the gizmo. */
  nudge(axis, value, mode = this.opts.gizmo) {
    const obj = this.gizmoObject();
    if (!obj) return;
    const g = this.gizmoScreen(obj);
    if (!g) return;
    this.beginGeom(obj);
    const x = { obj, axis, base: obj.before, mode, value, g };
    this.applyXform(x);
    const extra = this.xformExtras(x);
    extra(1);
    this.geometryChanged(obj, { commit: true });
    this.commitGeom(obj, this.xformLabel(x), { extra });
  }

  /* ----------------------------------------------------------- import/export */

  download(buffer, name) {
    const url = URL.createObjectURL(new Blob([buffer], { type: "model/stl" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  caseSlug() {
    return String(this.caseData.id || "case").replace(/[^\w-]+/g, "_");
  }

  /** Exports exactly the edited vertices, after checking the mesh is still printable. */
  exportUnit(obj = this.mapObject()) {
    if (!obj?.mesh) {
      this.io.toast("There is no restoration to export in this case yet.", "warn");
      return null;
    }
    const stats = meshStats(obj.mesh.pos, obj.mesh.idx);
    const buffer = writeBinarySTL([{ positions: obj.mesh.pos, indices: obj.mesh.idx }], `FAUCHAR ${obj.name}`);
    this.download(buffer, `${this.caseSlug()}_${obj.name.replace(/\s+/g, "-").toLowerCase()}.stl`);
    this.io.toast(stats.closed ? `Exported ${obj.name}: closed mesh, ${stats.triangles.toLocaleString()} triangles, ${stats.volume.toFixed(1)} mm³.` : `Exported ${obj.name}, but it is NOT watertight: ${stats.boundary} open and ${stats.nonManifold} non-manifold edges.`, stats.closed ? undefined : "warn");
    return stats;
  }

  /** Separate shells, one solid per unit, overlapping at the connectors. */
  exportShells() {
    const list = this.units.map((o) => ({ positions: o.mesh.pos, indices: o.mesh.idx }));
    if (!list.length) return;
    this.download(writeBinarySTL(list, "FAUCHAR Design shells"), `${this.caseSlug()}_units.stl`);
    this.io.toast(`Exported ${list.length} separate overlapping shells.`);
  }

  /** One watertight solid. The whole surface is resampled at the chosen voxel size. */
  async exportMerged() {
    const list = this.units.map((o) => ({ positions: o.mesh.pos, indices: o.mesh.idx }));
    if (!list.length || this.busy) return null;
    this.busy = true;
    this.session?.refresh();
    this.setStatus("Merging units…");
    await tick();
    try {
      const merged = await this.kernel.run("merge", { meshes: list, voxel: this.opts.voxel }, p => this.setStatus(`Merging units… ${Math.round(p * 100)}%`));
      if (this.disposed) return null;
      const stats = merged.stats;
      this.download(writeBinarySTL([merged], "FAUCHAR Design merged"), `${this.caseSlug()}_merged.stl`);
      this.io.toast(`Merged into one solid at ${this.opts.voxel} mm: ${stats.closed ? "closed and manifold" : "NOT watertight"}, ${stats.triangles.toLocaleString()} triangles, ${stats.volume.toFixed(1)} mm³.`, stats.closed ? undefined : "warn");
      return stats;
    } catch (e) {
      if (!this.disposed) this.io.toast(e.message, "error");
      return null;
    } finally {
      this.busy = false;
      if (!this.disposed) { this.setStatus("Ready"); this.session?.refresh(); }
    }
  }

  /** Brings an STL into the design as a new restoration unit. */
  async refreshLibrary() {
    try { this.libraryModels = await listLibraryModels(); if (!this.disposed) this.renderPanel(); }
    catch (error) { this.io.toast(error.message, "error"); }
  }

  async addToLibrary(file) {
    if (this.libraryBusy) return;
    this.libraryBusy = true;
    try {
      await addLibraryModel(file, this.marginTooth || this.caseData.teeth?.[0] || 22);
      if (!this.disposed) { await this.refreshLibrary(); this.io.toast("STL saved to your local library. Select it to import and position it manually."); }
    } catch (error) { this.io.toast(error.message, "error"); }
    finally { this.libraryBusy = false; if (!this.disposed) this.renderPanel(); }
  }

  async useLibraryModel(id) {
    if (this.libraryBusy || this.busy) return;
    this.libraryBusy = true;
    try {
      const model = await getLibraryModel(id);
      if (!model) throw new Error("Library model is no longer available.");
      if (!this.disposed) await this.importUnit({ name: `${model.name}.stl`, arrayBuffer: async () => model.buffer.slice(0) });
    } catch (error) { this.io.toast(error.message, "error"); }
    finally { this.libraryBusy = false; if (!this.disposed) this.renderPanel(); }
  }

  async importUnit(file) {
    const buffer = await file.arrayBuffer();
    let geometry;
    try {
      geometry = parseBinarySTL(buffer);
    } catch {
      this.io.toast("Only binary STL can be imported here.", "warn");
      return;
    }
    const first = !this.crown;
    const obj = { id: this.newId("unit"), kind: first ? "crown" : "pontic", name: first ? "Restoration" : file.name.replace(/\.stl$/i, ""), params: null };
    const style = RESTORATION_STYLE;
    obj.style = style;
    this.addObject(obj, geometry, style);
    if (first) {
      await this.setupCrown(obj);
      obj.frame = obj.seg ? ops.crownFrame(obj.mesh, obj.seg, this.prep?.lazy.positions ?? null) : defaultFrame(obj.mesh.pos);
      this.insertionAxis = obj.frame.occlusal;
      if (!this.margin && obj.seg) {
        this.margin = ops.resampleLoop(Array.from(obj.seg.rimLoop, (v) => vertexAt(obj.mesh.pos, v)), 160);
        this.refreshMargin();
      }
    } else {
      obj.frame = this.crown?.frame ?? defaultFrame(obj.mesh.pos);
    }
    this.pushObject(obj, `Import ${obj.name}`, true, style);
    this.selectedId = obj.id;
    this.viewer.fit();
    this.setStatus("Ready");
    this.renderPanel();
  }

  /* ------------------------------------------------------------- persistence */

  markDirty() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveDesign(), 1500);
  }

  async saveDesign() {
    if (this.disposed || !this.io.saveDesign) return;
    const objects = [];
    for (const o of this.objects.values()) {
      if (o.kind === "scan") continue;
      objects.push({ id: o.id, kind: o.kind, name: o.name, params: o.params ?? null, frame: o.frame ?? null, positions: o.mesh.pos, indices: o.mesh.idx, original: o.original, originalIdx: o.originalIdx, style: o.style ?? null, seg: o.seg ?? null, source: o.source ?? null });
    }
    try {
      const teeth = {};
      for (const [jaw, d] of Object.entries(this.teethData)) {
        if (d.model.status === "reviewed") teeth[jaw] = { points: d.model.curve.points.length, jobTooth: d.model.jobTooth ?? null, jobToothConfirmed: !!d.model.jobToothConfirmed, teeth: d.model.teeth.map(({ fdi, from, to, confidence, manual, stump, partial }) => ({ fdi, from, to, confidence, manual, stump, partial })) };
      }
      await this.io.saveDesign({
        version: 1, objects, margin: this.margin, marginCtrl: this.marginCtrl, marginTooth: this.marginTooth, margins: [...this.margins], teeth,
        marginOriginal: this.marginOriginal, axis: this.insertionAxis, axisUserSet: !!this.axisUserSet, axisFrame: this.axisFrame, tilt: this.opts.axisTilt, seq: this.seq || 0,
        workflow: this.workflow, construction: this.construction, settings: { cement: this.opts.cement, thickness: this.opts.thickness, targets: this.opts.targets, voxel: this.opts.voxel },
      });
      this.setStatus("Saved in this browser");
      return true;
    } catch (e) {
      this.setStatus("Could not save");
      console.error(e);
      return false;
    }
  }

  async restoreDesign() {
    const saved = await this.io.loadDesign?.().catch(() => null);
    if (!saved || saved.version !== 1) return;
    this.seq = saved.seq || 0;
    if (saved.workflow) this.workflow = { ...this.workflow, ...saved.workflow };
    if (saved.construction) this.construction = { ...this.construction, ...saved.construction };
    if (saved.settings) {
      for (const key of ["cement", "thickness", "targets"]) if (saved.settings[key]) Object.assign(this.opts[key], saved.settings[key]);
      if ([0.05, 0.08, 0.1, 0.15, 0.2].includes(saved.settings.voxel)) this.opts.voxel = saved.settings.voxel;
    }
    if (saved.margin !== undefined && saved.marginTooth !== undefined) {
      this.margin = saved.margin;
      this.marginCtrl = saved.marginCtrl ?? saved.margin;
      this.marginTooth = saved.marginTooth;
    } else if (saved.margin) {
      this.margin = saved.margin;
      this.marginCtrl = saved.margin;
    }
    if (saved.margins) this.margins = new Map(saved.margins);
    this.savedTeeth = saved.teeth ?? null;
    if (saved.axis) { this.insertionAxis = saved.axis; this.axisUserSet = !!saved.axisUserSet || !!this.crown; }
    if (saved.axisFrame) this.axisFrame = saved.axisFrame;
    if (saved.tilt) this.opts.axisTilt = saved.tilt;
    let changed = false;
    for (const s of saved.objects) {
      const existing = this.objects.get(s.id);
      if (existing?.mesh) {
        if (s.positions.length === existing.mesh.pos.length && arraysEqual(s.indices, existing.mesh.idx)) {
          existing.mesh.pos.set(s.positions);
          existing.frame = s.frame ?? existing.frame;
          this.geometryChanged(existing, { commit: true });
        } else {
          this.uploadNew(existing, { positions: new Float32Array(s.positions), indices: new Uint32Array(s.indices) }, RESTORATION_STYLE);
          existing.frame = s.frame ?? existing.frame;
          await this.setupSegFromSaved(existing);
        }
        changed = changed || !arraysEqual(s.positions, s.original);
      } else {
        const obj = { id: s.id, kind: s.kind, name: s.name, params: s.params, frame: s.frame, style: s.style, vid: s.id, alpha: 1, visible: true, original: new Float32Array(s.original), originalIdx: new Uint32Array(s.originalIdx), source: s.source };
        this.objects.set(s.id, obj);
        this.uploadNew(obj, { positions: new Float32Array(s.positions), indices: new Uint32Array(s.indices) }, s.style || RESTORATION_STYLE);
        if (obj.kind === "crown") await this.setupSegFromSaved(obj, s.seg);
        changed = true;
      }
    }
    if (this.crown && this.prep && this.margin) {
      this.ensureMesh(this.prep);
      this.applyJawParts(ops.segmentJaw(this.prep.mesh, this.margin, this.crown.frame));
    }
    // An axis the technician never set keeps following the margin, also after reopening.
    if (!this.axisUserSet && !this.crown && this.margin) { this.insertionAxis = null; this.followMarginAxis(this.margin); if (!this.insertionAxis) this.insertionAxis = saved.axis || (this.prep ? this.occlusalGuess() : null); }
    if (changed) this.io.toast("Restored your saved design edits for this case.");
  }

  async setupSegFromSaved(obj, savedSeg = null) {
    const seg = savedSeg?.intaglio?.length === obj.mesh.count ? savedSeg : ops.segmentCrown(obj.mesh);
    obj.seg = seg.rimLoop.length >= 16 ? seg : null;
    obj.intaglioBvh = obj.seg ? new BVH(obj.mesh.pos, obj.mesh.idx, obj.seg.inTris) : null;
    if (obj.seg) this.refreshWeights(obj);
    else obj.weights = { weight: new Float32Array(obj.mesh.count).fill(1), rimDist: new Float32Array(obj.mesh.count).fill(99) };
  }

  /** Throws away every edit in this case and returns to what was imported. */
  async discardDesign() {
    await this.io.clearDesign?.();
    this.stack = [];
    this.cursor = 0;
    for (const o of [...this.objects.values()]) {
      if (o.kind === "scan") continue;
      if (o.id.startsWith("cad:")) {
        this.objects.delete(o.id);
        this.viewer.removeMesh(o.vid);
      } else if (o.original.length === o.mesh.pos.length) {
        o.mesh.pos.set(o.original);
        this.geometryChanged(o, { commit: true });
      } else {
        this.uploadNew(o, { positions: o.original.slice(), indices: o.originalIdx.slice() }, RESTORATION_STYLE);
        await this.setupSegFromSaved(o);
      }
    }
    this.margins = new Map();
    this.savedTeeth = null;
    this.margin = this.marginOriginal?.map((p) => p.slice()) ?? null;
    this.marginCtrl = this.margin;
    this.marginTooth = this.margin && this.caseData.teeth?.length ? this.caseData.teeth[0] : null;
    if (Object.keys(this.teethData).length) this.identifyTeeth({ keepSaved: false });
    this.paintTeeth();
    this.selectedId = this.crown?.id ?? null;
    this.refreshMargin();
    this.afterHistory();
  }

  /* ------------------------------------------------------------- keyboard */

  bindKeys() {
    this.onKey = (e) => {
      if (this.disposed) return;
      if (this.busy) {
        if (e.key === "Escape") this.kernel.cancel();
        if ((e.ctrlKey || e.metaKey) && ["s", "e", "z", "y"].includes(e.key.toLowerCase())) e.preventDefault();
        return;
      }
      const typing = e.target.closest?.("input:not([type=range]), textarea, select, [contenteditable]");
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        if (typing) return;
        e.preventDefault();
        if (this.marginDraft?.length && !e.shiftKey) {
          this.undoMarginDraft();
          return;
        }
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && key === "y") {
        if (typing) return;
        e.preventDefault();
        this.redo();
        return;
      }
      if (mod && key === "e") {
        e.preventDefault();
        this.exportUnit();
        return;
      }
      if (mod && key === "s") {
        e.preventDefault();
        this.saveDesign();
        return;
      }
      if (typing || mod || e.altKey || document.querySelector("dialog[open]")) return;
      const tool = TOOLS.find((t) => t.key === key);
      if (tool && !e.shiftKey) {
        this.setTool(tool.id);
        e.preventDefault();
        return;
      }
      if (key === "x") {
        this.setCompare(this.compare === "original" ? "edited" : "original");
        e.preventDefault();
        return;
      }
      if (key === "escape") {
        if (this.marginDraft || this.pendingAutoSeed) this.cancelMarginDraft();
        this.measureDraft = [];
        this.pendingPontic = false;
        this.pendingAutoSeed = false;
        if (this.pendingTooth) { this.pendingTooth = null; this.renderPanel(); }
        this.viewer.render();
        return;
      }
      if (key === "enter" && this.marginDraft) {
        this.closeMarginDraft();
        e.preventDefault();
        return;
      }
      if (key === "backspace" && this.marginDraft?.length) {
        this.undoMarginDraft();
        e.preventDefault();
        return;
      }
      if ((key === "delete" || key === "backspace") && this.tool === "margin" && this.marginSel >= 0 && this.marginCtrl?.length > 4) {
        this.setControl(this.marginCtrl.filter((_, k) => k !== this.marginSel), "Delete margin point");
        e.preventDefault();
        return;
      }
      if (key === "[" || key === "]" || key === "{" || key === "}") {
        const up = key === "]" || key === "}";
        if (e.shiftKey) this.opts.strength = clamp(this.opts.strength + (up ? 0.05 : -0.05), 0.02, 1);
        else this.opts.radius = clamp(this.opts.radius * (up ? 1.12 : 1 / 1.12), 0.15, 6);
        this.renderPanel();
        this.viewer.render();
        e.preventDefault();
        return;
      }
      if (PAINT_TOOLS.includes(this.tool)) {
        const brush = BRUSHES.find((b) => b.key === key);
        if (brush) {
          this.opts.brush = brush.id;
          this.renderPanel();
          e.preventDefault();
          return;
        }
      }
      if (this.tool === "transform") {
        const fine = e.shiftKey ? 0.2 : 1;
        const mode = this.opts.gizmo;
        const unit = mode === "move" ? 0.05 * fine : mode === "rotate" ? ((1 * Math.PI) / 180) * fine : 0;
        const arrow = { arrowleft: [0, -1], arrowright: [0, 1], arrowup: [2, 1], arrowdown: [2, -1], pageup: [1, 1], pagedown: [1, -1] }[key];
        if (arrow) {
          if (mode === "scale") this.nudge(arrow[0], 1 + 0.01 * fine * arrow[1]);
          else this.nudge(arrow[0], unit * arrow[1]);
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", this.onKey);
  }

  /* ------------------------------------------------------------------ HUD */

  drawHud() {
    if (this.disposed) return;
    const c = this.hud;
    const ctx = c.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const project = (q) => this.viewer.projectToScreen(this.viewer.toWorld(q));
    if (PAINT_TOOLS.includes(this.tool) && this.hover?.hit) this.drawBrush(ctx, project);
    if (this.tool === "transform") this.drawGizmo(ctx);
    if (this.measures.length || this.measureDraft.length) this.drawMeasures(ctx, project);
    if (this.hover?.probe !== undefined && !Number.isNaN(this.hover.probe) && this.mapKind && !MAPS[this.mapKind].categories) {
      label(ctx, this.hover.x + 14, this.hover.y - 12, `${this.hover.probe.toFixed(3)} ${MAPS[this.mapKind].unit}`);
    }
    if (this.marginDrag && this.marginCtrl?.[this.marginDrag.i]) {
      const q = this.marginCtrl[this.marginDrag.i];
      const s = project(q);
      if (s) label(ctx, s.x + 12, s.y - 12, `Point ${this.marginDrag.i + 1} of ${this.marginCtrl.length}`);
    }
    if (this.tool === "margin" && this.marginDraft?.length) {
      const start = project(this.marginDraft[0]);
      if (start && !start.behind) {
        ctx.strokeStyle = "#ffe39a"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(start.x, start.y, 14, 0, Math.PI * 2); ctx.stroke();
        label(ctx, start.x + 19, start.y - 12, this.marginDraft.length >= 4 ? "Return here to close" : "Start point");
      }
    }
    if (this.hover?.handle !== undefined && this.marginCtrl?.[this.hover.handle]) {
      const s = project(this.marginCtrl[this.hover.handle]);
      if (s) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawBrush(ctx, project) {
    const { hit } = this.hover;
    const n = hit.normal;
    const u = V.norm(V.cross(n, Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
    const w = V.cross(n, u);
    const r = this.opts.radius;
    ctx.beginPath();
    let open = false;
    for (let k = 0; k <= 40; k++) {
      const th = (k / 40) * Math.PI * 2;
      const s = project(V.add(hit.point, V.add(V.mul(u, Math.cos(th) * r), V.mul(w, Math.sin(th) * r))));
      if (!s) continue;
      if (open) ctx.lineTo(s.x, s.y);
      else { ctx.moveTo(s.x, s.y); open = true; }
    }
    const kind = this.opts.brush;
    ctx.strokeStyle = kind === "remove" || kind === "groove" ? "#ff8a7a" : kind === "restore" ? "#6cb8dc" : "#b7f34a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const s = project(hit.point);
    if (s) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawGizmo(ctx) {
    const obj = this.gizmoObject();
    if (!obj) return;
    const g = this.gizmoScreen(obj);
    if (!g) return;
    const colors = ["#e57f9a", "#5fb4d9", "#b7f34a"];
    const active = this.xform ? this.xform.axis : this.hover?.gizmo ?? null;
    if (this.opts.gizmo === "rotate") {
      g.rings.forEach((pts, i) => {
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = active === i ? 3 : 1.6;
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      });
    } else {
      g.screens.forEach((s, i) => {
        ctx.strokeStyle = colors[i];
        ctx.fillStyle = colors[i];
        ctx.lineWidth = active === i ? 3.5 : 2;
        ctx.beginPath();
        ctx.moveTo(g.c.x, g.c.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        const a = Math.atan2(s.y - g.c.y, s.x - g.c.x);
        if (this.opts.gizmo === "scale") ctx.fillRect(s.x - 4.5, s.y - 4.5, 9, 9);
        else {
          ctx.beginPath();
          ctx.moveTo(s.x + Math.cos(a) * 9, s.y + Math.sin(a) * 9);
          ctx.lineTo(s.x + Math.cos(a + 2.5) * 8, s.y + Math.sin(a + 2.5) * 8);
          ctx.lineTo(s.x + Math.cos(a - 2.5) * 8, s.y + Math.sin(a - 2.5) * 8);
          ctx.fill();
        }
      });
    }
    ctx.fillStyle = "#f5f4ef";
    ctx.beginPath();
    ctx.arc(g.c.x, g.c.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMeasures(ctx, project) {
    const drawPts = (pts, text) => {
      const scr = pts.map(project);
      if (scr.some((s) => !s)) return;
      ctx.strokeStyle = "#ffe27a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      scr.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
      ctx.stroke();
      ctx.fillStyle = "#ffe27a";
      scr.forEach((s) => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      if (text) {
        const m = scr[Math.floor((scr.length - 1) / 2)];
        const n = scr[Math.ceil((scr.length - 1) / 2)];
        label(ctx, (m.x + n.x) / 2 + 8, (m.y + n.y) / 2 - 8, text);
      }
    };
    this.measures.forEach((m) => {
      const r = this.measureValue(m);
      if (r) drawPts(r.pts, r.value === null ? "no opposite wall" : `${r.value.toFixed(r.unit === "°" ? 1 : 3)} ${r.unit}`);
    });
    if (this.measureDraft.length) drawPts(this.measureDraft.map((r) => this.measurePoint(r)).filter(Boolean), null);
  }

  dispose() {
    this.toothCraftRequest?.abort();
    void this.saveDesign();
    this.disposed = true;
    this.kernel.dispose();
    this.session?.dispose();
    clearTimeout(this.saveTimer);
    clearTimeout(this.readoutTimer);
    if (this.marginPreviewFrame) cancelAnimationFrame(this.marginPreviewFrame);
    if (this.onKey) document.removeEventListener("keydown", this.onKey);
    const host = this.viewer.canvas?.parentElement;
    if (host && this.onDragOver) host.removeEventListener("dragover", this.onDragOver, true);
    if (host && this.onDropFile) host.removeEventListener("drop", this.onDropFile, true);
    this.viewer.tool = null;
    this.viewer.onFrame = null;
  }
}

/* ---------------------------------------------------------------- helpers */

const noSnap = { closest: () => null };

function label(ctx, x, y, text) {
  ctx.font = "500 11.5px Inter, sans-serif";
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = "rgba(11,17,20,0.9)";
  ctx.fillRect(x - 2, y - 11, w, 18);
  ctx.fillStyle = "#f5f4ef";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, x + 3, y - 2);
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

function centroid(pos) {
  const c = [0, 0, 0];
  for (let i = 0; i < pos.length; i += 3) { c[0] += pos[i]; c[1] += pos[i + 1]; c[2] += pos[i + 2]; }
  const n = pos.length / 3 || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
}

const centerOf = (pts) => pts.reduce((s, p) => V.add(s, p), [0, 0, 0]).map((x) => x / (pts.length || 1));

function centerOfVisible(obj, mesh) {
  // The gizmo sits at the bounding-box centre; for a whole jaw that is still a sensible pivot.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (mesh.pos[i + k] < lo[k]) lo[k] = mesh.pos[i + k];
      if (mesh.pos[i + k] > hi[k]) hi[k] = mesh.pos[i + k];
    }
  }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
}

function centerOfBounds(viewer) {
  const b = viewer.bounds;
  if (!b) return [0, 0, 0];
  return viewer.toModel([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
}

function defaultFrame(pos) {
  return defaultFrameAt(centroid(pos));
}

function defaultFrameAt(center) {
  return { center, occlusal: [0, 0, 1], facial: [0, 1, 0], mesial: [1, 0, 0], rimRadius: 4 };
}

const shiftFrame = (f, center) => ({ ...f, center });

function triNormalAt(mesh, tri) {
  const a = vertexAt(mesh.pos, mesh.idx[tri * 3]), b = vertexAt(mesh.pos, mesh.idx[tri * 3 + 1]), c = vertexAt(mesh.pos, mesh.idx[tri * 3 + 2]);
  return V.norm(V.cross(V.sub(b, a), V.sub(c, a)));
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Margin tube with small octahedral handles, as one mesh with per-vertex colours. */
function marginGeometry(pts, closed, handlePts, selected) {
  const handles = !!handlePts;
  const positions = [], normals = [], indices = [], colors = [];
  const tube = hexLin("#2fd2ff"), handle = hexLin("#f5f4ef"), sel = hexLin("#b7f34a");
  const n = pts.length;
  if (n < 2 && !handles) return { positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(), colors: new Float32Array() };
  const segs = closed ? n : n - 1;
  const R = 0.055, S = 6;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = V.norm(V.sub(b, a));
    const u = V.norm(V.cross(d, Math.abs(d[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
    const w = V.cross(d, u);
    const base = positions.length / 3;
    for (let s = 0; s < S; s++) {
      const th = (s / S) * Math.PI * 2;
      const nrm = V.add(V.mul(u, Math.cos(th)), V.mul(w, Math.sin(th)));
      for (const p of [a, b]) {
        positions.push(p[0] + nrm[0] * R, p[1] + nrm[1] * R, p[2] + nrm[2] * R);
        normals.push(...nrm);
        colors.push(...tube);
      }
    }
    for (let s = 0; s < S; s++) {
      const p = base + s * 2, q = base + ((s + 1) % S) * 2;
      indices.push(p, p + 1, q + 1, p, q + 1, q);
    }
  }
  if (handles) {
    const OCT = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const FACES = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    handlePts.forEach((p, i) => {
      const base = positions.length / 3;
      const r = i === selected ? 0.2 : handlePts.length < 60 ? 0.14 : 0.095;
      OCT.forEach((o) => {
        positions.push(p[0] + o[0] * r, p[1] + o[1] * r, p[2] + o[2] * r);
        normals.push(...o);
        colors.push(...(i === selected ? sel : handle));
      });
      FACES.forEach((f) => indices.push(base + f[0], base + f[1], base + f[2]));
    });
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices), colors: new Float32Array(colors) };
}
