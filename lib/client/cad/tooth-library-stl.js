/**
 * Anatomic crowns from the tooth STLs in public/assets/teeth/<FDI>.stl.
 *
 * Each file is an open crown shell with one cervical opening, all in one shared arch frame.
 * fitLibraryCrown places that shell on a drawn margin, pulls its cervical edge onto the margin,
 * builds the intaglio from the preparation and zips both into one closed, exportable crown.
 */
import { BVH, V, meshStats, smoothstep, vertexAt } from "./mesh.js";
import { enforceThickness, makeMesh, smoothWeighted } from "./ops.js";
import { TOOTH_LIBRARY } from "./anatomy-library.js";
import { TOOTH_ATLAS } from "./tooth-atlas.js";
import { preparationFrame } from "./crown-builder.js";
import { buildIntaglioRings, intaglioOptions, shapeIntaglio } from "./intaglio.js";

export const TOOTH_STL_DIR = "/assets/teeth/";

/** The single open boundary of a shell, ordered along its directed boundary edges. */
export function shellRim(positions, indices) {
  const nV = positions.length / 3;
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + (k + 1) % 3];
      const key = a < b ? a * nV + b : b * nV + a;
      const e = edges.get(key);
      if (e) e.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  }
  const next = new Map();
  for (const e of edges.values()) {
    if (e.count > 2) throw new Error("The tooth STL has non-manifold edges.");
    if (e.count === 1) {
      if (next.has(e.a)) throw new Error("The tooth STL has a pinched cervical edge.");
      next.set(e.a, e.b);
    }
  }
  if (next.size < 12) throw new Error("The tooth STL needs one open cervical edge.");
  const loops = [];
  const seen = new Set();
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const loop = [];
    let v = s;
    while (!seen.has(v)) { seen.add(v); loop.push(v); v = next.get(v); if (v === undefined) throw new Error("The tooth STL cervical edge is broken."); }
    loops.push(loop);
  }
  loops.sort((a, b) => b.length - a.length);
  // Small extra holes are scan noise; only the largest opening is the cervix.
  if (loops.length > 1 && loops[1].length > loops[0].length * 0.25) throw new Error("The tooth STL has more than one large opening.");
  return { loop: loops[0], holes: loops.length - 1 };
}

/** Library frame of an arbitrary open shell (dropped STL): occlusal from rim to body; mesial/facial from its cross-section. */
export function frameFromShell(positions, indices) {
  const { loop } = shellRim(positions, indices);
  const n = positions.length / 3;
  let c = [0, 0, 0];
  for (let i = 0; i < n; i++) c = V.add(c, vertexAt(positions, i));
  c = V.mul(c, 1 / n);
  let rim = [0, 0, 0];
  for (const v of loop) rim = V.add(rim, vertexAt(positions, v));
  rim = V.mul(rim, 1 / loop.length);
  const occlusal = V.norm(V.sub(c, rim));
  const x0 = V.norm(V.cross(Math.abs(occlusal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], occlusal));
  const y0 = V.cross(occlusal, x0);
  let xx = 0, xy = 0, yy = 0;
  for (let i = 0; i < n; i++) {
    const q = V.sub(vertexAt(positions, i), rim);
    const u = V.dot(q, x0), w = V.dot(q, y0);
    xx += u * u; xy += u * w; yy += w * w;
  }
  const phi = 0.5 * Math.atan2(2 * xy, xx - yy);
  const mesial = V.norm(V.add(V.mul(x0, Math.cos(phi)), V.mul(y0, Math.sin(phi))));
  return { rim, occlusal, mesial, facial: V.cross(occlusal, mesial), guessed: true };
}

export function atlasFrame(fdi) {
  const a = TOOTH_ATLAS[Number(fdi)];
  if (!a) throw new Error(`No tooth STL is listed for FDI ${fdi}.`);
  return { rim: a.rim, occlusal: a.occlusal, mesial: a.mesial, facial: a.facial, height: a.height, guessed: false };
}

const memo = new Map();
/** Browser: fetch and parse public/assets/teeth/<FDI>.stl once per session. */
export async function loadLibraryTooth(fdi, { fetchImpl = globalThis.fetch, parse } = {}) {
  const key = Number(fdi);
  if (!TOOTH_ATLAS[key]) throw new Error(`No tooth STL is listed for FDI ${fdi}.`);
  if (!memo.has(key)) {
    memo.set(key, (async () => {
      const res = await fetchImpl(`${TOOTH_STL_DIR}${TOOTH_ATLAS[key].file}`);
      if (!res.ok) throw new Error(`Tooth ${key} STL could not be loaded (${res.status}).`);
      const buffer = await res.arrayBuffer();
      const parser = parse || (await import("./mesh.js")).parseBinarySTL;
      return parser(buffer);
    })().catch((error) => { memo.delete(key); throw error; }));
  }
  const mesh = await memo.get(key);
  return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
}

