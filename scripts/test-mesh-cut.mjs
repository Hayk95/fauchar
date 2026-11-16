import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { parseHTML } from "linkedom";
import { clipMeshByPlane } from "../lib/client/cad/mesh-cut.js";
import { inspectMesh } from "../lib/client/cad/mesh-quality.js";
import { CadEditor } from "../lib/client/cad/editor.js";
import { renderPanel } from "../lib/client/cad/panel.js";
import { parseBinarySTL } from "../lib/client/cad/mesh.js";

// Adapt Node threads to the browser Worker API while running the actual handler.
class BrowserWorker {
  constructor() {
    this.worker = new Worker(new URL("./fixtures/kernel-thread.mjs", import.meta.url));
    this.worker.on("message", data => this.onmessage?.({ data }));
    this.worker.on("error", error => this.onerror?.(error));
  }
  postMessage(message) { this.worker.postMessage(message); }
  terminate() { void this.worker.terminate(); }
}
globalThis.Worker = BrowserWorker;

const tetra = () => ({ positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]) });
const cut = (mesh, axis = 0, offset = 0.25, side = 1) => clipMeshByPlane({ ...mesh, axis, offset, side });
const area = mesh => inspectMesh(mesh).report.components.reduce((sum, c) => sum + c.area, 0);

test("plane clipping preserves winding, shares intersection vertices and invents no cap", () => {
  const mesh = tetra(), before = structuredClone(mesh);
  for (const axis of [0, 1, 2]) {
    const upper = cut(mesh, axis), lower = cut(mesh, axis, 0.25, -1);
    assert.ok(upper.positions instanceof Float64Array);
    assert.ok(upper.positions.every((v, i) => i % 3 !== axis || v >= 0.25));
    assert.ok(lower.positions.every((v, i) => i % 3 !== axis || v <= 0.25));
    assert.ok(Math.abs(area(upper) + area(lower) - area(mesh)) < 1e-12);
    const report = inspectMesh(upper).report;
    assert.equal(report.components.length, 1); assert.equal(report.inconsistentEdges, 0);
    assert.equal(report.boundaryEdges, 3); assert.equal(report.nonManifoldEdges, 0);
    assert.equal(report.degenerateFaces, 0); assert.equal(report.unusedVertices, 0);
    assert.equal(report.closedOriented, false, "cut remains open without a fabricated cap");
    assert.equal(new Set(Array.from({length:upper.positions.length / 3}, (_, i) => [...upper.positions.slice(i * 3, i * 3 + 3)].join(","))).size, upper.positions.length / 3);
  }
  assert.deepEqual(mesh, before);
});

test("crossing triangle produces two correctly oriented triangles, with exact plane coordinates", () => {
  const mesh = { positions: new Float64Array([-1, 0, 0, 1, 0, 0, 1, 2, 0]), indices: new Uint32Array([0, 1, 2]) };
  const result = cut(mesh, 0, 0);
  assert.equal(result.indices.length, 6); assert.equal(result.positions.length, 12);
  for (let i = 0; i < result.indices.length; i += 3) {
    const [a, b, c] = result.indices.slice(i, i + 3).map(v => v * 3);
    assert.ok((result.positions[b] - result.positions[a]) * (result.positions[c + 1] - result.positions[a + 1]) -
      (result.positions[b + 1] - result.positions[a + 1]) * (result.positions[c] - result.positions[a]) > 0);
  }
  assert.equal(area(result), 1.5);
});

test("on-plane vertices, empty halves, no-op planes and invalid input are explicit", () => {
  const mesh = tetra();
  assert.equal(cut(mesh, 0, 0).unchanged, true);
  assert.throws(() => cut(mesh, 0, 2), /no triangles/);
  const face = cut(mesh, 0, 0, -1);
  assert.equal(face.indices.length, 3); assert.equal(inspectMesh(face).report.degenerateFaces, 0);
  assert.throws(() => cut(mesh, 4), /Choose X/);
  assert.throws(() => cut(mesh, 0, NaN), /finite/);
  assert.throws(() => cut(mesh, 0, 0.5, 0), /side/);
  assert.throws(() => cut({ ...mesh, indices: new Uint32Array([0, 1, 99]) }), /vertex index/);
  const small = { positions: mesh.positions.map(v => 100000 + v / 1000), indices: mesh.indices };
  const result = cut(small, 0, 100000.00025);
  assert.ok(result.positions instanceof Float64Array);
  assert.ok(result.positions.some(v => v === 100000.00025));
});

function viewer() { return { meshes: new Map(), addMesh(id, geometry, style) { this.meshes.set(id, { ...geometry, ...style }); }, setVisible() {}, render() {}, removeMesh(id) { this.meshes.delete(id); } }; }
function editor(io = {}) {
  const ed = new CadEditor({ viewer: viewer(), caseData: { id: "CUT", teeth: [22] }, io: { toast() {}, ...io } });
  ed.scanObjects = [];
  ed.renderPanel = ed.renderRibbon = ed.refreshMap = ed.updateSection = () => {};
  return ed;
}
const dispose = ed => { clearTimeout(ed.saveTimer); ed.kernel.dispose(); };

