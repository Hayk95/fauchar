/** Original, deterministic crown starter. No proprietary tooth libraries or AI weights.
 * Supports a single, star-shaped preparation viewed along its insertion axis.
 * It builds a hollow, closed shell; the technician must finish anatomy and review fit.
 */
import { BVH, V, meshStats } from "./mesh.js";
import { resampleLoop } from "./ops.js";
import { ANATOMY_STYLES, TOOTH_LIBRARY, anatomyHeight, morphologyForTooth } from "./anatomy-library.js";
import { bodyMm, cuspMm, formHeight, ringScale, toothFile, toothSpec } from "./tooth-forms.js";

export const CROWN_PROFILES = {
  anterior: { label: "Anterior starter", cusps: 0, relief: 0.35 },
  premolar: { label: "Premolar starter", cusps: 2, relief: 0.5 },
  molar: { label: "Molar starter", cusps: 4, relief: 0.6 },
};

export function profileForTooth(fdi) {
  const n = Number(fdi) % 10;
  return n <= 3 ? "anterior" : n <= 5 ? "premolar" : "molar";
}

export function createCrown({ positions, indices, margin, axis, tooth = 22, profile = profileForTooth(tooth),
  gap = 0.06, marginGap = 0.02, wall = 0.8, marginWall = 0.2, relief = 0.6, anatomyStyle = null, libraryId = null, segments = 96, rings = 24 }) {
  if (!positions?.length || !indices?.length) throw new Error("Load a preparation scan first.");
  if (!margin || margin.length < 8 || margin.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error("Draw a closed preparation margin with at least eight points.");
  if (!axis || axis.length !== 3 || !axis.every(Number.isFinite) || V.len(axis) < 0.9) throw new Error("Set a valid insertion direction first.");
  if (![gap, marginGap, wall, marginWall, relief].every(Number.isFinite) || gap < 0 || gap > 0.3 || marginGap < 0 || marginGap > 0.2 || wall < 0.3 || wall > 3 || marginWall <= marginGap || marginWall > 1 || relief < 0 || relief > 3) throw new Error("Crown dimensions are outside the supported starter range.");
  if (!CROWN_PROFILES[profile]) throw new Error("Unknown crown starter profile.");
  if (!Number.isInteger(segments) || segments < 32 || segments > 160 || !Number.isInteger(rings) || rings < 8 || rings > 40) throw new Error("Unsupported crown mesh resolution.");
  if (anatomyStyle && !ANATOMY_STYLES[anatomyStyle]) throw new Error("Unknown anatomy style.");
  const library = libraryId ? TOOTH_LIBRARY.find(item => item.id === libraryId) : null;
  if (libraryId && !library) throw new Error("Unknown tooth library.");
  morphologyForTooth(tooth);
  const { z, x, y, center, loop, polar, sample } = preparationFrame({ positions, indices, margin, axis, segments });
  const vertices = [], triangles = [], faceIn = [], inner = [], outer = [];
  const push = p => { const id = vertices.length / 3; vertices.push(...p); return id; };
  const addTri = (a, b, c, inside) => { triangles.push(a, b, c); faceIn.push(inside ? 1 : 0); };
  const profileData = CROWN_PROFILES[profile];
  const maxU = Math.max(...polar.map(p => Math.abs(p[0]))), maxV = Math.max(...polar.map(p => Math.abs(p[1])));
  const span = Math.max(maxU, maxV);
  const spec = toothSpec(tooth);
  // The whole chewing table lifts together, so a pointed preparation cannot fill the grooves.
  let occlusalLift = 0;
  if (library) {
    let prepMax = -Infinity;
    const consider = p => { prepMax = Math.max(prepMax, V.dot(V.sub(sample(p).point, center), z)); };
    consider(center);
    for (let i = 0; i < 12; i++) {
      const ang = i / 12 * Math.PI * 2;
      try { consider(V.add(center, V.add(V.mul(x, Math.cos(ang) * span * .45), V.mul(y, Math.sin(ang) * span * .45)))); } catch { /* ray left the preparation */ }
    }
    const fossa = (bodyMm(spec, library) + cuspMm(spec, 0, 0, library)) * relief;
    occlusalLift = Math.max(0, prepMax + wall + .25 - fossa);
  }
  for (let r = 0; r < rings; r++) {
    const t = r / rings;
    const inRing = [], outRing = [];
    for (let i = 0; i < segments; i++) {
      const rim = loop[i], radial = V.sub(rim, center);
      const flat = V.sub(radial, V.mul(z, V.dot(radial, z)));
      const dir = V.norm(flat);
      const scale = library ? ringScale(t, library) : 1 - t;
      const placed = V.add(center, V.mul(flat, scale));
      const hit = r === 0 ? { point: rim, normal: dir } : sample(V.add(center, V.mul(flat, 1 - t)));
      const blend = Math.min(1, t * 8);
      const cement = marginGap + (gap - marginGap) * blend;
      const inP = V.add(hit.point, V.mul(hit.normal, cement));
      const angle = Math.atan2(V.dot(dir, y), V.dot(dir, x));
      const uu = V.dot(V.sub(placed, center), x) / maxU, vv = V.dot(V.sub(placed, center), y) / maxV;
      const cusps = anatomyStyle ? anatomyHeight(tooth, anatomyStyle, uu, vv) * Math.sin(Math.PI * t / 2) : profileData.cusps ? (0.5 + 0.5 * Math.cos(profileData.cusps * angle)) * Math.sin(Math.PI * t) : Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.cos(angle));
      const thickness = marginWall + (wall - marginWall) * blend;
      let outP;
      if (library) {
        const rimH = V.dot(V.sub(rim, center), z);
        const prepH = V.dot(V.sub(hit.point, center), z);
        const rise = Math.min(1, t / .62);
        const h = rimH + formHeight(spec, library, t, uu, vv) * relief + occlusalLift * rise * rise * (3 - 2 * rise);
        outP = V.add(placed, V.mul(z, Math.max(prepH + thickness, h)));
      } else outP = V.add(V.add(hit.point, V.mul(hit.normal, thickness)), V.mul(z, cusps * relief * profileData.relief));
      inRing.push(push(inP)); outRing.push(push(outP));
    }
    inner.push(inRing); outer.push(outRing);
  }
  const top = sample(center);
  const innerTop = push(V.add(top.point, V.mul(top.normal, gap)));
  const prepTopH = V.dot(V.sub(top.point, center), z);
  const outerTop = push(library
    ? V.add(center, V.mul(z, Math.max(prepTopH + wall, (bodyMm(spec, library) + cuspMm(spec, 0, 0, library)) * relief + occlusalLift)))
    : V.add(V.add(top.point, V.mul(top.normal, wall)), V.mul(z, anatomyStyle ? anatomyHeight(tooth, anatomyStyle, 0, 0) * relief * profileData.relief : 0)));
  for (let r = 0; r < rings - 1; r++) for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    for (const [disk, inside] of [[outer, false], [inner, true]]) {
      const a = disk[r][i], b = disk[r][j], c = disk[r + 1][j], d = disk[r + 1][i];
      if (inside) { addTri(a, c, b, true); addTri(a, d, c, true); }
      else { addTri(a, b, c, false); addTri(a, c, d, false); }
    }
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    addTri(outer[rings - 1][i], outer[rings - 1][j], outerTop, false);
    addTri(inner[rings - 1][i], innerTop, inner[rings - 1][j], true);
    addTri(inner[0][i], inner[0][j], outer[0][j], false);
    addTri(inner[0][i], outer[0][j], outer[0][i], false);
  }
  const pos = new Float32Array(vertices), idx = new Uint32Array(triangles);
  const stats = meshStats(pos, idx);
  if (!stats.closed || stats.invalid || stats.degenerate || stats.volume < 1) throw new Error("Could not create a valid closed starter. Review the margin and scan.");
  const intaglio = new Uint8Array(pos.length / 3);
  for (let r = 1; r < rings; r++) inner[r].forEach(v => intaglio[v] = 1);
  intaglio[innerTop] = 1;
  const inTris = [], outTris = [];
  faceIn.forEach((v, i) => (v ? inTris : outTris).push(i));
  const rimRadius = loop.reduce((max, p) => Math.max(max, V.dist(p, center)), 0);
  return { positions: pos, indices: idx, stats, frame: { center, occlusal: z, mesial: x, facial: y, rimRadius },
    seg: { intaglio, rim: Int32Array.from(inner[0]), rimLoop: Int32Array.from(inner[0]), faceIn: Uint8Array.from(faceIn), inTris, outTris },
    source: { type: library ? "anatomic-library" : "procedural-starter", libraryId: library?.id || null, libraryLabel: library?.label || null, toothFile: library ? toothFile(tooth) : null, profile, anatomyStyle, tooth, gap, marginGap, wall, marginWall, relief } };
}

