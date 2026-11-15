/**
 * FAUCHAR CAD tool panels. Each panel only drives real operations on the editor;
 * anything a case can't support (no antagonist, no die) says so instead of pretending.
 */
import * as ops from "./ops.js";
import { MAPS } from "./editor.js";
import { ARCH_ORDER, jawOfFdi } from "./teeth.js";
import { TOOTH_LIBRARY, morphologyForTooth } from "./anatomy-library.js";
import { TOOTH_ATLAS } from "./tooth-atlas.js";

/** Occlusal silhouette of the library tooth, widened or narrowed the way the variation changes its table. */
function toothThumbnail(fdi, item) {
  const a = TOOTH_ATLAS[fdi];
  if (!a) return `<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="28" fill="#d9cfb6"/></svg>`;
  const k = 30 / Math.max(a.md, a.bl) * (item.table / 0.86) ** 0.5;
  const pts = a.outline.map(([u, w]) => `${(40 + u * k).toFixed(1)},${(40 - w * k).toFixed(1)}`).join(" ");
  const inner = a.outline.map(([u, w]) => `${(40 + u * k * item.table * 0.62).toFixed(1)},${(40 - w * k * item.table * 0.62).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 80 80" aria-hidden="true"><polygon points="${pts}" fill="#efe7d4" stroke="#9c8f71" stroke-width="1.2"/><polygon points="${inner}" fill="none" stroke="#bcae8c" stroke-width="${(0.6 + item.groove).toFixed(2)}" stroke-dasharray="3 2"/></svg>`;
}

export const TOOLS = [
  { id: "teeth", label: "Teeth", key: "q", title: "Identify teeth and correct their FDI numbers" },
  { id: "transform", label: "Move", key: "t", title: "Move, rotate and scale objects" },
  { id: "library", label: "Library", key: "l", title: "Original tooth forms and your local restoration STL library" },
  { id: "anatomy", label: "Anatomy", key: "a", title: "Tooth shape, surfaces, cusps, ridges, grooves" },
  { id: "sculpt", label: "Sculpt", key: "s", title: "Add, remove, smooth, flatten" },
  { id: "margin", label: "Margin", key: "m", title: "Draw, edit and detect the margin line" },
  { id: "occlusion", label: "Occlusion", key: "o", title: "Opposing jaw distances and high contacts" },
  { id: "contacts", label: "Contacts", key: "c", title: "Mesial and distal contact points" },
  { id: "crown", label: "Crown", key: "d", title: "Cement gap, wall, insertion axis, emergence" },
  { id: "bridge", label: "Bridge", key: "b", title: "Pontics, connectors, units" },
  { id: "measure", label: "Measure", key: "e", title: "Distance, thickness, angle, section" },
  { id: "view", label: "View", key: "v", title: "Visibility, opacity, colour maps, compare" },
];

export const BRUSHES = [
  { id: "add", label: "Add", key: "y", tip: "Build material along the surface normal" },
  { id: "remove", label: "Remove", key: "h", tip: "Take material away" },
  { id: "smooth", label: "Smooth", key: "j", tip: "Even out bumps and scratches" },
  { id: "flatten", label: "Flatten", key: "k", tip: "Pull toward the local mean plane" },
  { id: "grab", label: "Grab", key: "l", tip: "Drag the surface freely" },
  { id: "ridge", label: "Ridge", key: "u", tip: "Raise a narrow ridge along the stroke" },
  { id: "groove", label: "Groove", key: "i", tip: "Carve a fissure along the stroke" },
  { id: "restore", label: "Restore", key: "p", tip: "Paint back the original surface" },
];

const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(d));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const sec = (title, body, open = true) => `<details class="cad-sec" ${open ? "open" : ""}><summary>${title}</summary><div class="cad-sec-body">${body}</div></details>`;
const slider = (id, label, min, max, step, value, unit = "", tip = "") => `
  <label class="cad-slider" ${tip ? `title="${esc(tip)}"` : ""}><span class="cad-slider-head"><span>${label}</span><output data-out="${id}">${formatValue(value, step)}${unit ? ` ${unit}` : ""}</output></span>
  <input type="range" data-slider="${id}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
const num = (id, label, value, step = 0.01, unit = "mm", attrs = "") => `<label class="cad-num"><span>${label}</span><span class="cad-num-in"><input type="number" data-num="${id}" step="${step}" value="${value}" ${attrs}><em>${unit}</em></span></label>`;
const btn = (act, label, cls = "", attrs = "") => `<button type="button" class="btn btn-sm ${cls}" data-act="${act}" ${attrs}>${label}</button>`;
const seg = (name, options, current) => `<div class="cad-seg" role="group">${options.map(([id, label, tip]) => `<button type="button" data-seg="${name}" data-val="${id}" aria-pressed="${id === current}" ${tip ? `title="${esc(tip)}"` : ""}>${label}</button>`).join("")}</div>`;
const row = (k, v, cls = "") => `<div class="cad-row"><span>${k}</span><strong class="${cls}">${v}</strong></div>`;
const note = (t, cls = "") => `<p class="cad-note ${cls}">${t}</p>`;

function formatValue(v, step) {
  const d = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  return Number(v).toFixed(d);
}

/* ------------------------------------------------------------------ panels */

function targetRow(ed) {
  const units = ed.units;
  if (units.length < 2) return "";
  return `<label class="cad-select"><span>Working on</span><select data-select-unit>${units.map((u) => `<option value="${esc(u.id)}" ${u.id === ed.selectedId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>`;
}

function brushControls(ed) {
  const o = ed.opts;
  return `
    ${slider("radius", "Radius", 0.15, 6, 0.05, o.radius, "mm", "[ and ] change the radius")}
    ${slider("strength", "Strength", 2, 100, 1, Math.round(o.strength * 100), "%", "Shift+[ and Shift+] change the strength")}
    <label class="cad-check"><input type="checkbox" data-check="protect" ${o.protect ? "checked" : ""}>Protect intaglio and margin</label>`;
}

function brushGrid(ed, ids) {
  return `<div class="cad-tools">${BRUSHES.filter((b) => ids.includes(b.id)).map((b) => `<button type="button" data-brush="${b.id}" aria-pressed="${ed.opts.brush === b.id}" title="${esc(b.tip)}">${b.label}<kbd>${b.key.toUpperCase()}</kbd></button>`).join("")}</div>`;
}

/** The FDI chart: `pick` decides what clicking a number does. */
function fdiChart(ed, jaws = ["upper", "lower"]) {
  const row = (jaw) => {
    const data = ed.teethData[jaw];
    const cells = ARCH_ORDER[jaw].map((fdi, k) => {
      const i = data?.model.teeth.findIndex((t) => t.fdi === fdi) ?? -1;
      const t = i >= 0 ? data.model.teeth[i] : null;
      const sel = ed.tool === "margin" ? ed.marginTooth === fdi : ed.selectedTooth?.jaw === jaw && ed.selectedTooth.i === i && i >= 0;
      const marked = ed.marginTooth === fdi ? !!ed.margin : ed.margins.has(fdi);
      const cls = [t ? (t.confidence < 0.6 ? "is-unsure" : "is-found") : "is-absent", sel ? "is-sel" : "", marked ? "has-margin" : "", k === 8 ? "is-mid" : ""].join(" ");
      return `<button type="button" class="${cls}" data-fdi="${fdi}" aria-pressed="${sel}" title="${t ? `${fdi}: ${t.width.toFixed(1)} mm${t.stump ? ", prepared" : ""}${t.partial ? ", cut off by the scan" : ""}${t.confidence < 0.6 ? ", check this one" : ""}` : `${fdi}: not found on the scan`}${marked ? ", margin marked" : ""}">${fdi}</button>`;
    }).join("");
    return `<div class="cad-chart-row">${cells}</div>`;
  };
  return `<div class="cad-chart">${jaws.map(row).join("")}<p class="cad-chart-side"><span>Patient right</span><span>Patient left</span></p></div>`;
}

const panels = {
  library(ed) {
    return sec("My STL library", `${note("Add restoration STLs you are permitted to reuse. Models stay in this browser. Import preserves original coordinates: position/scale manually and review fit; automatic anatomical fitting is not implemented.")}
      <label class="btn btn-sm cad-file">Add binary restoration STL<input type="file" accept=".stl" data-library-import hidden ${ed.libraryBusy ? "disabled" : ""}></label>
      ${btn("library-refresh", "Load my library")}
      <div class="cad-user-library">${ed.libraryModels.map(m => `<button type="button" data-library-model="${esc(m.id)}" ${ed.libraryBusy ? "disabled" : ""}><strong>${esc(m.name)}</strong><small>FDI ${esc(m.fdi)} · ${Number(m.triangles).toLocaleString()} triangles</small></button>`).join("") || note("No library models loaded. Add an STL or load your saved library.")}</div>`)
      + sec("Tooth library", `${note("Standard, Youthful, Broad, Square, Tapered and Worn are original forms in Crown bottom. Pick one for this tooth, build, then sculpt. Exocad's library is not included.")}${btn("to-construction", "Choose a tooth and build", "btn-primary")}`);
  },
  axis(ed) {
    return sec("Insertion direction", `${note("Rotate the scan until you look down the preparation, then use From view.")}
      ${btn("axis-view", "Set current view as insertion axis", "btn-primary")}
      ${row("Direction", ed.insertionAxis ? ed.insertionAxis.map(v => f(v, 3)).join(", ") : "Not set")}
      ${ed.crown?.frame || ed.axisFrame ? `${slider("tilt-m", "Mesial / distal", -25, 25, 0.5, ed.opts.axisTilt[0], "°")}${slider("tilt-f", "Facial / lingual", -25, 25, 0.5, ed.opts.axisTilt[1], "°")}` : ""}
      ${btn("axis-undercuts", ed.undercutActive ? "Hide undercuts" : "Show undercuts", "", ed.prep?.prepVerts?.length ? "" : "disabled")}
      ${note("Undercut analysis becomes available after the preparation has been segmented.")}`);
  },

  construction(ed) {
    const o = ed.opts;
    const tooth = Number(ed.marginTooth || ed.caseData.teeth?.[0] || 22);
    let kind = "tooth";
    try { kind = morphologyForTooth(tooth).replace("-", " "); } catch { /* keep the generic label */ }
    const chosen = TOOTH_LIBRARY.find(item => item.id === ed.construction.libraryId) || TOOTH_LIBRARY[0];
    const dropped = ed.droppedTooth;
    const droppedName = dropped ? esc(dropped.name.replace(/\.stl$/i, "")) : "";
    const place = dropped ? `Place ${droppedName}` : null;
    const file = TOOTH_ATLAS[tooth]?.file;
    const library = sec("Tooth library", `${dropped
      ? `${note(`${droppedName} will be placed on your margin${dropped.open ? " and closed with an intaglio" : ""}.`)}${btn("clear-dropped", `Use library tooth ${tooth} instead`)}`
      : note(file ? `Tooth ${tooth} (${kind}) from the library file ${file}. Place puts the original tooth on the preparation, set in the arch by its neighbours. You move, rotate or scale it; OK then cuts it at your margin and joins it to the crown bottom.` : `FDI ${tooth}, ${kind}. No library file for this tooth; the built-in form is used.`)}
      <div class="cad-anatomy-library">${TOOTH_LIBRARY.map(item => `<button type="button" data-tooth-library="${item.id}" aria-pressed="${chosen.id === item.id}" title="${esc(item.note)}">${toothThumbnail(tooth, item)}<span>${esc(item.label)}</span></button>`).join("")}</div>
      ${note(`${chosen.label}: ${chosen.note}. Drop another tooth STL on the 3D view to use it instead.`)}
      ${num("starter-relief", "Cusp relief", ed.construction.relief)}
      ${ed.crown
        ? `${btn("replace-crown", ed.busy ? "Building…" : (place || `Replace with ${chosen.label}`), "btn-primary", ed.busy ? "disabled" : "")}${note("Replace removes this crown and any sculpting on it. Undo brings the previous tooth back.", "cad-note-warn")}`
        : btn("create-crown", ed.busy ? "Building…" : (ed.toothSetup ? "OK – fit placed tooth to margin" : place || `Place tooth ${tooth}`), "btn-primary", ed.busy || !ed.margin || !ed.insertionAxis ? "disabled" : "")}`);
    if (ed.crown) return library + panels.crown(ed);
    return library + sec("Crown bottom", `${note("Cement gap and wall are applied when the tooth is placed.")}
      ${num("cement-gap", "Cement gap", o.cement.gap)}${num("cement-margin", "Margin gap", o.cement.marginGap)}
      ${num("starter-wall", "Wall offset", ed.construction.wall)}${num("starter-margin", "Margin border", ed.construction.marginWall)}
      ${process.env.NEXT_PUBLIC_TOOTHCRAFT_EVALUATION === "1" ? sec("ToothCraft · internal evaluation", `${note("Preview the completed scan region using the ToothCraft service on this computer.")}${btn("toothcraft-preview", ed.toothCraftRequest ? "Generating…" : "Generate AI preview", "", !ed.margin || !ed.insertionAxis || ed.toothCraftRequest ? "disabled" : "")}${btn("toothcraft-clear", "Clear preview")}`) : ""}
      ${note("The inside follows the preparation plus the cement gap. Check contacts and wall thickness before export.", "cad-note-warn")}
      <label class="btn btn-sm cad-file">Or import restoration STL<input type="file" accept=".stl" data-import hidden></label>`);
  },

  export(ed) {
    return sec("Save design", `${btn("save-design", "Save editable design in this browser", "btn-primary")}${note("Saved geometry, margins, parameters and workflow can be reopened in the same browser.")}`)
      + sec("Restoration output", ed.units.length ? `${exportBody(ed)}${note("Check margin fit, contacts, thickness and mesh integrity before manufacture.")}` : noRestoration());
  },

  teeth(ed) {
    const jaws = Object.keys(ed.teethData);
    if (!jaws.length) return note("Tooth numbering needs at least one upper or lower jaw scan in the case.", "cad-note-warn");
    const statusOf = (d) => {
      const m = d.model;
      if (!m.teeth.length) return note("No teeth could be found on this scan. Check the Up axis and Flip settings in the Case tab.", "cad-note-warn");
      if (m.jobTooth && !m.jobToothConfirmed) {
        const proposed = m.teeth.some((t) => t.fdi === m.jobTooth);
        return note(proposed
          ? `Tooth ${m.jobTooth} from the appointment is not confirmed. The amber tooth is only a proposal from the arch geometry. Confirm it, or select the right tooth and set its number to ${m.jobTooth}.`
          : `Tooth ${m.jobTooth} from the appointment was not found. Select the prepared tooth in 3D and set its number to ${m.jobTooth}.`, "cad-note-warn")
          + (proposed ? btn("confirm-job-tooth", `Yes, the amber tooth is ${m.jobTooth}`, "btn-primary") : "");
      }
      if (m.status === "reviewed") return note(`${m.teeth.length} teeth. ${m.jobTooth ? `Tooth ${m.jobTooth} confirmed. ` : ""}Your correction is saved with this design.`);
      if (m.status === "partial") return note("This scan doesn't show the whole arch, so there is no midline to count from. Select any tooth and enter its number: the rest follow along the arch.", "cad-note-warn");
      if (m.status === "anchored") return note(`Numbered from the known tooth ${ed.caseData.primaryTooth || ed.caseData.teeth?.[0]}. Check the neighbours before trusting them.`, "cad-note-warn");
      return note(`${m.teeth.length} teeth, counted outward from the arch midline by FAUCHAR's arch-geometry detector (no AI model). Review the numbers.`);
    };
    const sel = ed.selectedToothData();
    const options = sel ? ARCH_ORDER[sel.jaw].map((f) => f).sort((a, b) => a - b).map((f) => `<option value="${f}" ${sel.tooth.fdi === f ? "selected" : ""}>${f}</option>`).join("") : "";
    return sec("FDI chart", `${seg("teeth-jaw", jaws.map((j) => [j, j === "upper" ? "Upper jaw" : "Lower jaw"]), ed.teethJaw)}
        ${statusOf(ed.teethData[ed.teethJaw] ?? ed.teethData[jaws[0]])}
        ${fdiChart(ed)}
        <p class="cad-chart-key"><i class="k-found"></i>Found <i class="k-unsure"></i>Check <i class="k-none"></i>Not found</p>
        ${note("Click a tooth in 3D or on the chart. Numbers come from the arch geometry, so review them: you have the final say.")}`)
      + sec(sel ? (sel.tooth.fdi ? `Tooth ${sel.tooth.fdi}` : "Selected tooth") : "Selected tooth", sel ? `
        ${row("Width", `${sel.tooth.width.toFixed(1)} mm`)}
        ${sel.tooth.stump ? row("Looks like", "Prepared tooth") : ""}${sel.tooth.partial ? row("Scan", "Cuts this tooth off", "is-warn") : ""}
        ${row("Confidence", sel.tooth.manual ? "Set by you" : `${Math.round(sel.tooth.confidence * 100)}%`, sel.tooth.manual ? "is-good" : sel.tooth.confidence < 0.6 ? "is-warn" : "")}
        <label class="cad-select"><span>Number</span><select data-tooth-number>${sel.tooth.fdi ? "" : `<option value="" selected>Choose</option>`}${options}</select></label>
        <div class="cad-btns">${btn("number-one", "This tooth only")}${btn("number-arch", "Renumber along arch", "btn-primary")}</div>
        ${btn("to-margin", "Mark margin on this tooth", "btn-primary", sel.tooth.fdi ? "" : "disabled")}
        <div class="cad-boundary"><span>Mesial/distal cuts</span>
          <div class="cad-btns">${btn("cut-from-minus", "◀")}${btn("cut-from-plus", "▶")}<em>|</em>${btn("cut-to-minus", "◀")}${btn("cut-to-plus", "▶")}</div></div>
        <div class="cad-btns">${btn("tooth-merge", "Merge with next", "", sel.i < sel.model.teeth.length - 1 ? "" : "disabled")}${btn("tooth-remove", "Not a tooth")}</div>`
      : note("Nothing selected yet."))
      + sec("Fix the regions", `
        <div class="cad-btns">${btn("tooth-split", ed.pendingTooth?.kind === "split" ? "Click the gap in 3D…" : "Split a tooth")}${btn("tooth-add", ed.pendingTooth?.kind === "add" ? "Click the tooth in 3D…" : "Add a missed tooth")}</div>
        ${btn("teeth-redetect", "Detect again", "btn-quiet")}`, false);
  },

  transform(ed) {
    const obj = ed.selected;
    const setup = ed.toothSetup;
    const setupSec = setup ? sec(`Position ${esc(setup.obj.name)}`, `${note("This is the original library tooth, unchanged. Move, rotate or scale it until it sits right between the neighbours and against the antagonist. Nothing is cut yet.")}
        ${note(`Start position: ${esc(setup.obj.source?.placement || "library")}.`)}
        ${btn("setup-accept", ed.busy ? "Fitting…" : "OK – fit to margin", "btn-primary", ed.busy ? "disabled" : "")}
        <div class="cad-btn-row">${btn("setup-reset", "Back to start position")}${btn("setup-cancel", "Cancel")}</div>`) : "";
    const all = [...ed.units, ...ed.scanObjects];
    const dental = !!(obj?.frame || ed.crown?.frame);
    const names = dental ? ["Mesial", "Facial", "Occlusal"] : ["X", "Y", "Z"];
    const unit = ed.opts.gizmo === "move" ? "mm" : ed.opts.gizmo === "rotate" ? "°" : "%";
    const dflt = ed.opts.gizmo === "move" ? 0.1 : ed.opts.gizmo === "rotate" ? 1 : 1;
    return setupSec + sec("Object", `<div class="cad-objects">${all.map((o) => `<button type="button" data-select="${esc(o.id)}" aria-pressed="${o.id === ed.selectedId}">${esc(o.name)}</button>`).join("")}</div>`)
      + sec("Transform", `
        ${seg("gizmo", [["move", "Move"], ["rotate", "Rotate"], ["scale", "Scale"]], ed.opts.gizmo)}
        ${note("Drag a gizmo handle, or type an exact step below. Arrow keys nudge; Shift makes it finer.")}
        <div class="cad-step">
          ${names.map((n, i) => `<div class="cad-step-row"><span class="cad-axis cad-axis-${i}">${n}</span>
            <button type="button" class="btn btn-sm" data-step="${i}" data-dir="-1" aria-label="${n} minus">−</button>
            <input type="number" data-step-val="${i}" value="${dflt}" step="${ed.opts.gizmo === "move" ? 0.01 : 0.1}"><em>${unit}</em>
            <button type="button" class="btn btn-sm" data-step="${i}" data-dir="1" aria-label="${n} plus">+</button></div>`).join("")}
        </div>`)
      + sec("Reset", `${note(obj?.mesh ? `Puts ${esc(obj.name)} back as it was imported. Undoable.` : "Select an object to reset it.")}${btn("reset-object", "Reset this object", "", obj?.mesh ? "" : "disabled")}`);
  },

  anatomy(ed) {
    const o = ed.selected?.seg ? ed.selected : ed.crown;
    if (!o) return noRestoration();
    return targetRow(ed) + sec("Tooth shape", `
        ${note(`${o.seg ? "Margin and intaglio stay locked." : "No margin found on this mesh, so the whole shape moves."} Each change is one history step.`)}
        ${slider("a-height", "Height", 80, 125, 0.5, 100, "%")}
        ${slider("a-width", "Width (facial–lingual)", 80, 125, 0.5, 100, "%")}
        ${slider("a-length", "Length (mesial–distal)", 80, 125, 0.5, 100, "%")}
        ${slider("a-shiftM", "Shift mesial–distal", -1.5, 1.5, 0.01, 0, "mm")}
        ${slider("a-shiftF", "Shift facial–lingual", -1.5, 1.5, 0.01, 0, "mm")}
        ${slider("a-shiftO", "Shift occlusal", -1.5, 1.5, 0.01, 0, "mm")}
        ${slider("a-rotate", "Rotate around long axis", -20, 20, 0.1, 0, "°")}
        ${slider("a-tiltF", "Tip facial–lingual", -20, 20, 0.1, 0, "°")}
        ${slider("a-tiltM", "Tip mesial–distal", -20, 20, 0.1, 0, "°")}
        <div data-readout="dims"></div>`)
      + sec("Individual surfaces", `
        ${seg("zone", ops.ZONES.map((z) => [z, z[0].toUpperCase() + z.slice(1)]), ed.opts.zone || "occlusal")}
        ${slider("z-offset", "Offset surface", -1, 1, 0.01, 0, "mm")}`)
      + sec("Cusps, ridges, grooves", `
        ${brushGrid(ed, ["grab", "ridge", "groove", "smooth"])}
        <label class="cad-check"><input type="checkbox" data-check="axial" ${ed.opts.axial ? "checked" : ""}>Grab moves along the occlusal axis only (cusp height)</label>
        ${brushControls(ed)}
        ${note("Drag on a cusp tip with Grab, draw along a ridge or a fissure with Ridge or Groove.")}`);
  },

  sculpt(ed) {
    const obj = ed.brushTarget();
    if (!obj) return noRestoration();
    return targetRow(ed)
      + sec("Brush", `${brushGrid(ed, BRUSHES.map((b) => b.id))}${brushControls(ed)}${note("Right-drag rotates, middle-drag or Shift-drag pans, wheel zooms.")}`)
      + sec("Mesh", `${row("Triangles", (obj.mesh.idx.length / 3).toLocaleString())}${row("Average edge", `${averageEdge(obj.mesh).toFixed(3)} mm`)}
        ${btn("refine", "Refine mesh ×4", "", 'title="Split every triangle into four, for finer detail"')}`)
      + sec("Live checks", `<div data-readout="sculpt"></div>`);
  },

  margin(ed) {
    const has = !!ed.margin;
    const drawing = !!ed.marginDraft?.length;
    const count = ed.marginDraft?.length || 0;
    const facts = has && !drawing ? ed.marginFacts() : null;
    const chart = Object.keys(ed.teethData).length ? fdiChart(ed) : "";
    return sec(`Tooth ${ed.marginTooth || ed.caseData.teeth?.[0] || "—"} · Finish line`, `
        <div class="cad-margin-guide" role="status" data-margin-progress>${ed.pendingAutoSeed
          ? "Click the top of the prepared tooth in the 3D view."
          : drawing ? `${count} samples · Continue tracing, or finish the line.`
          : has ? "Margin ready. Drag a point or the line itself to adjust."
          : "Trace the finish line directly on the scan, or let Find margin propose it."}</div>
        <div class="cad-margin-start">${btn("margin-auto", ed.pendingAutoSeed ? "Waiting for your click…" : "Find margin", ed.pendingAutoSeed ? "" : "btn-primary", drawing ? "disabled" : "")}
          ${btn("margin-draw", drawing ? "Drawing…" : has ? "Draw new line" : "Trace by hand", ed.marginSub === "draw" && !ed.pendingAutoSeed ? "btn-primary" : "", drawing ? "disabled" : "")}</div>
        ${ed.pendingAutoSeed ? btn("margin-cancel", "Cancel detection") : ""}
        <label class="cad-check"><input type="checkbox" data-margin-isolate ${ed.isolateMargin !== false ? "checked" : ""}> Show only this tooth</label>
        ${ed.marginSub === "draw" && !ed.pendingAutoSeed ? `
          ${note("Hold the left button and trace, or click individual points. The teeth beside this one stay hidden until the line is finished. Right-drag rotates; middle-drag or Shift-drag pans; the wheel zooms.")}
          <div class="cad-margin-finish">${btn("margin-finish", "Finish line ↵", "btn-primary", count >= 4 ? "" : "disabled")}
          ${btn("margin-undo-point", "Undo stroke", "", count ? "" : "disabled")}${btn("margin-cancel", "Cancel drawing", "", count || has ? "" : "disabled")}</div>
          ${note("Return to the highlighted starting point to close automatically. The old margin stays safe until you finish.")}` : ""}
        ${has && !drawing && !ed.pendingAutoSeed ? `${seg("margin", [["move", "Adjust"], ["add", "Insert point"], ["delete", "Erase point"]], ed.marginSub)}
          ${ed.marginSub === "move" ? note("Drag a handle, or drag anywhere on the line to insert and move a point. Drag away from the line to rotate.") : note(ed.marginSub === "add" ? "Click the scan beside the line to insert a point." : "Click a point to erase it. Undo restores it.")}
          ${slider("influence", "Soft adjustment", 0, 4, 0.1, ed.opts.influence, "mm")}` : ""}
        <div class="cad-btns">${btn("margin-focus", "Center line", "", has || drawing || ed.marginSeed ? "" : "disabled")}${btn("margin-view", "Look from above")}</div>`)
      + (facts ? sec("Review margin", `${row("Editable points", facts.points)}${row("Length", `${facts.length.toFixed(2)} mm`)}
          ${facts.fit ? row("Distance to scan", `${f(facts.fit.median, 3)} mm median`) : ""}
          ${facts.rim ? row("Crown vs margin", `${f(facts.rim.median, 3)} mm median`) : ""}
          ${ed.crown?.seg && ed.marginTooth === ed.caseData.teeth?.[0] ? btn("margin-apply", "Fit crown boundary to this line", "btn-primary") : ""}`) : "")
      + sec("Advanced", `
          <label class="cad-check"><input type="checkbox" data-check="magnet" ${ed.magnet ? "checked" : ""}>Snap toward nearby sharp edges</label>
          <label class="cad-check"><input type="checkbox" data-check="showMargin" ${ed.showMargin ? "checked" : ""}>Show margin line</label>
          <div class="cad-btns">${btn("margin-smooth", "Smooth", "", has && !drawing ? "" : "disabled")}${btn("margin-snap", "Snap to scan", "", has && !drawing ? "" : "disabled")}</div>
          <div class="cad-btns">${btn("margin-resample-12", "12 handles", "", has && !drawing ? "" : "disabled")}${btn("margin-resample-24", "24 handles", "", has && !drawing ? "" : "disabled")}${btn("margin-resample-48", "48 handles", "", has && !drawing ? "" : "disabled")}</div>
          ${chart ? `<details><summary>Change tooth</summary>${chart}</details>` : ""}
          <div class="cad-btns">${btn("margin-reset", "Original line", "", ed.marginOriginal && ed.marginTooth === ed.caseData.teeth?.[0] && !drawing ? "" : "disabled")}${btn("margin-clear", "Clear line", "", has && !drawing ? "" : "disabled")}</div>
          ${note("Detected margins are proposals. Inspect the full line and correct it on the scan.")}`, false);
  },

  occlusion(ed) {
    if (!ed.crown) return noRestoration();
    if (!ed.antagonist) return note("This case has no opposing jaw scan, so there is nothing to measure occlusion against. Add the antagonist STL to the case.", "cad-note-warn");
    return sec("Occlusal map", `
        <label class="cad-check"><input type="checkbox" data-map="occlusion" ${ed.mapKind === "occlusion" ? "checked" : ""}>Colour the crown by distance to ${esc(ed.antagonist.name.toLowerCase())}</label>
        <div data-readout="occlusion"></div>`)
      + sec("Clearance", `
        ${num("target-occlusal", "Target clearance", ed.opts.targets.occlusal)}
        ${btn("occlusion-fit", "Apply clearance", "btn-primary")}
        ${note("Removes high contacts and collisions until the whole crown clears the target, or builds material toward the antagonist if it is too far. Margin and intaglio don't move.")}`)
      + sec("Correct by hand", `${brushGrid(ed, ["remove", "add", "smooth", "restore"])}${brushControls(ed)}${note("Paint directly on the crown: the map updates as you work, and hovering reads the exact distance. Drag off the model to rotate.")}`);
  },

  contacts(ed) {
    if (!ed.crown) return noRestoration();
    const nb = ed.neighborBvh;
    if (!nb?.mesial && !nb?.distal) return note("No neighbouring teeth were found on the preparation scan, so contacts can't be measured.", "cad-note-warn");
    const side = (k, label) => (nb[k] ? `
      <div class="cad-contact">
        <h5>${label}</h5>
        <div data-readout="contact-${k}"></div>
        ${num(`target-${k}`, "Target gap", ed.opts.targets[k])}
        ${btn(`contact-${k}`, `Fit ${label.toLowerCase()} contact`)}
      </div>` : note(`${label} neighbour not found on this scan.`));
    return sec("Proximal map", `<label class="cad-check"><input type="checkbox" data-map="contact" ${ed.mapKind === "contact" ? "checked" : ""}>Colour by distance to neighbours</label>`)
      + sec("Contact points", `${side("mesial", "Mesial")}${side("distal", "Distal")}
        ${note("Negative distance is overlap with the neighbour, and it reads red. Fit moves the crown surface around the contact point until the gap matches the target.")}
        ${note("Scanned neighbours are segmented automatically and may include some gum tissue. Check the map before trusting the value.", "cad-note-warn")}`)
      + sec("Interproximal shaping", `${brushGrid(ed, ["remove", "add", "smooth", "flatten"])}${brushControls(ed)}${note("Paint directly on the crown to shape the area around the contact. Hovering reads the exact distance.")}`);
  },

  crown(ed) {
    const c = ed.crown;
    if (!c) return noRestoration();
    const o = ed.opts;
    const noSeg = !c.seg;
    const prepAvail = !!(ed.prep?.prepVerts?.length);
    return (noSeg ? note("No clear margin rim could be found on this mesh, so cement gap and wall tools are off.", "cad-note-warn") : "")
      + sec("Cement gap and spacing", `
        ${num("cement-gap", "Internal gap", o.cement.gap)}
        ${num("cement-margin", "At the margin", o.cement.marginGap)}
        ${num("cement-zone", "Blend width", o.cement.zone, 0.1)}
        ${btn("cement-apply", "Apply to intaglio", "btn-primary", noSeg || !ed.prepBvh ? "disabled" : "")}
        <div data-readout="cement"></div>`)
      + sec("Minimum wall thickness", `
        ${num("wall-min", "Minimum", o.thickness.min)}
        ${num("wall-margin", "Near margin", o.thickness.minMargin)}
        ${num("wall-zone", "Margin zone", o.thickness.zone, 0.1)}
        ${btn("wall-apply", "Thicken where needed", "btn-primary", noSeg ? "disabled" : "")}
        <label class="cad-check"><input type="checkbox" data-map="thickness" ${ed.mapKind === "thickness" ? "checked" : ""}>Show thickness map</label>
        <div data-readout="thickness"></div>`)
      + sec("Insertion direction", `
        ${slider("tilt-m", "Tilt mesial–distal", -25, 25, 0.5, Number(o.axisTilt[0].toFixed(1)), "°")}
        ${slider("tilt-f", "Tilt facial–lingual", -25, 25, 0.5, Number(o.axisTilt[1].toFixed(1)), "°")}
        <div class="cad-btns">${btn("axis-undercuts", ed.undercutActive ? "Hide undercuts" : "Show undercuts", "", prepAvail ? "" : "disabled")}${btn("axis-best", "Best fit", "", prepAvail ? "" : "disabled")}${btn("axis-view", "From view")}</div>
        <div data-readout="undercut"></div>`, false)
      + sec("Emergence profile", `
        ${note("Bows the band just above the margin in or out. The margin itself stays fixed.")}
        ${slider("emerge", "Contour", -0.6, 0.6, 0.01, 0, "mm")}
        ${slider("emerge-h", "Band height", 0.6, 3.5, 0.1, o.emergeH ?? 1.6, "mm")}`, false)
      + sec("Crown boundary", `${note("The boundary follows the margin line. Edit the line in Margin (M), then fit the crown to it.")}${btn("margin-apply", "Fit boundary to margin line", "", c.seg && ed.margin ? "" : "disabled")}`, false);
  },

  bridge(ed) {
    const o = ed.opts;
    const units = ed.units;
    const pontics = units.filter((u) => u.kind === "pontic");
    const conns = units.filter((u) => u.kind === "connector");
    const sel = ed.selected;
    const cp = sel?.kind === "connector" ? sel.params : o.connector;
    const area = (Math.PI / 4) * cp.width * cp.height * cp.waist * cp.waist;
    return sec("Units", units.length ? `<div class="cad-objects">${units.map((u) => `<button type="button" data-select="${esc(u.id)}" aria-pressed="${u.id === ed.selectedId}">${esc(u.name)}</button>`).join("")}</div>
        ${sel && sel.kind !== "crown" && sel.kind !== "scan" ? btn("remove-unit", `Remove ${esc(sel.name)}`, "btn-quiet") : ""}` : note("No units yet."))
      + sec("Pontic", `
        ${btn("place-pontic", ed.pendingPontic ? "Click the position in 3D…" : "Place pontic", "btn-primary")}
        ${note(ed.crown?.seg ? "A pontic copies the crown's outer anatomy and closes its underside with an ovate base." : "With no crown to copy, a pontic starts as a simple ovoid.")}
        ${slider("p-md", "Mesial–distal", 60, 140, 1, sel?.kind === "pontic" ? sel.params.md : o.pontic.md, "%")}
        ${slider("p-fl", "Facial–lingual", 60, 140, 1, sel?.kind === "pontic" ? sel.params.fl : o.pontic.fl, "%")}
        ${slider("p-h", "Height", 60, 140, 1, sel?.kind === "pontic" ? sel.params.h : o.pontic.h, "%")}
        ${slider("p-dome", "Base depth", 0, 3, 0.05, sel?.kind === "pontic" ? sel.params.dome : o.pontic.dome, "mm")}
        ${pontics.length ? note("With a pontic selected, these sliders rebuild it and replace any sculpting on that unit (undoable).") : ""}`)
      + sec("Connector", `
        <label class="cad-select"><span>From</span><select data-conn="a">${units.filter((u) => u.kind !== "connector").map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")}</select></label>
        <label class="cad-select"><span>To</span><select data-conn="b">${units.filter((u) => u.kind !== "connector").map((u, i) => `<option value="${esc(u.id)}" ${i === 1 ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
        ${btn("add-connector", "Add connector", "btn-primary", units.filter((u) => u.kind !== "connector").length < 2 ? "disabled" : "")}
        ${slider("c-width", "Width", 1, 6, 0.05, sel?.kind === "connector" ? sel.params.width : o.connector.width, "mm")}
        ${slider("c-height", "Height", 1, 7, 0.05, sel?.kind === "connector" ? sel.params.height : o.connector.height, "mm")}
        ${slider("c-waist", "Waist", 0.5, 1, 0.01, sel?.kind === "connector" ? sel.params.waist : o.connector.waist)}
        ${slider("c-offset", "Move up or down", -3, 3, 0.05, sel?.kind === "connector" ? sel.params.offset ?? 0 : 0, "mm")}
        ${num("c-min", "Your minimum area", o.connector.minArea, 0.5, "mm²")}
        <div data-connector-area>${areaRow(area, o.connector.minArea)}</div>`)
      + sec("Bridge thickness", `${note("Offsets the outer surface of the selected unit. The crown's margin and intaglio stay fixed.")}${slider("b-offset", "Offset", -0.5, 0.8, 0.01, 0, "mm")}`, false)
      + sec("Export", exportBody(ed, conns), true);
  },

  measure(ed) {
    const s = ed.section;
    const rows = ed.measures.map((m, i) => {
      const r = ed.measureValue(m);
      const name = m.type[0].toUpperCase() + m.type.slice(1);
      return `<div class="cad-row cad-measure"><span>${name}</span><strong>${r && r.value !== null ? `${r.value.toFixed(r.unit === "°" ? 1 : 3)} ${r.unit}` : "—"}</strong><button type="button" class="icon-x" data-measure-del="${i}" aria-label="Delete measurement">×</button></div>`;
    }).join("");
    return sec("Measure", `
        ${seg("measure", [["distance", "Distance", "Click two points"], ["thickness", "Thickness", "Click one point: straight through the wall"], ["angle", "Angle", "Click three points; the second is the corner"]], ed.measureSub)}
        ${note(ed.measureSub === "distance" ? "Click two points on any model." : ed.measureSub === "thickness" ? "Click a point: the wall is measured straight through from it." : "Click three points; the second is the corner.")}
        <div data-readout="measures">${rows || note("No measurements yet. They stay attached to the surface and update as you edit.")}</div>
        ${ed.measures.length ? btn("clear-measures", "Clear all", "btn-quiet") : ""}`)
      + sec("Cross-section", `
        <label class="cad-check"><input type="checkbox" data-check="section" ${s.on ? "checked" : ""}>Cut the view</label>
        ${seg("section", [["mesial", "M–D"], ["facial", "F–L"], ["occlusal", "Axial"], ["view", "View"]], s.axis)}
        ${slider("section", "Plane position", -12, 12, 0.05, s.offset, "mm")}
        <div data-readout="section"></div>`)
      + sec("Crown dimensions", `<div data-readout="dims"></div>`);
  },

  view(ed) {
    const groups = ed.prep ? ed.viewer.meshes.get(ed.prep.vid)?.groups : null;
    const part = (id, label) => {
      const g = groups?.find((x) => x.id === id);
      if (!g || !g.count) return "";
      return visRow(`part:${id}`, label, g.visible, g.alpha ?? 1);
    };
    const neighbors = groups?.filter((g) => g.id.startsWith("neighbor") && g.count) ?? [];
    return sec("Visibility and opacity", `
        ${ed.scanObjects.map((o) => visRow(`obj:${o.id}`, o === ed.prep ? `${o.name} (prepared)` : o.name, o.visible !== false, o.alpha)).join("")}
        ${groups ? part("prep", "Preparation die") : ""}
        ${neighbors.length ? visRow("part:neighbors", "Neighbouring teeth", neighbors[0].visible, neighbors[0].alpha ?? 1) : ""}
        ${groups ? part("jaw", "Gum and other teeth") : ""}
        ${ed.units.map((o) => visRow(`obj:${o.id}`, o.name, o.visible !== false, o.alpha)).join("")}
        ${groups ? "" : note("Die and neighbours can be shown separately once a margin is defined on the preparation scan.")}`)
      + sec("Colour-coded analysis", `<div class="cad-maps">${Object.entries(MAPS).map(([id, m]) => `<button type="button" data-mapbtn="${id}" aria-pressed="${ed.mapKind === id}" ${mapAvailable(ed, id) ? "" : 'disabled title="Not available for this case"'}>${m.label}</button>`).join("")}</div>
        ${note("Hover the model to read the exact value.")}`)
      + sec("Original vs edited", `
        ${seg("compare", [["edited", "Edited"], ["original", "Original"], ["overlay", "Overlay"], ["deviation", "Deviation"]], ed.compare)}
        ${note("X toggles between the original and your edits. Original is the restoration as it was imported.")}`)
      + sec("Cross-section", `<label class="cad-check"><input type="checkbox" data-check="section" ${ed.section.on ? "checked" : ""}>Cut the view</label>${slider("section", "Plane position", -12, 12, 0.05, ed.section.offset, "mm")}`, false);
  },
};

const noRestoration = () => `${note("This case has no restoration yet. Define the margin and insertion direction, then build a crown bottom.")}${btn("to-construction", "Create crown from preparation", "btn-primary")}<label class="btn btn-sm cad-file">Import restoration STL<input type="file" accept=".stl" data-import hidden></label>`;

function mapAvailable(ed, id) {
  const c = ed.crown;
  if (!c) return false;
  if (id === "occlusion") return !!ed.antagonist;
  if (id === "contact") return !!(ed.neighborBvh?.mesial || ed.neighborBvh?.distal);
  if (id === "thickness") return !!c.seg;
  if (id === "cement") return !!(c.seg && ed.prepBvh);
  return true;
}

function visRow(key, label, visible, alpha) {
  return `<div class="cad-vis"><label class="cad-check"><input type="checkbox" data-vis="${esc(key)}" ${visible ? "checked" : ""}>${esc(label)}</label><input type="range" data-alpha="${esc(key)}" min="0.1" max="1" step="0.05" value="${alpha ?? 1}" aria-label="${esc(label)} opacity"></div>`;
}

function areaRow(area, min) {
  const low = area < min;
  return `${row("Cross-section", `${area.toFixed(1)} mm²`, low ? "is-bad" : "is-good")}${low ? note(`Below your ${min} mm² minimum.`, "cad-note-warn") : ""}`;
}

function exportBody(ed) {
  const multi = ed.units.length > 1;
  return `${multi ? `<label class="cad-select"><span>Merge voxel size</span><select data-voxel>${[0.05, 0.08, 0.1, 0.15, 0.2].map((v) => `<option value="${v}" ${ed.opts.voxel === v ? "selected" : ""}>${v} mm</option>`).join("")}</select></label>
    <div class="cad-btns">${btn("export-merged", "Merged STL", "btn-primary")}${btn("export-shells", "Separate shells")}</div>
    ${note("Merged STL is one watertight solid, but the whole surface is resampled at the voxel size, including margins. Check the margin fit before milling.", "cad-note-warn")}` : ""}
    ${btn("export-unit", `Export ${esc(ed.selected?.mesh && ed.selected.kind !== "scan" ? ed.selected.name : ed.crown?.name || "unit")}`, multi ? "" : "btn-primary", ed.units.length ? "" : "disabled")}`;
}

function averageEdge(mesh) {
  let s = 0;
  const n = Math.min(mesh.idx.length, 6000);
  for (let t = 0; t < n; t += 3) {
    const a = mesh.idx[t] * 3, b = mesh.idx[t + 1] * 3;
    s += Math.hypot(mesh.pos[a] - mesh.pos[b], mesh.pos[a + 1] - mesh.pos[b + 1], mesh.pos[a + 2] - mesh.pos[b + 2]);
  }
  return s / (n / 3 || 1);
}

function historyHtml(ed) {
  if (!ed.stack.length) return note("Nothing edited yet. Every operation lands here and can be undone.");
  const items = ed.stack.map((c, i) => {
    const active = i < ed.cursor;
    return `<li class="${active ? "" : "is-undone"} ${i === ed.cursor - 1 ? "is-current" : ""}"><button type="button" data-jump="${i + 1}" title="Go back to this step">${esc(c.label)}</button>${c.type === "geom" && active ? `<button type="button" class="icon-x" data-revert="${i}" title="Revert only this step" aria-label="Revert ${esc(c.label)}">↺</button>` : ""}</li>`;
  }).reverse().join("");
  return `<ol class="cad-history">${items}<li class="${ed.cursor === 0 ? "is-current" : ""}"><button type="button" data-jump="0">Original design</button></li></ol>`;
}

/* ------------------------------------------------------------------ render */

export function renderPanel(ed) {
  const el = ed.panelEl;
  const scroll = el.scrollTop;
  const open = {};
  el.querySelectorAll("details.cad-sec").forEach((d) => { open[d.querySelector("summary").textContent] = d.open; });
  const tool = TOOLS.find((t) => t.id === ed.tool);
  el.innerHTML = `
    <div class="cad-panel-head"><h3>${tool?.title ?? ""}</h3></div>
    ${panels[ed.tool]?.(ed) ?? ""}
    ${ed.tool !== "bridge" && ed.units.length ? sec("Export", exportBody(ed), ed.tool === "view") : ""}
    ${sec("History", `${historyHtml(ed)}${ed.stack.length || ed.units.length ? `<button type="button" class="btn btn-sm btn-quiet cad-discard" data-act="discard">Discard all edits</button>` : ""}`, ed.stack.length > 0)}
    <p class="cad-note cad-foot">Manual design tools. Not validated for clinical use: review every result before manufacture.</p>`;
  el.querySelectorAll("details.cad-sec").forEach((d) => {
    const k = d.querySelector("summary").textContent;
    // History always opens once there is something in it.
    if (k in open && !(k === "History" && ed.stack.length)) d.open = open[k];
  });
  el.scrollTop = scroll;
  bind(ed, el);
  readouts(ed);
}

/** Readouts measure the current geometry. They run after each committed change, not per frame. */
export function readouts(ed) {
  const el = ed.panelEl;
  const need = el.querySelector("[data-readout]");
  if (!need || !ed.crown) return;
  const facts = ed.liveFacts();
  if (!facts) return;
  const put = (key, html) => el.querySelectorAll(`[data-readout="${key}"]`).forEach((n) => { n.innerHTML = html; });
  const gap = (g, lo = 0) => (g && g.min !== null ? row("Closest", `${f(g.min, 3)} mm`, g.min < lo ? "is-bad" : "is-good") : row("Closest", "out of range"));
  const dims = facts.dims;
  put("dims", dims ? `${row("Mesial–distal", `${f(dims.md)} mm`)}${row("Facial–lingual", `${f(dims.fl)} mm`)}${row("Height", `${f(dims.h)} mm`)}${row("Volume", `${facts.stats.volume.toFixed(1)} mm³`)}${row("Mesh", facts.stats.closed ? "Closed" : `Open: ${facts.stats.boundary} edges`, facts.stats.closed ? "is-good" : "is-bad")}` : "");
  put("sculpt", `${row("Volume", `${facts.stats.volume.toFixed(1)} mm³`)}
    ${facts.thickness ? row("Thinnest wall", `${f(facts.thickness.min, 3)} mm`, facts.thickness.min < ed.opts.thickness.min ? "is-bad" : "is-good") : ""}
    ${facts.occlusal ? row("Occlusal clearance", `${f(facts.occlusal.min, 3)} mm`, facts.occlusal.min < 0 ? "is-bad" : "") : ""}
    ${row("Mesh", facts.stats.closed ? "Closed" : `Open: ${facts.stats.boundary} edges`, facts.stats.closed ? "is-good" : "is-bad")}`);
  if (facts.occlusal) {
    const g = facts.occlusal;
    const n = g.values ? countBelow(g.values, ed.opts.targets.occlusal) : 0;
    const col = g.penetrating || 0;
    put("occlusion", `${gap(g)}${row("Collision vertices", col, col ? "is-bad" : "is-good")}${row(`Closer than ${ed.opts.targets.occlusal} mm`, `${n} vertices`, n ? "is-warn" : "is-good")}${g.at >= 0 ? `<button type="button" class="btn btn-sm btn-quiet" data-act="look-occlusion">Go to closest point</button>` : ""}`);
  }
  for (const k of ["mesial", "distal"]) {
    const g = facts[k];
    if (!g) continue;
    const t = ed.opts.targets[k];
    const status = g.min === null ? "No contact in range" : g.min > t + 0.1 ? "Insufficient: open" : g.min < t - 0.05 ? "Excessive: too tight" : "Within 0.05–0.1 mm of target";
    put(`contact-${k}`, `${gap(g)}${row("Status", status, g.min !== null && g.min >= t - 0.05 && g.min <= t + 0.1 ? "is-good" : "is-warn")}`);
  }
  if (facts.cement) put("cement", `${row("Measured median", `${f(facts.cement.median, 3)} mm`)}${row("Range", `${f(facts.cement.min, 3)} to ${f(facts.cement.max, 3)} mm`)}`);
  if (facts.thickness) put("thickness", row(`Thinnest beyond ${ed.opts.thickness.zone} mm from margin`, `${f(facts.thickness.min, 3)} mm`, facts.thickness.min < ed.opts.thickness.min ? "is-bad" : "is-good"));
  if (ed.undercut) put("undercut", `${row("Die in undercut", `${(ed.undercut.fraction * 100).toFixed(1)}%`, ed.undercut.fraction > 0.02 ? "is-warn" : "is-good")}${row("Deepest shadow", `${f(ed.undercut.max)} mm`)}`);
  if (ed.section.stats) put("section", `${row("Section width", `${f(ed.section.stats.width)} mm`)}${row("Section height", `${f(ed.section.stats.height)} mm`)}${row("Contour length", `${f(ed.section.stats.length)} mm`)}`);
  else put("section", ed.section.on ? note("The plane doesn't cross the crown here.") : "");
}

function countBelow(values, t) {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (values[i] < t) n++;
  return n;
}

/* --------------------------------------------------------------- bindings */

function bind(ed, el) {
  const o = ed.opts;
  el.querySelectorAll("[data-brush]").forEach((b) => b.addEventListener("click", () => { o.brush = b.dataset.brush; renderPanel(ed); }));
  el.querySelectorAll("[data-select]").forEach((b) => b.addEventListener("click", () => ed.select(b.dataset.select)));
  el.querySelectorAll("[data-fdi]").forEach((b) => b.addEventListener("click", () => chartClick(ed, Number(b.dataset.fdi))));
  el.querySelector("[data-select-unit]")?.addEventListener("change", (e) => ed.select(e.target.value));
  el.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => segChange(ed, b.dataset.seg, b.dataset.val)));
  el.querySelectorAll("[data-map]").forEach((c) => c.addEventListener("change", () => ed.setMap(c.dataset.map)));
  el.querySelectorAll("[data-mapbtn]").forEach((c) => c.addEventListener("click", () => ed.setMap(c.dataset.mapbtn)));
  el.querySelectorAll("[data-check]").forEach((c) => c.addEventListener("change", () => checkChange(ed, c.dataset.check, c.checked)));
  el.querySelectorAll("[data-vis]").forEach((c) => c.addEventListener("change", () => visChange(ed, c.dataset.vis, { visible: c.checked })));
  el.querySelectorAll("[data-alpha]").forEach((c) => c.addEventListener("input", () => visChange(ed, c.dataset.alpha, { alpha: Number(c.value) })));
  el.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => ed.jumpTo(Number(b.dataset.jump))));
  el.querySelectorAll("[data-revert]").forEach((b) => b.addEventListener("click", () => ed.revertStep(Number(b.dataset.revert))));
  el.querySelectorAll("[data-measure-del]").forEach((b) => b.addEventListener("click", () => {
    ed.measures.splice(Number(b.dataset.measureDel), 1);
    renderPanel(ed);
    ed.viewer.render();
  }));
  el.querySelectorAll("[data-num]").forEach((i) => i.addEventListener("change", () => numChange(ed, i.dataset.num, Number(i.value))));
  el.querySelector("[data-voxel]")?.addEventListener("change", (e) => { o.voxel = Number(e.target.value); });
  el.querySelectorAll("[data-tooth-library]").forEach(b => b.addEventListener("click", () => { ed.construction.libraryId = b.dataset.toothLibrary; ed.markDirty(); renderPanel(ed); }));
  el.querySelector("[data-profile]")?.addEventListener("change", (e) => { ed.construction.profile = e.target.value; ed.markDirty(); });
  el.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    const axis = Number(b.dataset.step);
    const input = el.querySelector(`[data-step-val="${axis}"]`);
    const v = Number(input.value) * Number(b.dataset.dir);
    if (o.gizmo === "move") ed.nudge(axis, v, "move");
    else if (o.gizmo === "rotate") ed.nudge(axis, (v * Math.PI) / 180, "rotate");
    else ed.nudge(axis, 1 + v / 100, "scale");
  }));
  el.querySelector("[data-library-import]")?.addEventListener("change", e => { if (e.target.files[0]) void ed.addToLibrary(e.target.files[0]); });
  el.querySelectorAll("[data-library-model]").forEach(b => b.addEventListener("click", () => { void ed.useLibraryModel(b.dataset.libraryModel); }));
  el.querySelectorAll("[data-import]").forEach((i) => i.addEventListener("change", () => {
    if (i.files[0]) void ed.takeDroppedTooth(i.files[0]);
  }));
  el.querySelector("[data-margin-isolate]")?.addEventListener("change", (e) => {
    ed.isolateMargin = e.target.checked;
    ed.syncMarginIsolation();
    ed.viewer.render();
  });
  el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
    try { action(ed, b.dataset.act); } catch (error) { ed.io.toast(error.message, "error"); }
  }));
  el.querySelectorAll("[data-slider]").forEach((s) => bindSlider(ed, s));
}

function chartClick(ed, fdi) {
  const jaw = jawOfFdi(fdi);
  const data = ed.teethData[jaw];
  const i = data?.model.teeth.findIndex((t) => t.fdi === fdi) ?? -1;
  if (ed.tool === "margin") {
    ed.setMarginTooth(fdi);
    if (i >= 0) ed.focusTooth(jaw, i);
    if (!ed.margin) ed.marginSub = "draw";
    ed.paintTeeth();
    renderPanel(ed);
    return;
  }
  if (i >= 0) {
    ed.selectTooth(jaw, i, { focus: true });
    return;
  }
  // A number nothing has yet: give it to the selected tooth if there is one on that jaw.
  const sel = ed.selectedToothData();
  if (sel && sel.jaw === jaw) ed.numberTooth(jaw, sel.i, fdi, false);
  else ed.io.toast(`${fdi} wasn't found on the scan. Select a tooth first to give it this number.`);
}

function segChange(ed, name, val) {
  if (name === "teeth-jaw") { ed.showJaw(val); return; }
  if (name === "gizmo") { ed.opts.gizmo = val; ed.gizmo = null; }
  if (name === "zone") ed.opts.zone = val;
  if (name === "margin") {
    if (ed.marginDraft?.length) { ed.io.toast("Finish or cancel the new line before changing edit mode.", "warn"); return; }
    ed.marginSub = val; ed.pendingAutoSeed = false; ed.syncDrawingNeighbors(); ed.refreshMargin();
  }
  if (name === "measure") { ed.measureSub = val; ed.measureDraft = []; }
  if (name === "section") { ed.section.axis = val; ed.updateSection(); }
  if (name === "compare") { ed.setCompare(val); return; }
  renderPanel(ed);
  ed.viewer.render();
}

function checkChange(ed, name, on) {
  if (name === "protect") ed.opts.protect = on;
  if (name === "axial") ed.opts.axial = on;
  if (name === "magnet") ed.magnet = on;
  if (name === "showMargin") { ed.showMargin = on; ed.refreshMargin(); }
  if (name === "section") {
    ed.section.on = on;
    ed.updateSection();
    renderPanel(ed);
  }
}

function visChange(ed, key, { visible, alpha }) {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "obj") {
    const o = ed.objects.get(id);
    if (!o) return;
    if (visible !== undefined) ed.setVisible(o, visible);
    if (alpha !== undefined) ed.setAlpha(o, alpha);
    ed.io.onVisibility?.(o, visible);
  } else {
    const parts = id === "neighbors" ? ["neighbor-m", "neighbor-d"] : [id];
    parts.forEach((p) => ed.setPart(p, { ...(visible !== undefined ? { visible } : {}), ...(alpha !== undefined ? { alpha } : {}) }));
  }
}

function numChange(ed, id, v) {
  const o = ed.opts;
  if (Number.isNaN(v)) return;
  const map = {
    "starter-wall": () => (ed.construction.wall = v), "starter-margin": () => (ed.construction.marginWall = v), "starter-relief": () => (ed.construction.relief = v),
    "target-occlusal": () => (o.targets.occlusal = v), "target-mesial": () => (o.targets.mesial = v), "target-distal": () => (o.targets.distal = v),
    "cement-gap": () => (o.cement.gap = v), "cement-margin": () => (o.cement.marginGap = v), "cement-zone": () => (o.cement.zone = Math.max(0.1, v)),
    "wall-min": () => (o.thickness.min = v), "wall-margin": () => (o.thickness.minMargin = v), "wall-zone": () => (o.thickness.zone = Math.max(0.1, v)),
    "c-min": () => (o.connector.minArea = v),
  };
  map[id]?.();
  ed.markDirty();
  readouts(ed);
}

const setSliderOut = (el, s) => {
  const out = el.querySelector(`[data-out="${s.dataset.slider}"]`);
  if (out) out.textContent = `${formatValue(s.value, s.step)}${s.dataset.unit ? ` ${s.dataset.unit}` : ""}`;
};

/** Sliders that deform geometry snap back to neutral once the step is in the history. */
function bindSlider(ed, s) {
  const id = s.dataset.slider;
  const el = ed.panelEl;
  const obj = () => (ed.selected?.mesh && ed.selected.kind !== "scan" ? ed.selected : ed.crown);
  const value = () => Number(s.value);
  const live = LIVE[id];
  s.addEventListener("input", () => {
    setSliderOut(el, s);
    if (live) {
      const target = live.target ? live.target(ed) : obj();
      if (!target) return;
      if (!ed.live || ed.live.sliderId !== id) {
        const apply = live.begin(ed, target);
        ed.liveStart(target, live.label, apply);
        ed.live.sliderId = id;
      }
      ed.liveUpdate(value());
      return;
    }
    plain(ed, id, value());
  });
  s.addEventListener("change", () => {
    if (live && ed.live?.sliderId === id) {
      const v = value();
      ed.liveCommit(() => live.done(v), live.extra?.(ed, v));
      renderPanel(ed);
    }
  });
}

function plain(ed, id, v) {
  const o = ed.opts;
  if (id === "radius") { o.radius = v; ed.viewer.render(); }
  else if (id === "strength") o.strength = v / 100;
  else if (id === "influence") o.influence = v;
  else if (id === "section") { ed.section.offset = v; ed.updateSection(); readouts(ed); }
  else if (id === "tilt-m") ed.setAxisTilt(0, v);
  else if (id === "tilt-f") ed.setAxisTilt(1, v);
  else if (id === "emerge-h") o.emergeH = v;
}

const anatomy = (key, map, label, doneFmt) => ({
  label,
  begin: (ed, target) => {
    const info = target.weights;
    const frame = target.frame || ed.crown.frame;
    return (base, v) => ops.deformAnatomy(target.mesh, base, info, frame, { [key]: map(v) });
  },
  done: doneFmt,
});

const signed = (v, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
const rad = (d) => (d * Math.PI) / 180;

/** Pontic and connector sliders rebuild from parameters, so a preview never drifts. */
const param = (key, label, unit, build) => ({
  label,
  target: (ed) => (ed.selected?.kind === build ? ed.selected : null),
  begin: (ed, target) => (base, v) => {
    const g = build === "pontic" ? ed.ponticGeometry({ ...target.params, [key]: v }) : ed.connectorGeometry({ ...target.params, [key]: v });
    if (g.positions.length === target.mesh.pos.length) target.mesh.pos.set(g.positions);
    if (build === "connector") {
      const p = { ...target.params, [key]: v };
      const out = ed.panelEl.querySelector("[data-connector-area]");
      if (out) out.innerHTML = areaRow((Math.PI / 4) * p.width * p.height * p.waist * p.waist, ed.opts.connector.minArea);
    }
  },
  done: (v) => `${label} ${v.toFixed(2)}${unit}`,
  // The parameter is part of the history step, so undo keeps sliders and geometry in step.
  extra: (ed, v) => {
    const t = ed.selected;
    const old = t.params[key];
    t.params[key] = v;
    return (sign) => { t.params[key] = sign > 0 ? v : old; };
  },
});

const LIVE = {
  "a-height": anatomy("height", (v) => v / 100, "Height", (v) => `Height ${v.toFixed(1)}%`),
  "a-width": anatomy("width", (v) => v / 100, "Width", (v) => `Width ${v.toFixed(1)}%`),
  "a-length": anatomy("length", (v) => v / 100, "Length", (v) => `Length ${v.toFixed(1)}%`),
  "a-shiftM": anatomy("shiftMesial", (v) => v, "Shift", (v) => `Shift mesial ${signed(v)} mm`),
  "a-shiftF": anatomy("shiftFacial", (v) => v, "Shift", (v) => `Shift facial ${signed(v)} mm`),
  "a-shiftO": anatomy("shiftOcclusal", (v) => v, "Shift", (v) => `Shift occlusal ${signed(v)} mm`),
  "a-rotate": anatomy("rotate", rad, "Rotate", (v) => `Rotate ${signed(v, 1)}°`),
  "a-tiltF": anatomy("tiltFacial", (v) => Math.tan(rad(v)), "Tip", (v) => `Tip facial ${signed(v, 1)}°`),
  "a-tiltM": anatomy("tiltMesial", (v) => Math.tan(rad(v)), "Tip", (v) => `Tip mesial ${signed(v, 1)}°`),
  "z-offset": {
    label: "Surface offset",
    begin: (ed, target) => {
      const frame = target.frame || ed.crown.frame;
      const z = ops.zoneWeights(target.mesh, target.mesh.pos.slice(), target.weights.weight, frame, ed.opts.zone || "occlusal");
      ed.lastZone = ed.opts.zone || "occlusal";
      return (base, v) => ops.offsetByWeights(target.mesh, base, z.normals, z.weights, v);
    },
    done: (v) => `Offset surface ${signed(v)} mm`,
  },
  emerge: {
    label: "Emergence",
    target: (ed) => (ed.crown?.seg ? ed.crown : null),
    begin: (ed, target) => (base, v) => ops.emergence(target.mesh, base, target.weights, target.frame, { amount: v, height: ed.opts.emergeH ?? 1.6 }),
    done: (v) => `Emergence ${signed(v)} mm`,
  },
  "b-offset": {
    label: "Bridge thickness",
    begin: (ed, target) => {
      const normals = Float32Array.from(target.mesh.norm);
      const w = target.weights.weight;
      return (base, v) => {
        const p = target.mesh.pos;
        for (let i = 0; i < target.mesh.count; i++) {
          const s = v * w[i];
          p[i * 3] = base[i * 3] + normals[i * 3] * s;
          p[i * 3 + 1] = base[i * 3 + 1] + normals[i * 3 + 1] * s;
          p[i * 3 + 2] = base[i * 3 + 2] + normals[i * 3 + 2] * s;
        }
      };
    },
    done: (v) => `Thickness ${signed(v)} mm`,
  },
  "p-md": param("md", "Pontic width", "%", "pontic"),
  "p-fl": param("fl", "Pontic depth", "%", "pontic"),
  "p-h": param("h", "Pontic height", "%", "pontic"),
  "p-dome": param("dome", "Pontic base", " mm", "pontic"),
  "c-width": param("width", "Connector width", " mm", "connector"),
  "c-height": param("height", "Connector height", " mm", "connector"),
  "c-waist": param("waist", "Connector waist", "", "connector"),
  "c-offset": param("offset", "Connector position", " mm", "connector"),
};

function action(ed, act) {
  const crown = ed.crown;
  const obj = ed.mapObject();
  const toast = (m, k) => ed.io.toast(m, k);
  switch (act) {
    case "create-crown": void ed.createRestoration(); break;
    case "setup-accept": void ed.acceptToothSetup(); break;
    case "setup-reset": ed.resetToothSetup(); break;
    case "setup-cancel": ed.cancelToothSetup(); break;
    case "clear-dropped": ed.droppedTooth = null; renderPanel(ed); ed.io.toast("The built-in form will be used."); break;
    case "replace-crown": void ed.replaceWithLibrary(); break;
    case "toothcraft-preview": void ed.previewToothCraft(); break;
    case "toothcraft-clear": ed.toothCraftRequest?.abort(); ed.viewer.removeMesh("toothcraft-preview"); ed.viewer.render(); break;
    case "library-refresh": void ed.refreshLibrary(); break;
    case "to-construction": ed.session ? ed.session.go("bottom") : ed.setTool("construction"); break;
    case "save-design": void ed.saveDesign(); break;
    case "refine": ed.refineSelected(); break;
    case "reset-object": ed.resetObject(ed.selected); break;
    case "margin-auto": ed.startMarginDetection(); break;
    case "margin-draw": ed.startMarginDrawing(); break;
    case "margin-finish": ed.closeMarginDraft(); break;
    case "margin-undo-point": ed.undoMarginDraft(); break;
    case "margin-cancel": ed.cancelMarginDraft(); break;
    case "margin-view": ed.focusMargin(true) || ed.dentalView("top") || ed.viewer.view("top"); break;
    case "margin-smooth": ed.smoothMargin(); break;
    case "margin-snap": ed.snapMargin(); break;
    case "margin-resample-12": ed.resampleMargin(12); break;
    case "margin-resample-24": ed.resampleMargin(24); break;
    case "margin-resample-48": ed.resampleMargin(48); break;
    case "margin-reset": ed.setMargin(ed.marginOriginal, "Back to original margin"); break;
    case "margin-clear": ed.clearMargin(); break;
    case "margin-focus": {
      if (ed.focusMargin()) break;
      const fdi = ed.marginTooth;
      const data = ed.teethData[jawOfFdi(fdi)];
      const i = data?.model.teeth.findIndex((t) => t.fdi === fdi) ?? -1;
      if (i >= 0) ed.focusTooth(jawOfFdi(fdi), i);
      break;
    }
    case "number-one":
    case "number-arch": {
      const s = ed.selectedToothData();
      const value = Number(ed.panelEl.querySelector("[data-tooth-number]")?.value);
      if (!s || !value) { toast("Choose a number first.", "warn"); break; }
      ed.numberTooth(s.jaw, s.i, value, act === "number-arch");
      break;
    }
    case "to-margin": {
      const s = ed.selectedToothData();
      if (!s?.tooth.fdi) break;
      const { fdi } = s.tooth;
      ed.setTool("margin");
      ed.setMarginTooth(fdi);
      if (!ed.margin) ed.marginSub = "draw";
      ed.focusTooth(s.jaw, s.i);
      ed.paintTeeth();
      renderPanel(ed);
      break;
    }
    case "cut-from-minus":
    case "cut-from-plus":
    case "cut-to-minus":
    case "cut-to-plus": {
      const s = ed.selectedToothData();
      if (s) ed.moveBoundary(s.jaw, s.i, act.includes("from") ? -1 : 1, act.endsWith("plus") ? 0.25 : -0.25);
      break;
    }
    case "tooth-merge": {
      const s = ed.selectedToothData();
      if (s) ed.mergeTeeth(s.jaw, s.i);
      break;
    }
    case "tooth-remove": {
      const s = ed.selectedToothData();
      if (s) ed.removeTooth(s.jaw, s.i);
      break;
    }
    case "tooth-split":
    case "tooth-add":
      ed.pendingTooth = { kind: act === "tooth-split" ? "split" : "add", jaw: ed.teethJaw };
      renderPanel(ed);
      break;
    case "confirm-job-tooth": ed.confirmJobTooth(ed.teethJaw); break;
    case "teeth-redetect":
      ed.savedTeeth = null;
      ed.identifyTeeth({ keepSaved: false });
      ed.selectedTooth = null;
      ed.stack = ed.stack.filter((c) => c.type !== "teeth");
      ed.cursor = Math.min(ed.cursor, ed.stack.length);
      ed.paintTeeth();
      renderPanel(ed);
      ed.markDirty();
      break;
    case "margin-apply": ed.applyMarginToCrown(); break;
    case "occlusion-fit": {
      const t = ed.opts.targets.occlusal;
      const { result: r } = ed.operate(crown, `Occlusal clearance ${t} mm`, () => ops.setClearance(crown.mesh, crown.weights.weight, ed.antagonistBvh(), t));
      toast(`Occlusal clearance ${r.before?.toFixed(3)} → ${r.after?.toFixed(3)} mm.`);
      break;
    }
    case "contact-mesial":
    case "contact-distal": {
      const side = act.split("-")[1];
      const t = ed.opts.targets[side];
      const { result: r } = ed.operate(crown, `${side[0].toUpperCase()}${side.slice(1)} contact ${t} mm`, () => ops.setClearance(crown.mesh, crown.weights.weight, ed.neighborBvh[side], t, { radius: 1.8 }));
      toast(`${side[0].toUpperCase()}${side.slice(1)} gap ${r.before?.toFixed(3)} → ${r.after?.toFixed(3)} mm.`);
      break;
    }
    case "look-occlusion": {
      const g = ops.gapStats(crown.mesh, crown.weights.weight, ed.antagonistBvh(), 2.5);
      if (g.at >= 0) {
        const p = ed.viewer.toWorld([crown.mesh.pos[g.at * 3], crown.mesh.pos[g.at * 3 + 1], crown.mesh.pos[g.at * 3 + 2]]);
        ed.viewer.go({ target: p, yaw: ed.viewer.cam.yaw, pitch: ed.viewer.cam.pitch, dist: 28 });
      }
      break;
    }
    case "cement-apply":
      ed.operate(crown, `Cement gap ${ed.opts.cement.gap} mm`, () => ops.setCementGap(crown.mesh, crown.seg, ed.prepBvh, ed.opts.cement));
      break;
    case "wall-apply": {
      const { result: r } = ed.operate(crown, `Minimum wall ${ed.opts.thickness.min} mm`, () => ops.enforceThickness(crown.mesh, crown.seg, crown.intaglioBvh, ed.opts.thickness));
      toast(r.moved ? `Wall thickened by up to ${r.moved.toFixed(3)} mm.` : "The wall already meets this minimum.");
      break;
    }
    case "axis-undercuts":
      if (ed.undercutActive) ed.hideUndercuts();
      else ed.showUndercuts();
      renderPanel(ed);
      break;
    case "axis-best": ed.bestAxis(); break;
    case "axis-view": ed.axisFromView(); break;
    case "place-pontic":
      ed.pendingPontic = true;
      renderPanel(ed);
      toast("Click where the pontic should sit.");
      break;
    case "remove-unit": ed.removeObject(ed.selected); break;
    case "add-connector": {
      const a = ed.panelEl.querySelector('[data-conn="a"]').value;
      const b = ed.panelEl.querySelector('[data-conn="b"]').value;
      ed.connectUnits(a, b);
      break;
    }
    case "clear-measures": ed.clearMeasures(); break;
    case "export-unit": ed.exportUnit(obj); break;
    case "export-shells": ed.exportShells(); break;
    case "export-merged": ed.exportMerged(); break;
    case "discard":
      ed.io.confirmDiscard?.().then((ok) => { if (ok) ed.discardDesign(); });
      break;
    default:
  }
  ed.viewer.render();
}
