import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { newJob, setUnit, bridgePreset, jobProblems, scanPlan, scanProblems, caseFromJob } from "../lib/client/case-plan.js";
import { mountCaseIntake } from "../lib/client/case-intake.js";
import { CadEditor } from "../lib/client/cad/editor.js";
import { workflowForCase } from "../lib/client/cad/workflow.js";

const validScan = slot => ({ id: `file-${slot}`, slot, name: `${slot}.stl`, size: 100, status: "valid", stats: { triangles: 10 }, buffer: new ArrayBuffer(100) });
test("crown and bridge definitions produce different, jaw-aware scan plans", () => {
  const job = newJob(); setUnit(job, 22, { indication: "crown" });
  assert.deepEqual(jobProblems(job), []);
  assert.deepEqual(scanPlan(job).filter(s => s.required).map(s => s.id), ["upper", "lower"]);
  job.useAntagonist = false;
  assert.deepEqual(scanPlan(job).filter(s => s.required).map(s => s.id), ["upper"]);
  assert.match(scanProblems(job, [validScan("lower")])[0], /preparation/);
  setUnit(job, 36, { indication: "antagonist" });
  assert.deepEqual(scanPlan(job).filter(s => s.required).map(s => s.id), ["upper", "lower"]);
  bridgePreset(job, 46, 44);
  assert.deepEqual(job.units.filter(u => u.indication !== "antagonist").map(u => [u.fdi, u.indication]), [[46, "crown"], [45, "pontic"], [44, "crown"]]);
  assert.equal(scanPlan(job)[0].id, "lower");
  assert.equal(scanPlan(job).find(s => s.id === "gingiva").required, false);
});

test("invalid spans, unsupported work and disconnected/material-mismatched bridges cannot launch CAD", () => {
  const job = newJob();
  assert.ok(jobProblems(job).length);
  assert.throws(() => setUnit(job, 22, { indication: "implant" }), /module/);
  setUnit(job, 22, { indication: "crown" });
  assert.throws(() => setUnit(job, 22, { indication: "implant" }), /module/);
  assert.equal(job.units.find(u => u.fdi === 22).indication, "crown", "failed indication change preserves the existing work");
  assert.throws(() => bridgePreset(job, 24, 44), /one jaw/);
  bridgePreset(job, 24, 26); assert.deepEqual(jobProblems(job), []);
  job.connectors = []; assert.match(jobProblems(job).join(" "), /connector/);
  bridgePreset(job, 24, 26); setUnit(job, 25, { indication: "pontic", material: "PMMA" });
  assert.match(jobProblems(job).join(" "), /same material/);
  const invalid = newJob(); invalid.units = [{ fdi: 99, indication: "crown" }, { fdi: 100, indication: "crown" }];
  assert.ok(jobProblems(invalid).length);
});

test("enabled references are explicit roles and scans left from an older plan are rejected", () => {
  const job = newJob(); setUnit(job, 22, { indication: "crown" }); job.preop = true; job.bite = true;
  const files = [validScan("upper"), validScan("lower"), validScan("preop"), validScan("bite")];
  assert.deepEqual(scanProblems(job, files), []);
  const c = caseFromJob(job, files, { id: "CASE", now: 123 });
  assert.equal(c.files.find(f => f.role === "bite").jaw, "bite");
  assert.equal(c.files.find(f => f.role === "preop").jaw, "preop");
  assert.equal(c.job.units[0].fdi, 22);
  job.bite = false; assert.match(scanProblems(job, files).join(" "), /current job plan/);
  job.preop = false; job.parameters.minWall = NaN; assert.match(jobProblems(job).join(" "), /dimensions/);
});

test("saved plan supplies the editor's actual dimensions and the right workflow", () => {
  const job = newJob(); setUnit(job, 22, { indication: "crown" }); job.parameters.cementGap = .09; job.parameters.minWall = 1.1;
  const c = caseFromJob(job, [validScan("upper"), validScan("lower")], { id: "CASE" });
  const ed = new CadEditor({ viewer: {}, caseData: c, io: {} });
  assert.equal(ed.opts.cement.gap, .09); assert.equal(ed.construction.wall, 1.1);
  assert.equal(workflowForCase(c).some(s => s.id === "bridge"), false);
  assert.equal(workflowForCase({ restoration: "bridge" }).some(s => s.id === "bridge"), true);
});

