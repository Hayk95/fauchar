import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Worker as NodeWorker } from "node:worker_threads";
import { test, after } from "node:test";
import { createCrown, profileForTooth } from "../lib/client/cad/crown-builder.js";
import { BVH, meshStats, parseBinarySTL, writeBinarySTL, V } from "../lib/client/cad/mesh.js";
import { WORKFLOW, initialStep, workflowProblem } from "../lib/client/cad/workflow.js";
import { KernelWorker } from "../lib/client/cad/worker-client.js";
import { runKernelTask } from "../lib/client/cad/kernel-tasks.js";
import { CadEditor } from "../lib/client/cad/editor.js";
import * as ops from "../lib/client/cad/ops.js";

const sample = new URL("../public/assets/sample/", import.meta.url);
const raw = readFileSync(new URL("demo-upper.stl", sample));
const scan = parseBinarySTL(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const design = JSON.parse(readFileSync(new URL("demo-22.json", sample), "utf8"));
const toScan = p => [p[0], -p[2], p[1]];
const payload = { ...scan, margin: design.margin.map(toScan), axis: toScan(design.frame.occlusal), tooth: 22 };
const workers = new Set();
class BrowserWorker {
  constructor() {
    this.worker = new NodeWorker(new URL("./fixtures/kernel-thread.mjs", import.meta.url));
    workers.add(this.worker);
    this.worker.on("message", data => this.onmessage?.({ data }));
    this.worker.on("error", error => this.onerror?.(error));
  }
  postMessage(message) { this.worker.postMessage(message); }
  terminate() { workers.delete(this.worker); void this.worker.terminate(); }
}
globalThis.Worker = BrowserWorker;
after(() => { for (const worker of workers) void worker.terminate(); });

test("crown starter is closed, oriented, small and exports without topology loss", () => {
  const t = performance.now();
  const result = createCrown(payload);
  const stats = meshStats(result.positions, result.indices);
  assert.equal(stats.closed, true); assert.equal(stats.invalid, 0); assert.equal(stats.degenerate, 0);
  assert.equal(stats.triangles, 9216); assert.ok(stats.volume > 10);
  let volume = 0;
  for (let i = 0; i < result.indices.length; i += 3) {
    const pts = Array.from(result.indices.subarray(i, i + 3), j => Array.from(result.positions.subarray(j * 3, j * 3 + 3)));
    volume += V.dot(pts[0], V.cross(pts[1], pts[2])) / 6;
  }
  assert.ok(volume > 0, "outer faces face outward");
  const roundTrip = parseBinarySTL(writeBinarySTL([result]));
  assert.equal(meshStats(roundTrip.positions, roundTrip.indices).closed, true);
  assert.equal(result.seg.intaglio.length, stats.vertices);
  assert.ok(result.seg.inTris.length > 1000);
  console.log(`Real scan starter: ${stats.triangles} triangles, ${(performance.now() - t).toFixed(0)} ms including STL round-trip`);
});

test("all original starter families work, including reversed margin winding", () => {
  for (const [profile, tooth] of [["anterior", 22], ["premolar", 24], ["molar", 26]]) {
    assert.equal(profileForTooth(tooth), profile);
    const result = createCrown({ ...payload, profile, tooth, margin: payload.margin.slice().reverse(), segments: 48, rings: 12 });
    assert.equal(result.stats.closed, true); assert.equal(result.stats.degenerate, 0);
  }
});

test("starter can be finished with anatomy and sculpting while preserving intaglio and rim", () => {
  const result = createCrown({ ...payload, segments: 48, rings: 12 });
  const mesh = ops.makeMesh(result.positions.slice(), result.indices);
  const before = mesh.pos.slice(), weights = ops.outerWeights(mesh, result.seg);
  ops.deformAnatomy(mesh, before, weights, result.frame, { height: 1.05, width: 1.02 });
  ops.refresh(mesh);
  const hit = mesh.bvh.raycast(V.add(result.frame.center, V.mul(result.frame.occlusal, 25)), V.mul(result.frame.occlusal, -1));
  assert.ok(hit);
  assert.equal(result.seg.intaglio[mesh.idx[hit.tri * 3]], 0, "brush hits the outer anatomy");
  ops.brushStamp(mesh, { kind: "add", hit, radius: 1.5, strength: 0.6, mask: weights.weight, scratch: ops.newScratch(mesh.count) });
  ops.refresh(mesh);
  assert.ok(mesh.pos.some((v, i) => Math.abs(v - before[i]) > 0.005), "finishing changes actual vertices");
  for (let v = 0; v < mesh.count; v++) if (result.seg.intaglio[v] || result.seg.rim.includes(v)) {
    assert.deepEqual(mesh.pos.subarray(v * 3, v * 3 + 3), before.subarray(v * 3, v * 3 + 3));
  }
  const output = parseBinarySTL(writeBinarySTL([{ positions: mesh.pos, indices: mesh.idx }]));
  assert.equal(meshStats(output.positions, output.indices).closed, true);
});

test("invalid or unsupported preparations fail explicitly", () => {
  assert.throws(() => createCrown({ ...payload, margin: [] }), /margin/);
  assert.throws(() => createCrown({ ...payload, axis: [0, 0, 0] }), /insertion/);
  assert.throws(() => createCrown({ ...payload, wall: NaN }), /dimensions/);
  assert.throws(() => createCrown({ ...payload, marginWall: 0.01 }), /dimensions/);
  assert.throws(() => createCrown({ ...payload, segments: 1000 }), /resolution/);
  assert.throws(() => createCrown({ ...payload, margin: payload.margin.map(p => p.map(v => v * 100)) }), /dimensions/);
  const folded = payload.margin.slice(); [folded[1], folded[20]] = [folded[20], folded[1]];
  assert.throws(() => createCrown({ ...payload, margin: folded }), /star-shaped/);
});

test("workflow gates incomplete geometry without inventing completed stages", () => {
  const ed = { scanObjects: [{}], workflow: {}, crown: null, margin: null, insertionAxis: null };
  assert.equal(initialStep(ed), "margin");
  assert.match(workflowProblem(ed, "bottom"), /margin/);
  ed.margin = payload.margin;
  assert.match(workflowProblem(ed, "bottom"), /insertion/);
  ed.insertionAxis = payload.axis;
  assert.equal(workflowProblem(ed, "bottom"), null);
  assert.match(workflowProblem(ed, "placement"), /crown/);
  ed.crown = {};
  for (const step of WORKFLOW) assert.equal(workflowProblem(ed, step.id), null);
  assert.equal(initialStep(ed), "freeform");
  ed.workflow.step = "review";
  assert.equal(initialStep(ed), "review");
});

test("real module worker returns geometry without detaching the editable scan", async () => {
  const kernel = new KernelWorker();
  try {
    const bytes = payload.positions.byteLength;
    const promise = kernel.run("crown", { ...payload, segments: 48, rings: 12 });
    await assert.rejects(kernel.run("crown", payload), /current CAD operation/);
    const result = await promise;
    assert.equal(result.stats.closed, true);
    assert.equal(payload.positions.byteLength, bytes);
    assert.ok(result.positions instanceof Float32Array);
    await assert.rejects(kernel.run("crown", { ...payload, axis: null }), /insertion/);
    const cancelled = kernel.run("crown", payload); kernel.cancel();
    await assert.rejects(cancelled, /cancelled/);
    assert.equal((await kernel.run("crown", { ...payload, segments: 48, rings: 12 })).stats.closed, true);
  } finally { kernel.dispose(); }
});

test("merge task preserves geometry and enforces its memory budget", async () => {
  const result = createCrown({ ...payload, segments: 48, rings: 12 });
  const kernel = new KernelWorker();
  try {
    const merged = await kernel.run("merge", { meshes: [result], voxel: 0.15 });
    assert.equal(merged.stats.closed, true); assert.equal(merged.stats.invalid, 0);
    assert.ok(result.positions.byteLength > 0);
    assert.throws(() => runKernelTask("merge", { meshes: [result], voxel: 0 }), /resolution/);
    assert.throws(() => runKernelTask("merge", { meshes: [{ positions: new Float32Array([0, 0, 0, 1000, 1000, 1000]), indices: new Uint32Array() }], voxel: 0.05 }), /memory budget/);
  } finally { kernel.dispose(); }
});

function mockViewer() {
  return { meshes: new Map(), setLineLayer() {}, setVisible() {}, setMeshGroups() {}, refreshBounds() {}, clearVertexColors() {}, render() {},
    addMesh(id, mesh, style) { this.meshes.set(id, { ...mesh, style }); }, removeMesh(id) { this.meshes.delete(id); },
    updateMeshGeometry(id, positions, normals) { Object.assign(this.meshes.get(id), { positions, normals }); } };
}

test("scan-only editor builds a crown through its actual background operation", async () => {
  const viewer = mockViewer();
  const messages = [];
  const ed = new CadEditor({ viewer, caseData: { id: "BUILD", teeth: [22] }, io: { toast(message) { messages.push(message); } } });
  const prep = { id: "prep", vid: "prep", kind: "scan", jaw: "upper", lazy: { positions: scan.positions, indices: scan.indices }, visible: true };
  ed.objects.set(prep.id, prep); ed.scanObjects = [prep]; ed.prep = prep;
  ed.margin = payload.margin; ed.marginTooth = 22; ed.insertionAxis = payload.axis;
  // No DOM or camera is needed to exercise scan -> worker -> editable objects.
  ed.renderPanel = () => {}; ed.renderRibbon = () => {}; ed.refreshMap = () => {}; ed.updateSection = () => {};
  ed.setTool = () => {}; ed.focusCrown = () => {};
  try {
    await ed.createRestoration();
    assert.ok(ed.crown, "restoration created from scan-only case");
    assert.equal(ed.busy, false);
    assert.equal(meshStats(ed.crown.mesh.pos, ed.crown.mesh.idx).closed, true);
    assert.ok(ed.prepBvh, `generated restoration is related to its preparation: ${messages.join("; ")}`);
    assert.ok(ed.prep.prepVerts.length > 500, "the actual preparation was segmented");
    assert.equal(ed.stack.length, 1);
    assert.equal(ed.crown.seg.intaglio.length, ed.crown.mesh.count);
    assert.equal(scan.positions.byteLength, payload.positions.byteLength);
    assert.ok(viewer.meshes.has(ed.crown.id));
  } finally { clearTimeout(ed.saveTimer); ed.kernel.dispose(); }
});

test("generated crown remains editable, undoable and restorable after reopening", async () => {
  const result = createCrown({ ...payload, segments: 48, rings: 12 });
  let saved;
  const viewer = mockViewer();
  const ed = new CadEditor({ viewer, caseData: { id: "TEST", teeth: [22] }, io: { toast() {}, saveDesign: async value => { saved = structuredClone(value); } } });
  ed.scanObjects = [];
  const obj = { id: "cad:crown-1", kind: "crown", name: "Crown 22", frame: result.frame, source: result.source };
  ed.addObject(obj, result, {}); obj.seg = result.seg;
  obj.intaglioBvh = new BVH(obj.mesh.pos, obj.mesh.idx, obj.seg.inTris); ed.refreshWeights(obj);
  ed.selectedId = obj.id;
  // Keep UI painting outside this headless test; history, buffers and persistence remain real.
  ed.renderPanel = () => {}; ed.renderRibbon = () => {}; ed.refreshMap = () => {}; ed.updateSection = () => {}; ed.updateGhost = () => {};
  ed.pushObject(obj, "Create crown", true, {});
  ed.undo(); assert.equal(ed.crown, null);
  ed.redo(); assert.equal(ed.crown.id, obj.id);
  ed.workflow = { mode: "expert", step: "review" }; ed.margin = payload.margin; ed.insertionAxis = payload.axis;
  ed.opts.cement.gap = 0.08;
  await ed.saveDesign(); clearTimeout(ed.saveTimer);
  const reopened = new CadEditor({ viewer: mockViewer(), caseData: { id: "TEST", teeth: [22] }, io: { toast() {}, loadDesign: async () => saved } });
  reopened.scanObjects = [];
  await reopened.restoreDesign();
  assert.equal(reopened.crown.seg.inTris.length, obj.seg.inTris.length);
  assert.equal(reopened.crown.source.type, "procedural-starter");
  assert.deepEqual(reopened.crown.mesh.pos, obj.mesh.pos);
  assert.equal(reopened.opts.cement.gap, 0.08);
  assert.equal(initialStep(reopened), "review");
  assert.ok(reopened.crown.weights.weight.some(v => v > 0));
});

test("all original morphology styles change only the outer shape and preserve closed topology", async () => {
  const { ANATOMY_STYLES, morphologyForTooth, anatomyHeight } = await import("../lib/client/cad/anatomy-library.js");
  assert.equal(morphologyForTooth(46), "lower-molar");
  assert.equal(morphologyForTooth(16), "upper-molar");
  const shapes = [];
  let baseline;
  for (const anatomyStyle of Object.keys(ANATOMY_STYLES)) {
    const result = createCrown({ ...payload, anatomyStyle, segments: 48, rings: 12 });
    assert.equal(result.stats.closed, true); assert.equal(result.stats.degenerate, 0);
    const inner = [...result.seg.intaglio].flatMap((yes,i) => yes ? [...result.positions.slice(i*3,i*3+3)] : []);
    if (baseline) assert.deepEqual(inner, baseline); else baseline = inner;
    shapes.push([...result.positions].join(","));
    for (const fdi of [11, 13, 14, 16, 36, 46]) assert.ok(Number.isFinite(anatomyHeight(fdi, anatomyStyle, .2, -.3)));
  }
  assert.equal(new Set(shapes).size, 4, "styles change the actual generated mesh");
  assert.throws(() => createCrown({ ...payload, anatomyStyle: "unknown" }), /anatomy style/);
});

test("tooth library lifts a full anatomic crown off the margin and keeps the preparation side", async () => {
  const { TOOTH_LIBRARY, libraryHeightMm } = await import("../lib/client/cad/anatomy-library.js");
  const plain = createCrown({ ...payload, tooth: 46, segments: 48, rings: 12 });
  const heightOf = (mesh) => {
    const z = mesh.frame.occlusal, c = mesh.frame.center;
    let max = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (mesh.seg.intaglio[i / 3]) continue;
      const h = (mesh.positions[i] - c[0]) * z[0] + (mesh.positions[i + 1] - c[1]) * z[1] + (mesh.positions[i + 2] - c[2]) * z[2];
      if (h > max) max = h;
    }
    return max;
  };
  const plainInner = [...plain.seg.intaglio].flatMap((yes, i) => yes ? [...plain.positions.slice(i * 3, i * 3 + 3)] : []);
  const plainHeight = heightOf(plain);
  const shapes = [];
  for (const item of TOOTH_LIBRARY) {
    const result = createCrown({ ...payload, tooth: 46, libraryId: item.id, relief: 1, segments: 48, rings: 12 });
    assert.equal(result.stats.closed, true);
    assert.equal(result.stats.degenerate, 0);
    assert.equal(result.source.type, "anatomic-library");
    assert.equal(result.source.libraryId, item.id);
    const inner = [...result.seg.intaglio].flatMap((yes, i) => yes ? [...result.positions.slice(i * 3, i * 3 + 3)] : []);
    assert.deepEqual(inner, plainInner);
    shapes.push([...result.positions].join(","));
    if (item.id === "standard") {
      assert.ok(heightOf(result) > plainHeight + 1.4, "the library tooth stands above the smooth shell");
      const z = result.frame.occlusal, c = result.frame.center;
      let cusp = -Infinity, fossa = -Infinity;
      for (let i = 0; i < result.positions.length; i += 3) {
        if (result.seg.intaglio[i / 3]) continue;
        const p = [result.positions[i], result.positions[i + 1], result.positions[i + 2]];
        const h = (p[0] - c[0]) * z[0] + (p[1] - c[1]) * z[1] + (p[2] - c[2]) * z[2];
        const radial = Math.hypot(p[0] - c[0] - z[0] * h, p[1] - c[1] - z[1] * h, p[2] - c[2] - z[2] * h);
        if (h > cusp) cusp = h;
        if (radial < 0.35 && h > fossa) fossa = h;
      }
      assert.ok(cusp > fossa + 1.2, "cusps stand above the central groove");
      const rimR = result.frame.rimRadius;
      let wide = 0, seen = 0;
      for (let i = 0; i < result.positions.length; i += 3) {
        if (result.seg.intaglio[i / 3]) continue;
        const p = [result.positions[i], result.positions[i + 1], result.positions[i + 2]];
        const h = (p[0] - c[0]) * z[0] + (p[1] - c[1]) * z[1] + (p[2] - c[2]) * z[2];
        if (h < cusp * .28 || h > cusp * .55) continue;
        const radial = Math.hypot(p[0] - c[0] - z[0] * h, p[1] - c[1] - z[1] * h, p[2] - c[2] - z[2] * h);
        if (radial > rimR * .72) wide++;
        seen++;
      }
      assert.ok(seen > 20 && wide / seen > .6, "the sides stay wide instead of falling to a point");
    }
  }
  assert.equal(new Set(shapes).size, TOOTH_LIBRARY.length, "each library form changes the mesh");
  assert.ok(libraryHeightMm(46, "youthful", .32, -.35) > libraryHeightMm(46, "worn", .32, -.35) + 1);
  assert.throws(() => createCrown({ ...payload, libraryId: "copied" }), /tooth library/);
});

