import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { inspectMesh, cleanMeshFaces, extractMeshComponent } from "../lib/client/cad/mesh-quality.js";
import { parseBinarySTL, BVH } from "../lib/client/cad/mesh.js";
import { createCrown } from "../lib/client/cad/crown-builder.js";
import { CadEditor } from "../lib/client/cad/editor.js";

function tetra(offset = 0) {
  return { positions: new Float64Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0, offset, 0, 1]), indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]) };
}
function twoShells() {
  return { positions: Float64Array.from([...tetra().positions, ...tetra(3).positions]), indices: Uint32Array.from([...tetra().indices, ...tetra().indices.map(i => i + 4)]) };
}

test("inspection distinguishes disconnected shells, holes and inconsistent winding", () => {
  const mesh = twoShells();
  const { report, componentIds } = inspectMesh(mesh);
  assert.equal(report.closedOriented, true);
  assert.equal(report.components.length, 2);
  assert.deepEqual(report.components.map(c => c.triangles), [4, 4]);
  const part = extractMeshComponent({ ...mesh, componentIds, componentId: 1 });
  assert.ok(part.positions instanceof Float64Array);
  const triangles = mesh => Array.from(mesh.indices).flatMap(i => Array.from(mesh.positions.subarray(i * 3, i * 3 + 3)));
  assert.deepEqual(triangles(part), triangles(tetra(3)));
  assert.equal(inspectMesh(part).report.closedOriented, true);
  assert.equal(inspectMesh({ ...tetra(), indices: tetra().indices.slice(3) }).report.boundaryEdges, 3);
  const flipped = tetra(); [flipped.indices[0], flipped.indices[1]] = [flipped.indices[1], flipped.indices[0]];
  assert.equal(inspectMesh(flipped).report.inconsistentEdges, 3);
  assert.equal(inspectMesh(flipped).report.closedOriented, false);
});

test("conservative cleanup preserves coordinates, winding and face provenance", () => {
  const mesh = tetra();
  const dirty = { ...mesh, indices: Uint32Array.from([...mesh.indices, 1, 2, 0, 0, 0, 1]) };
  const report = inspectMesh(dirty).report;
  assert.equal(report.duplicateFaces, 1); assert.equal(report.degenerateFaces, 1);
  const clean = cleanMeshFaces(dirty);
  assert.deepEqual(clean.positions, mesh.positions);
  assert.deepEqual(clean.indices, mesh.indices);
  assert.deepEqual([...clean.keptFaces], [0, 1, 2, 3]);
  assert.equal(inspectMesh(clean).report.closedOriented, true);
  assert.deepEqual(dirty.indices.slice(-3), new Uint32Array([0, 0, 1]));
});

test("invalid meshes and stale component requests fail before geometry allocation", () => {
  assert.throws(() => inspectMesh({ ...tetra(), indices: new Uint32Array([0, 2, 10]) }), /vertex index/);
  assert.throws(() => inspectMesh({ ...tetra(), positions: new Float64Array([NaN, 0, 0]) }), /non-finite/);
  assert.throws(() => inspectMesh({ ...tetra(), indices: new Uint32Array(3 * 750001) }), /750,000/);
  assert.throws(() => cleanMeshFaces({ ...tetra(), indices: new Uint32Array([0, 0, 1]) }), /no usable triangles/);
  assert.throws(() => extractMeshComponent({ ...tetra(), componentIds: new Int32Array(4), componentId: 1 }), /no longer exists/);
});

test("actual module worker transfers inspection, cleanup and extraction results", async () => {
  const worker = new Worker(new URL("./fixtures/kernel-thread.mjs", import.meta.url));
  let sequence = 0;
  const run = (type, payload) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const receive = data => {
      if (data.id !== id || data.progress !== undefined) return;
      worker.off("message", receive);
      if (data.error) reject(new Error(data.error)); else resolve(data.result);
    };
    worker.on("message", receive); worker.postMessage({ id, type, payload });
  });
  try {
    const mesh = twoShells();
    const result = await run("mesh-inspect", mesh);
    assert.equal(result.report.components.length, 2);
    assert.ok(result.componentIds instanceof Int32Array);
    const part = await run("mesh-component", { ...mesh, componentIds: result.componentIds, componentId: 0 });
    assert.equal(part.indices.length, 12);
    const clean = await run("mesh-clean", mesh);
    assert.equal(clean.keptFaces.length, 8);
    assert.equal(mesh.positions.byteLength, 192, "source buffer remains editable");
  } finally { await worker.terminate(); }
});

function viewer() {
  return { meshes: new Map(), addMesh(id, geometry, style) { this.meshes.set(id, { ...geometry, ...style }); }, setVisible() {}, render() {}, removeMesh(id) { this.meshes.delete(id); } };
}

