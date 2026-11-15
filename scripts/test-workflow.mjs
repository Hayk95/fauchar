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
