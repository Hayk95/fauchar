import { ANATOMY_STYLES } from "./cad/anatomy-library.js";

/** Original DentalDB-style job definition and scan planning. Shared with headless tests. */
export const ARCHES = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
};
// Catalog labels/grouping follow the public workflow reference. Only implemented engines are enabled.
export const INDICATIONS = Object.fromEntries([
  ["crown", "Anatomic crown", "Crowns and copings", "#b000bd", true],
  ["coping", "Coping", "Crowns and copings", "#39877b"],
  ["pressedCrown", "Pressed crown", "Crowns and copings", "#a6ae00"],
  ["provisional", "Eggshell crown (Provisional)", "Crowns and copings", "#7900e7"],
  ["offsetCoping", "Offset coping", "Crowns and copings", "#388500"],
  ["mockup", "Mockup", "Crowns and copings", "#c95e60"],
  ["pontic", "Anatomic pontic", "Pontics", "#980033", true],
  ["reducedPontic", "Reduced pontic", "Pontics", "#ba164e"],
  ["pressedPontic", "Pressed pontic", "Pontics", "#59a9ce"],
  ["eggshellPontic", "Eggshell pontic (Provisional)", "Pontics", "#b97aaf"],
  ["inlay", "Inlay/Onlay", "Inlays, onlays and veneers", "#456f19"],
  ["offsetInlay", "Offset inlay", "Inlays, onlays and veneers", "#2463ba"],
  ["veneer", "Veneer", "Inlays, onlays and veneers", "#3294a4"],
  ["waxup", "Anatomic waxup", "Digital copy milling", "#40bd82"],
  ["reducedWaxup", "Reduced waxup", "Digital copy milling", "#515151"],
  ["ponticWaxup", "Pontic waxup", "Digital copy milling", "#4f439c"],
  ["denture", "Full denture", "Removables and appliances", "#6abfc8"],
  ["partialDenture", "Partial denture", "Removables and appliances", "#b8aa7e"],
  ["splint", "Bite splint", "Removables and appliances", "#5d688c"],
  ["primaryTelescope", "Primary telescopic crown", "Removables and appliances", "#b9867d"],
  ["secondaryTelescope", "Secondary telescopic crown", "Removables and appliances", "#ad896f"],
  ["attachment", "Attachment", "Removables and appliances", "#123f50"],
  ["barPillar", "Bar pillar", "Bars", "#7f660b"],
  ["barSegment", "Bar segment", "Bars", "#6600a6"],
  ["offsetSubstructure", "Offset substructure", "Bars", "#a8a28d"],
  ["antagonist", "Antagonist", "Residual dentition", "#f28500", true],
  ["adjacent", "Adjacent tooth", "Residual dentition", "#edb31c", true],
  ["omit", "Omit in bridge", "Residual dentition", "#ee2528"],
].map(([id, label, group, color, supported = false]) => [id, { label, group, color, supported }]));
export const MATERIAL_CATALOG = [
  ["Zirconia", "#e8eceb", "disc"], ["Zirconia Multilayer", "#eceadf", "layered"],
  ["PMMA", "#e5d7b9", "layered"], ["Wax", "#4f9983", "disc"],
  ["CoCr", "#a4a4af", "disc"], ["Titanium", "#989aaf", "disc"],
  ["CoCr (Laser)", "#aeb2b6", "bridge"], ["3D Print", "#c8ac82", "bridge"],
  ["Lithium disilicate", "#b8a8cf", "block"], ["Lithium silicate", "#d0b18b", "block"],
  ["Composite", "#d9c8a2", "block"], ["Hybrid ceramic", "#d4cfbd", "block"], ["Other", "#c8c8c8", "disc"],
].map(([name, color, shape]) => ({ name, color, shape }));
export const MATERIALS = MATERIAL_CATALOG.map(m => m.name);
export const SHADES = ["A1", "A2", "A3", "A3.5", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4", "D2", "D3", "D4", "0M1", "0M2", "0M3"];
export const jawOf = fdi => ARCHES.upper.includes(Number(fdi)) ? "upper" : ARCHES.lower.includes(Number(fdi)) ? "lower" : null;
export const restoredUnits = job => job.units.filter(u => u.indication === "crown" || u.indication === "pontic");
export const connectorKey = (a, b) => [Number(a), Number(b)].sort((x, y) => x - y).join("-");

export function newJob() {
  return { version: 1, name: "", client: "", technician: "", patientRef: "", notes: "", dueDate: "",
    scanMode: "intraoral", upAxis: "z", useAntagonist: true, preop: false, gingiva: false, bite: false,
    anatomyStyle: "balanced", material: "Zirconia", shade: "A2", production: "milling", units: [], connectors: [],
    parameters: { cementGap: 0.06, marginGap: 0.02, minWall: 0.8, marginWall: 0.2 } };
}

export function setUnit(job, fdi, values) {
  if (!jawOf(fdi)) throw new Error("Choose a valid permanent tooth (FDI 11–48).");
  if (values && !INDICATIONS[values.indication]?.supported) throw new Error("This indication does not have a design module yet.");
  const id = Number(fdi);
  job.units = job.units.filter(u => u.fdi !== id);
  if (values) {
    job.units.push({ fdi: id, indication: values.indication, material: values.material || job.material, shade: values.shade || job.shade });
  }
  const units = new Map(restoredUnits(job).map(u => [u.fdi, u]));
  job.connectors = job.connectors.filter(c => units.has(c.a) && units.has(c.b) && units.get(c.a).material === units.get(c.b).material);
}

export function bridgePreset(job, first, last) {
  const jaw = jawOf(first);
  if (!jaw || jawOf(last) !== jaw) throw new Error("A bridge must stay in one jaw.");
  const arch = ARCHES[jaw], a = arch.indexOf(Number(first)), b = arch.indexOf(Number(last));
  const span = arch.slice(Math.min(a, b), Math.max(a, b) + 1);
  if (span.length < 3) throw new Error("Choose two abutments with at least one pontic between them.");
  job.units = job.units.filter(u => !["crown", "pontic"].includes(u.indication));
  span.forEach((fdi, i) => setUnit(job, fdi, { indication: i === 0 || i === span.length - 1 ? "crown" : "pontic" }));
  job.connectors = span.slice(1).map((fdi, i) => ({ a: span[i], b: fdi }));
  return span;
}

export function jobProblems(job) {
  const errors = [], units = restoredUnits(job);
  if (!units.length) errors.push("Click a tooth and assign an anatomic crown, or define a bridge.");
  if (job.units.some(u => !jawOf(u.fdi) || !INDICATIONS[u.indication]?.supported)) errors.push("Remove unsupported tooth indications.");
  if (new Set(job.units.map(u => u.fdi)).size !== job.units.length) errors.push("Each tooth can have only one indication.");
  const jaws = new Set(units.map(u => jawOf(u.fdi)));
  if (jaws.size > 1) errors.push("Create separate jobs for restorations in opposing jaws.");
  if (jaws.size === 1 && job.units.some(u => u.indication === "antagonist" && jaws.has(jawOf(u.fdi)))) errors.push("Mark antagonist teeth in the opposite jaw, not in the restoration jaw.");
  if (!units.some(u => u.indication === "crown")) errors.push("A bridge needs prepared abutment teeth, not only pontics.");
  if (units.length > 1 && jaws.size === 1 && !jaws.has(null)) {
    const arch = ARCHES[[...jaws][0]], sorted = units.slice().sort((a, b) => arch.indexOf(a.fdi) - arch.indexOf(b.fdi));
    if (sorted[0].indication !== "crown" || sorted[sorted.length - 1].indication !== "crown") errors.push("The first and last bridge units must be crowns on prepared abutments.");
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      if (arch.indexOf(b.fdi) - arch.indexOf(a.fdi) !== 1) { errors.push("Bridge units must form a continuous span. Define missing units as pontics."); break; }
      if (a.material !== b.material) { errors.push("Connected bridge units must use the same material."); break; }
      if (!job.connectors.some(c => connectorKey(c.a, c.b) === connectorKey(a.fdi, b.fdi))) { errors.push("Enable every bridge connector, or create separate jobs for independent crowns."); break; }
    }
  }
  if (job.anatomyStyle && !ANATOMY_STYLES[job.anatomyStyle]) errors.push("Choose a supported anatomy style.");
  if (job.units.some(u => !MATERIALS.includes(u.material))) errors.push("Choose a supported planning material.");
  if (!["milling", "printing", "external"].includes(job.production)) errors.push("Choose a production method.");
  const p = job.parameters;
  if (!p || ![p.cementGap, p.marginGap, p.minWall, p.marginWall].every(Number.isFinite) || p.cementGap < 0 || p.cementGap > 0.3 || p.marginGap < 0 || p.marginGap > 0.2 || p.minWall < 0.3 || p.minWall > 3 || p.marginWall <= p.marginGap || p.marginWall > 1) errors.push("Check the cement gap and wall dimensions.");
  if (!["intraoral", "model"].includes(job.scanMode)) errors.push("Choose the scan mode.");
  return [...new Set(errors)];
}

