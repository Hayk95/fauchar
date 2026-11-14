import { ARCHES, INDICATIONS, MATERIALS, newJob, setUnit, bridgePreset, restoredUnits, jobProblems, scanPlan, scanProblems, caseFromJob, connectorKey } from "./case-plan.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const button = (label, attr = "", primary = false) => `<button type="button" class="btn btn-sm ${primary ? "btn-primary" : ""}" ${attr}>${label}</button>`;

/** Define the job first; import only its requested scan roles; then open the actual CAD case. */
export function mountCaseIntake(io) {
  const { view, uid, readFile, parseSTL, toast } = io;
  const flow = { step: 1, job: newJob(), files: [], selected: 22, quick: null, anchor: null, saved: false, saving: false, error: "" };
  let disposed = false, draft = { indication: "crown", material: flow.job.material, shade: flow.job.shade };
  const abort = new AbortController();
  const processing = () => flow.files.some(f => ["reading", "parsing"].includes(f.status));
  const selectedUnit = () => flow.job.units.find(u => u.fdi === flow.selected);
  function select(fdi) { flow.selected = fdi; draft = { indication: "crown", material: flow.job.material, shade: flow.job.shade, ...selectedUnit() }; }
  const field = (label, key, value, type = "text", max = 80) => `<label class="field"><span>${label}</span><input type="${type}" data-job="${key}" value="${esc(value)}" maxlength="${max}"></label>`;
  const selectField = (label, key, options, value) => `<label class="field"><span>${label}</span><select class="select" data-job="${key}">${options.map(([v, l]) => `<option value="${v}" ${value === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
  const requirementList = () => `<ul class="job-scan-needs">${scanPlan(flow.job).map(s => `<li><strong>${esc(s.label)}</strong><span>${s.required ? "Required" : "Recommended"}${s.reference ? " · reference only" : ""}</span></li>`).join("") || "<li>Select the restoration teeth to see the scan plan.</li>"}</ul>`;
  function toothChart() {
    return Object.entries(ARCHES).map(([jaw, teeth]) => `<div class="job-arch-label">${jaw === "upper" ? "Upper" : "Lower"} arch · FDI</div><div class="job-tooth-row">${teeth.map(fdi => {
      const unit = flow.job.units.find(u => u.fdi === fdi);
      return `<button type="button" class="job-tooth ${unit ? `role-${unit.indication}` : ""}" data-tooth="${fdi}" aria-pressed="${flow.selected === fdi}" aria-label="Tooth ${fdi}${unit ? ` · ${INDICATIONS[unit.indication].label}` : " · not assigned"}"><span class="job-tooth-shape" aria-hidden="true"></span><strong>${fdi}</strong><small>${unit ? ({ crown: "Crown", pontic: "Pontic", adjacent: "Adj.", antagonist: "Antag." }[unit.indication]) : "—"}</small></button>`;
    }).join("")}</div>`).join("");
  }
  function definitions() {
    const j = flow.job;
    const units = restoredUnits(j);
    const connects = Object.values(ARCHES).flatMap(arch => arch.slice(1).map((b, k) => ({ a: arch[k], b }))).filter(c => units.some(u => u.fdi === c.a) && units.some(u => u.fdi === c.b));
    return `<div class="job-definition">
      <section class="panel job-details"><div class="panel-head"><h2 class="panel-title">Job details</h2></div><div class="panel-body stack">
        ${field("Job / appointment name", "name", j.name)}${field("Client / laboratory", "client", j.client, "text", 60)}
        ${field("Patient reference", "patientRef", j.patientRef, "text", 32)}${field("Technician", "technician", j.technician, "text", 60)}${field("Due date · optional", "dueDate", j.dueDate, "date")}
        ${selectField("Scan mode", "scanMode", [["intraoral", "Intraoral / digital impression"], ["model", "Model scans · already aligned"]], j.scanMode)}
        ${selectField("Production plan", "production", [["milling", "Milling"], ["printing", "3D printing"], ["external", "External laboratory"]], j.production)}
        ${selectField("New-unit material", "material", MATERIALS.map(m => [m, m]), j.material)}${field("New-unit shade", "shade", j.shade, "text", 20)}
      </div></section>
      <section class="panel job-chart-panel"><div class="panel-head"><h2 class="panel-title">Define the work on each tooth</h2></div><div class="panel-body">
        <div class="job-quick">${button("Single crown", 'data-quick="crown"', flow.quick === "crown")}${button("Bridge: choose end teeth", 'data-quick="bridge"', flow.quick === "bridge")}</div>
        <p class="job-hint" role="status">${flow.quick === "bridge" ? (flow.anchor ? `First abutment ${flow.anchor}. Click the last abutment; the span between becomes pontics.` : "Click the first bridge abutment, then the last.") : flow.quick === "crown" ? "Click the prepared tooth to create a single-crown job." : "Click a tooth, choose its indication on the right and apply. Ctrl-click copies the last settings."}</p>
        ${toothChart()}
        <div class="job-legend"><span class="role-crown">Crown / abutment</span><span class="role-pontic">Pontic</span><span class="role-adjacent">Adjacent</span><span class="role-antagonist">Antagonist</span></div>
        ${connects.length ? `<div class="job-connectors"><h3>Connectors</h3>${connects.map(c => `<label><input type="checkbox" data-connector="${c.a}:${c.b}" ${j.connectors.some(x => connectorKey(x.a, x.b) === connectorKey(c.a, c.b)) ? "checked" : ""}>${c.a} ↔ ${c.b}</label>`).join("")}</div>` : ""}
        <div class="job-extras"><h3>Scan options</h3>${[["useAntagonist", "Include opposing jaw for occlusion"], ["preop", "Add a pre-op reference"], ["gingiva", "Require a gingiva reference"], ["bite", "Add bite registration · reference only"]].map(([key, label]) => `<label><input type="checkbox" data-job="${key}" ${j[key] ? "checked" : ""}>${label}</label>`).join("")}</div>
        <details class="job-parameters"><summary>Design parameters · millimetres</summary><p class="job-hint">These are editable starting values, not a manufacturer material preset.</p>${[["cementGap", "Cement gap"], ["marginGap", "Margin gap"], ["minWall", "Minimum wall"], ["marginWall", "Margin border"]].map(([key, label]) => `<label>${label}<input type="number" data-parameter="${key}" value="${j.parameters[key]}" step="0.01" min="0" max="3"></label>`).join("")}</details>
        <label class="field"><span>Design instructions</span><textarea data-job="notes" maxlength="1000">${esc(j.notes)}</textarea></label>
      </div></section>
      <aside class="stack"><section class="panel job-unit"><div class="panel-head"><h2 class="panel-title">Tooth ${flow.selected}</h2><span>${selectedUnit() ? "Assigned" : "Not assigned"}</span></div><div class="panel-body stack">
        <label class="field"><span>Indication</span><select class="select" data-unit="indication">${Object.entries(INDICATIONS).map(([key, v]) => `<option value="${key}" ${draft.indication === key ? "selected" : ""} ${v.supported ? "" : "disabled"}>${v.label}${v.supported ? "" : " · module unavailable"}</option>`).join("")}</select></label>
        <label class="field"><span>Material</span><select class="select" data-unit="material">${MATERIALS.map(m => `<option ${draft.material === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="field"><span>Shade</span><input data-unit="shade" maxlength="20" value="${esc(draft.shade)}"></label>
        ${button(`Apply to tooth ${flow.selected}`, 'data-action="apply-unit"', true)}${button("Clear this tooth", 'data-action="clear-unit"', false)}
        <p class="job-hint">Crown/bridge design is available. Other module indications are shown but cannot start an unsupported design.</p>
      </div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Suggested scans</h2></div>${requirementList()}</section></aside>
    </div>`;
  }
  function scans() {
    const plan = scanPlan(flow.job);
    return `<div class="job-scan-grid">${plan.map(slot => {
      const f = flow.files.find(file => file.slot === slot.id);
      return `<section class="panel job-scan-slot" data-drop-slot="${slot.id}"><div class="panel-head"><h2 class="panel-title">${esc(slot.label)}</h2><span class="badge ${slot.required ? "status-review" : ""}">${slot.required ? "Required" : "Recommended"}</span></div><div class="panel-body stack"><p>${esc(slot.purpose)}</p>
        ${f ? `<div class="job-file"><strong>${esc(f.name)}</strong><p>${f.status === "valid" ? `${Math.round(f.size / 1024).toLocaleString()} KB · ${f.stats.triangles.toLocaleString()} triangles` : f.status === "error" ? esc(f.error) : `${f.status === "reading" ? "Reading" : "Validating"}… ${Math.round(f.progress * 100)}%`}</p>${button("Remove", `data-remove="${slot.id}"`)}</div>` : '<p class="job-hint">Drop an STL here, or choose a file below.</p>'}
        <label class="field"><span>${f ? "Replace scan" : "Choose STL scan"}</span><input type="file" accept=".stl" data-slot="${slot.id}" ${processing() ? "disabled" : ""}></label></div></section>`;
    }).join("")}</div>
      ${flow.files.filter(f => !plan.some(s => s.id === f.slot)).map(f => `<div class="banner banner-warn">${esc(f.name)} is not in the changed job plan. ${button("Remove", `data-remove="${f.slot}"`)}</div>`).join("")}
      <div class="panel job-import-options"><div class="panel-body"><label class="field"><span>Scan up axis</span><select class="select" data-job="upAxis"><option value="z" ${flow.job.upAxis === "z" ? "selected" : ""}>Z-up</option><option value="y" ${flow.job.upAxis === "y" ? "selected" : ""}>Y-up</option></select></label><p class="job-hint">STL, binary or ASCII · millimetres · up to 250 MB per file. Jaws keep their original positions. A bite-reference scan does not automatically align them.</p></div></div>`;
  }
  function review() {
    const j = flow.job, units = restoredUnits(j);
    return `<div class="flow-grid"><section class="panel"><div class="panel-head"><h2 class="panel-title">Job definition</h2></div><div class="panel-body stack"><h3>${esc(j.name || (units.length === 1 ? `Crown ${units[0].fdi}` : "Bridge"))}</h3><div class="job-review-table"><table class="table"><thead><tr><th>Tooth</th><th>Indication</th><th>Material</th><th>Shade</th></tr></thead><tbody>${j.units.map(u => `<tr><td>${u.fdi}</td><td>${INDICATIONS[u.indication].label}</td><td>${esc(u.material)}</td><td>${esc(u.shade)}</td></tr>`).join("")}</tbody></table></div><p>${j.connectors.length ? `Connectors: ${j.connectors.map(c => `${c.a}–${c.b}`).join(", ")}` : "Single-unit job"}</p><p class="job-hint">The CAD editor opens the prepared tooth for margin definition. Bridges continue through the manual pontic and connector tools. Check scan orientation and bite in WebGL.</p></div></section><aside class="stack"><section class="panel"><div class="panel-head"><h2 class="panel-title">Input scans</h2></div>${requirementList()}<div class="panel-body">${flow.files.map(f => `<p>${esc(scanPlan(j).find(s => s.id === f.slot)?.label)}: <strong>${esc(f.name)}</strong></p>`).join("")}</div></section></aside></div>`;
  }
  function render() {
    if (disposed) return;
    view.innerHTML = `<div class="page job-intake"><header class="page-head"><div><p class="crumbs"><a href="/workspace/cases">Cases</a> / New job</p><h1 class="page-title">New dental job / appointment</h1><p class="job-hint">Define the restorations first. The scan plan follows your tooth indications.</p></div></header>
      <ol class="stepper">${["Define job", "Import required scans", "Review & open CAD"].map((s, i) => `<li ${flow.step === i + 1 ? 'aria-current="step"' : ""}><span class="n">${i + 1}</span><strong>${s}</strong></li>`).join("")}</ol>
      <div class="job-error banner banner-warn" role="alert" ${flow.error ? "" : "hidden"}>${esc(flow.error)}</div>
      ${flow.step === 1 ? definitions() : flow.step === 2 ? scans() : review()}
      <div class="flow-actions">${flow.step > 1 ? button("‹ Back", 'data-action="back"') : '<a class="btn btn-quiet" href="/workspace/cases">Cancel</a>'}
      ${flow.step === 3 ? button(flow.saving ? "Saving…" : "Save job & open WebGL", 'data-action="create"', true) : button(flow.step === 1 ? "Continue to scans ›" : "Review job ›", 'data-action="next"', true)}</div>
    </div>`;
    if (flow.saving) view.querySelectorAll("button,input,select,textarea").forEach(e => e.disabled = true);
  }
  async function addFile(slot, file) {
    if (!file || disposed || processing()) return;
    const f = { id: uid(), slot, name: file.name, size: file.size, status: "reading", progress: 0 };
    flow.files = flow.files.filter(x => x.slot !== slot); flow.files.push(f);
    const live = () => !disposed && flow.files.includes(f);
    render();
    try {
      if (!/\.stl$/i.test(file.name)) throw new Error("Choose an STL file (binary or ASCII).");
      if (file.size > 250 * 1024 * 1024) throw new Error("This file exceeds the 250 MB scan limit.");
      f.buffer = await readFile(file, p => { if (live()) { f.progress = p * .4; updateProgress(f); } });
      if (!live()) return;
      f.status = "parsing"; render();
      const { stats } = await parseSTL(f.buffer.slice(0), f.name, p => { if (live()) { f.progress = .4 + p * .6; updateProgress(f); } });
      if (!live()) return;
      if (!stats.triangles) throw new Error("The STL does not contain any triangles.");
      f.stats = stats; f.status = "valid";
    } catch (error) { if (live()) { f.status = "error"; f.error = error.message; f.buffer = null; } }
    if (live()) render();
  }
  function updateProgress(f) {
    const node = view.querySelector(`[data-drop-slot="${f.slot}"] .job-file p`);
    if (node) node.textContent = `${f.status === "reading" ? "Reading" : "Validating"}… ${Math.round(f.progress * 100)}%`;
  }
  async function save() {
    if (flow.saving || processing()) return;
    const errors = [...jobProblems(flow.job), ...scanProblems(flow.job, flow.files)];
    if (errors.length) { flow.error = errors[0]; render(); return; }
    flow.saving = true; render();
    try {
      const id = await io.nextCaseId();
      const c = caseFromJob(flow.job, flow.files, { id });
      await io.persistCase(c, flow.files.map(f => ({ id: f.id, caseId: id, buffer: f.buffer })));
      flow.saved = true; flow.saving = false;
      toast(`${id} saved. Opening the ${c.restoration === "bridge" ? "bridge" : "crown"} workspace.`);
      io.navigate(`/workspace/case/${id}`);
    } catch (error) { flow.saving = false; flow.error = `Could not save this job: ${error.message}`; render(); }
  }
  view.addEventListener("input", e => {
    const key = e.target.dataset.job;
    if (key) flow.job[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (e.target.dataset.unit) draft[e.target.dataset.unit] = e.target.value;
    if (e.target.dataset.parameter) flow.job.parameters[e.target.dataset.parameter] = Number(e.target.value);
  }, { signal: abort.signal });
  view.addEventListener("change", e => {
    if (e.target.dataset.slot) { void addFile(e.target.dataset.slot, e.target.files[0]); return; }
    const key = e.target.dataset.job;
    if (key) { flow.job[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value; if (["useAntagonist", "preop", "gingiva", "bite", "scanMode"].includes(key)) render(); }
    if (e.target.dataset.unit) draft[e.target.dataset.unit] = e.target.value;
    if (e.target.dataset.connector) {
      const [a, b] = e.target.dataset.connector.split(":").map(Number);
      flow.job.connectors = flow.job.connectors.filter(c => connectorKey(c.a, c.b) !== connectorKey(a, b));
      if (e.target.checked) flow.job.connectors.push({ a, b });
    }
  }, { signal: abort.signal });
  view.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b || b.disabled || flow.saving) return;
    try {
      flow.error = "";
      if (b.dataset.quick) { flow.quick = b.dataset.quick; flow.anchor = null; render(); return; }
      if (b.dataset.tooth) {
        const fdi = Number(b.dataset.tooth);
        if (flow.quick === "bridge") {
          if (!flow.anchor) flow.anchor = fdi;
          else { bridgePreset(flow.job, flow.anchor, fdi); flow.quick = null; flow.anchor = null; }
        } else if (flow.quick === "crown") {
          flow.job.units = flow.job.units.filter(u => !["crown", "pontic"].includes(u.indication)); flow.job.connectors = [];
          setUnit(flow.job, fdi, { indication: "crown" }); flow.quick = null;
        } else if (e.ctrlKey || e.metaKey) setUnit(flow.job, fdi, draft);
        select(fdi); render(); return;
      }
      if (b.dataset.remove) { flow.files = flow.files.filter(f => f.slot !== b.dataset.remove); render(); return; }
      const action = b.dataset.action;
      if (action === "apply-unit") { setUnit(flow.job, flow.selected, draft); flow.quick = null; }
      if (action === "clear-unit") { setUnit(flow.job, flow.selected, null); select(flow.selected); }
      if (action === "back") flow.step--;
      if (action === "next") {
        const problems = flow.step === 1 ? jobProblems(flow.job) : scanProblems(flow.job, flow.files);
        if (problems.length) flow.error = problems[0]; else flow.step++;
      }
      if (action === "create") { await save(); return; }
      render();
    } catch (error) { flow.error = error.message; render(); }
  }, { signal: abort.signal });
  view.addEventListener("dragover", e => { if (e.target.closest("[data-drop-slot]")) e.preventDefault(); }, { signal: abort.signal });
  view.addEventListener("drop", e => { const card = e.target.closest("[data-drop-slot]"); if (card) { e.preventDefault(); void addFile(card.dataset.dropSlot, e.dataTransfer.files[0]); } }, { signal: abort.signal });
  render();
  return { flow, dispose() { disposed = true; abort.abort(); flow.files = []; } };
}