test("a dropped tooth STL is seated on the margin, cervix down", async () => {
  const { canonicalTooth } = await import("../lib/client/cad/tooth-forms.js");
  const { seatTooth } = await import("../lib/client/cad/seat-tooth.js");
  const tooth = canonicalTooth(46, 48);
  const margin = Array.from({ length: 48 }, (_, i) => {
    const a = i / 48 * Math.PI * 2;
    return [Math.cos(a) * 4.5, Math.sin(a) * 3.6, 0];
  });
  const check = (positions) => {
    const seated = seatTooth(positions, margin, [0, 0, 1]);
    let low = Infinity, high = -Infinity, n = 0, radial = 0;
    const heights = [];
    for (let i = 0; i < seated.positions.length; i += 3) {
      const z = seated.positions[i + 2];
      heights.push(z);
      if (z < low) low = z;
      if (z > high) high = z;
    }
    heights.sort((a, b) => a - b);
    const cut = heights[Math.floor(heights.length * 0.08)];
    for (let i = 0; i < seated.positions.length; i += 3) {
      if (seated.positions[i + 2] > cut) continue;
      radial += Math.hypot(seated.positions[i], seated.positions[i + 1]);
      n++;
    }
    assert.ok(Math.abs(low) < 0.4, `cervix height ${low}`);
    assert.ok(high > 3, `occlusal height ${high}`);
    assert.ok(Math.abs(radial / n - 4) < 0.8, `cervical radius ${radial / n}`);
  };
  check(tooth.positions);
  const moved = new Float32Array(tooth.positions.length);
  for (let i = 0; i < tooth.positions.length; i += 3) {
    const x = tooth.positions[i], y = tooth.positions[i + 1], z = tooth.positions[i + 2];
    moved[i] = x + 40;
    moved[i + 1] = -z - 25;
    moved[i + 2] = y + 12;
  }
  check(moved);
});

