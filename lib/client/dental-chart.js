import { ARCHES, INDICATIONS, connectorKey } from "./case-plan.js";
import { TOOTH_ATLAS } from "./cad/tooth-atlas.js";

/**
 * Both arches drawn from the occlusal outlines of the library tooth STLs, laid out the way a
 * technician reads a chart: upper arch on top (incisors up), lower arch below (incisors down),
 * patient right on the viewer's left. Units are millimetres of the library arch.
 */
const GAP = 3.5;
const UPPER_FRONT = Math.min(...ARCHES.upper.map(f => TOOTH_ATLAS[f].centroid[1]));
const UPPER_BACK = Math.max(...ARCHES.upper.map(f => TOOTH_ATLAS[f].centroid[1]));
const LOWER_FRONT = Math.min(...ARCHES.lower.map(f => TOOTH_ATLAS[f].centroid[1]));
const LOWER_BACK = Math.max(...ARCHES.lower.map(f => TOOTH_ATLAS[f].centroid[1]));
const MARGIN = 6;
const lowerTop = (UPPER_BACK - UPPER_FRONT) + GAP + (LOWER_BACK - LOWER_FRONT);

function chartPoint(fdi, x, y) {
  return ARCHES.upper.includes(fdi)
    ? [x, y - UPPER_FRONT + MARGIN]
    : [x, lowerTop - (y - LOWER_FRONT) + MARGIN];
}

const LAYOUT = Object.fromEntries(Object.values(ARCHES).flat().map(fdi => {
  const a = TOOTH_ATLAS[fdi];
  const [cx, cy] = chartPoint(fdi, a.centroid[0], a.centroid[1]);
  // Outline (mesial, facial) mm → plan view of the arch; the lower arch is mirrored top to bottom.
  const flip = ARCHES.upper.includes(fdi) ? 1 : -1;
  const pts = a.outline.map(([u, w]) => [
    u * a.mesial[0] + w * a.facial[0],
    flip * (u * a.mesial[1] + w * a.facial[1]),
  ]);
  // The outline is centred on the cervical rim; shift it so the silhouette sits on the crown centroid.
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  // Slightly enlarged so neighbouring teeth touch, as on a printed chart.
  const local = pts.map(([x, y]) => [(x - mx) * 1.07, (y - my) * 1.07]);
  const xs = local.map(p => p[0]), ys = local.map(p => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return [fdi, { cx, cy, local, box }];
}));
const XS = Object.values(LAYOUT).flatMap(t => [t.cx + t.box[0], t.cx + t.box[2]]);
const YS = Object.values(LAYOUT).flatMap(t => [t.cy + t.box[1], t.cy + t.box[3]]);
const VIEW = { x: Math.min(...XS) - 2, y: Math.min(...YS) - 2, w: Math.max(...XS) - Math.min(...XS) + 4, h: Math.max(...YS) - Math.min(...YS) + 4 };

export function toothPosition(fdi) {
  const t = LAYOUT[fdi];
  return { x: (t.cx - VIEW.x) / VIEW.w, y: (t.cy - VIEW.y) / VIEW.h, jaw: ARCHES.upper.includes(fdi) ? "upper" : "lower" };
}

function toothSvg(fdi) {
  const { local, box } = LAYOUT[fdi];
  const w = box[2] - box[0], h = box[3] - box[1];
  const d = `M${local.map(([x, y]) => `${(x - box[0]).toFixed(2)} ${(y - box[1]).toFixed(2)}`).join("L")}Z`;
  return `<svg viewBox="-0.4 -0.4 ${(w + 0.8).toFixed(2)} ${(h + 0.8).toFixed(2)}" aria-hidden="true" class="db-tooth-svg"><path d="${d}" class="db-tooth-outline"/></svg>`;
}

export function dentalChartMarkup(job, selected) {
  const units = new Map(job.units.map(u => [u.fdi, u]));
  const teeth = Object.values(ARCHES).flat().map(fdi => {
    const t = LAYOUT[fdi], unit = units.get(fdi), p = toothPosition(fdi);
    const w = t.box[2] - t.box[0] + 0.8, h = t.box[3] - t.box[1] + 0.8;
    const pressed = selected === fdi;
    const color = unit ? INDICATIONS[unit.indication].color : null;
    const left = (t.cx + t.box[0] - 0.4 - VIEW.x) / VIEW.w * 100, top = (t.cy + t.box[1] - 0.4 - VIEW.y) / VIEW.h * 100;
    return `<button type="button" class="db-tooth ${p.jaw} ${unit ? `role-${unit.indication} assigned` : ""}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${(w / VIEW.w * 100).toFixed(2)}%;height:${(h / VIEW.h * 100).toFixed(2)}%;${color ? `--tooth-fill:${color};` : ""}" data-tooth="${fdi}" aria-pressed="${pressed}" tabindex="${pressed || (selected == null && fdi === 18) ? 0 : -1}" aria-label="Tooth ${fdi}${unit ? ` · ${INDICATIONS[unit.indication].label}` : " · not assigned"}">${toothSvg(fdi)}<span class="db-tooth-number">${fdi}</span></button>`;
  }).join("");
  const connectors = Object.values(ARCHES).flatMap(arch => arch.slice(1).map((b, i) => ({ a: arch[i], b }))).filter(c => [c.a, c.b].every(fdi => ["crown", "pontic"].includes(units.get(fdi)?.indication))).map(c => {
    const a = toothPosition(c.a), b = toothPosition(c.b);
    const incompatible = units.get(c.a).material !== units.get(c.b).material;
    const enabled = job.connectors.some(x => connectorKey(x.a, x.b) === connectorKey(c.a, c.b));
    return `<input type="checkbox" class="db-connector ${incompatible ? "incompatible" : ""}" style="left:${((a.x + b.x) / 2 * 100).toFixed(2)}%;top:${((a.y + b.y) / 2 * 100).toFixed(2)}%" data-connector="${c.a}:${c.b}" ${enabled ? "checked" : ""} ${incompatible ? "disabled" : ""} aria-label="Connector ${c.a} to ${c.b}${incompatible ? ": different materials" : ""}" title="${incompatible ? "Different materials cannot be connected" : `Connector ${c.a}–${c.b}`}"/>`;
  }).join("");
  const used = [...new Set(job.units.map(u => u.indication))];
  const legend = used.length
    ? `<ul class="db-legend" aria-label="Indications in this job">${used.map(id => `<li style="--swatch:${INDICATIONS[id].color}">${INDICATIONS[id].label}</li>`).join("")}</ul>`
    : `<p class="db-legend-empty">Click a tooth to define its restoration</p>`;
  return `<div class="db-dental-chart" style="aspect-ratio:${VIEW.w.toFixed(2)} / ${VIEW.h.toFixed(2)};width:min(100cqw, calc(100cqh * ${(VIEW.w / VIEW.h).toFixed(4)}), 560px)" role="group" aria-label="Upper and lower dental arches, FDI tooth notation"><span class="db-arch-label upper">Upper jaw</span><span class="db-arch-label lower">Lower jaw</span><span class="db-patient-side right">R</span><span class="db-patient-side left">L</span>${teeth}${connectors}<div class="db-chart-center">${legend}</div></div>`;
}

export const CHART_ASPECT = VIEW.w / VIEW.h;
