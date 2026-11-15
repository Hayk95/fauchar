/** Original parametric morphology, not manufacturer tooth models or trained AI. */
export const ANATOMY_STYLES = {
  balanced: { label: "Balanced", height: 1, spread: .25, groove: .12 },
  soft: { label: "Soft", height: .7, spread: .34, groove: .06 },
  pronounced: { label: "Pronounced", height: 1.25, spread: .19, groove: .18 },
  worn: { label: "Worn", height: .4, spread: .4, groove: .03 },
};
/** Forms the technician picks before building. Heights are millimetres for a full crown, not a ripple on the preparation. */
export const TOOTH_LIBRARY = [
  { id: "standard", label: "Standard", note: "Everyday cusps and grooves", height: 1, spread: .22, groove: 1 },
  { id: "youthful", label: "Youthful", note: "Taller, sharper cusps", height: 1.22, spread: .15, groove: 1.25 },
  { id: "broad", label: "Broad", note: "Wider, shallower table", height: .86, spread: .34, groove: .65 },
  { id: "worn", label: "Worn", note: "Low, flattened chewing surface", height: .5, spread: .4, groove: .28 },
];
const CROWN_MM = { incisor: 8.2, canine: 7.6, premolar: 6.2, "upper-molar": 5.8, "lower-molar": 5.6 };
export function morphologyForTooth(fdi) {
  const n = Number(fdi) % 10, q = Math.floor(Number(fdi) / 10);
  if (![1, 2, 3, 4].includes(q) || n < 1 || n > 8) throw new Error("Choose a valid FDI tooth for anatomy.");
  return n <= 2 ? "incisor" : n === 3 ? "canine" : n <= 5 ? "premolar" : q <= 2 ? "upper-molar" : "lower-molar";
}
const CUSPS = {
  premolar: [[-.38, .05, 1], [.38, -.05, .85]],
  "upper-molar": [[-.38, -.36, .95], [.36, -.36, 1], [-.38, .36, .8], [.36, .36, .85]],
  "lower-molar": [[-.4, -.35, .9], [.32, -.35, 1], [-.45, .3, .85], [.12, .37, .8], [.55, .2, .6]],
};
function reliefOf(type, settings, u, v) {
  if (type === "incisor") return Math.exp(-v * v / .08) * (.78 + .22 * Math.exp(-u * u / (settings.form === "oval" ? .28 : .7)));
  if (type === "canine") return Math.exp(-(u * u + v * v) / settings.spread);
  let peak = 0;
  for (const [x, y, z] of CUSPS[type]) peak = Math.max(peak, z * Math.exp(-((u - x) ** 2 + (v - y) ** 2) / settings.spread));
  const valley = settings.groove * Math.exp(-u * u / Math.max(settings.spread, .08)) * Math.exp(-v * v / .04);
  return Math.max(peak * .5, peak - valley);
}
/** Non-negative normalized relief. The separate crown builder preserves the intaglio. */
export function anatomyHeight(fdi, style, u, v) {
  const settings = ANATOMY_STYLES[style];
  if (!settings) throw new Error("Unknown anatomy style.");
  const type = morphologyForTooth(fdi);
  const mirror = [2, 3].includes(Math.floor(Number(fdi) / 10)) ? -1 : 1;
  return reliefOf(type, settings, u * mirror, v) * settings.height;
}
/** Occlusal height in millimetres above the margin plane for one library form. */
export function libraryHeightMm(fdi, libraryId, u, v, span = 5) {
  const lib = TOOTH_LIBRARY.find(item => item.id === libraryId);
  if (!lib) throw new Error("Unknown tooth library.");
  const type = morphologyForTooth(fdi);
  const mirror = [2, 3].includes(Math.floor(Number(fdi) / 10)) ? -1 : 1;
  const scale = Math.min(1.35, Math.max(.7, span / 5));
  const settings = { spread: lib.spread, groove: .45 * lib.groove, height: 1 };
  return reliefOf(type, settings, u * mirror, v) * CROWN_MM[type] * lib.height * scale;
}
/** Lightweight SVG preview sampled from the exact relief function used in construction. */
export function anatomyThumbnail(fdi, style) {
  return reliefThumbnail((u, v) => anatomyHeight(fdi, style, u, v), 22);
}
export function libraryThumbnail(fdi, libraryId) {
  return reliefThumbnail((u, v) => libraryHeightMm(fdi, libraryId, u, v, 5), 4);
}
function reliefThumbnail(sample, gain) {
  let cells = "";
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const u = (x - 7.5) / 8, v = (y - 7.5) / 8;
    if (u * u + v * v > .95) continue;
    const h = sample(u, v), shade = Math.round(Math.min(96, 62 + h * gain));
    cells += `<rect x="${x * 4 + 8}" y="${y * 4 + 8}" width="4.2" height="4.2" fill="hsl(43 25% ${shade}%)"/>`;
  }
  return `<svg viewBox="0 0 80 80" aria-hidden="true"><ellipse cx="40" cy="42" rx="32" ry="33" fill="#c3b897"/>${cells}</svg>`;
}