/** Distance between the neighbouring teeth along the mesial line and their occlusal height, in the preparation frame. */
export function measureSpace(scan, center, z, mes, mx0, mx1) {
  const side = (s) => {
    const start = (s > 0 ? mx1 : -mx0) + 0.3;
    let gap = Infinity;
    for (let h = 1.5; h <= 6.5; h += 1) {
      const o = V.add(center, V.add(V.mul(z, h), V.mul(mes, s * start)));
      const hit = scan.raycast(o, V.mul(mes, s));
      if (hit && hit.t < 7) gap = Math.min(gap, start + hit.t);
    }
    if (!Number.isFinite(gap)) return null;
    let top = null;
    for (const off of [2, 3, 4]) {
      const o = V.add(center, V.add(V.mul(mes, s * (gap + off)), V.mul(z, 30)));
      const hit = scan.raycast(o, V.mul(z, -1));
      if (hit) top = Math.max(top ?? -Infinity, 30 - hit.t);
    }
    return { gap, top };
  };
  const m = side(1), d = side(-1);
  const out = { md: null, shift: 0, top: null, mesial: m, distal: d };
  if (m && d && m.gap + d.gap > 3 && m.gap + d.gap < 16) { out.md = m.gap + d.gap; out.shift = (m.gap - d.gap) / 2; }
  const tops = [m?.top, d?.top].filter(v => Number.isFinite(v) && v > 1 && v < 14);
  if (tops.length) out.top = tops.reduce((a, b) => a + b, 0) / tops.length;
  return out;
}

/** Facial direction at a tooth from the jaw scan: perpendicular to the local arch line, on the convex side. */
export function archFacial(positions, center, z) {
  const n = positions.length / 3, stride = Math.max(1, Math.floor(n / 60000));
  const x0 = V.norm(V.cross(Math.abs(z[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], z)), y0 = V.cross(z, x0);
  let xx = 0, xy = 0, yy = 0, cnt = 0, gx = 0, gy = 0, gn = 0;
  for (let v = 0; v < n; v += stride) {
    const q = V.sub(vertexAt(positions, v), center);
    const u = V.dot(q, x0), w = V.dot(q, y0);
    gx += u; gy += w; gn++;
    const r = Math.hypot(u, w);
    // Only the dentition at crown level; palate and vestibule lie below the margin and would bend the line.
    if (r > 16 || V.dot(q, z) < 0.5) continue;
    const k = Math.exp(-(r * r) / 80);
    xx += u * u * k; xy += u * w * k; yy += w * w * k; cnt += k;
  }
  if (cnt < 1) return null;
  const phi = 0.5 * Math.atan2(2 * xy, xx - yy);
  const tangent = [Math.cos(phi), Math.sin(phi)];
  let perp = [-tangent[1], tangent[0]];
  // The arch curves around its lingual side, so the jaw's centre of mass lies lingual of every tooth.
  if (perp[0] * gx / gn + perp[1] * gy / gn > 0) perp = [-perp[0], -perp[1]];
  return V.norm(V.add(V.mul(x0, perp[0]), V.mul(y0, perp[1])));
}

/** y = s R x + t */
function applySim(sim, p) {
  const R = sim.R;
  return [sim.t[0] + sim.s * (R[0] * p[0] + R[1] * p[1] + R[2] * p[2]),
    sim.t[1] + sim.s * (R[3] * p[0] + R[4] * p[1] + R[5] * p[2]),
    sim.t[2] + sim.s * (R[6] * p[0] + R[7] * p[1] + R[8] * p[2])];
}

/** Weighted similarity transform (Horn's quaternion method, symmetric scale) mapping xs onto ys. */
export function similarity(xs, ys, ws) {
  const W = ws.reduce((a, b) => a + b, 0);
  const cx = [0, 0, 0], cy = [0, 0, 0];
  xs.forEach((x, i) => { for (let k = 0; k < 3; k++) { cx[k] += ws[i] * x[k] / W; cy[k] += ws[i] * ys[i][k] / W; } });
  const S = Array(9).fill(0);
  let sx = 0, sy = 0;
  xs.forEach((x0, i) => {
    const a = V.sub(x0, cx), b = V.sub(ys[i], cy), w = ws[i];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] += w * a[r] * b[c];
    sx += w * V.dot(a, a); sy += w * V.dot(b, b);
  });
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const shift = N.flat().reduce((a, v) => a + Math.abs(v), 0) + 1;
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 300; it++) {
    const n = N.map((row, r) => row.reduce((a, v, c) => a + v * q[c], 0) + shift * q[r]);
    const l = Math.hypot(...n);
    q = n.map(v => v / l);
  }
  const [w, x, y, z] = q;
  const R = [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ];
  const s = Math.sqrt(sy / Math.max(1e-9, sx));
  const Rc = applySim({ R, s, t: [0, 0, 0] }, cx);
  const t = V.sub(cy, Rc);
  const sim = { R, s, t };
  const rms = Math.sqrt(xs.reduce((a, x0, i) => a + ws[i] * V.dot(V.sub(applySim(sim, x0), ys[i]), V.sub(applySim(sim, x0), ys[i])), 0) / W);
  return { ...sim, rms };
}