test("every adult tooth has its own closed anatomic form", async () => {
  const { canonicalTooth, toothSpec } = await import("../lib/client/cad/tooth-forms.js");
  for (const q of [1, 2, 3, 4]) for (let n = 1; n <= 8; n++) {
    const tooth = canonicalTooth(q * 10 + n, 48);
    assert.equal(tooth.stats.closed, true);
    assert.equal(tooth.stats.degenerate, 0);
    assert.ok(tooth.stats.volume > 30, `${q * 10 + n} volume`);
  }
  assert.ok(toothSpec(11).md > toothSpec(41).md);
  assert.notEqual(toothSpec(13).kind, toothSpec(46).kind);
});

test("user library validates actual STL geometry and rejects unsafe imports", async () => {
  const { validateLibraryMesh } = await import("../lib/client/cad/restoration-library.js");
  const crown = createCrown({ ...payload, segments: 48, rings: 12 });
  const buffer = writeBinarySTL([crown], "User library test");
  const result = validateLibraryMesh(buffer);
  assert.equal(result.stats.closed, true);
  assert.throws(() => validateLibraryMesh(new ArrayBuffer(21*1024*1024)), /20 MB/);
  assert.throws(() => validateLibraryMesh(new ArrayBuffer(0)));
  const open = writeBinarySTL([{ positions: new Float32Array([0,0,0,1,0,0,0,1,0]), indices: new Uint32Array([0,1,2]) }]);
  assert.throws(() => validateLibraryMesh(open), /closed/);
});

