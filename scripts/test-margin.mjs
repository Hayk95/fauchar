import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { CadEditor } from "../lib/client/cad/editor.js";
import { workflowProblem } from "../lib/client/cad/workflow.js";
import { drawingNeighborLabels, makeMesh } from "../lib/client/cad/ops.js";

const editors = [], frames = [];
globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
function editor() {
  const messages = [];
  const viewer = { canvas: { dataset: {} }, meshes: new Map(), setLineLayer() {}, render() {}, removeMesh() {},
    toWorld: p => p, projectToScreen: p => ({ x: p[0] * 20, y: p[1] * 20, behind: false }), screenRay: () => null };
  const ed = new CadEditor({ viewer, caseData: { teeth: [22] }, io: { toast: message => messages.push(message) } });
  ed.scanObjects = []; ed.tool = "margin";
  ed.refreshMargin = () => {}; ed.renderPanel = () => {}; ed.renderRibbon = () => {};
  ed.refreshMap = () => {}; ed.updateSection = () => {}; ed.paintTeeth = () => {};
  ed.marginPick = p => p.point || null;
  ed.marginSub = "draw"; ed.marginTooth = 22;
  editors.push(ed);
  return { ed, messages };
}
const circle = count => Array.from({ length: count }, (_, i) => [3 * Math.cos(i * Math.PI * 2 / count), 3 * Math.sin(i * Math.PI * 2 / count), 0]);
const pointer = p => ({ x: p[0] * 20, y: p[1] * 20, point: p, shift: false });
afterEach(() => { for (const ed of editors.splice(0)) { clearTimeout(ed.saveTimer); ed.kernel.dispose(); } frames.length = 0; });

test("empty margin starts drawing on the selected tooth without whole-arch identification", () => {
  const { ed } = editor(); ed.marginTooth = null; ed.marginSub = "move";
  ed.scanObjects = [{ jaw: "upper" }];
  ed.identifyTeeth = () => assert.fail("Opening the margin tool must not identify the entire arch");
  ed.setTool("margin");
  assert.equal(ed.marginSub, "draw"); assert.equal(ed.marginTooth, 22);
  assert.equal(ed.onDown(pointer([3, 0, 0])), true);
  assert.equal(ed.marginDraft.length, 1);
});

test("continuous tracing closes near the start and creates one undoable margin", () => {
  const { ed } = editor(), points = circle(32);
  ed.onDown(pointer(points[0]));
  for (const p of points.slice(1)) ed.onDrag(pointer(p));
  ed.onDrag(pointer(points[0]));
  assert.equal(ed.marginDraft, null);
  assert.ok(ed.margin?.length >= 12);
  assert.ok(ed.marginCtrl.length <= 48);
  assert.equal(ed.marginSub, "move"); assert.equal(ed.stack.length, 1);
  ed.undo(); assert.equal(ed.margin, null);
  ed.redo(); assert.ok(ed.margin.length >= 12);
  assert.ok(frames.length <= 1, "coalesce trace previews instead of fitting a spline on every pointer event");
});

test("short draft keeps its points, and cancelling retains the previous margin", () => {
  const { ed, messages } = editor(), old = circle(12);
  ed.margin = old; ed.marginCtrl = old; ed.startMarginDrawing();
  for (const p of circle(8).slice(0, 3)) { ed.onDown(pointer(p)); ed.onUp(pointer(p)); }
  ed.closeMarginDraft();
  assert.equal(ed.marginDraft.length, 3); assert.equal(ed.margin, old);
  assert.match(messages.at(-1), /still here/);
  ed.cancelMarginDraft(); assert.equal(ed.margin, old); assert.equal(ed.marginSub, "move");
});

test("undo removes one trace stroke and the drawing can continue after releasing", () => {
  const { ed } = editor(), points = circle(32);
  ed.onDown(pointer(points[0])); ed.onDrag(pointer(points[1])); ed.onDrag(pointer(points[2])); ed.onUp(pointer(points[2]));
  const firstStroke = ed.marginDraft.length;
  ed.onDown(pointer(points[3])); ed.onDrag(pointer(points[4])); ed.onUp(pointer(points[4]));
  assert.ok(ed.marginDraft.length > firstStroke);
  ed.undoMarginDraft(); assert.equal(ed.marginDraft.length, firstStroke);
  ed.undoMarginDraft(); assert.equal(ed.marginDraft, null);
});

