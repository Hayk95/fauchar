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