test("ToothCraft transports a local STL and returns it to the scan frame", async () => {
  const { scanContext, requestToothCraft } = await import("../lib/client/cad/toothcraft.js");
  const context = scanContext(scan, payload.margin, payload.axis);
  const local = parseBinarySTL(context.buffer);
  assert.ok(local.indices.length > 0 && local.indices.length < scan.indices.length);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "http://127.0.0.1:7861/complete");
      assert.equal(options.body, context.buffer);
      return new Response(context.buffer);
    };
    const result = await requestToothCraft(context);
    const scanVertices = new Set();
    for (let i = 0; i < scan.positions.length; i += 3) scanVertices.add(Array.from(scan.positions.subarray(i,i+3), v => v.toFixed(2)).join(","));
    let recovered = 0;
    for (let i = 0; i < result.positions.length; i += 3) recovered += scanVertices.has(Array.from(result.positions.subarray(i,i+3), v => v.toFixed(2)).join(","));
    assert.ok(recovered > result.positions.length / 3 * .99);
  } finally { globalThis.fetch = original; }
});

test("every library tooth STL is one open crown shell with a consistent arch frame", async () => {
  const { shellRim } = await import("../lib/client/cad/tooth-library-stl.js");
  const { TOOTH_ATLAS } = await import("../lib/client/cad/tooth-atlas.js");
  for (const q of [1, 2, 3, 4]) for (let n = 1; n <= 8; n++) {
    const fdi = q * 10 + n, a = TOOTH_ATLAS[fdi];
    const buf = readFileSync(new URL(`../public/assets/teeth/${fdi}.stl`, import.meta.url));
    const shell = parseBinarySTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.ok(shellRim(shell.positions, shell.indices).loop.length >= 60, `${fdi} cervical edge`);
    assert.ok(Math.abs(V.dot(a.mesial, a.occlusal)) < 1e-3 && Math.abs(V.dot(a.facial, a.occlusal)) < 1e-3, `${fdi} frame`);
    // Upper crowns point down to the occlusal plane, lower ones up; mesial runs toward the midline (x = 0) or across it for centrals.
    assert.equal(Math.sign(a.occlusal[2]), q <= 2 ? -1 : 1, `${fdi} occlusal`);
    if (n > 1) assert.ok(a.mesial[0] * a.centroid[0] < 0, `${fdi} mesial ${a.mesial}`);
    assert.ok(a.md > 4 && a.md < 13 && a.bl > 4 && a.bl < 13, `${fdi} size`);
  }
});