test("real crown cleanup preserves intaglio, supports undo/redo and saves/reopens", async () => {
  const raw = readFileSync(new URL("../public/assets/sample/demo-upper.stl", import.meta.url));
  const scan = parseBinarySTL(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const design = JSON.parse(readFileSync(new URL("../public/assets/sample/demo-22.json", import.meta.url), "utf8"));
  const convert = p => [p[0], -p[2], p[1]];
  const crown = createCrown({ ...scan, margin: design.margin.map(convert), axis: convert(design.frame.occlusal), segments: 48, rings: 12 });
  const dirty = { ...crown, indices: Uint32Array.from([...crown.indices, ...crown.indices.slice(0, 3)]) };
  const faceIn = Uint8Array.from([...crown.seg.faceIn, crown.seg.faceIn[0]]);
  let saved;
  const ed = new CadEditor({ viewer: viewer(), caseData: { id: "TEST", teeth: [22] }, io: { toast() {}, saveDesign: async value => { saved = structuredClone(value); } } });
  const obj = { id: "cad:quality-test", name: "Crown 22", kind: "crown", frame: crown.frame };
  ed.addObject(obj, dirty, {}); obj.seg = { ...crown.seg, faceIn };
  obj.intaglioBvh = new BVH(obj.mesh.pos, obj.mesh.idx, obj.seg.inTris); ed.refreshWeights(obj);
  ed.scanObjects = []; ed.selectedId = obj.id;
  ed.renderPanel = ed.renderRibbon = ed.refreshMap = ed.updateSection = () => {};
  const oldPositions = obj.mesh.pos.slice(), protectedVertices = obj.seg.intaglio.slice();
  const point = tri => ({ objId: obj.id, tri, u: 0.2, v: 0.3 });
  ed.measures = [{ id: 1, type: "distance", pts: [point(0), point(1)] },
    { id: 2, type: "distance", pts: [point(crown.indices.length / 3), point(1)] }];
  const originalMeasures = structuredClone(ed.measures);
  try {
    ed.applyMeshFaceCleanup(obj, cleanMeshFaces(dirty));
    assert.deepEqual(obj.mesh.pos, oldPositions);
    assert.deepEqual(obj.seg.intaglio, protectedVertices);
    assert.deepEqual(obj.seg.faceIn, crown.seg.faceIn);
    assert.deepEqual(obj.mesh.idx, crown.indices);
    assert.equal(ed.measures.length, 1, "removed face cannot retain a stale measurement");
    ed.undo(); assert.deepEqual(obj.mesh.idx, dirty.indices);
    assert.deepEqual(ed.measures, originalMeasures);
    ed.redo(); assert.deepEqual(obj.mesh.idx, crown.indices);
    await ed.saveDesign();
    const reopened = new CadEditor({ viewer: viewer(), caseData: { id: "TEST", teeth: [22] }, io: { toast() {}, loadDesign: async () => saved } });
    reopened.scanObjects = [];
    await reopened.restoreDesign();
    assert.deepEqual(reopened.crown.mesh.idx, crown.indices);
    assert.deepEqual(reopened.crown.seg.intaglio, protectedVertices);
    assert.equal(reopened.crown.seg.faceIn.length, reopened.crown.mesh.idx.length / 3);
    reopened.kernel.dispose(); clearTimeout(reopened.saveTimer);
  } finally { clearTimeout(ed.saveTimer); ed.kernel.dispose(); }
});

test("cleanup remaps measurement triangles after an earlier face is removed", () => {
  const mesh = tetra();
  const dirty = { ...mesh, indices: Uint32Array.from([0, 0, 1, ...mesh.indices]) };
  const ed = new CadEditor({ viewer: viewer(), caseData: { id: "REMAP" }, io: { toast() {} } });
  const obj = { id: "cad:remap", name: "Restoration", kind: "crown" };
  ed.addObject(obj, dirty, {}); ed.scanObjects = [];
  ed.renderPanel = ed.renderRibbon = ed.refreshMap = ed.updateSection = () => {};
  const ref = { objId: obj.id, tri: 2, u: 0.25, v: 0.4 };
  ed.measures = [{ type: "distance", pts: [ref, { ...ref, tri: 3 }] }];
  const before = ed.measurePoint(ref);
  try {
    ed.applyMeshFaceCleanup(obj, cleanMeshFaces(dirty));
    assert.equal(ed.measures[0].pts[0].tri, 1);
    assert.deepEqual(ed.measurePoint(ed.measures[0].pts[0]), before);
    ed.undo(); assert.equal(ed.measures[0].pts[0].tri, 2);
    ed.redo(); assert.equal(ed.measures[0].pts[0].tri, 1);
  } finally { clearTimeout(ed.saveTimer); ed.kernel.dispose(); }
});