test("extra scans stay reference objects and cannot be chosen as preparation or antagonist", async () => {
  const viewer = { meshes: new Map(), render() {} };
  const entries = ["upper", "lower", "preop", "gingiva", "bite"].map(jaw => ({ id: jaw, jaw, name: `${jaw}.stl` }));
  for (const entry of entries) viewer.meshes.set(entry.id, { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), visible: true });
  const ed = new CadEditor({ viewer, caseData: { teeth: [22] }, hud: { getContext: () => ({}) }, io: {} });
  ed.setupRelations = async () => {}; ed.restoreDesign = async () => {}; ed.bindTool = () => {};
  ed.bindKeys = () => {}; ed.setTool = () => {}; ed.renderRibbon = () => {}; ed.refreshMargin = () => {}; ed.focusCrown = () => {};
  await ed.init(entries);
  assert.deepEqual(ed.scanObjects.map(o => o.id), ["upper", "lower"]);
  assert.equal(ed.objects.size, 5, "references remain available to scene visibility controls");
  assert.equal(ed.units.length, 0, "references are not restoration units");
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const { document, window } = parseHTML('<main id="view"></main>');
  const view = document.getElementById("view"), saved = [], routes = [];
  let seq = 0;
  const intake = mountCaseIntake({ view, uid: () => `id-${++seq}`, toast() {}, nextCaseId: async () => "CASE-1",
    readFile: async () => new ArrayBuffer(100), parseSTL: async () => ({ stats: { triangles: 10 } }),
    persistCase: async (c, files) => saved.push({ c, files }), navigate: to => routes.push(to) });
  const click = selector => { const el = view.querySelector(selector); assert.ok(el, selector); el.dispatchEvent(new window.Event("click", { bubbles: true })); };
  const upload = async slot => {
    const el = view.querySelector(`[data-slot="${slot}"]`); assert.ok(el);
    Object.defineProperty(el, "files", { value: [{ name: `${slot}.stl`, size: 100 }] });
    el.dispatchEvent(new window.Event("change", { bubbles: true })); await tick(); await tick();
  };
  return { view, intake, click, upload, saved, routes, window };
}

test("actual intake DOM prevents scan-first progression, assigns tooth and saves before opening WebGL", async () => {
  const h = harness();
  try {
    assert.equal(h.view.querySelector('[data-slot="upper"]'), null, "job definition comes before upload");
    h.click('[data-action="next"]'); assert.equal(h.intake.flow.step, 1);
    assert.match(h.view.querySelector('[role="alert"]').textContent, /assign/);
    h.click('[data-quick="crown"]'); h.click('[data-tooth="22"]');
    h.click('[data-action="next"]'); assert.equal(h.intake.flow.step, 2);
    h.click('[data-action="next"]'); assert.equal(h.intake.flow.step, 2, "required scans block progression");
    await h.upload("upper"); await h.upload("lower");
    h.click('[data-action="next"]'); assert.equal(h.intake.flow.step, 3);
    h.click('[data-action="create"]'); await tick(); await tick();
    assert.equal(h.saved.length, 1); assert.equal(h.saved[0].c.teeth[0], 22);
    assert.deepEqual(h.saved[0].c.files.map(f => f.jaw), ["upper", "lower"]);
    assert.equal(h.saved[0].files.length, 2);
    assert.deepEqual(h.routes, ["/workspace/case/CASE-1"]);
    assert.equal(h.intake.flow.saved, true);
  } finally { h.intake.dispose(); }
});

test("actual bridge picker assigns abutments, pontics and connectors before requesting scans", () => {
  const h = harness();
  try {
    h.click('[data-quick="bridge"]'); h.click('[data-tooth="24"]'); h.click('[data-tooth="26"]');
    assert.equal(h.intake.flow.job.units.find(u => u.fdi === 25).indication, "pontic");
    assert.equal(h.intake.flow.job.connectors.length, 2);
    h.click('[data-action="next"]'); assert.equal(h.intake.flow.step, 2);
    assert.ok(h.view.querySelector('[data-drop-slot="gingiva"]'));
  } finally { h.intake.dispose(); }
});