export function scanPlan(job) {
  const units = restoredUnits(job), jaw = jawOf(units[0]?.fdi);
  if (!jaw) return [];
  const opposite = jaw === "upper" ? "lower" : "upper";
  const name = id => id === "upper" ? "Upper jaw" : "Lower jaw";
  const plan = [{ id: jaw, jaw, label: `${name(jaw)} · preparation`, required: true, purpose: "Prepared abutment(s), adjacent teeth and the margin region." }];
  const explicitAntagonist = job.units.some(u => u.indication === "antagonist" && jawOf(u.fdi) === opposite);
  if (job.useAntagonist || explicitAntagonist) plan.push({ id: opposite, jaw: opposite, label: `${name(opposite)} · antagonist`, required: true, purpose: "Opposing dentition for static occlusion. Supply scans already aligned in bite." });
  else plan.push({ id: opposite, jaw: opposite, label: `${name(opposite)} · antagonist`, required: false, purpose: "Recommended for occlusion. Without it, antagonist checks are unavailable." });
  if (job.preop) plan.push({ id: "preop", jaw: "preop", label: "Pre-op reference", required: true, reference: true, purpose: "Original tooth shape for visual comparison; no automatic shape copy." });
  if (job.gingiva || units.some(u => u.indication === "pontic")) plan.push({ id: "gingiva", jaw: "gingiva", label: "Gingiva / ridge reference", required: job.gingiva, reference: true, purpose: "Soft tissue beneath pontics for visual review. No automatic tissue adaptation." });
  if (job.bite) plan.push({ id: "bite", jaw: "bite", label: "Bite registration reference", required: true, reference: true, purpose: "Reference geometry only. Automatic bite registration is not implemented." });
  return plan;
}