/** Frame, resampled counter-clockwise margin and a ray sampler of the preparation along the insertion axis. */
export function preparationFrame({ positions, indices, margin, axis, segments = 96 }) {
  const z = V.norm(axis);
  const x = V.norm(V.cross(Math.abs(z[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], z));
  const y = V.cross(z, x);
  const center = V.mul(margin.reduce((a, p) => V.add(a, p), [0, 0, 0]), 1 / margin.length);
  let loop = resampleLoop(margin, segments);
  const uv = p => [V.dot(V.sub(p, center), x), V.dot(V.sub(p, center), y)];
  const area = loop.reduce((s, p, i) => { const a = uv(p), b = uv(loop[(i + 1) % segments]); return s + a[0] * b[1] - b[0] * a[1]; }, 0);
  if (area < 0) loop = loop.reverse();
  // A radial parameterization is only safe when the full boundary is visible from its center.
  const polar = loop.map(uv);
  if (Math.abs(area) < 2 || polar.some((a, i) => { const b = polar[(i + 1) % segments]; return a[0] * b[1] - a[1] * b[0] <= 1e-6; })) throw new Error("Margin is folded or not star-shaped along this axis. Correct the line or insertion direction.");
  if (polar.some(p => Math.hypot(...p) < 0.5 || Math.hypot(...p) > 12)) throw new Error("Margin dimensions must be in millimetres and describe one preparation.");
  const scan = new BVH(positions, indices);
  const start = V.add(center, V.mul(z, 20));
  const down = V.mul(z, -1);
  const sample = p => {
    const o = V.add(start, V.sub(p, center));
    const hit = scan.raycast(o, down);
    if (!hit || hit.t > 32 || hit.t < 4) throw new Error("The preparation is not visible along the insertion axis. Check orientation, scan holes and margin.");
    const h = V.dot(V.sub(hit.point, center), z);
    if (h < -2 || h > 15) throw new Error("Margin and preparation height do not agree. Review the scan and axis.");
    const n = V.dot(hit.normal, z) < 0 ? V.mul(hit.normal, -1) : hit.normal;
    return { ...hit, normal: n };
  };
  return { z, x, y, center, loop, polar, sample, scan };
}
