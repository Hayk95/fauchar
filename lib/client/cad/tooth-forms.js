/** Original FAUCHAR tooth forms, one per FDI number. Not a commercial tooth library. */
import { TOOTH_LIBRARY } from "./anatomy-library.js";
import { meshStats } from "./mesh.js";

const UPPER = [
  null,
  { md: 8.6, bl: 7.2, h: 10.4, kind: "incisor" },
  { md: 6.6, bl: 6.2, h: 9.0, kind: "incisor" },
  { md: 7.6, bl: 8.0, h: 10.4, kind: "canine" },
  { md: 7.2, bl: 9.2, h: 8.5, kind: "premolar" },
  { md: 6.8, bl: 9.0, h: 7.8, kind: "premolar" },
  { md: 10.4, bl: 11.4, h: 7.5, kind: "umolar" },
  { md: 9.5, bl: 10.8, h: 7.0, kind: "umolar" },
  { md: 8.8, bl: 10.0, h: 6.5, kind: "umolar" },
];
const LOWER = [
  null,
  { md: 5.4, bl: 6.0, h: 9.0, kind: "incisor" },
  { md: 6.0, bl: 6.4, h: 9.4, kind: "incisor" },
  { md: 6.8, bl: 7.7, h: 10.8, kind: "canine" },
  { md: 7.0, bl: 7.7, h: 8.6, kind: "lpremolar" },
  { md: 7.2, bl: 8.2, h: 8.0, kind: "premolar" },
  { md: 11.2, bl: 10.4, h: 7.6, kind: "lmolar" },
  { md: 10.6, bl: 10.1, h: 7.1, kind: "lmolar" },
  { md: 10.0, bl: 9.6, h: 6.6, kind: "lmolar" },
];
const CUSPS = {
  premolar: [[-.32, .12, 1], [.34, -.08, .82]],
  lpremolar: [[-.08, .18, 1], [.16, -.22, .55]],
  umolar: [[-.36, -.34, .95], [.34, -.36, 1], [-.36, .34, .78], [.36, .32, .84]],
  lmolar: [[-.42, -.32, .9], [.28, -.34, 1], [-.46, .28, .86], [.08, .36, .8], [.48, .16, .62]],
};

export function toothSpec(fdi) {
  const q = Math.floor(Number(fdi) / 10);
  const n = Number(fdi) % 10;
  if (![1, 2, 3, 4].includes(q) || n < 1 || n > 8) throw new Error("Choose a valid FDI tooth.");
  const spec = (q <= 2 ? UPPER : LOWER)[n];
  return { ...spec, fdi: Number(fdi), mirror: q === 2 || q === 3 };
}

export function toothFile(fdi) {
  return `${toothSpec(fdi).fdi}.stl`;
}

/** How far this ring sits from the margin center. The chewing table stays wide; it does not pinch to a point. */
export function ringScale(t, lib) {
  const edge = .5;
  if (t <= edge) {
    const u = t / edge;
    const bulge = Math.sin(Math.PI * u) * lib.bulge;
    return (1 + bulge) * (1 - u) + lib.table * u;
  }
  const k = (t - edge) / (1 - edge);
  return lib.table * (1 - k) + .34 * k;
}

/** Extra millimetres of cusp or incisal edge above the marginal ridge. */
export function cuspMm(spec, u, v, lib) {
  const uu = spec.mirror ? -u : u;
  const amp = 2.5 * lib.height;
  if (spec.kind === "incisor") {
    const edge = Math.exp(-((v - .18) ** 2) / .018) * (.62 + .38 * Math.exp(-(uu * uu) / .45));
    const fossa = v < .05 ? .45 * Math.exp(-(uu * uu) / .22) * Math.exp(-((v + .28) ** 2) / .07) : 0;
    return amp * Math.max(0, .85 * edge - .35 * fossa);
  }
  if (spec.kind === "canine") return amp * Math.exp(-(uu * uu + (v - .12) ** 2) / .14);
  let peak = 0;
  for (const [x, y, w] of CUSPS[spec.kind]) peak = Math.max(peak, w * Math.exp(-((uu - x) ** 2 + (v - y) ** 2) / lib.spread));
  const valley = .55 * lib.groove * Math.exp(-(uu * uu) / .12) * Math.exp(-(v * v) / .045);
  return amp * Math.max(.18, peak - valley);
}

export function bodyMm(spec, lib) {
  return spec.h * .72 * lib.height;
}

function smooth(u) {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/** Height of the outer surface above the margin point on this meridian. */
export function formHeight(spec, lib, t, u, v) {
  const edge = .62;
  const body = bodyMm(spec, lib);
  if (t <= edge) return body * smooth(t / edge);
  return body + cuspMm(spec, u, v, lib) * smooth((t - edge) / .12);
}

/** Closed canonical tooth, cervix on z = 0, occlusal toward +z, mesial +x, facial +y. */
export function canonicalTooth(fdi, segments = 64, libraryId = "standard") {
  const spec = toothSpec(fdi);
  const lib = TOOTH_LIBRARY.find(item => item.id === libraryId);
  if (!lib) throw new Error("Unknown tooth library.");
  if (!Number.isInteger(segments) || segments < 32) throw new Error("Unsupported tooth resolution.");
  const hx = spec.md / 2, hy = spec.bl / 2;
  const vertices = [];
  const triangles = [];
  const push = (x, y, z) => { const id = vertices.length / 3; vertices.push(x, y, z); return id; };
  const rings = [];
  const count = 18;
  for (let r = 0; r < count; r++) {
    const t = r / count;
    const scale = ringScale(t, lib);
    const ring = [];
    for (let i = 0; i < segments; i++) {
      const theta = i / segments * Math.PI * 2;
      const x = Math.cos(theta) * hx * scale;
      const y = Math.sin(theta) * hy * scale;
      ring.push(push(x, y, formHeight(spec, lib, t, x / hx, y / hy)));
    }
    rings.push(ring);
  }
  const top = push(0, 0, formHeight(spec, lib, 1, 0, 0));
  const bottom = push(0, 0, 0);
  const add = (a, b, c) => triangles.push(a, b, c);
  for (let r = 0; r < count - 1; r++) for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    add(rings[r][i], rings[r][j], rings[r + 1][j]);
    add(rings[r][i], rings[r + 1][j], rings[r + 1][i]);
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    add(rings[count - 1][i], rings[count - 1][j], top);
    add(rings[0][j], rings[0][i], bottom);
  }
  const positions = new Float32Array(vertices);
  const indices = new Uint32Array(triangles);
  const stats = meshStats(positions, indices);
  if (!stats.closed || stats.degenerate || stats.volume < 1) throw new Error(`Tooth ${spec.fdi} is not a closed form.`);
  return { positions, indices, stats, spec };
}