test("library tooth 22 is fitted on the real scan: closed, on the margin, thick enough, close to the reference crown", async () => {
  const { fitLibraryCrown } = await import("../lib/client/cad/tooth-library-stl.js");
  const read = name => { const b = readFileSync(new URL(name, import.meta.url)); return parseBinarySTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const shell = read("../public/assets/teeth/22.stl");
  const result = runKernelTask("crown-stl", { ...payload, shell, libFrame: null });
  assert.equal(result.stats.closed, true); assert.equal(result.stats.invalid, 0); assert.ok(result.stats.volume > 50);
  assert.equal(result.source.type, "anatomic-stl"); assert.ok(result.source.space.md > 5 && result.source.space.md < 8);
  let worst = 0;
  for (const v of result.seg.rimLoop) {
    const p = [result.positions[v * 3], result.positions[v * 3 + 1], result.positions[v * 3 + 2]];
    worst = Math.max(worst, Math.min(...payload.margin.map(m => V.dist(p, m))));
  }
  assert.ok(worst < 0.2, `rim ${worst}`);
  const mesh = ops.makeMesh(result.positions, result.indices);
  const thick = ops.thicknessMap(mesh, result.seg, new BVH(result.positions, result.indices, result.seg.inTris));
  assert.ok(thick.min > 0.75, `wall ${thick.min}`);
  const ref = read("../public/assets/sample/demo-crown-22.stl");
  const refBvh = new BVH(ref.positions, ref.indices);
  let sum = 0, n = 0;
  for (let v = 0; v < mesh.count; v += 3) if (!result.seg.intaglio[v]) { const c = refBvh.closest([mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2]], 6); if (c) { sum += c.d; n++; } }
  assert.ok(sum / n < 0.8, `mean distance to the reference crown ${sum / n}`);
  const back = parseBinarySTL(writeBinarySTL([result]));
  assert.equal(meshStats(back.positions, back.indices).closed, true);
  assert.throws(() => fitLibraryCrown({ ...payload, shell, relief: 5 }), /range/);
});