export function scanProblems(job, files) {
  const plan = scanPlan(job), errors = [];
  for (const slot of plan) {
    const matches = files.filter(f => f.slot === slot.id);
    if (matches.length > 1) errors.push(`Use one file for ${slot.label}.`);
    if (slot.required && !matches.some(f => f.status === "valid")) errors.push(`Add ${slot.label.toLowerCase()}.`);
  }
  if (files.some(f => f.status === "reading" || f.status === "parsing")) errors.unshift("Wait for scan processing to finish.");
  if (files.some(f => f.status === "error")) errors.push("Replace or remove the scans that could not be read.");
  if (files.some(f => !plan.some(s => s.id === f.slot))) errors.push("Remove scans no longer included in the current job plan.");
  return [...new Set(errors)];
}

export function caseFromJob(job, files, { id, now = Date.now() }) {
  const problems = [...jobProblems(job), ...scanProblems(job, files)];
  if (problems.length) throw new Error(problems[0]);
  const units = restoredUnits(job), arch = ARCHES[jawOf(units[0].fdi)];
  const teeth = units.map(u => u.fdi).sort((a, b) => arch.indexOf(a) - arch.indexOf(b));
  const primary = teeth[0];
  const plan = scanPlan(job);
  const name = job.name.trim() || (units.length === 1 ? `Crown ${primary}` : `Bridge ${teeth[0]}–${teeth[teeth.length - 1]}`);
  return { id, name, project: job.client.trim(), patientRef: job.patientRef.trim(), notes: job.notes.trim(),
    restoration: units.length === 1 ? "crown" : "bridge", teeth, primaryTooth: primary,
    job: structuredClone(job), scanPlan: plan,
    files: files.filter(f => f.status === "valid").map(f => ({ id: f.id, jaw: plan.find(s => s.id === f.slot).jaw, role: f.slot, name: f.name, size: f.size, stats: f.stats })),
    status: "review", upAxis: job.upAxis, created: now, modified: now, opened: now, archived: false };
}