/**
 * Fits the library arch onto the patient's numbered teeth. `arch` = { occlusal, teeth: [{ fdi, center }] }
 * from the tooth detection of the preparation jaw. Heights are re-measured on the scan at each tooth's centre,
 * the same way the atlas measured the library teeth.
 */
export function archPlacement(arch, scanBvh, jobTooth) {
  const O = V.norm(arch.occlusal);
  const order = jobTooth >= 30 ? [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] : [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const at = order.indexOf(jobTooth);
  const jawUp = O;
  const libUp = V.norm(order.reduce((a, f) => V.add(a, TOOTH_ATLAS[f].occlusal), [0, 0, 0]));
  const cand = arch.teeth
    .filter(t => t.fdi && t.fdi !== jobTooth && order.includes(t.fdi) && TOOTH_ATLAS[t.fdi] && t.center && !t.stump && !t.partial && (t.manual || (t.confidence ?? 1) >= 0.55))
    .map(t => ({ ...t, d: Math.abs(order.indexOf(t.fdi) - at) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  if (cand.length < 3) return null;
  const xs = [], ys = [], ws = [], used = [];
  for (const t of cand) {
    const hit = scanBvh.raycast(V.add(t.center, V.mul(jawUp, 30)), V.mul(jawUp, -1));
    if (!hit) continue;
    const a = TOOTH_ATLAS[t.fdi];
    const w = 1 / (0.5 + t.d);
    xs.push(a.top); ys.push(hit.point); ws.push(w);
    // A point below each tip ties the occlusal plane, so two neighbours on a line still fix the rotation.
    xs.push(V.sub(a.top, V.mul(libUp, 5))); ys.push(V.sub(hit.point, V.mul(jawUp, 5))); ws.push(w * 0.5);
    used.push(t.fdi);
  }
  if (used.length < 3) return null;
  const sim = similarity(xs, ys, ws);
  if (!(sim.s > 0.8 && sim.s < 1.25) || sim.rms > 2.5) return { ...sim, used, rejected: `scale ${sim.s.toFixed(2)}, rms ${sim.rms.toFixed(1)} mm` };
  return { ...sim, used };
}

const wrap = a => { while (a <= -Math.PI) a += 2 * Math.PI; while (a > Math.PI) a -= 2 * Math.PI; return a; };

/** Linear interpolation of per-angle samples (sorted by angle, circular). */
function angularField(angles, values) {
  const order = angles.map((a, i) => i).sort((i, j) => angles[i] - angles[j]);
  const A = order.map(i => angles[i]), F = order.map(i => values[i]);
  const n = A.length;
  return (a) => {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (A[m] < a) lo = m + 1; else hi = m; }
    const j = lo % n, i = (lo - 1 + n) % n;
    let span = A[j] - A[i];
    if (span <= 0) span += 2 * Math.PI;
    let d = a - A[i];
    if (d < 0) d += 2 * Math.PI;
    const t = span > 1e-9 ? Math.min(1, d / span) : 0;
    const fi = F[i], fj = F[j];
    return Array.isArray(fi) ? fi.map((v, k) => v + (fj[k] - v) * t) : fi + (fj - fi) * t;
  };
}

/**
 * Closed anatomic crown from a library shell.
 * @param facial world direction from the arch centre toward the cheek/lip at this tooth (from the jaw scan).
 */
export function fitLibraryCrown({ positions, indices, margin, axis, tooth, shell, libFrame = null, facial = null, arch = null, placedWorld = null, placedFrame = null, previewOnly = false,
  gap = 0.06, marginGap = 0.02, wall = 0.8, marginWall = 0.2, relief = 1, libraryId = "standard", segments = 200, rings = 24, thicken = true,
  blockout, blockoutAngle, blockoutZone, toolCompensation, toolDiameter, bullnose, toolFlat }) {
  const shaping = intaglioOptions({ blockout, blockoutAngle, blockoutZone, toolCompensation, toolDiameter, bullnose, toolFlat });
  if (!positions?.length || !indices?.length) throw new Error("Load a preparation scan first.");
  if (!shell?.positions?.length || !shell?.indices?.length) throw new Error("The tooth STL is empty.");
  if (!margin || margin.length < 8 || margin.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error("Draw a closed preparation margin with at least eight points.");
  if (!axis || axis.length !== 3 || !axis.every(Number.isFinite) || V.len(axis) < 0.9) throw new Error("Set a valid insertion direction first.");
  if (![gap, marginGap, wall, marginWall, relief].every(Number.isFinite) || gap < 0 || gap > 0.3 || marginGap < 0 || marginGap > 0.2 || wall < 0.3 || wall > 3 || marginWall <= marginGap || marginWall > 1 || relief < 0.3 || relief > 2) throw new Error("Crown dimensions are outside the supported range.");
  const variant = TOOTH_LIBRARY.find(item => item.id === libraryId);
  if (!variant) throw new Error("Unknown tooth library variation.");
  const lib = libFrame || atlasFrame(tooth);
  const { z, x, y, center, loop, sample, scan } = preparationFrame({ positions, indices, margin, axis, segments });

  // ---- intaglio: preparation offset by the cement gap, ring 0 on the margin
  const vertices = [], triangles = [], faceIn = [];
  const push = p => { const id = vertices.length / 3; vertices.push(p[0], p[1], p[2]); return id; };
  const addTri = (a, b, c, inside) => { triangles.push(a, b, c); faceIn.push(inside ? 1 : 0); };
  const { inner, innerTop, dirs } = buildIntaglioRings({ loop, center, z, sample, rings, segments, gap, marginGap, push, addTri });
  // Undercuts are blocked out along the insertion axis and sharp internal corners get milling relief before
  // the outer surface is built, so the wall is measured from the inside the crown will really have.
  const shaped = shapeIntaglio({ vertices, inner, innerTop, loop, center, z, dirs, scan, gap, marginGap, options: shaping });
  const innerCount = vertices.length / 3;

  // ---- world frame: facial from the arch, mesial follows from the library's handedness
  let fac = facial || archFacial(positions, center, z) || y;
  fac = V.sub(fac, V.mul(z, V.dot(fac, z)));
  if (V.len(fac) < 1e-6) fac = y;
  fac = V.norm(fac);
  const hand = Math.sign(V.dot(V.cross(lib.mesial, lib.facial), lib.occlusal)) || 1;
  let mes = V.mul(V.cross(fac, z), hand);
  let occ = z;

  // ---- shell in library coordinates
  const sp = shell.positions, nS = sp.length / 3;
  const local = new Float64Array(nS * 3);
  let hMax = 0;
  for (let v = 0; v < nS; v++) {
    const d = V.sub(vertexAt(sp, v), lib.rim);
    local[v * 3] = V.dot(d, lib.mesial); local[v * 3 + 1] = V.dot(d, lib.facial); local[v * 3 + 2] = V.dot(d, lib.occlusal);
    hMax = Math.max(hMax, local[v * 3 + 2]);
  }
  let { loop: rimLoop } = shellRim(sp, shell.indices);
  const range = (vals) => [Math.min(...vals), Math.max(...vals)];
  const [rx0, rx1] = range(rimLoop.map(v => local[v * 3])), [ry0, ry1] = range(rimLoop.map(v => local[v * 3 + 1]));
  const rimH = rimLoop.reduce((s, v) => s + local[v * 3 + 2], 0) / rimLoop.length;
  const mLocal = loop.map(p => [V.dot(V.sub(p, center), mes), V.dot(V.sub(p, center), fac), V.dot(V.sub(p, center), z)]);
  const [mx0, mx1] = range(mLocal.map(p => p[0])), [my0, my1] = range(mLocal.map(p => p[1]));
  const clampS = s => Math.min(1.6, Math.max(0.6, s));
  // Space left by the neighbours: mesial-distal gap at contact height and their occlusal level.
  const space = measureSpace(scan, center, z, mes, mx0, mx1);
  const atlas = TOOTH_ATLAS[Number(tooth)];
  const libMD = atlas && !libFrame ? atlas.md : (rx1 - rx0) * 1.25;
  const libBL = atlas && !libFrame ? atlas.bl : (ry1 - ry0) * 1.2;
  let sx = space.md ? clampS(space.md / libMD) : clampS((mx1 - mx0 + 2 * marginWall) / Math.max(1e-3, rx1 - rx0));
  let sy = clampS(Math.max(sx ** 0.7, (my1 - my0 + 2 * wall) / libBL));
  const occTop = space.top ?? null;
  let sz = occTop ? Math.min(1.35, Math.max(0.6, occTop / Math.max(1, hMax - rimH))) : (1 + (sx + sy) / 2) / 2;
  sz *= variant.height;
  const tableScale = variant.table / 0.86;
  const cusp = 0.62 * hMax;
  const ox = space.md ? space.shift : (mx0 + mx1) / 2, oy = (my0 + my1) / 2;
  const rcx = (rx0 + rx1) / 2, rcy = (ry0 + ry1) / 2;
  const world = new Float64Array(nS * 3);
  for (let v = 0; v < nS; v++) {
    let lz = local[v * 3 + 2] - rimH;
    const up = smoothstep(0.35 * hMax, hMax, lz);
    if (lz > cusp) lz = cusp + (lz - cusp) * relief;
    const side = 1 + (tableScale - 1) * up;
    const lx = ox + (local[v * 3] - rcx) * sx * side, ly = oy + (local[v * 3 + 1] - rcy) * sy * side;
    const p = V.add(center, V.add(V.add(V.mul(mes, lx), V.mul(fac, ly)), V.mul(z, lz * sz)));
    world[v * 3] = p[0]; world[v * 3 + 1] = p[1]; world[v * 3 + 2] = p[2];
  }
  // ---- like a library arch setup: place the tooth where the library arch, fitted to the neighbours, puts it
  let placement = null;
  if (arch && !libFrame) {
    placement = archPlacement(arch, scan, Number(tooth));
    const rimWorld = placement && applySim(placement, lib.rim);
    const off = rimWorld ? V.sub(rimWorld, center) : null;
    // The arch tells where the crown belongs; the preparation must still be under it.
    if (placement && V.len(V.sub(off, V.mul(z, V.dot(off, z)))) > 4) placement = { ...placement, rejected: "far from the preparation" };
    if (placement && !placement.rejected) {
      for (let v = 0; v < nS; v++) {
        let lz = local[v * 3 + 2];
        if (!previewOnly && lz - rimH > cusp) lz = rimH + cusp + (lz - rimH - cusp) * relief;
        const q = V.add(lib.rim, V.add(V.add(V.mul(lib.mesial, local[v * 3]), V.mul(lib.facial, local[v * 3 + 1])), V.mul(lib.occlusal, lz)));
        const w = applySim(placement, q);
        world[v * 3] = w[0]; world[v * 3 + 1] = w[1]; world[v * 3 + 2] = w[2];
      }
      const rot = d => V.norm(applySim({ ...placement, t: [0, 0, 0], s: 1 }, d));
      mes = rot(lib.mesial); fac = rot(lib.facial); occ = rot(lib.occlusal);
      sz = placement.s;
    }
  }
  // Start position for hand placement without an arch fit: the original tooth, rigid, one uniform scale,
  // its cervical opening centred on the margin and its long axis along the insertion direction.
  if (previewOnly && (!placement || placement.rejected) && !placedWorld) {
    const k = Math.min(1.2, Math.max(0.8, space.md ? space.md / libMD : 1));
    for (let v = 0; v < nS; v++) {
      const lx = ox + (local[v * 3] - rcx) * k, ly = oy + (local[v * 3 + 1] - rcy) * k, lz = (local[v * 3 + 2] - rimH) * k;
      const p = V.add(center, V.add(V.add(V.mul(mes, lx), V.mul(fac, ly)), V.mul(z, lz)));
      world[v * 3] = p[0]; world[v * 3 + 1] = p[1]; world[v * 3 + 2] = p[2];
    }
  }
  // The technician placed the original tooth by hand: take it exactly as it stands.
  if (placedWorld) {
    if (placedWorld.length !== nS * 3) throw new Error("The placed tooth does not match its library file.");
    for (let i = 0; i < world.length; i++) world[i] = placedWorld[i];
    if (placedFrame) { mes = V.norm(placedFrame.mesial); fac = V.norm(placedFrame.facial); occ = V.norm(placedFrame.occlusal); }
    placement = { used: ["your placement"], rms: 0, manual: true };
  }
  if (previewOnly) {
    const rimPts = rimLoop.map(v => [world[v * 3], world[v * 3 + 1], world[v * 3 + 2]]);
    const rimCenter = V.mul(rimPts.reduce((a, p) => V.add(a, p), [0, 0, 0]), 1 / rimPts.length);
    return { positions: Float32Array.from(world), indices: Uint32Array.from(shell.indices),
      frame: { center: rimCenter, occlusal: occ, mesial: mes, facial: fac },
      source: { type: "tooth-setup", tooth, toothFile: TOOTH_ATLAS[Number(tooth)]?.file || null, placement: placement && !placement.rejected ? `arch fit to ${placement.used.join(" ")}` : "measured from the gap and neighbours" } };
  }
  const wAt = v => [world[v * 3], world[v * 3 + 1], world[v * 3 + 2]];
  const angleOf = p => { const q = V.sub(p, center); return Math.atan2(V.dot(q, y), V.dot(q, x)); };

  // ---- outer surface: the placed tooth sampled along meridians, from margin + border up over the cusps.
  // Rays from one point inside the crown can never fold the surface, and ring 0 lies exactly on the margin.
  const shellBvh = new BVH(Float32Array.from(world), Uint32Array.from(shell.indices));
  const heightOf = p => V.dot(V.sub(p, center), z);
  let topH = -Infinity;
  for (let v = 0; v < nS; v++) topH = Math.max(topH, heightOf(wAt(v)));
  const marginH = loop.map(heightOf);
  const meanMarginH = marginH.reduce((s0, h) => s0 + h, 0) / marginH.length;
  // Start the rays inside the crown body: its own centroid across, 42 % up from the margin.
  let body = [0, 0, 0], nb = 0;
  for (let v = 0; v < nS; v++) { const p = wAt(v); if (heightOf(p) > meanMarginH + 0.25 * (topH - meanMarginH)) { body = V.add(body, p); nb++; } }
  body = nb ? V.mul(body, 1 / nb) : center;
  const across = V.sub(body, V.mul(z, heightOf(body)));
  const origin = V.add(across, V.mul(z, meanMarginH + 0.42 * Math.max(2, topH - meanMarginH)));
  const K = 60, blendRings = Math.round(K * 0.2);
  const outer = Array.from({ length: K }, () => new Array(segments));
  const innerPos = Float32Array.from(vertices);
  // The wall is kept along every sampling ray: the outer point stays at least the wall beyond the intaglio,
  // tapering to the margin border near the margin. Nothing has to be pushed out (and folded) afterwards.
  const innerBvh = new BVH(innerPos, Uint32Array.from(triangles));
  // Walk out along the ray until the point is really `need` away from the inside. Measured perpendicular,
  // so a ray that grazes the inside wall is not pushed by a multiple of the wall (that made cervical flares).
  const thickenAlong = (d, t0, need) => {
    let t = t0;
    for (let it = 0; it < 8; it++) {
      const c = innerBvh.closest(V.add(origin, V.mul(d, t)), need + 0.5);
      if (!c || c.d >= need - 0.004) break;
      t += (need - c.d) * 1.05 + 0.002;
    }
    return t;
  };
  const lift = 0;
  const liftAt = k => z.map(c => c * lift * smoothstep(0.25, 0.85, k / K));
  const meridian = [];
  const pushGrid = new Float32Array(segments * K), rayDir = new Array(segments * K), reachOf = new Int32Array(segments).fill(K);
  for (let i = 0; i < segments; i++) {
    const m = V.add(loop[i], V.mul(dirs[i], marginWall));
    const phi0 = Math.acos(Math.max(-1, Math.min(1, V.dot(V.norm(V.sub(m, origin)), z))));
    const pts = [m];
    for (let k = 1; k < K; k++) {
      const phi = phi0 * (1 - k / K);
      const d = V.norm(V.add(V.mul(z, Math.cos(phi)), V.mul(dirs[i], Math.sin(phi))));
      const hit = shellBvh.raycast(origin, d);
      if (!hit || hit.t >= 25) { pts.push(null); pushGrid[i * K + k] = 0; continue; }
      // Full wall from 1.2 mm above the margin, as the thickness check counts it; the margin border below.
      const need = marginWall + (wall - marginWall) * smoothstep(0, 1.2, V.dist(hit.point, m));
      pushGrid[i * K + k] = Math.max(0, thickenAlong(d, hit.t, need) - hit.t);
      rayDir[i * K + k] = d;
      pts.push(V.add(origin, V.mul(d, hit.t + pushGrid[i * K + k])));
    }
    // Below the library tooth's own cervical line the rays leave through its opening: bridge to the margin.
    const firstK = pts.findIndex((p, k) => k > 0 && p);
    if (firstK < 0) { meridian.push(null); continue; }
    for (let k = 1; k < firstK; k++) pts[k] = V.add(m, V.mul(V.sub(pts[firstK], m), k / firstK));
    for (let k = firstK + 1; k < K; k++) if (!pts[k]) pts[k] = pts[k - 1];
    // Emergence profile: only the gap between margin and tooth is filled; the placed anatomy is kept.
    // Just above the gap a few rings blend the joint. Only a tooth that hangs far out over the margin
    // gets the longer, exocad-like pull to the margin.
    const radial = (p) => { const q = V.sub(p, center); return Math.hypot(V.dot(q, x), V.dot(q, y)); };
    const overhang = radial(pts[firstK]) - radial(m);
    // The further the tooth hangs out over the margin, the longer the pull: a short pull on a big overhang
    // leaves a lip at the cervical (it reads as spikes around the margin).
    const hM = heightOf(m), band = Math.max(1.0, 1.6 * Math.max(0, overhang));
    let reach = Math.min(K - 2, firstK + 3);
    while (reach < K - 2 && heightOf(pts[reach]) - hM < band) reach++;
    reach = Math.max(reach, Math.min(K - 2, overhang > 0.8 ? blendRings : 0));
    const anchor = pts[reach];
    reachOf[i] = reach;
    for (let k = 1; k < reach; k++) {
      const w = smoothstep(0, 1, k / reach);
      const straight = V.add(m, V.mul(V.sub(anchor, m), k / reach));
      pts[k] = V.add(V.mul(straight, 1 - w), V.mul(pts[k], w));
      // The filled part keeps the wall too (tapering to the margin border at the margin).
      const off = V.sub(pts[k], origin), len = V.len(off), d = V.mul(off, 1 / len);
      const need = marginWall + (wall - marginWall) * smoothstep(0, 1.2, V.dist(pts[k], m));
      const tNeed = thickenAlong(d, len, need);
      if (tNeed > len) {
        pushGrid[i * K + k] = tNeed - len;
        pts[k] = V.add(origin, V.mul(d, tNeed));
      }
      rayDir[i * K + k] = d;
    }
    meridian.push(pts);
  }
  // A meridian that never met the tooth borrows from its nearest neighbours around the ring.
  const good = meridian.map((m0, i) => m0 ? i : -1).filter(i => i >= 0);
  if (good.length < segments * 0.6) throw new Error("The library tooth does not cover this preparation. Check the tooth number, margin and insertion direction.");
  for (let i = 0; i < segments; i++) {
    if (meridian[i]) continue;
    let a = i, b = i;
    while (!meridian[(a + segments) % segments]) a--;
    while (!meridian[b % segments]) b++;
    const A = meridian[(a + segments) % segments], B = meridian[b % segments], t = (i - a) / (b - a);
    const m = V.add(loop[i], V.mul(dirs[i], marginWall));
    meridian[i] = A.map((p, k) => k === 0 ? m : V.add(V.mul(p, 1 - t), V.mul(B[k], t)));
  }
  // Where the preparation comes closer than the wall, the extra thickness is spread like added wax:
  // dilated a little, then blurred, and never less than what each ray needs.
  {
    const at = (i, k) => pushGrid[((i + segments) % segments) * K + Math.max(0, Math.min(K - 1, k))];
    let grid = new Float32Array(pushGrid.length);
    for (let i = 0; i < segments; i++) for (let k = 0; k < K; k++) {
      let mx = 0;
      for (let di = -4; di <= 4; di++) for (let dk = -2; dk <= 2; dk++) mx = Math.max(mx, at(i + di, k + dk));
      grid[i * K + k] = mx;
    }
    for (let pass = 0; pass < 6; pass++) {
      const next = new Float32Array(grid.length);
      for (let i = 0; i < segments; i++) for (let k = 0; k < K; k++) {
        const g = (ii, kk) => grid[((ii + segments) % segments) * K + Math.max(0, Math.min(K - 1, kk))];
        next[i * K + k] = (4 * g(i, k) + 2 * (g(i - 1, k) + g(i + 1, k)) + g(i - 2, k) + g(i + 2, k) + 2 * (g(i, k - 1) + g(i, k + 1))) / 14;
      }
      grid = next;
    }
    for (let i = 0; i < segments; i++) for (let k = 1; k < K; k++) {
      // The spread covers the emergence zone too: a thin spot there would otherwise become a lone bump
      // (it reads as a spike at the cervical). Only the first rings at the crown edge stay exact.
      // Each ray already has its own minimum; only the smooth spread beyond it is added here.
      const amount = Math.max(0, grid[i * K + k] * smoothstep(1, 5, k) - pushGrid[i * K + k]);
      const d = rayDir[i * K + k];
      if (amount > 0 && d && meridian[i]) meridian[i][k] = V.add(meridian[i][k], V.mul(d, amount));
    }
  }
  // Light smoothing only where the surface was built (the filled gap and its joint), never on the anatomy.
  const maxReach = Math.max(...reachOf.filter((r) => r < K));
  for (let k = 1; k < Math.min(K, maxReach + 2); k++) {
    const ring = meridian.map(pts => pts[k]);
    for (let i = 0; i < segments; i++) {
      if (k > reachOf[i] + 1) continue;
      const a0 = ring[(i + segments - 1) % segments], b0 = ring[i], c0 = ring[(i + 1) % segments];
      meridian[i][k] = V.add(V.mul(b0, 0.6), V.mul(V.add(a0, c0), 0.2));
    }
  }
  for (let k = 0; k < K; k++) for (let i = 0; i < segments; i++) outer[k][i] = push(V.add(meridian[i][k], liftAt(k)));
  const capHit = shellBvh.raycast(origin, z);
  const outerTop = push(V.add(capHit ? capHit.point : V.add(origin, V.mul(z, topH - heightOf(origin))), V.mul(z, lift)));
  for (let k = 0; k < K - 1; k++) for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    addTri(outer[k][i], outer[k][j], outer[k + 1][j], false);
    addTri(outer[k][i], outer[k + 1][j], outer[k + 1][i], false);
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    addTri(outer[K - 1][i], outer[K - 1][j], outerTop, false);
    addTri(inner[0][i], inner[0][j], outer[0][j], false);
    addTri(inner[0][i], outer[0][j], outer[0][i], false);
  }

  let pos = Float32Array.from(vertices);
  const idx = Uint32Array.from(triangles);
  const intaglio = new Uint8Array(pos.length / 3);
  for (let r = 1; r < rings; r++) inner[r].forEach(v => { intaglio[v] = 1; });
  intaglio[innerTop] = 1;
  const inTris = [], outTris = [];
  faceIn.forEach((v, i) => (v ? inTris : outTris).push(i));
  const seg = { intaglio, rim: Int32Array.from(inner[0]), rimLoop: Int32Array.from(inner[0]), faceIn: Uint8Array.from(faceIn), inTris, outTris };
  if (thicken) {
    const mesh = makeMesh(pos, idx);
    enforceThickness(mesh, seg, new BVH(pos, idx, inTris), { min: wall, minMargin: marginWall });
    pos = mesh.pos;
  }
  const stats = meshStats(pos, idx);
  if (!stats.closed || stats.invalid || stats.volume < 1) throw new Error("The tooth could not be closed on this margin. Review the margin and insertion direction.");
  const rimRadius = loop.reduce((m, p) => Math.max(m, V.dist(p, center)), 0);
  return { positions: pos, indices: idx, stats, frame: { center, occlusal: z, mesial: mes, facial: fac, rimRadius },
    seg, source: { type: "anatomic-stl", toothFile: TOOTH_ATLAS[Number(tooth)]?.file || null, libraryId, libraryLabel: variant.label, tooth, gap, marginGap, wall, marginWall, relief, blockout: shaped.blockout, tool: shaped.tool, facialFrom: facial ? "given" : "arch", placement: placement?.manual ? "placed by you" : placement ? (placement.rejected ? `measured (arch fit ${placement.rejected})` : `arch fit to ${placement.used.join(" ")}, rms ${placement.rms.toFixed(2)} mm`) : "measured", scale: [sx, sy, sz], lift, space } };
}
