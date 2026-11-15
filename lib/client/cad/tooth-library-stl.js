/**
 * Anatomic crowns from the tooth STLs in public/assets/teeth/<FDI>.stl.
 *
 * Each file is an open crown shell with one cervical opening, all in one shared arch frame.
 * fitLibraryCrown places that shell on a drawn margin, pulls its cervical edge onto the margin,
 * builds the intaglio from the preparation and zips both into one closed, exportable crown.
 */
import { BVH, V, meshStats, smoothstep, vertexAt } from "./mesh.js";
import { enforceThickness, makeMesh } from "./ops.js";
import { TOOTH_LIBRARY } from "./anatomy-library.js";
import { TOOTH_ATLAS } from "./tooth-atlas.js";
import { preparationFrame } from "./crown-builder.js";

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
export function fitLibraryCrown({ positions, indices, margin, axis, tooth, shell, libFrame = null, facial = null,
  gap = 0.06, marginGap = 0.02, wall = 0.8, marginWall = 0.2, relief = 1, libraryId = "standard", segments = 96, rings = 24, thicken = true }) {
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
  const vertices = [], triangles = [], faceIn = [], inner = [];
  const push = p => { const id = vertices.length / 3; vertices.push(p[0], p[1], p[2]); return id; };
  const addTri = (a, b, c, inside) => { triangles.push(a, b, c); faceIn.push(inside ? 1 : 0); };
  const dirs = loop.map(rim => { const r = V.sub(rim, center); return V.norm(V.sub(r, V.mul(z, V.dot(r, z)))); });
  for (let r = 0; r < rings; r++) {
    const t = r / rings, ring = [];
    for (let i = 0; i < segments; i++) {
      const rim = loop[i], radial = V.sub(rim, center);
      const flat = V.sub(radial, V.mul(z, V.dot(radial, z)));
      const hit = r === 0 ? { point: rim, normal: dirs[i] } : sample(V.add(center, V.mul(flat, 1 - t)));
      const cement = marginGap + (gap - marginGap) * Math.min(1, t * 8);
      ring.push(push(V.add(hit.point, V.mul(hit.normal, cement))));
    }
    inner.push(ring);
  }
  const top = sample(center);
  const innerTop = push(V.add(top.point, V.mul(top.normal, gap)));
  for (let r = 0; r < rings - 1; r++) for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const a = inner[r][i], b = inner[r][j], c = inner[r + 1][j], d = inner[r + 1][i];
    addTri(a, c, b, true); addTri(a, d, c, true);
  }
  for (let i = 0; i < segments; i++) addTri(inner[rings - 1][i], innerTop, inner[rings - 1][(i + 1) % segments], true);
  const innerCount = vertices.length / 3;

  // ---- world frame: facial from the arch, mesial follows from the library's handedness
  let fac = facial || archFacial(positions, center, z) || y;
  fac = V.sub(fac, V.mul(z, V.dot(fac, z)));
  if (V.len(fac) < 1e-6) fac = y;
  fac = V.norm(fac);
  const hand = Math.sign(V.dot(V.cross(lib.mesial, lib.facial), lib.occlusal)) || 1;
  const mes = V.mul(V.cross(fac, z), hand);

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
  const wAt = v => [world[v * 3], world[v * 3 + 1], world[v * 3 + 2]];
  const angleOf = p => { const q = V.sub(p, center); return Math.atan2(V.dot(q, y), V.dot(q, x)); };

  // ---- pull the cervical edge onto the margin (plus the margin wall), fading out toward the cusps
  const marginAngles = loop.map(angleOf);
  const marginAt = angularField(marginAngles, loop.map((p, i) => V.add(p, V.mul(dirs[i], marginWall))));
  const rimAngles = rimLoop.map(v => angleOf(wAt(v)));
  const disp = rimLoop.map((v, k) => V.sub(marginAt(rimAngles[k]), wAt(v)));
  const dispAt = angularField(rimAngles, disp);
  const rimHAt = angularField(rimAngles, rimLoop.map(v => V.dot(V.sub(wAt(v), center), z)));
  const fade = Math.max(2, 0.5 * hMax * sz);
  const onRim = new Uint8Array(nS);
  rimLoop.forEach(v => { onRim[v] = 1; });
  for (let v = 0; v < nS; v++) {
    const p = wAt(v), a = angleOf(p);
    const w = onRim[v] ? 1 : 1 - smoothstep(0, fade, V.dot(V.sub(p, center), z) - rimHAt(a));
    if (w <= 0) continue;
    const d = onRim[v] ? disp[rimLoop.indexOf(v)] : dispAt(a);
    world[v * 3] += d[0] * w; world[v * 3 + 1] += d[1] * w; world[v * 3 + 2] += d[2] * w;
  }

  // ---- orientation: the cervical edge must run counter-clockwise seen from the chewing side (outward normals)
  let sIdx = Uint32Array.from(shell.indices);
  const signed = rimLoop.reduce((s, v, k) => {
    const p = V.sub(wAt(v), center), q = V.sub(wAt(rimLoop[(k + 1) % rimLoop.length]), center);
    return s + V.dot(p, x) * V.dot(q, y) - V.dot(q, x) * V.dot(p, y);
  }, 0);
  if (signed < 0) {
    for (let t = 0; t < sIdx.length; t += 3) { const b = sIdx[t + 1]; sIdx[t + 1] = sIdx[t + 2]; sIdx[t + 2] = b; }
    rimLoop = rimLoop.slice().reverse();
  }

  // ---- lift the chewing surface if the preparation would leave less than the wall
  const shellBvh = new BVH(Float32Array.from(world), sIdx);
  let lift = 0;
  const innerPos = Float32Array.from(vertices);
  for (let r = Math.floor(rings / 3); r < rings; r++) for (let i = 0; i < segments; i += 2) {
    const p = vertexAt(innerPos, inner[r][i]);
    const hit = shellBvh.raycast(p, z);
    if (hit) lift = Math.max(lift, wall - hit.t);
  }
  const topHit = shellBvh.raycast(vertexAt(innerPos, innerTop), z);
  if (topHit) lift = Math.max(lift, wall - topHit.t);
  else lift = Math.max(lift, wall);
  if (lift > 0) for (let v = 0; v < nS; v++) {
    if (onRim[v]) continue;
    const p = wAt(v);
    const w = smoothstep(0, fade * 1.4, V.dot(V.sub(p, center), z) - rimHAt(angleOf(p)));
    world[v * 3] += z[0] * lift * w; world[v * 3 + 1] += z[1] * lift * w; world[v * 3 + 2] += z[2] * lift * w;
  }

  // ---- assemble: intaglio + shell + a strip from the margin ring to the shell's cervical edge
  const base = innerCount;
  for (let v = 0; v < nS; v++) vertices.push(world[v * 3], world[v * 3 + 1], world[v * 3 + 2]);
  for (let t = 0; t < sIdx.length; t += 3) addTri(sIdx[t] + base, sIdx[t + 1] + base, sIdx[t + 2] + base, false);
  const A = inner[0], B = rimLoop.map(v => v + base);
  const a0 = marginAngles[0];
  const rel = a => { let d = wrap(a - a0); if (d < 0) d += 2 * Math.PI; return d; };
  let start = 0, best = Infinity;
  rimLoop.forEach((v, k) => { const d = rel(angleOf(wAt(v))); if (d < best) { best = d; start = k; } });
  const Bs = B.slice(start).concat(B.slice(0, start));
  const P = Float32Array.from(vertices);
  const bAng = [];
  let prev = rel(angleOf(vertexAt(P, Bs[0])));
  bAng.push(prev);
  for (let k = 1; k <= Bs.length; k++) {
    const raw = angleOf(vertexAt(P, Bs[k % Bs.length]));
    prev = prev + wrap(raw - (prev + a0));
    bAng.push(prev);
  }
  bAng[Bs.length] = bAng[0] + 2 * Math.PI;
  const aAng = A.map((_, i) => { const d = rel(marginAngles[i]); return i === 0 ? 0 : d; });
  aAng.push(2 * Math.PI);
  let ia = 0, jb = 0;
  const K = A.length, N = Bs.length;
  while (ia < K || jb < N) {
    const advanceA = ia < K && (jb >= N || aAng[ia + 1] <= bAng[jb + 1]);
    if (advanceA) { addTri(A[ia], A[(ia + 1) % K], Bs[jb % N], false); ia++; }
    else { addTri(A[ia % K], Bs[(jb + 1) % N], Bs[jb], false); jb++; }
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
    seg, source: { type: "anatomic-stl", toothFile: TOOTH_ATLAS[Number(tooth)]?.file || null, libraryId, libraryLabel: variant.label, tooth, gap, marginGap, wall, marginWall, relief, facialFrom: facial ? "given" : "arch", scale: [sx, sy, sz], lift, space } };
}
