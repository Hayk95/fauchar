import { WORKFLOW, initialStep, workflowProblem, workflowForCase } from "./workflow.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** CAD-only desktop layout. Every command calls the real editor/viewer; no demo timers. */
export function mountDentalSession(editor, cad) {
  const caseView = cad.closest(".case-view");
  caseView.classList.add("dental-case");
  cad.classList.add("dental-cad");
  document.documentElement.dataset.dentalSession = "1";
  const abort = new AbortController(), signal = abort.signal;
  const layers = document.createElement("div"); layers.className = "dental-layers"; layers.setAttribute("aria-label", "Scene objects"); cad.prepend(layers);
  const rail = document.createElement("div"); rail.className = "dental-commands"; rail.setAttribute("role", "toolbar"); rail.setAttribute("aria-label", "CAD commands");
  rail.innerHTML = [["save", "Save", "▣"], ["mode", "Expert / Wizard", "◇"], ["tools", "Tools", "+"], ["distance", "Distances", "↔"], ["cut", "Cut view", "◩"], ["fit", "Fit", "⊞"], ["quality", "Quality", "◉"], ["case", "Case info", "i"]].map(([id, name, mark]) => `<button type="button" data-session="${id}" title="${name}"><span aria-hidden="true">${mark}</span>${name}</button>`).join("");
  cad.append(rail);
  const stages = document.createElement("nav"); stages.className = "dental-workflow"; stages.setAttribute("aria-label", "Restoration workflow"); cad.append(stages);
  const props = cad.querySelector("#props");
  const head = document.createElement("div"); head.className = "dental-wizard-head"; props.prepend(head);
  const footer = document.createElement("div"); footer.className = "dental-wizard-footer";
  footer.innerHTML = `<button type="button" data-session="back">‹ Back</button><button type="button" data-session="next">Next ›</button><button type="button" data-session="cancel" hidden>Cancel calculation</button>`;
  props.append(footer);
  let disposed = false, changing = false, layerKey = "", current = initialStep(editor);
  editor.workflow.mode = editor.workflow.mode === "expert" ? "expert" : "wizard";
  const visibleSteps = () => current === "bridge" ? WORKFLOW : workflowForCase(editor.caseData, editor.units.length > 1);
  function refresh() {
    if (disposed) return;
    const definition = WORKFLOW.find(s => s.id === current);
    head.innerHTML = `<strong>${esc(definition.label)}</strong><span>${editor.workflow.mode === "expert" ? "EXPERT" : "WIZARD"}</span><p>${esc(definition.hint)}</p>`;
    stages.innerHTML = visibleSteps().map((s, i) => `<button type="button" data-stage="${s.id}" aria-current="${s.id === current ? "step" : "false"}" ${editor.busy ? "disabled" : ""}><span>${String(i + 1).padStart(2, "0")}</span>${s.label}</button>`).join("");
    const objects = [...editor.objects.values()];
    const key = objects.map(o => `${o.id}:${o.name}`).join("|");
    if (key !== layerKey) {
      layerKey = key;
      layers.innerHTML = objects.map(o => `<label><input type="checkbox" data-scene-object="${esc(o.id)}">${esc(o.name)}<input type="range" data-scene-alpha="${esc(o.id)}" min="0.1" max="1" step="0.05" aria-label="${esc(o.name)} opacity"></label>`).join("") + `<button type="button" data-session="show-all">Show all</button>`;
    }
    layers.querySelectorAll("[data-scene-object]").forEach(input => { input.checked = editor.objects.get(input.dataset.sceneObject)?.visible !== false; });
    layers.querySelectorAll("[data-scene-alpha]").forEach(input => { input.value = editor.objects.get(input.dataset.sceneAlpha)?.alpha ?? 1; });
    footer.querySelector('[data-session="back"]').disabled = current === "scan" || editor.busy;
    footer.querySelector('[data-session="next"]').disabled = current === "export" || editor.busy;
    footer.querySelector('[data-session="cancel"]').hidden = !editor.busy;
    editor.panelEl.querySelectorAll("button,input,select").forEach(control => {
      if (editor.busy) { if (!control.disabled) { control.dataset.busyDisabled = "1"; control.disabled = true; } }
      else if (control.dataset.busyDisabled) { control.disabled = false; delete control.dataset.busyDisabled; }
    });
    rail.querySelectorAll("button").forEach(b => { b.disabled = editor.busy && !["fit", "quality"].includes(b.dataset.session); });
    rail.querySelector('[data-session="mode"]').setAttribute("aria-pressed", String(editor.workflow.mode === "expert"));
    cad.dataset.workflowMode = editor.workflow.mode;
  }
  function go(step, force = false) {
    if (editor.busy || changing) return;
    if (!force && editor.workflow.mode === "wizard") {
      const problem = workflowProblem(editor, step);
      if (problem) { editor.io.toast(problem, "warn"); return; }
    }
    changing = true;
    current = step;
    editor.workflow.step = step;
    const def = WORKFLOW.find(s => s.id === step);
    editor.setTool(def.tool);
    cad.querySelector('[data-props-tab="design"]').click();
    // The loaded crown must remain selectable even after editing the preparation.
    editor.markDirty();
    changing = false;
    refresh();
  }
  const listener = async e => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    try {
      if (b.dataset.stage) { go(b.dataset.stage); return; }
      const cmd = b.dataset.session;
      if (cmd === "next" || cmd === "back") {
        const steps = visibleSteps();
        const index = steps.findIndex(s => s.id === current) + (cmd === "next" ? 1 : -1);
        if (steps[index]) go(steps[index].id);
      }
      if (cmd === "save") { const ok = await editor.saveDesign(); editor.io.toast(ok ? "Design saved in this browser." : "Could not save this design.", ok ? undefined : "error"); }
      if (cmd === "mode") { editor.workflow.mode = editor.workflow.mode === "wizard" ? "expert" : "wizard"; editor.markDirty(); refresh(); }
      if (cmd === "tools") { editor.setTool("view"); }
      if (cmd === "fit") editor.viewer.fit();
      if (cmd === "distance") { if (!editor.crown || !editor.antagonist) { editor.io.toast("Distance analysis needs a crown and antagonist scan.", "warn"); return; } editor.setMap("occlusion"); }
      if (cmd === "cut") { editor.section.on = !editor.section.on; editor.updateSection(); editor.renderPanel(); }
      if (cmd === "case") cad.querySelector('[data-props-tab="case"]').click();
      if (cmd === "show-all") { for (const obj of editor.objects.values()) { editor.setVisible(obj, true); editor.io.onVisibility?.(obj, true); } refresh(); }
      if (cmd === "cancel") editor.kernel.cancel();
      if (cmd === "quality") {
        editor.viewer.pixelRatioLimit = editor.viewer.pixelRatioLimit === 1 ? 1.5 : 1;
        b.setAttribute("aria-pressed", String(editor.viewer.pixelRatioLimit === 1));
        editor.viewer.render();
        editor.io.toast(editor.viewer.pixelRatioLimit === 1 ? "Fast preview: capped at 1× pixels. Export geometry is unchanged." : "Sharp preview: capped at 1.5× pixels. Export geometry is unchanged.");
      }
    } catch (error) { editor.io.toast(error.message, "error"); }
  };
  cad.addEventListener("click", listener, { signal });
  layers.addEventListener("change", e => {
    const id = e.target.dataset.sceneObject;
    const obj = id && editor.objects.get(id);
    if (obj) { editor.setVisible(obj, e.target.checked); editor.io.onVisibility?.(obj, e.target.checked); refresh(); }
  }, { signal });
  layers.addEventListener("input", e => {
    const id = e.target.dataset.sceneAlpha;
    if (id) editor.setAlpha(editor.objects.get(id), Number(e.target.value));
  }, { signal });
  const session = { refresh, go, onToolChange(tool) {
    if (changing) return;
    const aliases = { crown: "bottom", anatomy: "freeform", contacts: "contacts", teeth: "scan" };
    const step = aliases[tool] || WORKFLOW.find(s => s.tool === tool)?.id;
    if (step) { current = step; editor.workflow.step = step; editor.markDirty(); }
  }, get step() { return current; }, dispose() {
    disposed = true; abort.abort(); delete document.documentElement.dataset.dentalSession;
    caseView.classList.remove("dental-case"); cad.classList.remove("dental-cad");
    [layers, rail, stages, head, footer].forEach(el => el.remove());
  } };
  editor.session = session;
  go(current, true);
  return session;
}
