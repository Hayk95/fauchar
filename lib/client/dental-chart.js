import { ARCHES, INDICATIONS, connectorKey } from "./case-plan.js";

/** Original vector tooth silhouettes: occlusal chart symbols, not patient anatomy. */
const SHAPES = {
  molar: "M13 5 C7 3 3 9 5 17 C1 23 5 37 13 36 C18 41 23 37 27 38 C36 38 39 30 36 23 C40 15 36 5 29 6 C23 1 18 4 13 5Z",
  premolar: "M15 4 C7 3 5 10 7 19 C4 26 8 37 16 38 C23 40 32 35 32 27 C36 19 32 7 26 5 C22 2 18 3 15 4Z",
  canine: "M20 3 C12 4 6 11 7 21 C7 30 12 37 20 39 C27 37 33 28 32 20 C34 12 27 5 20 3Z",
  incisor: "M10 6 Q20 2 30 6 Q34 12 31 23 L28 35 Q20 39 12 35 L8 23 Q5 12 10 6Z",
};
export function toothPosition(fdi) {
  const jaw = ARCHES.upper.includes(fdi) ? "upper" : "lower";
  const index = ARCHES[jaw].indexOf(fdi);
  const angle = index * Math.PI / 15;
  return { x: 320 - 218 * Math.cos(angle), y: jaw === "upper" ? 234 - 144 * Math.sin(angle) : 316 + 144 * Math.sin(angle),
    rotation: (angle * 180 / Math.PI - 90) * (jaw === "upper" ? .8 : -.8), jaw };
}
function silhouette(fdi) {
  const n = fdi % 10, type = n >= 6 ? "molar" : n >= 4 ? "premolar" : n === 3 ? "canine" : "incisor";
  return `<svg viewBox="0 0 42 43" aria-hidden="true" class="db-tooth-svg"><defs><radialGradient id="db-enamel-${fdi}" cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="var(--tooth-highlight)"/><stop offset=".6" stop-color="var(--tooth-fill)"/><stop offset="1" stop-color="var(--tooth-shadow)"/></radialGradient></defs>
    <path d="${SHAPES[type]}" fill="url(#db-enamel-${fdi})" class="db-tooth-outline"/>
    ${type === "molar" ? '<path d="M12 12 Q20 20 29 12 M20 17 L19 29 M11 27 Q20 22 29 29" class="db-tooth-fissure"/><path d="M9 17 Q10 11 15 10 M27 9 Q33 13 32 18 M30 30 Q26 35 22 33" class="db-tooth-shine"/>' : type === "premolar" ? '<path d="M12 13 Q20 22 27 14 M19 18 L19 31" class="db-tooth-fissure"/><path d="M10 15 Q11 9 16 8 M25 30 Q29 25 28 22" class="db-tooth-shine"/>' : '<path d="M12 12 Q20 8 28 12 M16 31 Q20 33 25 31" class="db-tooth-shine"/>'}</svg>`;
}
export function dentalChartMarkup(job, selected) {
  const units = new Map(job.units.map(u => [u.fdi, u]));
  const teeth = Object.values(ARCHES).flat().map(fdi => {
    const p = toothPosition(fdi), unit = units.get(fdi), n = fdi % 10;
    const w = n >= 6 ? 40 : n >= 4 ? 34 : 31;
    const pressed = selected === fdi;
    return `<button type="button" class="db-tooth ${p.jaw} ${unit ? `role-${unit.indication}` : ""}" style="left:${p.x / 6.4}%;top:${p.y / 5.5}%;width:${w / 6.4}%;--tooth-rotation:${p.rotation}deg" data-tooth="${fdi}" aria-pressed="${pressed}" tabindex="${pressed || (selected == null && fdi === 18) ? 0 : -1}" aria-label="Tooth ${fdi}${unit ? ` · ${INDICATIONS[unit.indication].label}` : " · not assigned"}">${silhouette(fdi)}<span class="db-tooth-number">${fdi}</span></button>`;
  }).join("");
  const connectors = Object.values(ARCHES).flatMap(arch => arch.slice(1).map((b, i) => ({ a: arch[i], b }))).filter(c => [c.a, c.b].every(fdi => ["crown", "pontic"].includes(units.get(fdi)?.indication))).map(c => {
    const a = toothPosition(c.a), b = toothPosition(c.b);
    const incompatible = units.get(c.a).material !== units.get(c.b).material;
    const enabled = job.connectors.some(x => connectorKey(x.a, x.b) === connectorKey(c.a, c.b));
    return `<input type="checkbox" class="db-connector ${incompatible ? "incompatible" : ""}" style="left:${(a.x + b.x) / 12.8}%;top:${(a.y + b.y) / 11}%" data-connector="${c.a}:${c.b}" ${enabled ? "checked" : ""} ${incompatible ? "disabled" : ""} aria-label="Connector ${c.a} to ${c.b}${incompatible ? ": different materials" : ""}" title="${incompatible ? "Different materials cannot be connected" : `Connector ${c.a}–${c.b}`}"/>`;
  }).join("");
  return `<div class="db-dental-chart" role="group" aria-label="Upper and lower dental arches, FDI tooth notation"><span class="db-arch-label upper">Upper jaw</span><span class="db-arch-label lower">Lower jaw</span><span class="db-patient-side right">Patient right</span><span class="db-patient-side left">Patient left</span>${teeth}${connectors}<span class="db-chart-center">Click a tooth to define its restoration</span></div>`;
}