test("library tooth 46 on the lower partial arch finds both neighbours and points mesial along the arch", async () => {
  const read = name => { const b = readFileSync(new URL(name, import.meta.url)); return parseBinarySTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const scan46 = read("../public/assets/sample/sample-lower-scan.stl");
  const jaw = ops.makeMesh(scan46.positions, scan46.indices);
  const top = jaw.bvh.raycast([-21.3, 40, -28.3], [0, -1, 0]).point;
  const margin = ops.detectMargin(jaw.bvh, top, [0, 1, 0]);
  const result = runKernelTask("crown-stl", { ...scan46, margin, axis: [0, 1, 0], tooth: 46, shell: read("../public/assets/teeth/46.stl") });
  assert.equal(result.stats.closed, true);
  assert.ok(result.source.space.mesial && result.source.space.distal, "both neighbours");
  assert.ok(Math.abs(result.source.space.md - 11) < 1.5, `gap ${result.source.space.md}`);
  // In this fixture the arch runs along +Z toward the front and 46 sits at negative X.
  assert.ok(result.frame.mesial[2] > 0.8, `mesial ${result.frame.mesial}`);
  assert.ok(result.frame.facial[0] < -0.8, `facial ${result.frame.facial}`);
});

test("tooth 22 placed by the library arch fitted to its neighbours matches the exocad crown of the case", async () => {
  const { detectTeeth } = await import("../lib/client/cad/teeth.js");
  const read = name => { const b = readFileSync(new URL(name, import.meta.url)); return parseBinarySTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const model = detectTeeth(scan.positions, scan.indices, "upper", { occlusal: [0, 0, -1] });
  const arch = { occlusal: model.occlusal, teeth: model.teeth.map(({ fdi, center, stump, partial, confidence }) => ({ fdi, center, stump, partial, confidence })) };
  const result = runKernelTask("crown-stl", { ...payload, shell: read("../public/assets/teeth/22.stl"), libFrame: null, arch });
  assert.match(result.source.placement, /^arch fit to/);
  assert.equal(result.stats.closed, true);
  const ref = read("../public/assets/sample/demo-crown-22.stl");
  const mean = (from, to) => { let s = 0, n = 0; for (let v = 0; v < from.length / 3; v += 3) { const c = to.closest([from[v * 3], from[v * 3 + 1], from[v * 3 + 2]], 8); if (c) { s += c.d; n++; } } return s / n; };
  const outer = new BVH(result.positions, result.indices, result.seg.outTris);
  const outerPos = Float32Array.from(result.seg.outTris.flatMap(t => [0, 1, 2].flatMap(k => { const v = result.indices[t * 3 + k]; return [result.positions[v * 3], result.positions[v * 3 + 1], result.positions[v * 3 + 2]]; })));
  assert.ok(mean(outerPos, new BVH(ref.positions, ref.indices)) < 0.45, "our surface stays on the exocad crown");
  assert.ok(mean(ref.positions, outer) < 0.6, "the exocad crown is covered by ours");
  // A clean surface: no folded sheets (a fold multiplies the area).
  assert.ok(result.stats.area < 340, `area ${result.stats.area}`);
  assert.ok(result.stats.volume > 60 && result.stats.volume < 160, `volume ${result.stats.volume}`);
});

test("the original library tooth is placed unchanged, moved by hand, and only cut at the margin on OK", async () => {
  const read = name => { const b = readFileSync(new URL(name, import.meta.url)); return parseBinarySTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const shell = read("../public/assets/teeth/22.stl");
  const placed = runKernelTask("tooth-place", { ...payload, shell, libFrame: null });
  assert.equal(placed.source.type, "tooth-setup");
  assert.equal(placed.indices.length, shell.indices.length, "same triangles as the library file");
  // Unchanged shape: every edge keeps its length up to one uniform scale.
  const edge = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const ratios = [];
  for (let t = 0; t < shell.indices.length; t += 997) ratios.push(edge(placed.positions, shell.indices[t], shell.indices[t + 1]) / edge(shell.positions, shell.indices[t], shell.indices[t + 1]));
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 1e-3, "rigid placement with one scale");
  // The technician lifts it 0.4 mm along the occlusal direction, then presses OK.
  const moved = placed.positions.slice();
  for (let i = 0; i < moved.length; i += 3) for (let k = 0; k < 3; k++) moved[i + k] += placed.frame.occlusal[k] * 0.4;
  const crown = runKernelTask("crown-stl", { ...payload, shell, libFrame: null, placedWorld: moved, placedFrame: placed.frame });
  assert.equal(crown.stats.closed, true);
  assert.equal(crown.source.placement, "placed by you");
  const outer = new BVH(crown.positions, crown.indices, crown.seg.outTris);
  let top = -Infinity, near = 0, n = 0;
  for (let i = 0; i < moved.length; i += 30) {
    const p = [moved[i], moved[i + 1], moved[i + 2]];
    top = Math.max(top, V.dot(p, placed.frame.occlusal));
    const c = outer.closest(p, 3);
    if (c && V.dot(V.sub(p, placed.frame.center), placed.frame.occlusal) > 3) { near += c.d; n++; }
  }
  assert.ok(near / n < 0.25, `the crown keeps the placed anatomy above the cervical third (${(near / n).toFixed(2)} mm)`);
});

test("a case-file crown that was replaced does not come back next to the new crown on reopen", async () => {
  const viewer = mockViewer();
  const fileCrown = { id: "demo-crown", vid: "demo-crown", kind: "crown", fromFile: true, name: "Crown 22", visible: true };
  viewer.meshes.set("demo-crown", {});
  const replaced = createCrown({ ...payload, segments: 48, rings: 12 });
  const saved = { version: 1, objects: [{ id: "cad:crown-2", kind: "crown", name: "Crown 22", frame: replaced.frame, positions: replaced.positions, indices: replaced.indices, original: replaced.positions, originalIdx: replaced.indices, seg: replaced.seg, source: replaced.source, style: null }] };
  const ed = new CadEditor({ viewer, caseData: { id: "DEMO", teeth: [22] }, io: { toast() {}, loadDesign: async () => saved } });
  ed.objects.set(fileCrown.id, fileCrown); ed.scanObjects = [];
  await ed.restoreDesign();
  const crowns = [...ed.objects.values()].filter(o => o.kind === "crown");
  assert.deepEqual(crowns.map(o => o.id), ["cad:crown-2"]);
  assert.equal(viewer.meshes.has("demo-crown"), false);
  // A save that still lists the file crown keeps it.
  const keep = new CadEditor({ viewer: mockViewer(), caseData: { id: "DEMO", teeth: [22] }, io: { toast() {}, loadDesign: async () => ({ version: 1, objects: [] }) } });
  keep.objects.set(fileCrown.id, { ...fileCrown }); keep.scanObjects = [];
  await keep.restoreDesign();
  assert.equal(keep.objects.has("demo-crown"), false, "an empty save after removal drops it too");
});

test("an older save holding the case-file crown and its replacement keeps only the replacement", async () => {
  const viewer = mockViewer();
  const replaced = createCrown({ ...payload, segments: 48, rings: 12 });
  const item = (id) => ({ id, kind: "crown", name: "Crown 22", frame: replaced.frame, positions: replaced.positions, indices: replaced.indices, original: replaced.positions, originalIdx: replaced.indices, seg: replaced.seg, source: replaced.source, style: null });
  const ed = new CadEditor({ viewer, caseData: { id: "DEMO", teeth: [22] }, io: { toast() {}, loadDesign: async () => ({ version: 1, objects: [item("demo-crown"), item("cad:crown-5")] }) } });
  const fileCrown = { id: "demo-crown", vid: "demo-crown", kind: "crown", fromFile: true, name: "Crown 22", visible: true };
  ed.addObject(fileCrown, { positions: replaced.positions.slice(), indices: replaced.indices.slice() }, {});
  fileCrown.fromFile = true; fileCrown.frame = replaced.frame; ed.scanObjects = [];
  await ed.restoreDesign();
  assert.deepEqual([...ed.objects.values()].filter(o => o.kind === "crown").map(o => o.id), ["cad:crown-5"]);
});

test("Find margin measures the preparation's own axis and lands on the exocad margin of the case", async () => {
  const { detectTeeth } = await import("../lib/client/cad/teeth.js");
  const mesh = ops.makeMesh(scan.positions, scan.indices);
  const c = V.mul(payload.margin.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / payload.margin.length);
  const top = mesh.bvh.raycast(V.add(c, V.mul(payload.axis, 15)), V.mul(payload.axis, -1)).point;
  // Start from the jaw's occlusal direction, 23° off this inclined incisor.
  let axis = detectTeeth(scan.positions, scan.indices, "upper", { occlusal: [0, 0, -1] }).occlusal;
  for (let pass = 0; pass < 3; pass++) axis = ops.preparationAxis(mesh, top, axis);
  const tilt = Math.acos(V.dot(axis, V.norm(payload.axis))) * 180 / Math.PI;
  assert.ok(tilt < 5, `preparation axis ${tilt.toFixed(1)}° from exocad's`);
  const raw = ops.detectMargin(mesh.bvh, top, axis);
  const ref = ops.resampleLoop(payload.margin, 400);
  const d = ops.resampleLoop(raw, 200).map(p => Math.min(...ref.map(q => V.dist(p, q)))).sort((a, b) => a - b);
  assert.ok(d.reduce((s, x) => s + x, 0) / d.length < 0.1, `mean ${d.reduce((s, x) => s + x, 0) / d.length}`);
  assert.ok(d[d.length - 1] < 0.35, `max ${d[d.length - 1]}`);
});

/* ---- inside of the crown: undercut block-out and milling-tool compensation */
const revolve = (profile, n = 120) => {
  const pos = [], idx = [];
  for (const [r, h] of profile) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pos.push(r * Math.cos(a), r * Math.sin(a), h); }
  for (let p = 0; p + 1 < profile.length; p++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = p * n + i, b = p * n + j, c = (p + 1) * n + j, d = (p + 1) * n + i;
    idx.push(a, b, c, a, c, d);
  }
  const top = pos.length / 3; pos.push(0, 0, profile[profile.length - 1][1]);
  const last = (profile.length - 1) * n;
  for (let i = 0; i < n; i++) idx.push(last + i, last + (i + 1) % n, top);
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
};
const dieMargin = r => Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a), 0]; });