test("find-margin button waits for an explicit preparation click", () => {
  const { ed } = editor(); let seed;
  ed.autoDetectMargin = point => { seed = point; };
  ed.startMarginDetection(); assert.equal(ed.pendingAutoSeed, true);
  ed.onDown(pointer([1, 2, 3]));
  assert.deepEqual(seed, [1, 2, 3]); assert.equal(ed.pendingAutoSeed, false);
});

test("line itself can be grabbed between handles, inserted, moved and undone", () => {
  const { ed } = editor(), points = [[-3, -3, 0], [3, -3, 0], [3, 3, 0], [-3, 3, 0]];
  ed.margin = points; ed.marginCtrl = points; ed.marginSub = "move";
  assert.equal(ed.onDown(pointer([0, -3, 0])), true);
  assert.equal(ed.marginCtrl.length, 5);
  ed.onDrag(pointer([0, -2.8, 0])); ed.onUp(pointer([0, -2.8, 0]));
  assert.equal(ed.stack.length, 1);
  ed.undo(); assert.deepEqual(ed.marginCtrl, points);
});

test("back-side handles are ignored and Shift retains camera navigation", () => {
  const { ed } = editor();
  ed.marginCtrl = [[0, 0, 5], [0, 0, 1]];
  ed.viewer.screenRay = () => ({ o: [0, 0, 0], d: [0, 0, 1] });
  ed.scanObjects = [{ id: "s", vid: "s", jaw: "upper" }];
  ed.pick = () => ({ t: 1, point: [0, 0, 1] });
  assert.equal(ed.marginHandleAt({ x: 0, y: 0 }), 1);
  assert.equal(ed.onDown({ ...pointer([1, 0, 0]), shift: true }), false);
});

test("drawing hides the tooth beside the preparation and closing shows it again", () => {
  const { ed } = editor();
  const calls = [];
  ed.viewer.setGroupStyle = (id, group, style) => calls.push([id, group, style.visible]);
  ed.viewer.meshes.set("jaw", { groups: [{ id: "neighbor-m", visible: true }, { id: "neighbor-d", visible: true }] });
  ed.scanObjects = [{ id: "jaw", vid: "jaw", jaw: "upper", parts: { label: new Uint8Array(0) } }];
  ed.marginTooth = 22;
  ed.marginSub = "draw";
  ed.marginDraft = [[0, 0, 0]];
  ed.syncDrawingNeighbors();
  assert.deepEqual(calls, [["jaw", "neighbor-m", false], ["jaw", "neighbor-d", false]]);
  ed.marginSub = "move";
  ed.marginDraft = null;
  ed.syncDrawingNeighbors();
  assert.equal(calls.at(-1)[2], true, "neighbours return when the line is finished");
  assert.equal(calls.at(-2)[2], true);
});

test("a click on one tooth marks the tooth beside it, not the clicked surface", () => {
  const n = 14, pos = [], idx = [], at = (i, j) => j * n + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * 28, y = (j / (n - 1) - 0.5) * 14;
    const hump = (cx) => Math.exp(-((x - cx) ** 2) / 7 - (y * y) / 20) * 5;
    pos.push(x, y, hump(-7) + hump(7));
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    idx.push(a, b, d, a, d, c);
  }
  const mesh = makeMesh(new Float32Array(pos), new Uint32Array(idx));
  const label = drawingNeighborLabels(mesh, [-7, 0, 5], [0, 0, 1]);
  const near = (x0) => {
    let hidden = 0, seen = 0;
    for (let v = 0; v < mesh.count; v++) {
      if (Math.hypot(pos[v * 3] - x0, pos[v * 3 + 1]) > 2.5 || pos[v * 3 + 2] < 2) continue;
      seen++;
      if (label[v] === 2) hidden++;
    }
    return hidden / seen;
  };
  assert.ok(near(-7) < 0.2, "the tooth being traced stays visible");
  assert.ok(near(7) > 0.6, "the neighbouring tooth is hidden");
});

test("wizard does not use an old saved line while a replacement is still being traced", () => {
  const { ed } = editor(); ed.scanObjects = [{}]; ed.margin = circle(12); ed.insertionAxis = [0, 0, 1];
  ed.onDown(pointer([3, 0, 0]));
  assert.match(workflowProblem(ed, "bottom"), /Finish or cancel/);
});
