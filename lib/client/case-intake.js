import { INDICATIONS, MATERIAL_CATALOG, SHADES, newJob, setUnit, bridgePreset, restoredUnits, jobProblems, scanPlan, scanProblems, caseFromJob, connectorKey } from "./case-plan.js";
import { dentalChartMarkup } from "./dental-chart.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const button = (label, attr = "", primary = false) => `<button type="button" class="btn btn-sm ${primary ? "btn-primary" : ""}" ${attr}>${label}</button>`;

/** Define the job first; import only its requested scan roles; then open the actual CAD case. */
export function mountCaseIntake(io) {
  const { view, uid, readFile, parseSTL, toast } = io;
  const flow = { step: 1, job: newJob(), files: [], selected: 22, quick: null, anchor: null, saved: false, saving: false, error: "", dialogOpen: false };
  let disposed = false, draft = { indication: "crown", material: flow.job.material, shade: flow.job.shade };
  let draftOptions = {}, draftParameters = {};
  const documentRoot = view.ownerDocument?.documentElement;
  if (documentRoot) documentRoot.dataset.dentalIntake = "1";
  const abort = new AbortController();
  const processing = () => flow.files.some(f => ["reading", "parsing"].includes(f.status));
  const selectedUnit = () => flow.job.units.find(u => u.fdi === flow.selected);
  function select(fdi) {
    flow.selected = fdi;
    draft = { indication: "crown", material: flow.job.material, shade: flow.job.shade, production: flow.job.production, ...selectedUnit() };
    draftOptions = { preop: flow.job.preop, gingiva: flow.job.gingiva, bite: flow.job.bite };
    draftParameters = { ...flow.job.parameters };
  }
  const field = (label, key, value, type = "text", max = 80) => `<label class="field"><span>${label}</span><input type="${type}" data-job="${key}" value="${esc(value)}" maxlength="${max}"></label>`;
  const selectField = (label, key, options, value) => `<label class="field"><span>${label}</span><select class="select" data-job="${key}">${options.map(([v, l]) => `<option value="${v}" ${value === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
  const requirementList = () => `<ul class="job-scan-needs">${scanPlan(flow.job).map(s => `<li><strong>${esc(s.label)}</strong><span>${s.required ? "Required" : "Recommended"}${s.reference ? " · reference only" : ""}</span></li>`).join("") || "<li>Select the restoration teeth to see the scan plan.</li>"}</ul>`;
  const icon = name => `<svg class="ico" aria-hidden="true"><use href="#w-${name}"/></svg>`;
  function definitions() {
    const j = flow.job, units = restoredUnits(j);
    const status = units.length ? `${units.length} restoration unit${units.length === 1 ? "" : "s"} defined` : "Please select a client and define the restorations.";
    const chartSelection = flow.dialogOpen || j.units.some(u => u.fdi === flow.selected) ? flow.selected : null;
    return `<div class="db-workbench">
      <section class="db-project"><header class="db-panel-heading"><h2>Project</h2><div class="db-project-tools">
        ${button(`${icon("plus")}New`, 'data-action="new-job"')}
        <a class="btn btn-sm" href="/workspace/cases">${icon("folder")}Load</a>
        ${button(`${icon("file")}Save`, 'disabled title="Import the requested scans before saving this job"')}
        ${button(`${icon("file")}Duplicate`, 'disabled title="Available for saved projects"')}</div></header>
        <div class="db-project-body">
          <p class="db-project-message">${esc(status)}</p>
          <div class="db-form-row">${field("Due", "dueDate", j.dueDate, "date")}${field("Case ID", "patientRef", j.patientRef, "text", 32)}</div>
          ${field("Client", "client", j.client, "text", 60)}${field("Name / case", "name", j.name)}${field("Technician", "technician", j.technician, "text", 60)}
          <label class="field db-notes"><span>Notes</span><textarea data-job="notes" maxlength="1000" placeholder="Type notes here…">${esc(j.notes)}</textarea></label>
        </div>
        <div class="db-preview"><div class="db-preview-tabs"><strong>3D PREVIEW</strong><span>SCAN DATA</span></div>
          <div class="db-preview-content">${icon("cube")}<span>${flow.files.length ? `${flow.files.length} scan file${flow.files.length === 1 ? "" : "s"} selected` : "Project not yet saved"}</span></div>
          <div class="db-project-state"><span class="db-state-dot"></span>Job definition<span class="db-state-dot pending"></span>Scan<span class="db-state-dot pending"></span>CAD</div>
        </div>
      </section>
      <section class="db-indications"><header class="db-panel-heading"><h2>Indication and materials</h2><span class="db-patient-mode">Patient</span></header>
        <div class="db-chart-help" role="status">${flow.quick === "bridge" ? (flow.anchor ? `Abutment ${flow.anchor} selected. Click the last abutment.` : "Click the first and last bridge abutments.") : flow.quick === "crown" ? "Click the prepared tooth to create a single crown." : "Select a tooth to define its indication and material. Ctrl-click copies the last settings."}</div>
        <div class="db-chart-region">${dentalChartMarkup(j, chartSelection)}
          <div class="db-chart-shortcuts">${button("Single crown", 'data-quick="crown"', flow.quick === "crown")}${button("Bridge", 'data-quick="bridge"', flow.quick === "bridge")}</div>
          <div class="db-indication-key"><span class="role-crown">Anatomic crown</span><span class="role-pontic">Anatomic pontic</span><span class="role-adjacent">Adjacent tooth</span><span class="role-antagonist">Antagonist</span></div>
        </div>
        <div class="db-scan-settings">${selectField("Scan mode", "scanMode", [["intraoral", "Digital impression / intraoral"], ["model", "Two models in occlusion"]], j.scanMode)}${field("Tooth shade", "shade", j.shade, "text", 20)}
          <label class="db-antagonist"><input type="checkbox" data-job="useAntagonist" ${j.useAntagonist ? "checked" : ""}>Use antagonist scan</label>
          <div class="db-extra-summary">${[j.preop && "Pre-op", j.gingiva && "Gingiva", j.bite && "Bite reference"].filter(Boolean).join(" · ") || "Additional scans can be set in the tooth definition."}</div>
        </div>
        <details class="db-required-scans"><summary>Required scan data · ${scanPlan(j).filter(s => s.required).length} files</summary>${requirementList()}</details>
      </section>
      <aside class="db-actions"><h2>Actions</h2>
        ${button(`${icon("upload")}<span>Scan</span>`, 'data-action="next"', true)}
        ${button(`${icon("tooth")}<span>Design</span>`, 'disabled title="Define the job and import its scans first"')}
        ${button(`${icon("cube")}<span>Model Creator</span>`, 'disabled title="Module not implemented"')}
        ${button(`${icon("settings")}<span>Manufacture</span>`, 'disabled title="CAM integration not configured"')}
        ${button(`${icon("share")}<span>Share</span>`, 'disabled title="Sharing module not configured"')}
        <a class="btn btn-sm db-back" href="/workspace/cases">${icon("folder")}<span>Cases</span></a>
      </aside>
    </div>`;
  }
  const indicationIcon = `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M6 5Q10 1 16 6Q22 1 26 5Q30 10 26 18L23 28Q21 31 19 23L16 18L13 23Q11 31 9 28L6 18Q2 10 6 5Z"/><path d="M7 29H26" stroke="currentColor" stroke-width="2"/></svg>`;
  function materialArt(m) {
    return `<svg viewBox="0 0 100 82" aria-hidden="true">${m.shape === "block" ? `<rect x="41" y="6" width="18" height="28" rx="3" fill="#b8bbc0"/><path d="M43 10H57M43 15H57M43 20H57" stroke="#73777c"/><path d="M25 36L65 30L77 39V75L37 80L25 71Z" fill="${m.color}"/><path d="M37 44L77 39V75L37 80Z" fill="#000" opacity=".07"/>` : m.shape === "bridge" ? `<path d="M12 39Q50 67 88 39V59Q50 88 12 59Z" fill="${m.color}" stroke="#a4a0a0"/>${[20,40,60,80].map((x, i) => `<path d="M${x-8} ${34+i%2*5}Q${x} ${23+i%2*5} ${x+8} ${34+i%2*5}L${x+6} 57Q${x} 64 ${x-6} 57Z" fill="${m.color}" stroke="#8f887d"/>`).join("")}` : `<circle cx="50" cy="43" r="37" fill="${m.color}" stroke="#cbd0cf" stroke-width="2"/>${m.shape === "layered" ? '<path d="M17 60Q50 28 83 57L79 68Q48 92 17 60Z" fill="#b7bfd2" opacity=".6"/>' : ""}<path d="M20 30Q30 7 57 11" fill="none" stroke="#fff" stroke-width="3" opacity=".5"/>`}</svg>`;
  }
  function indicationPalette(inDialog = false) {
    const groups = [...new Set(Object.values(INDICATIONS).map(v => v.group))];
    return `<div class="db-indication-list">${groups.map(group => `<h4>${group}</h4><div class="db-type-grid">${Object.entries(INDICATIONS).filter(([, v]) => v.group === group).map(([id, v]) => `<button type="button" style="--indication-color:${v.color}" ${inDialog ? "data-indication" : "data-start-indication"}="${id}" aria-pressed="${draft.indication === id}" ${v.supported ? "" : 'disabled title="Design engine not implemented"'}>${indicationIcon}<span>${v.label}</span>${v.supported ? "" : '<span class="db-module-mark" aria-label="Module unavailable">○</span>'}</button>`).join("")}</div>`).join("")}</div><p class="job-hint">○ Design engine unavailable</p>`;
  }
  function toothDialog() {
    return `<dialog class="db-tooth-dialog" aria-labelledby="db-tooth-dialog-title"><header class="db-dialog-title"><h2 id="db-tooth-dialog-title">Tooth ${flow.selected}</h2><span>1 Restoration · 2 Material · 3 Options and parameters</span>${button("×", 'data-action="cancel-unit" aria-label="Close tooth definition"')}</header>
      <div class="db-dialog-columns"><section class="db-restoration-column"><h3>Restoration</h3>${indicationPalette(true)}</section>
      <section class="db-material-column"><h3>Material</h3><select class="select" aria-label="Production method" data-unit="production">${[["milling", "5-axis milling"], ["printing", "Laser / 3D print"], ["external", "External laboratory"]].map(([id, label]) => `<option value="${id}" ${draft.production === id ? "selected" : ""}>${label}</option>`).join("")}</select><div class="db-material-list">${MATERIAL_CATALOG.map(m => `<button type="button" data-material="${m.name}" aria-pressed="${draft.material === m.name}">${materialArt(m)}<span>${m.name === "PMMA" ? "Acrylic/PMMA" : m.name}</span></button>`).join("")}</div><p class="job-hint">Planning materials. Enter parameters for the selected product; manufacturer presets are not supplied.</p></section>
      <section class="db-options-column"><h3>Options & Parameters</h3>
        <fieldset class="db-implant-options" disabled><legend>Implant-based?</legend><div class="db-option-tiles"><button type="button" style="--option-color:#ac245d">Custom Abutment</button><button type="button" style="--option-color:#328a16">Screw retained</button><button type="button" style="--option-color:#61add0">On substructure scan</button><button type="button" style="--option-color:#65a275">On abutment</button></div><small>Implant engine unavailable</small></fieldset>
        <h4>Additional scans</h4><div class="db-extra-options db-option-tiles">${[["preop", "Pre-op model", "#70bfc7"], ["gingiva", "Extra Gingiva Scan", "#b878b1"], ["bite", "Bite reference", "#7799b8"]].map(([key, label, color]) => `<label style="--option-color:${color}"><input type="checkbox" data-option="${key}" ${draftOptions[key] ? "checked" : ""}>${label}</label>`).join("")}</div>
        <h4>Design virtual gingiva?</h4><div class="db-option-tiles" title="Virtual gingiva engine not implemented"><button type="button" disabled>No (expert mode only)</button><button type="button" disabled>Optional (ask in Wizard)</button><button type="button" disabled>Yes</button></div>
        <h4>Design with thimble crown workflow?</h4><div class="db-option-tiles" title="Thimble engine not implemented"><button type="button" disabled>No</button><button type="button" disabled>Yes</button></div>
        <h4>Cervical adaptation</h4><div class="db-option-tiles"><span class="db-fixed-option">Pull to margin</span><button type="button" disabled title="Library-preserving cervical adaptation unavailable">Preserve tooth library shape</button></div>
        <div class="db-primary-parameters">${[["cementGap", "Gap width of cement", 0, .3, .01], ["minWall", "Minimal thickness", .3, 3, .05]].map(([key,label,min,max,step]) => `<label><span>${label}</span><output data-parameter-output="${key}">${draftParameters[key]} mm</output><input aria-label="${label}" type="range" data-modal-parameter="${key}" value="${draftParameters[key]}" min="${min}" max="${max}" step="${step}"></label>`).join("")}</div>
        <details class="db-dialog-parameters"><summary>Show advanced parameters</summary>${[["marginGap", "Margin gap"], ["marginWall", "Margin border"]].map(([key, label]) => `<label>${label}<input type="number" data-modal-parameter="${key}" value="${draftParameters[key]}" step="0.01" min="0" max="1"><span>mm</span></label>`).join("")}</details>
        <h4>Material shade</h4><div class="db-shade-grid">${SHADES.map((shade, i) => `<button type="button" data-shade="${shade}" style="--shade-color:hsl(42 32% ${94-i%5*4}%)" aria-pressed="${draft.shade === shade}">${shade}</button>`).join("")}</div>
        <label class="field db-custom-shade"><span>Custom shade</span><input aria-label="Material shade" data-unit="shade" value="${esc(draft.shade)}" maxlength="20"></label>
      </section></div><footer>${button("Clear", 'data-action="clear-unit"')}${button("Cancel", 'data-action="cancel-unit"')}${button("✓ OK", 'data-action="apply-unit"', true)}</footer>
    </dialog>`;
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
    view.innerHTML = `<div class="page job-intake dentaldb-intake"><header class="db-application-bar"><span class="db-brand">FAUCHAR</span><span>Dental workspace</span><span class="db-job-caption">${esc(flow.job.name || "New project")}</span></header>
      ${flow.step > 1 ? `<div class="db-step-heading"><h1>${flow.step === 2 ? "Import scan data" : "Review job & open CAD"}</h1><span>Project → Scan → Design</span></div>` : ""}
      <div class="job-error banner banner-warn" role="alert" ${flow.error ? "" : "hidden"}>${esc(flow.error)}</div>
      ${flow.step === 1 ? definitions() : `<div class="db-import-page">${flow.step === 2 ? scans() : review()}</div>`}
      <footer class="db-bottom-bar"><span>${flow.step === 1 ? "Project not yet saved" : flow.step === 2 ? "Assign scans to the requested roles" : "Ready to save job and open WebGL"}</span><div>${flow.step > 1 ? button("‹ Back", 'data-action="back"') : '<a class="btn btn-sm" href="/workspace/cases">Close</a>'}
      ${flow.step === 3 ? button(flow.saving ? "Saving…" : "Save & start design", 'data-action="create"', true) : button(flow.step === 1 ? "Scan ›" : "Review job ›", 'data-action="next"', true)}</div></footer>
      ${flow.dialogOpen ? toothDialog() : ""}
    </div>`;
    const dialog = view.querySelector(".db-tooth-dialog");
    if (dialog) {
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
      dialog.addEventListener("cancel", e => { e.preventDefault(); flow.dialogOpen = false; render(); view.querySelector(`[data-tooth="${flow.selected}"]`)?.focus(); });
    }

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
    if (e.target.dataset.modalParameter) {
      draftParameters[e.target.dataset.modalParameter] = Number(e.target.value);
      const output = view.querySelector(`[data-parameter-output="${e.target.dataset.modalParameter}"]`);
      if (output) output.textContent = `${e.target.value} mm`;
    }
    if (e.target.dataset.option) draftOptions[e.target.dataset.option] = e.target.checked;
  }, { signal: abort.signal });
  view.addEventListener("change", e => {
    if (e.target.dataset.slot) { void addFile(e.target.dataset.slot, e.target.files[0]); return; }
    const key = e.target.dataset.job;
    if (key) { flow.job[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value; if (["useAntagonist", "preop", "gingiva", "bite", "scanMode"].includes(key)) render(); }
    if (e.target.dataset.unit) draft[e.target.dataset.unit] = e.target.value;
    if (e.target.dataset.option) draftOptions[e.target.dataset.option] = e.target.checked;
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
      if (b.dataset.startIndication) { select(flow.selected); draft.indication = b.dataset.startIndication; flow.dialogOpen = true; render(); return; }
      if (b.dataset.indication) { draft.indication = b.dataset.indication; render(); return; }
      if (b.dataset.shade) { draft.shade = b.dataset.shade; render(); return; }
      if (b.dataset.material) { draft.material = b.dataset.material; render(); return; }
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
        else flow.dialogOpen = true;
        select(fdi); render(); return;
      }
      if (b.dataset.remove) { flow.files = flow.files.filter(f => f.slot !== b.dataset.remove); render(); return; }
      const action = b.dataset.action;
      if (action === "apply-unit") {
        setUnit(flow.job, flow.selected, draft); flow.quick = null; flow.dialogOpen = false;
        flow.job.material = draft.material; flow.job.shade = draft.shade; flow.job.production = draft.production;
        Object.assign(flow.job, draftOptions); Object.assign(flow.job.parameters, draftParameters);
      }
      if (action === "cancel-unit") flow.dialogOpen = false;
      if (action === "new-job") { flow.job = newJob(); flow.files = []; flow.quick = null; flow.anchor = null; select(22); }
      if (action === "clear-unit") { setUnit(flow.job, flow.selected, null); select(flow.selected); flow.dialogOpen = false; }
      if (action === "back") flow.step--;
      if (action === "next") {
        const problems = flow.step === 1 ? jobProblems(flow.job) : scanProblems(flow.job, flow.files);
        if (problems.length) flow.error = problems[0]; else flow.step++;
      }
      if (action === "create") { await save(); return; }
      render();
      if (["apply-unit", "clear-unit", "cancel-unit"].includes(action)) view.querySelector(`[data-tooth="${flow.selected}"]`)?.focus();
    } catch (error) { flow.error = error.message; render(); }
  }, { signal: abort.signal });
  view.addEventListener("dragover", e => { if (e.target.closest("[data-drop-slot]")) e.preventDefault(); }, { signal: abort.signal });
  view.addEventListener("drop", e => { const card = e.target.closest("[data-drop-slot]"); if (card) { e.preventDefault(); void addFile(card.dataset.dropSlot, e.dataTransfer.files[0]); } }, { signal: abort.signal });
  view.addEventListener("keydown", e => {
    const tooth = e.target.closest("[data-tooth]");
    if (!tooth || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const buttons = [...view.querySelectorAll("[data-tooth]")], index = buttons.indexOf(tooth);
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16 }[e.key];
    e.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))]?.focus();
  }, { signal: abort.signal });
  render();
  return { flow, dispose() { disposed = true; abort.abort(); flow.files = []; if (documentRoot) delete documentRoot.dataset.dentalIntake; } };
}