test("editable copies retain source geometry, undo/redo, save/reopen and separate exports", async () => {
  let saved;
  const ed = editor({ saveDesign: async value => { saved = structuredClone(value); } });
  const source = { id: "cad:crown", name: "Crown 22", kind: "crown" };
  ed.addObject(source, tetra(), {}); ed.selectedId = source.id;
  const before = source.mesh.pos.slice(), beforeIdx = source.mesh.idx.slice();
  try {
    const copy = await ed.runMeshEdit("cut");
    assert.ok(copy); assert.equal(copy.kind, "mesh"); assert.equal(ed.crown, source);
    assert.deepEqual(source.mesh.pos, before); assert.deepEqual(source.mesh.idx, beforeIdx);
    assert.equal(copy.seg, undefined); assert.notEqual(copy.mesh.pos.buffer, source.mesh.pos.buffer);
    assert.equal(copy.source.operation.type, "plane-cut");
    const id = copy.id;
    ed.undo(); assert.equal(ed.objects.has(id), false); assert.equal(ed.crown, source);
    ed.redo(); assert.equal(ed.objects.get(id), copy);
    let exported;
    ed.download = buffer => { exported = parseBinarySTL(buffer); };
    ed.exportShells(); assert.equal(exported.indices.length, source.mesh.idx.length, "working mesh must not join manufacturing exports");
    ed.exportUnit(copy); assert.equal(exported.indices.length, copy.mesh.idx.length);
    await ed.saveDesign();
    const reopened = editor({ loadDesign: async () => saved });
    try {
      await reopened.restoreDesign();
      const restored = reopened.objects.get(id);
      assert.deepEqual(restored.mesh.idx, copy.mesh.idx);
      assert.deepEqual([...restored.mesh.pos], [...copy.mesh.pos]);
      assert.deepEqual(restored.source, copy.source);
      assert.equal(reopened.crown.id, source.id);
    } finally { dispose(reopened); }
    ed.selectedId = ed.meshQualityId = source.id;
    await ed.runMeshQuality("inspect");
    const part = await ed.runMeshEdit("component", 0);
    assert.ok(part); assert.equal(part.source.operation.componentId, 0);
    assert.equal(part.mesh.idx.length, source.mesh.idx.length);
  } finally { dispose(ed); }
});

test("mesh panel binds actual plane parameters and exposes functional copy actions", () => {
  const ed = editor(), { document, window } = parseHTML('<div id="panel"></div>');
  const source = { id: "scan", name: "Jaw", kind: "scan" };
  ed.addObject(source, tetra(), {}); ed.scanObjects = [source]; ed.selectedId = source.id;
  ed.panelEl = document.getElementById("panel"); ed.tool = "mesh";
  try {
    renderPanel(ed);
    assert.ok(ed.panelEl.querySelector('[data-act="mesh-cut"]'));
    const offset = ed.panelEl.querySelector('[data-mesh-cut-offset]');
    offset.value = "0.37"; offset.dispatchEvent(new window.Event("input"));
    assert.equal(ed.meshCut.offset, 0.37);
    offset.value = ""; offset.dispatchEvent(new window.Event("input"));
    assert.ok(Number.isNaN(ed.meshCut.offset), "blank field must not silently become zero");
    ed.meshInspection = { ...inspectMesh(tetra()), objectId: source.id, positions: source.mesh.pos, indices: source.mesh.idx, revision: 0 };
    renderPanel(ed);
    assert.ok(ed.panelEl.querySelector('[data-act="mesh-copy-component"]'));
  } finally { dispose(ed); }
});

test("actual worker transfers clipped geometry without detaching source buffers", async () => {
  const worker = new Worker(new URL("./fixtures/kernel-thread.mjs", import.meta.url));
  try {
    const input = tetra();
    const result = await new Promise((resolve, reject) => {
      worker.on("message", data => { if (data.progress !== undefined) return; data.error ? reject(Error(data.error)) : resolve(data.result); });
      worker.postMessage({ id: 1, type: "mesh-cut", payload: { ...input, axis: 0, offset: 0.25, side: 1 } });
    });
    assert.equal(result.indices.length, 9); assert.equal(inspectMesh(result).report.boundaryEdges, 3);
    assert.equal(input.positions.byteLength, 96);
  } finally { await worker.terminate(); }
});


test("sample crown cut exports actual retained surfaces and leaves its source intact", () => {
  const raw = readFileSync(new URL("../public/assets/sample/demo-crown-22.stl", import.meta.url));
  const mesh = parseBinarySTL(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const before = mesh.positions.slice(), indices = mesh.indices.slice();
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) { min = Math.min(min, mesh.positions[i]); max = Math.max(max, mesh.positions[i]); }
  const offset = (min + max) / 2, result = cut(mesh, 0, offset);
  assert.equal(result.unchanged, false);
  assert.ok(result.positions.every((v, i) => i % 3 !== 0 || v >= offset - 1e-5));
  const report = inspectMesh(result).report;
  assert.equal(report.nonManifoldEdges, 0); assert.equal(report.inconsistentEdges, 0);
  assert.equal(report.degenerateFaces, 0); assert.ok(report.boundaryEdges > 0);
  assert.deepEqual(mesh.positions, before); assert.deepEqual(mesh.indices, indices);
});

test("changed sources and failed plane requests do not leave partial copies", async () => {
  const messages = [], ed = editor({ toast: message => messages.push(message) });
  const source = { id: "scan", name: "Jaw", kind: "scan" };
  ed.addObject(source, tetra(), {}); ed.selectedId = source.id;
  try {
    ed.meshCutSettings().offset = NaN;
    assert.equal(await ed.runMeshEdit("cut"), null); assert.equal(ed.objects.size, 1);
    assert.ok(messages.some(message => message.includes("finite")));
    ed.meshCutSettings().offset = 0.5;
    const kernel = ed.kernel;
    ed.kernel = { async run(type, payload) { source.meshRevision = 1; return clipMeshByPlane(payload); } };
    assert.equal(await ed.runMeshEdit("cut"), null); assert.equal(ed.objects.size, 1);
    assert.ok(messages.some(message => message.includes("source changed")));
    ed.kernel = kernel;
  } finally { dispose(ed); }
});