async function shapedRings(scan, margin, options) {
  const { buildIntaglioRings, shapeIntaglio } = await import("../lib/client/cad/intaglio.js");
  const { preparationFrame } = await import("../lib/client/cad/crown-builder.js");
  const { z, center, loop, sample } = preparationFrame({ ...scan, margin, axis: [0, 0, 1], segments: 96 });
  const vertices = [], triangles = [], faceIn = [];
  const push = p => { const id = vertices.length / 3; vertices.push(p[0], p[1], p[2]); return id; };
  const addTri = (a, b, c, inside) => { triangles.push(a, b, c); faceIn.push(inside ? 1 : 0); };
  const built = buildIntaglioRings({ loop, center, z, sample, rings: 24, segments: 96, gap: 0.06, marginGap: 0.02, push, addTri });
  const report = shapeIntaglio({ vertices, ...built, loop, center, z, scan: new BVH(scan.positions, scan.indices), gap: 0.06, marginGap: 0.02, options });
  const radius = (r, i) => { const id = built.inner[r][i]; return Math.hypot(vertices[id * 3], vertices[id * 3 + 1]); };
  const height = (r, i) => vertices[built.inner[r][i] * 3 + 2];
  const minRing = r => Math.min(...Array.from({ length: 96 }, (_, i) => radius(r, i)));
  return { report, radius, height, minRing, loop };
}

test("block-out opens the intaglio over an undercut die, with angle and untouchable zone", async () => {
  // Die of revolution: margin r=4 at h=0, bulges to 4.4 at h=1, tapers to 2.6, flat top; gingiva flares below.
  const die = revolve([[6, -1.5], [4, 0], [4.25, 0.4], [4.4, 1], [4.3, 1.6], [3.8, 2.5], [3.2, 4], [2.6, 5.5], [1.2, 5.6]]);
  const margin = dieMargin(4);
  const off = await shapedRings(die, margin, { blockout: false, toolCompensation: false });
  assert.equal(off.report.blockout, null);
  assert.ok(Math.abs(off.minRing(0) - 4.02) < 0.01, `untouched edge ${off.minRing(0)}`);
  // Sampled from above, the wall jumps from the margin straight to the taper: it would cut through the bulge.
  assert.ok(off.height(1, 0) > 2 && off.radius(1, 0) < 4, `ring 1 at h ${off.height(1, 0)} r ${off.radius(1, 0)}`);

  const on = await shapedRings(die, margin, { blockout: true, blockoutAngle: 0, blockoutZone: 0, toolCompensation: false });
  assert.ok(on.report.blockout.maxDepth > 0.35 && on.report.blockout.maxDepth < 0.5, `depth ${on.report.blockout.maxDepth}`);
  assert.ok(on.report.blockout.fraction > 0.95);
  assert.ok(on.minRing(0) >= 4.41, `edge opened to the bulge ${on.minRing(0)}`);
  assert.ok(Math.hypot(on.loop[0][0], on.loop[0][1]) > 4.39, "the margin loop follows the opened edge");
  assert.ok(on.radius(1, 0) < 4 && Math.abs(on.radius(1, 0) - off.radius(1, 0)) < 0.05, "the taper above the bulge is untouched");

  const angled = await shapedRings(die, margin, { blockout: true, blockoutAngle: 5, blockoutZone: 0, toolCompensation: false });
  assert.ok(angled.minRing(0) >= 4.41 + Math.tan((5 * Math.PI) / 180) * 0.95, `flared edge ${angled.minRing(0)}`);

  const zoned = await shapedRings(die, margin, { blockout: true, blockoutAngle: 0, blockoutZone: 0.5, toolCompensation: false });
  assert.ok(Math.abs(zoned.minRing(0) - 4.02) < 0.01, `zone keeps the edge on the margin ${zoned.minRing(0)}`);
  assert.ok(zoned.report.blockout.maxDepth < on.report.blockout.maxDepth);

  const { intaglioOptions } = await import("../lib/client/cad/intaglio.js");
  assert.throws(() => intaglioOptions({ toolDiameter: 5 }), /range/);
  assert.throws(() => intaglioOptions({ blockoutAngle: 30 }), /range/);
});

test("milling relief widens the sharp internal corner a ball tool cannot reach and leaves the wall alone", async () => {
  // Tapered die with a sharp axio-occlusal line angle at (2.6, 4.5).
  const die = revolve([[6, -1.5], [3, 0], [2.6, 4.5], [0.6, 4.5]]);
  const margin = dieMargin(3);
  const off = await shapedRings(die, margin, { blockout: true, toolCompensation: false });
  const on = await shapedRings(die, margin, { blockout: true, toolCompensation: true, toolDiameter: 1 });
  assert.ok(on.report.tool.maxRelief > 0.03 && on.report.tool.maxRelief <= 0.5, `relief ${on.report.tool.maxRelief}`);
  // Rings 1–3 lie on the taper; ring 3 sits just under the corner and must open, ring 1 far below must not.
  assert.ok(on.height(3, 0) > 3.9 && on.height(3, 0) < 4.6, `ring 3 height ${on.height(3, 0)}`);
  assert.ok(on.radius(3, 0) - off.radius(3, 0) > 0.02, `corner relief ${on.radius(3, 0) - off.radius(3, 0)}`);
  assert.ok(on.height(1, 0) < 2 && Math.abs(on.radius(1, 0) - off.radius(1, 0)) < 0.005, "wall far from the corner unchanged");
  // A vertex on the flat top at the same height as the corner is not the envelope and stays put.
  assert.ok(Math.abs(on.radius(6, 0) - off.radius(6, 0)) < 1e-6);
  // A chamfer die that is wider just above the drawn margin: relief must not fold the inside over the edge.
  const lip = revolve([[6, -1.5], [3, 0], [3.15, 0.2], [3.1, 0.6], [2.6, 4.5], [0.6, 4.5]]);
  const lipped = await shapedRings(lip, margin, { blockout: true, toolCompensation: true, toolDiameter: 1 });
  for (let i = 0; i < 96; i += 7) {
    let widest = lipped.radius(0, i);
    for (let r = 1; r < lipped.rings; r++) { assert.ok(lipped.radius(r, i) <= widest + 0.05, `fold at ring ${r}: ${lipped.radius(r, i)} over ${widest}`); widest = Math.max(widest, lipped.radius(r, i)); }
  }
  assert.ok(lipped.report.tool.maxRelief < 0.5, `lip relief ${lipped.report.tool.maxRelief}`);
  const bull = await shapedRings(die, margin, { blockout: true, toolCompensation: true, toolDiameter: 1, bullnose: true, toolFlat: 60 });
  assert.ok(bull.report.tool.maxRelief > 0 && bull.report.tool.maxRelief < on.report.tool.maxRelief, `bullnose relief ${bull.report.tool.maxRelief} vs ball ${on.report.tool.maxRelief}`);
});

test("library tooth 22 keeps its fit on the real scan with block-out and milling relief on", async () => {
  const read = name => { const b = readFileSync(new URL(name, import.meta.url)); return parseBinarySTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const shell = read("../public/assets/teeth/22.stl");
  const plain = runKernelTask("crown-stl", { ...payload, shell, libFrame: null, blockout: false, toolCompensation: false });
  const shaped = runKernelTask("crown-stl", { ...payload, shell, libFrame: null, blockout: true, toolCompensation: true, toolDiameter: 1 });
  assert.equal(shaped.stats.closed, true); assert.equal(shaped.stats.invalid, 0);
  assert.ok(shaped.source.blockout && Number.isFinite(shaped.source.blockout.maxDepth));
  assert.ok(shaped.source.tool && Number.isFinite(shaped.source.tool.maxRelief));
  assert.ok(shaped.source.blockout.maxDepth < 0.6, `real die block-out ${shaped.source.blockout.maxDepth}`);
  assert.ok(Math.abs(shaped.stats.volume - plain.stats.volume) / plain.stats.volume < 0.08, `volume ${plain.stats.volume} → ${shaped.stats.volume}`);
  const mesh = ops.makeMesh(shaped.positions, shaped.indices);
  const thick = ops.thicknessMap(mesh, shaped.seg, new BVH(shaped.positions, shaped.indices, shaped.seg.inTris));
  assert.ok(thick.min > 0.75, `wall ${thick.min}`);
  assert.throws(() => runKernelTask("crown-stl", { ...payload, shell, libFrame: null, toolDiameter: 9 }), /range/);
  // On the real die no meridian of the inside may fold outward over the rings below it.
  const real = await shapedRings(scan, payload.margin, { blockout: true, toolCompensation: true, toolDiameter: 1 });
  let folds = 0;
  for (let i = 0; i < 96; i++) { let widest = real.radius(0, i); for (let r = 1; r < real.rings; r++) { if (real.radius(r, i) > widest + 0.05) folds++; widest = Math.max(widest, real.radius(r, i)); } }
  assert.equal(folds, 0, `${folds} folded ring vertices`);
});

test("a hand-placed tooth fitted with block-out and milling relief never grows spikes below its margin", async () => {
  const read = name => { const b = readFileSync(new URL(name, import.meta.url)); return parseBinarySTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const shell = read("../public/assets/teeth/22.stl");
  const placed = runKernelTask("tooth-place", { ...payload, shell, libFrame: null, arch: null });
  const z = V.norm(payload.axis), center = V.mul(payload.margin.reduce((a, p) => V.add(a, p), [0, 0, 0]), 1 / payload.margin.length);
  for (const opts of [{ blockout: false, toolCompensation: false }, { blockout: true, toolCompensation: true, toolDiameter: 1 }]) {
    const r = runKernelTask("crown-stl", { ...payload, shell, libFrame: null, arch: null, placedWorld: placed.positions, placedFrame: placed.frame, ...opts });
    const at = v => [r.positions[v * 3], r.positions[v * 3 + 1], r.positions[v * 3 + 2]];
    const segments = r.seg.rimLoop.length, rimH = Array.from(r.seg.rimLoop, v => V.dot(V.sub(at(v), center), z));
    let below = 0;
    for (let v = 0; v < r.positions.length / 3; v++) {
      if (r.seg.intaglio[v]) continue;
      if (V.dot(V.sub(at(v), center), z) - rimH[v % segments] < -0.2) below++;
    }
    assert.equal(below, 0, `${below} outer vertices below the margin with ${JSON.stringify(opts)}`);
    assert.equal(r.stats.closed, true);
  }
});
