/**
 * FAUCHAR CAD kernel: dental geometry operations.
 *
 * Everything works in scan (model) coordinates on { pos, idx, norm, adj, bvh } meshes
 * and mutates `pos` in place; history is handled by the caller (see editor.js).
 */
import { BVH, V, buildAdjacency, clamp, computeNormals, smoothstep, triNormal, vertexAt } from "./mesh.js";

export function makeMesh(pos, idx) {
  const mesh = { pos, idx, norm: computeNormals(pos, idx), adj: buildAdjacency(pos.length / 3, idx), bvh: new BVH(pos, idx) };
  mesh.count = pos.length / 3;
  return mesh;
}

export function refresh(mesh) {
  computeNormals(mesh.pos, mesh.idx, mesh.norm);
  mesh.bvh.refit();
}

/* ------------------------------------------------------- crown anatomy */

/**
 * Splits a closed crown into intaglio and outer surface. The cavity is found by rays cast
 * along vertex normals (only cavity walls see another wall far away), then grown face by face
 * until the sharp rim. Works on any restoration STL, with no design metadata needed.
 */
export function segmentCrown(mesh, { seedDist = 2, rimAngle = 55 } = {}) {
  const { pos, idx, norm, bvh, count } = mesh;
  const nTri = idx.length / 3;
  const deep = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    const n = [norm[v * 3], norm[v * 3 + 1], norm[v * 3 + 2]];
    const o = [pos[v * 3] + n[0] * 1e-3, pos[v * 3 + 1] + n[1] * 1e-3, pos[v * 3 + 2] + n[2] * 1e-3];
    const hit = bvh.raycast(o, n);
    if (hit && hit.t > seedDist) deep[v] = 1;
  }
  const edgeFaces = new Map();
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k], b = idx[t * 3 + (k + 1) % 3];
      const key = a < b ? a * count + b : b * count + a;
      const list = edgeFaces.get(key);
      if (list) list.push(t);
      else edgeFaces.set(key, [t]);
    }
  }
  const faceAdj = Array.from({ length: nTri }, () => []);
  const cosRim = Math.cos((rimAngle * Math.PI) / 180);
  const normals = new Float32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) normals.set(triNormal(pos, idx, t), t * 3);
  for (const list of edgeFaces.values()) {
    if (list.length !== 2) continue;
    const [p, q] = list;
    const c = normals[p * 3] * normals[q * 3] + normals[p * 3 + 1] * normals[q * 3 + 1] + normals[p * 3 + 2] * normals[q * 3 + 2];
    faceAdj[p].push([q, c >= cosRim]);
    faceAdj[q].push([p, c >= cosRim]);
  }
  // Largest connected patch of deep faces, grown across non-sharp edges.
  const label = new Int32Array(nTri).fill(-1);
  let best = -1, bestSize = 0, comp = 0;
  for (let s = 0; s < nTri; s++) {
    if (label[s] >= 0 || !(deep[idx[s * 3]] && deep[idx[s * 3 + 1]] && deep[idx[s * 3 + 2]])) continue;
    const stack = [s];
    label[s] = comp;
    let size = 0;
    while (stack.length) {
      const t = stack.pop();
      size++;
      for (const [q] of faceAdj[t]) {
        if (label[q] < 0 && deep[idx[q * 3]] && deep[idx[q * 3 + 1]] && deep[idx[q * 3 + 2]]) {
          label[q] = comp;
          stack.push(q);
        }
      }
    }
    if (size > bestSize) { bestSize = size; best = comp; }
    comp++;
  }
  const faceIn = new Uint8Array(nTri);
  const stack = [];
  for (let t = 0; t < nTri; t++) if (label[t] === best && best >= 0) { faceIn[t] = 1; stack.push(t); }
  while (stack.length) {
    const t = stack.pop();
    for (const [q, smooth] of faceAdj[t]) if (smooth && !faceIn[q]) { faceIn[q] = 1; stack.push(q); }
  }
  // Pockets the growth could not reach belong to the intaglio; the largest remaining patch is the outer surface.
  const rest = new Int32Array(nTri).fill(-1);
  const sizes = [];
  for (let s = 0; s < nTri; s++) {
    if (faceIn[s] || rest[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const st = [s];
    rest[s] = id;
    while (st.length) {
      const t = st.pop();
      size++;
      for (const [q] of faceAdj[t]) if (!faceIn[q] && rest[q] < 0) { rest[q] = id; st.push(q); }
    }
    sizes.push(size);
  }
  const outerId = sizes.indexOf(Math.max(...sizes, 0));
  for (let t = 0; t < nTri; t++) if (!faceIn[t] && rest[t] !== outerId) faceIn[t] = 1;
  return finishSegments(mesh, faceIn);
}

function finishSegments(mesh, faceIn) {
  const { idx, count } = mesh;
  const nTri = idx.length / 3;
  const touchIn = new Uint8Array(count);
  const touchOut = new Uint8Array(count);
  for (let t = 0; t < nTri; t++) {
    const m = faceIn[t] ? touchIn : touchOut;
    m[idx[t * 3]] = 1; m[idx[t * 3 + 1]] = 1; m[idx[t * 3 + 2]] = 1;
  }
  const intaglio = new Uint8Array(count);
  const rim = [];
  for (let v = 0; v < count; v++) {
    if (touchIn[v] && !touchOut[v]) intaglio[v] = 1;
    if (touchIn[v] && touchOut[v]) rim.push(v);
  }
  const inTris = [];
  const outTris = [];
  for (let t = 0; t < nTri; t++) (faceIn[t] ? inTris : outTris).push(t);
  return { intaglio, rim: Int32Array.from(rim), rimLoop: orderRim(mesh, faceIn), faceIn, inTris, outTris };
}

/** Longest closed chain of edges separating intaglio faces from outer faces. */
function orderRim(mesh, faceIn) {
  const { idx, count } = mesh;
  const seen = new Map();
  for (let t = 0; t < idx.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k], b = idx[t * 3 + (k + 1) % 3];
      const key = a < b ? a * count + b : b * count + a;
      const entry = seen.get(key);
      if (entry) entry.push(faceIn[t]);
      else seen.set(key, [a, b, faceIn[t]]);
    }
  }
  const next = new Map();
  for (const entry of seen.values()) {
    if (entry.length === 4 && entry[2] !== entry[3]) {
      const [a, b] = entry;
      (next.get(a) || next.set(a, []).get(a)).push(b);
      (next.get(b) || next.set(b, []).get(b)).push(a);
    }
  }
  const visited = new Set();
  let best = [];
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const loop = [start];
    visited.add(start);
    let cur = start;
    for (;;) {
      const nx = next.get(cur).find((q) => !visited.has(q));
      if (nx === undefined) break;
      visited.add(nx);
      loop.push(nx);
      cur = nx;
    }
    if (loop.length > best.length) best = loop;
  }
  return Int32Array.from(best);
}

/** Dental frame of a crown: occlusal from the rim plane, facial and mesial from the jaw arch. */
export function crownFrame(mesh, seg, jaw = null) {
  const { pos } = mesh;
  const rimPts = Array.from(seg.rimLoop, (v) => vertexAt(pos, v));
  const center = rimPts.reduce((s, p) => V.add(s, p), [0, 0, 0]).map((x) => x / (rimPts.length || 1));
  const occlusal = planeNormal(rimPts, center);
  let outer = [0, 0, 0], nOuter = 0;
  for (let v = 0; v < mesh.count; v++) {
    if (!seg.intaglio[v]) { outer = V.add(outer, vertexAt(pos, v)); nOuter++; }
  }
  outer = V.mul(outer, 1 / (nOuter || 1));
  let occ = occlusal;
  if (V.dot(V.sub(outer, center), occ) < 0) occ = V.mul(occ, -1);
  let facial = [1, 0, 0];
  let mesial = [0, 1, 0];
  if (jaw) {
    const stride = Math.max(1, Math.floor(jaw.length / 3 / 40000));
    let c = [0, 0, 0], n = 0;
    for (let v = 0; v < jaw.length / 3; v += stride) { c = V.add(c, vertexAt(jaw, v)); n++; }
    c = V.mul(c, 1 / n);
    const out = V.sub(center, c);
    facial = V.norm(V.sub(out, V.mul(occ, V.dot(out, occ))));
    // The midline is the arch point furthest from the molar-side centroid along its symmetry axis.
    const tangent = V.norm(V.cross(occ, facial));
    let sum = 0;
    for (let v = 0; v < jaw.length / 3; v += stride) {
      const q = V.sub(vertexAt(jaw, v), center);
      sum += V.dot(q, tangent);
    }
    // Jaw mass sits distally for every tooth except at the midline, where either side is fine.
    mesial = V.mul(tangent, sum > 0 ? -1 : 1);
    if (Math.abs(sum / n) < 12) mesial = archMesial(jaw, stride, c, occ, center, tangent);
  }
  return { center, occlusal: occ, facial, mesial, rimRadius: rimPts.reduce((m, p) => Math.max(m, V.dist(p, center)), 0) };
}

/** Near the front of the arch mass is balanced, so mesial is the tangent direction pointing to the arch apex. */
function archMesial(jaw, stride, c, occ, center, tangent) {
  let u = [0, 0, 0];
  const pts = [];
  for (let v = 0; v < jaw.length / 3; v += stride) {
    const q = V.sub(vertexAt(jaw, v), c);
    pts.push(V.sub(q, V.mul(occ, V.dot(q, occ))));
  }
  // Power iteration: the arch's long axis runs across it (left to right), the short axis to the apex.
  u = V.norm(pts[Math.floor(pts.length / 3)]);
  for (let it = 0; it < 12; it++) {
    let next = [0, 0, 0];
    for (const p of pts) next = V.add(next, V.mul(p, V.dot(p, u)));
    u = V.norm(next);
  }
  const apexAxis = V.norm(V.cross(occ, u));
  let m3 = 0;
  for (const p of pts) m3 += V.dot(p, apexAxis) ** 3;
  // The U opens toward the back, so the skew of the point cloud points away from the apex.
  const toApex = m3 > 0 ? V.mul(apexAxis, -1) : apexAxis;
  const q = V.sub(center, c);
  const apex = V.mul(toApex, 60);
  return V.mul(tangent, V.dot(V.sub(apex, q), tangent) > 0 ? 1 : -1);
}

export function planeNormal(pts, center) {
  // Smallest eigenvector via inverse-free power iteration on (trace * I - C).
  const C = [0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const x = p[0] - center[0], y = p[1] - center[1], z = p[2] - center[2];
    C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z;
  }
  const tr = C[0] + C[3] + C[5];
  let u = V.norm([0.37, 0.53, 0.76]);
  for (let i = 0; i < 80; i++) {
    u = V.norm([
      (tr - C[0]) * u[0] - C[1] * u[1] - C[2] * u[2],
      -C[1] * u[0] + (tr - C[3]) * u[1] - C[4] * u[2],
      -C[2] * u[0] - C[4] * u[1] + (tr - C[5]) * u[2],
    ]);
  }
  return u;
}

/** Euclidean distance from every vertex to a polyline. */
export function distToPolyline(pos, count, pts, closed = true) {
  const out = new Float32Array(count);
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let best = Infinity;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const l2 = dx * dx + dy * dy + dz * dz || 1;
      const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / l2, 0, 1);
      const qx = a[0] + dx * t - x, qy = a[1] + dy * t - y, qz = a[2] + dz * t - z;
      const d = qx * qx + qy * qy + qz * qz;
      if (d < best) best = d;
    }
    out[v] = Math.sqrt(best);
  }
  return out;
}

/** Per-vertex 0..1 edit weight: zero on the intaglio and the rim, full beyond `fade` mm. */
export function outerWeights(mesh, seg, fade = 0.6) {
  const rimPts = Array.from(seg.rimLoop, (v) => vertexAt(mesh.pos, v));
  const dist = distToPolyline(mesh.pos, mesh.count, rimPts);
  const w = new Float32Array(mesh.count);
  for (let v = 0; v < mesh.count; v++) w[v] = seg.intaglio[v] ? 0 : smoothstep(0, fade, dist[v]);
  return { weight: w, rimDist: dist };
}

/* -------------------------------------------------------------- brushes */

/** Vertices connected to `seed` within `radius` of `center`; stays on one sheet of a thin wall. */
export function brushRegion(mesh, seed, center, radius, scratch) {
  const { pos, adj } = mesh;
  const out = [];
  const stamp = ++scratch.stamp;
  const marks = scratch.marks;
  const r2 = radius * radius;
  const stack = [seed];
  marks[seed] = stamp;
  while (stack.length) {
    const v = stack.pop();
    const dx = pos[v * 3] - center[0], dy = pos[v * 3 + 1] - center[1], dz = pos[v * 3 + 2] - center[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    out.push(v, Math.sqrt(d2) / radius);
    for (let i = adj.offset[v], e = adj.offset[v + 1]; i < e; i++) {
      const q = adj.list[i];
      if (marks[q] !== stamp) { marks[q] = stamp; stack.push(q); }
    }
  }
  return out;
}

export const newScratch = (count) => ({ marks: new Int32Array(count), stamp: 0 });

/** One brush stamp. Returns the vertices it touched. */
export function brushStamp(mesh, { kind, hit, radius, strength, mask = null, restore = null, drag = null, scratch }) {
  const { pos, norm, adj } = mesh;
  const seedVert = closestTriVertex(mesh, hit);
  const region = brushRegion(mesh, seedVert, hit.point, radius, scratch);
  const count = region.length / 2;
  if (!count) return region;
  // Average normal of the footprint gives a steadier direction than the hit triangle.
  let avg = [0, 0, 0];
  let cen = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const v = region[i * 2];
    const f = falloff(region[i * 2 + 1]);
    avg[0] += norm[v * 3] * f; avg[1] += norm[v * 3 + 1] * f; avg[2] += norm[v * 3 + 2] * f;
    cen[0] += pos[v * 3] * f; cen[1] += pos[v * 3 + 1] * f; cen[2] += pos[v * 3 + 2] * f;
  }
  const fsum = (() => { let s = 0; for (let i = 0; i < count; i++) s += falloff(region[i * 2 + 1]); return s || 1; })();
  cen = V.mul(cen, 1 / fsum);
  avg = V.norm(avg);

  if (kind === "smooth") {
    // Laplacian against a copy so the result does not depend on vertex order.
    const next = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = region[i * 2];
      let sx = 0, sy = 0, sz = 0;
      const n = adj.offset[v + 1] - adj.offset[v];
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
        const q = adj.list[j];
        sx += pos[q * 3]; sy += pos[q * 3 + 1]; sz += pos[q * 3 + 2];
      }
      next[i * 3] = sx / (n || 1); next[i * 3 + 1] = sy / (n || 1); next[i * 3 + 2] = sz / (n || 1);
    }
    for (let i = 0; i < count; i++) {
      const v = region[i * 2];
      const w = falloff(region[i * 2 + 1]) * clamp(strength * 1.6, 0, 1) * (mask ? mask[v] : 1);
      pos[v * 3] += (next[i * 3] - pos[v * 3]) * w;
      pos[v * 3 + 1] += (next[i * 3 + 1] - pos[v * 3 + 1]) * w;
      pos[v * 3 + 2] += (next[i * 3 + 2] - pos[v * 3 + 2]) * w;
    }
    return region;
  }

  const step = strength * radius * 0.12;
  for (let i = 0; i < count; i++) {
    const v = region[i * 2];
    const d = region[i * 2 + 1];
    const m = mask ? mask[v] : 1;
    if (m <= 0) continue;
    const f = falloff(d) * m;
    let dx = 0, dy = 0, dz = 0;
    if (kind === "add" || kind === "remove") {
      const s = (kind === "add" ? step : -step) * f;
      dx = avg[0] * s; dy = avg[1] * s; dz = avg[2] * s;
    } else if (kind === "ridge" || kind === "groove") {
      // Narrow crest plus a pinch toward the stroke centre keeps the feature crisp.
      const narrow = Math.exp(-d * d * 7) * m;
      const s = (kind === "ridge" ? step : -step) * narrow;
      const pinch = strength * 0.1 * f;
      dx = avg[0] * s + (hit.point[0] - pos[v * 3]) * pinch;
      dy = avg[1] * s + (hit.point[1] - pos[v * 3 + 1]) * pinch;
      dz = avg[2] * s + (hit.point[2] - pos[v * 3 + 2]) * pinch;
    } else if (kind === "flatten") {
      const h = (pos[v * 3] - cen[0]) * avg[0] + (pos[v * 3 + 1] - cen[1]) * avg[1] + (pos[v * 3 + 2] - cen[2]) * avg[2];
      const s = -h * f * clamp(strength * 1.2, 0, 1);
      dx = avg[0] * s; dy = avg[1] * s; dz = avg[2] * s;
    } else if (kind === "restore" && restore) {
      const q = restore.closest(vertexAt(pos, v), radius * 4);
      if (!q) continue;
      const s = f * clamp(strength * 1.6, 0, 1);
      dx = (q.point[0] - pos[v * 3]) * s; dy = (q.point[1] - pos[v * 3 + 1]) * s; dz = (q.point[2] - pos[v * 3 + 2]) * s;
    } else if (kind === "grab" && drag) {
      dx = drag[0] * f; dy = drag[1] * f; dz = drag[2] * f;
    }
    pos[v * 3] += dx; pos[v * 3 + 1] += dy; pos[v * 3 + 2] += dz;
  }
  return region;
}

const falloff = (d) => {
  const x = 1 - d * d;
  return x * x * (x > 0 ? 1 : 0);
};

export function closestTriVertex(mesh, hit) {
  const { pos, idx } = mesh;
  let best = idx[hit.tri * 3], bd = Infinity;
  for (let k = 0; k < 3; k++) {
    const v = idx[hit.tri * 3 + k];
    const d = (pos[v * 3] - hit.point[0]) ** 2 + (pos[v * 3 + 1] - hit.point[1]) ** 2 + (pos[v * 3 + 2] - hit.point[2]) ** 2;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

/** Laplacian smooth of the given weighted vertices. */
export function smoothWeighted(mesh, weight, passes = 1, lambda = 0.5) {
  const { pos, adj, count } = mesh;
  const next = new Float32Array(pos.length);
  for (let it = 0; it < passes; it++) {
    next.set(pos);
    for (let v = 0; v < count; v++) {
      const w = weight[v] * lambda;
      if (w <= 0) continue;
      let sx = 0, sy = 0, sz = 0;
      const n = adj.offset[v + 1] - adj.offset[v];
      if (!n) continue;
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
        const q = adj.list[j];
        sx += pos[q * 3]; sy += pos[q * 3 + 1]; sz += pos[q * 3 + 2];
      }
      next[v * 3] = pos[v * 3] + (sx / n - pos[v * 3]) * w;
      next[v * 3 + 1] = pos[v * 3 + 1] + (sy / n - pos[v * 3 + 1]) * w;
      next[v * 3 + 2] = pos[v * 3 + 2] + (sz / n - pos[v * 3 + 2]) * w;
    }
    pos.set(next);
  }
}

/** Spreads a vector field along the mesh, keeping the values at `pinned` vertices. */
function diffuse(mesh, field, pinned, passes, weight) {
  const { adj, count } = mesh;
  const next = new Float32Array(field.length);
  for (let it = 0; it < passes; it++) {
    for (let v = 0; v < count; v++) {
      if (pinned[v] || weight[v] <= 0) {
        next[v * 3] = field[v * 3]; next[v * 3 + 1] = field[v * 3 + 1]; next[v * 3 + 2] = field[v * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      const n = adj.offset[v + 1] - adj.offset[v] || 1;
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
        const q = adj.list[j];
        sx += field[q * 3]; sy += field[q * 3 + 1]; sz += field[q * 3 + 2];
      }
      next[v * 3] = sx / n; next[v * 3 + 1] = sy / n; next[v * 3 + 2] = sz / n;
    }
    field.set(next);
  }
}

/* -------------------------------------------------- distances and fits */

/**
 * Signed gap from a point to a scanned surface: negative means inside it. Far from the surface
 * the sign of an open scan is meaningless, so it is only trusted within `signRange` mm.
 */
export function signedGap(bvh, p, maxDist = Infinity, signRange = 0.5) {
  const c = bvh.closest(p, maxDist);
  if (!c) return null;
  const d = c.side < 0 && c.d <= signRange ? -c.d : c.d;
  return { d, point: c.point, tri: c.tri };
}

export function gapStats(mesh, weight, bvh, maxDist = 3) {
  let min = Infinity, at = -1, point = null;
  const values = new Float32Array(mesh.count).fill(NaN);
  let below = 0;
  for (let v = 0; v < mesh.count; v++) {
    if (weight && weight[v] <= 0) continue;
    const g = signedGap(bvh, vertexAt(mesh.pos, v), maxDist);
    if (!g) continue;
    values[v] = g.d;
    if (g.d < min) { min = g.d; at = v; point = g.point; }
    if (g.d < 0) below++;
  }
  return { values, min: at < 0 ? null : min, at, point, penetrating: below };
}

/**
 * Removes material until every movable vertex clears the surface by `target` mm.
 * The correction is diffused over neighbours so relief stays anatomically smooth.
 */
export function relieve(mesh, weight, bvh, target, { iterations = 12, spread = 10, tol = 0.004, limit = null } = {}) {
  const { pos, count } = mesh;
  const field = new Float32Array(pos.length);
  const pinned = new Uint8Array(count);
  let moved = 0;
  for (let it = 0; it < iterations; it++) {
    field.fill(0);
    pinned.fill(0);
    let worst = 0;
    for (let v = 0; v < count; v++) {
      if (weight[v] <= 0 || (limit && !limit[v])) continue;
      const p = vertexAt(pos, v);
      const c = bvh.closest(p, target + 1.2);
      if (!c) continue;
      const d = c.side < 0 && c.d <= 0.5 ? -c.d : c.d;
      if (d >= target) continue;
      const deficit = target - d + tol * 0.5;
      // Push along the surface's own normal: the shortest way to open the gap.
      const n = triNormal(bvh.pos, bvh.idx, c.tri);
      field[v * 3] = n[0] * deficit; field[v * 3 + 1] = n[1] * deficit; field[v * 3 + 2] = n[2] * deficit;
      pinned[v] = 1;
      worst = Math.max(worst, deficit);
    }
    if (!worst) break;
    diffuse(mesh, field, pinned, spread, weight);
    for (let v = 0; v < count; v++) {
      const w = weight[v];
      if (w <= 0) continue;
      pos[v * 3] += field[v * 3] * w;
      pos[v * 3 + 1] += field[v * 3 + 1] * w;
      pos[v * 3 + 2] += field[v * 3 + 2] * w;
    }
    moved = Math.max(moved, worst);
  }
  refresh(mesh);
  return { moved };
}

/** Builds material toward a surface until the nearest vertex is `target` mm away from it. */
export function buildToward(mesh, weight, bvh, target, { radius = 2, iterations = 10, tol = 0.006, limit = null } = {}) {
  const { pos, count } = mesh;
  const scratch = newScratch(count);
  let total = 0;
  for (let it = 0; it < iterations; it++) {
    let best = Infinity, at = -1, q = null;
    for (let v = 0; v < count; v++) {
      if (weight[v] <= 0.5 || (limit && !limit[v])) continue;
      const g = signedGap(bvh, vertexAt(pos, v), Number.isFinite(best) ? Math.max(best + 0.05, 0.1) : 6);
      if (g && g.d < best) { best = g.d; at = v; q = g.point; }
    }
    if (at < 0 || best <= target + tol) break;
    const step = best - target;
    const dir = V.norm(V.sub(q, vertexAt(pos, at)));
    const region = brushRegion(mesh, at, vertexAt(pos, at), radius, scratch);
    for (let i = 0; i < region.length; i += 2) {
      const v = region[i];
      const f = falloff(region[i + 1]) * weight[v];
      pos[v * 3] += dir[0] * step * f;
      pos[v * 3 + 1] += dir[1] * step * f;
      pos[v * 3 + 2] += dir[2] * step * f;
    }
    total += step;
    refresh(mesh);
  }
  return { moved: total };
}

/** Moves the crown surface so its closest approach to `bvh` equals `target`, in either direction. */
export function setClearance(mesh, weight, bvh, target, opts = {}) {
  const before = gapStats(mesh, opts.limit ? weight.map((w, v) => (opts.limit[v] ? w : 0)) : weight, bvh, 6);
  if (before.min === null) return { before: null, after: null };
  if (before.min > target) buildToward(mesh, weight, bvh, target, { radius: opts.radius ?? 2.2, limit: opts.limit });
  relieve(mesh, weight, bvh, target, { limit: opts.limit, spread: opts.spread ?? 10 });
  const after = gapStats(mesh, opts.limit ? weight.map((w, v) => (opts.limit[v] ? w : 0)) : weight, bvh, 6);
  return { before: before.min, after: after.min };
}

/** Minimum wall thickness: outer vertices measured to the intaglio surface. */
export function thicknessMap(mesh, seg, intaglioBvh, marginZone = 1.2) {
  const values = new Float32Array(mesh.count).fill(NaN);
  const rimPts = Array.from(seg.rimLoop, (v) => vertexAt(mesh.pos, v));
  const rimDist = distToPolyline(mesh.pos, mesh.count, rimPts);
  let min = Infinity, at = -1;
  for (let v = 0; v < mesh.count; v++) {
    if (seg.intaglio[v]) continue;
    const c = intaglioBvh.closest(vertexAt(mesh.pos, v), 6);
    if (!c) continue;
    values[v] = c.d;
    // The wall tapers to nothing at the margin by design, so the reported minimum skips that band.
    if (rimDist[v] > marginZone && c.d < min) { min = c.d; at = v; }
  }
  return { values, min, at };
}

/** Thickens the outer wall to `min` mm, tapering to `minMargin` within `zone` mm of the rim. */
export function enforceThickness(mesh, seg, intaglioBvh, { min = 0.5, minMargin = 0.2, zone = 1.2, iterations = 14, spread = 6 } = {}) {
  const { pos, norm, count } = mesh;
  const { weight, rimDist } = outerWeights(mesh, seg, 0.25);
  const field = new Float32Array(pos.length);
  const pinned = new Uint8Array(count);
  let moved = 0;
  for (let it = 0; it < iterations; it++) {
    field.fill(0);
    pinned.fill(0);
    let any = false;
    for (let v = 0; v < count; v++) {
      if (seg.intaglio[v] || weight[v] <= 0) continue;
      const need = minMargin + (min - minMargin) * smoothstep(0, zone, rimDist[v]);
      const c = intaglioBvh.closest(vertexAt(pos, v), need + 0.2);
      if (!c || c.d >= need) continue;
      // Slight overshoot: on a curved wall, moving along the normal gains less than it moves.
      const deficit = (need - c.d) * 1.25 + 0.001;
      field[v * 3] = norm[v * 3] * deficit; field[v * 3 + 1] = norm[v * 3 + 1] * deficit; field[v * 3 + 2] = norm[v * 3 + 2] * deficit;
      pinned[v] = 1;
      moved = Math.max(moved, deficit);
      any = true;
    }
    if (!any) break;
    diffuse(mesh, field, pinned, spread, weight);
    for (let v = 0; v < count; v++) {
      pos[v * 3] += field[v * 3] * weight[v];
      pos[v * 3 + 1] += field[v * 3 + 1] * weight[v];
      pos[v * 3 + 2] += field[v * 3 + 2] * weight[v];
    }
    refresh(mesh);
  }
  return { moved };
}

export function cementMap(mesh, seg, prepBvh) {
  const values = new Float32Array(mesh.count).fill(NaN);
  const list = [];
  for (let v = 0; v < mesh.count; v++) {
    if (!seg.intaglio[v]) continue;
    const c = prepBvh.closest(vertexAt(mesh.pos, v), 2);
    if (!c) continue;
    const d = c.side < 0 && c.d <= 0.5 ? -c.d : c.d;
    values[v] = d;
    list.push(d);
  }
  list.sort((a, b) => a - b);
  return { values, median: list[list.length >> 1] ?? null, min: list[0] ?? null, max: list[list.length - 1] ?? null };
}

/**
 * Sets the internal spacing: `gap` over the axial walls and occlusal, `marginGap` at the margin,
 * blended across `zone` mm. Vertices move along their normals, which on the intaglio face the die.
 */
export function setCementGap(mesh, seg, prepBvh, { gap = 0.06, marginGap = 0.02, zone = 1, iterations = 4 } = {}) {
  const { pos, count } = mesh;
  const rimPts = Array.from(seg.rimLoop, (v) => vertexAt(pos, v));
  const rimDist = distToPolyline(pos, count, rimPts);
  const lock = new Uint8Array(count);
  for (const v of seg.rim) lock[v] = 1;
  const w = new Float32Array(count);
  for (let v = 0; v < count; v++) w[v] = seg.intaglio[v] && !lock[v] ? smoothstep(0, 0.3, rimDist[v]) : 0;
  const settle = () => {
    for (let v = 0; v < count; v++) {
      if (!seg.intaglio[v] || lock[v]) continue;
      const p = vertexAt(pos, v);
      const c = prepBvh.closest(p, 2);
      if (!c) continue;
      const d = c.side < 0 && c.d <= 0.5 ? -c.d : c.d;
      const want = marginGap + (gap - marginGap) * smoothstep(0, zone, rimDist[v]);
      const fade = smoothstep(0, 0.2, rimDist[v]);
      // Along the line to the die, so the gap changes by exactly the step and can't overshoot.
      const away = c.d > 1e-5 ? V.mul(V.sub(p, c.point), (d < 0 ? -1 : 1) / c.d) : triNormal(prepBvh.pos, prepBvh.idx, c.tri);
      const step = (want - d) * fade;
      pos[v * 3] += away[0] * step;
      pos[v * 3 + 1] += away[1] * step;
      pos[v * 3 + 2] += away[2] * step;
    }
    refresh(mesh);
  };
  for (let it = 0; it < iterations; it++) settle();
  // Smoothing evens out the die scan's facets, and a last settle puts the gap back on target.
  smoothWeighted(mesh, w, 1, 0.4);
  refresh(mesh);
  settle();
}

/* --------------------------------------------------- anatomy deformation */

/**
 * Reshapes the outer anatomy around the dental frame while intaglio and margin stay put.
 * Writes into `mesh.pos` from `base`, so sliders can be dragged without accumulating error.
 */
export function deformAnatomy(mesh, base, weightInfo, frame, { height = 1, width = 1, length = 1, shiftMesial = 0, shiftFacial = 0, shiftOcclusal = 0, rotate = 0, tiltFacial = 0, tiltMesial = 0 } = {}) {
  const { pos, count } = mesh;
  const { rimDist } = weightInfo;
  const { center, occlusal: O, facial: F, mesial: M } = frame;
  const cr = Math.cos(rotate), sr = Math.sin(rotate);
  for (let v = 0; v < count; v++) {
    const bx = base[v * 3], by = base[v * 3 + 1], bz = base[v * 3 + 2];
    const w = smoothstep(0, 2.4, rimDist[v]) * (weightInfo.weight[v] > 0 ? 1 : 0);
    if (w <= 0) {
      pos[v * 3] = bx; pos[v * 3 + 1] = by; pos[v * 3 + 2] = bz;
      continue;
    }
    const x = bx - center[0], y = by - center[1], z = bz - center[2];
    let m = x * M[0] + y * M[1] + z * M[2];
    let f = x * F[0] + y * F[1] + z * F[2];
    const o = x * O[0] + y * O[1] + z * O[2];
    m *= length;
    f *= width;
    const m2 = m * cr - f * sr + shiftMesial + o * tiltMesial;
    const f2 = m * sr + f * cr + shiftFacial + o * tiltFacial;
    const o2 = o * height + shiftOcclusal;
    const tx = center[0] + M[0] * m2 + F[0] * f2 + O[0] * o2;
    const ty = center[1] + M[1] * m2 + F[1] * f2 + O[1] * o2;
    const tz = center[2] + M[2] * m2 + F[2] * f2 + O[2] * o2;
    pos[v * 3] = bx + (tx - bx) * w;
    pos[v * 3 + 1] = by + (ty - by) * w;
    pos[v * 3 + 2] = bz + (tz - bz) * w;
  }
}

export const ZONES = ["occlusal", "facial", "lingual", "mesial", "distal"];

/** Soft membership of each outer vertex in one anatomical surface. */
export function zoneWeights(mesh, base, weight, frame, zone) {
  const dir = zone === "occlusal" ? frame.occlusal : zone === "facial" ? frame.facial : zone === "lingual" ? V.mul(frame.facial, -1) : zone === "mesial" ? frame.mesial : V.mul(frame.mesial, -1);
  const norm = computeNormals(base, mesh.idx);
  const out = new Float32Array(mesh.count);
  for (let v = 0; v < mesh.count; v++) {
    if (weight[v] <= 0) continue;
    const d = norm[v * 3] * dir[0] + norm[v * 3 + 1] * dir[1] + norm[v * 3 + 2] * dir[2];
    out[v] = smoothstep(0.35, 0.8, d) * weight[v];
  }
  // A little diffusion so the edge of the surface does not form a step.
  const field = new Float32Array(mesh.count * 3);
  for (let v = 0; v < mesh.count; v++) field[v * 3] = out[v];
  diffuse(mesh, field, new Uint8Array(mesh.count), 5, weight);
  for (let v = 0; v < mesh.count; v++) out[v] = field[v * 3];
  return { weights: out, normals: norm };
}

export function offsetByWeights(mesh, base, normals, weights, amount) {
  const { pos, count } = mesh;
  for (let v = 0; v < count; v++) {
    const s = weights[v] * amount;
    pos[v * 3] = base[v * 3] + normals[v * 3] * s;
    pos[v * 3 + 1] = base[v * 3 + 1] + normals[v * 3 + 1] * s;
    pos[v * 3 + 2] = base[v * 3 + 2] + normals[v * 3 + 2] * s;
  }
}

/** Emergence profile: bows the band above the margin outward (+) or inward (-). */
export function emergence(mesh, base, weightInfo, frame, { amount = 0, height = 1.6, width = 1.3 } = {}) {
  const { pos, count } = mesh;
  const O = frame.occlusal;
  const baseNormals = computeNormals(base, mesh.idx);
  for (let v = 0; v < count; v++) {
    const bx = base[v * 3], by = base[v * 3 + 1], bz = base[v * 3 + 2];
    pos[v * 3] = bx; pos[v * 3 + 1] = by; pos[v * 3 + 2] = bz;
    if (weightInfo.weight[v] <= 0) continue;
    const d = weightInfo.rimDist[v];
    const bell = Math.exp(-(((d - height) / width) ** 2)) * smoothstep(0, 0.45, d);
    const n = [baseNormals[v * 3], baseNormals[v * 3 + 1], baseNormals[v * 3 + 2]];
    const dir = V.norm(V.sub(n, V.mul(O, V.dot(n, O))));
    pos[v * 3] += dir[0] * amount * bell;
    pos[v * 3 + 1] += dir[1] * amount * bell;
    pos[v * 3 + 2] += dir[2] * amount * bell;
  }
}

/* -------------------------------------------------------- margin tools */

export function resampleLoop(pts, n) {
  const count = pts.length;
  const lens = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) lens[i + 1] = lens[i] + V.dist(pts[i], pts[(i + 1) % count]);
  const total = lens[count];
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total;
    while (lens[j + 1] < s) j++;
    const t = (s - lens[j]) / (lens[j + 1] - lens[j] || 1);
    const a = pts[j], b = pts[(j + 1) % count];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

export const loopLength = (pts) => pts.reduce((s, p, i) => s + V.dist(p, pts[(i + 1) % pts.length]), 0);

/** Laplacian smoothing of a closed polyline; every point is snapped back to the die if a BVH is given. */
export function smoothLoop(pts, passes = 2, lambda = 0.5, bvh = null) {
  let cur = pts.map((p) => p.slice());
  for (let it = 0; it < passes; it++) {
    const n = cur.length;
    const next = [];
    for (let i = 0; i < n; i++) {
      const a = cur[(i + n - 1) % n], b = cur[i], c = cur[(i + 1) % n];
      next.push([0, 1, 2].map((k) => b[k] + ((a[k] + c[k]) / 2 - b[k]) * lambda));
    }
    cur = next;
  }
  return bvh ? snapLoop(cur, bvh) : cur;
}

export function snapLoop(pts, bvh, maxDist = 1.5) {
  return pts.map((p) => {
    const c = bvh.closest(p, maxDist);
    return c ? c.point : p;
  });
}

/** Per-vertex convexity: positive on crests such as a finish line, negative in creases. */
export function convexity(mesh) {
  const { pos, norm, adj, count } = mesh;
  const out = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    let s = 0;
    const n = adj.offset[v + 1] - adj.offset[v];
    if (!n) continue;
    for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
      const q = adj.list[j];
      const dx = pos[v * 3] - pos[q * 3], dy = pos[v * 3 + 1] - pos[q * 3 + 1], dz = pos[v * 3 + 2] - pos[q * 3 + 2];
      const dn = (norm[v * 3] - norm[q * 3]) * dx + (norm[v * 3 + 1] - norm[q * 3 + 1]) * dy + (norm[v * 3 + 2] - norm[q * 3 + 2]) * dz;
      s += dn / (dx * dx + dy * dy + dz * dz + 1e-9);
    }
    out[v] = s / n;
  }
  return out;
}

/** Nudges a picked point onto the sharpest crest nearby, for tracing a finish line by hand. */
export function magnetPoint(mesh, hit, radius, scratch) {
  const curv = mesh.curvature || (mesh.curvature = convexity(mesh));
  const region = brushRegion(mesh, closestTriVertex(mesh, hit), hit.point, radius, scratch);
  let best = -1, bestScore = 0.25;
  for (let i = 0; i < region.length; i += 2) {
    const v = region[i];
    // Slightly favour staying where the technician clicked.
    const score = curv[v] * (1 - region[i + 1] * 0.4);
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best >= 0 ? vertexAt(mesh.pos, best) : hit.point;
}

/** Closed (or open) Catmull-Rom curve through control points. */
export function splineThrough(ctrl, closed = true, perSpan = 10) {
  const n = ctrl.length;
  if (n < 3) return ctrl.map((p) => p.slice());
  const out = [];
  const spans = closed ? n : n - 1;
  const at = (i) => (closed ? ctrl[(i + n) % n] : ctrl[clamp(i, 0, n - 1)]);
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let j = 0; j < perSpan; j++) {
      const t = j / perSpan, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  if (!closed) out.push(ctrl[n - 1].slice());
  return out;
}

/**
 * Margin detection on a die scan. Rays cast outward from the die axis measure its radius on each
 * meridian: going down from the top the radius grows until the finish line, then falls away into
 * the ditch or sulcus. Those radial maxima are the candidates, and a closed dynamic program
 * picks the smoothest loop through them.
 */
export function detectMargin(bvh, top, axis, { sectors = 120, depth = 10, step = 0.08, minDrop = 0.1, maxRadius = 9 } = {}) {
  const O = V.norm(axis);
  const u = V.norm(V.cross(O, Math.abs(O[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const w = V.cross(O, u);
  const window = Math.round(0.5 / step);
  const cand = [];
  for (let s = 0; s < sectors; s++) {
    const th = (s / sectors) * Math.PI * 2;
    const dir = V.add(V.mul(u, Math.cos(th)), V.mul(w, Math.sin(th)));
    const profile = [];
    const heights = Math.round(depth / step);
    for (let i = 0; i <= heights; i++) {
      const o = V.add(top, V.mul(O, -i * step));
      const hit = bvh.raycast(o, dir);
      profile.push(hit && hit.t < maxRadius ? { t: hit.t, p: hit.point, h: -i * step } : null);
    }
    const list = [];
    for (let i = 1; i < profile.length; i++) {
      const c = profile[i];
      if (!c) continue;
      let peak = true;
      let lowest = c.t;
      for (let j = Math.max(0, i - window); j <= Math.min(profile.length - 1, i + window * 3); j++) {
        const e = profile[j];
        if (j <= i + window && e && e.t > c.t) { peak = false; break; }
        if (j > i) lowest = Math.min(lowest, e ? e.t : 0);
      }
      if (peak && c.t - lowest >= minDrop) list.push({ p: c.p, order: list.length, drop: c.t - lowest });
    }
    // A meridian with no clear finish line is bridged by its neighbours in the loop.
    if (list.length) cand.push(list);
  }
  if (cand.length < sectors * 0.6) return null;
  // The first maximum below the top is the likeliest; later ones cost more, jumps cost most.
  const unary = (c) => -0.6 * c.order + Math.min(c.drop, 1);
  const jump = (a, b) => {
    const d = V.dist(a.p, b.p);
    return d * d * 8;
  };
  let best = null, bestScore = -Infinity;
  for (const start of cand[0]) {
    let row = [{ c: start, score: unary(start), prev: null }];
    for (let s = 1; s < cand.length; s++) {
      row = cand[s].map((c) => {
        let top1 = null, topScore = -Infinity;
        for (const e of row) {
          const score = e.score - jump(e.c, c);
          if (score > topScore) { topScore = score; top1 = e; }
        }
        return { c, score: topScore + unary(c), prev: top1 };
      });
    }
    for (const e of row) {
      const score = e.score - jump(e.c, start);
      if (score > bestScore) {
        bestScore = score;
        const loop = [];
        for (let x = e; x; x = x.prev) loop.push(x.c.p);
        best = loop.reverse();
      }
    }
  }
  return best;
}

/** Moves the crown rim onto a new margin line; the surrounding surface follows with a soft falloff. */
export function fitRimToMargin(mesh, seg, margin, { falloffMm = 1.4 } = {}) {
  const { pos, count } = mesh;
  const field = new Float32Array(pos.length);
  const pinned = new Uint8Array(count);
  let maxMove = 0;
  for (const v of seg.rim) {
    const p = vertexAt(pos, v);
    const q = closestOnLoop(p, margin);
    const d = V.sub(q, p);
    field[v * 3] = d[0]; field[v * 3 + 1] = d[1]; field[v * 3 + 2] = d[2];
    pinned[v] = 1;
    maxMove = Math.max(maxMove, V.len(d));
  }
  const rimPts = Array.from(seg.rimLoop, (v) => vertexAt(pos, v));
  const dist = distToPolyline(pos, count, rimPts);
  const weight = new Float32Array(count);
  for (let v = 0; v < count; v++) weight[v] = dist[v] < falloffMm * 3 ? 1 : 0;
  // Enough passes for the diffusion front to cross the falloff at the mesh's edge length.
  diffuse(mesh, field, pinned, Math.round(clamp(falloffMm / 0.08, 6, 40)), weight);
  for (let v = 0; v < count; v++) {
    const f = pinned[v] ? 1 : 1 - smoothstep(0, falloffMm, dist[v]);
    pos[v * 3] += field[v * 3] * f;
    pos[v * 3 + 1] += field[v * 3 + 1] * f;
    pos[v * 3 + 2] += field[v * 3 + 2] * f;
  }
  refresh(mesh);
  return { maxMove };
}

export function closestOnLoop(p, pts) {
  let best = pts[0], bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ab = V.sub(b, a);
    const t = clamp(V.dot(V.sub(p, a), ab) / (V.dot(ab, ab) || 1), 0, 1);
    const q = V.add(a, V.mul(ab, t));
    const d = V.dist(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** Margin-to-surface fit, and the median distance to a reference line (used to grade auto-detect). */
export function marginFit(margin, bvh) {
  const ds = margin.map((p) => bvh.closest(p, 5)?.d ?? 5).sort((a, b) => a - b);
  return { median: ds[ds.length >> 1], p95: ds[Math.floor(ds.length * 0.95)], max: ds[ds.length - 1] };
}

/* ----------------------------------------------------- scan segmentation */

/** Triangles of a scan within `radius` of a point: much faster queries than the whole jaw. */
export function regionTriangles(pos, idx, center, radius) {
  const out = [];
  const r2 = radius * radius;
  for (let t = 0; t < idx.length / 3; t++) {
    const v = idx[t * 3] * 3;
    const dx = pos[v] - center[0], dy = pos[v + 1] - center[1], dz = pos[v + 2] - center[2];
    if (dx * dx + dy * dy + dz * dz < r2) out.push(t);
  }
  return out;
}

export const LABEL = { JAW: 0, PREP: 1, NEIGHBOR_M: 2, NEIGHBOR_D: 3 };

/**
 * While a margin is being drawn, mark the two teeth beside the click and leave the
 * preparation itself unmarked. Neighbours stop at a gingival crease or one tooth width.
 * Returns null when the click is not on this scan. 0 = keep, 2 = neighbouring tooth.
 */
export function drawingNeighborLabels(mesh, seedPoint, occlusal) {
  const { pos, count, adj } = mesh;
  if (!count || !seedPoint || !occlusal) return null;
  const O = V.norm(occlusal);
  const curv = mesh.curvature || (mesh.curvature = convexity(mesh));
  let seed = -1, best = Infinity;
  for (let v = 0; v < count; v++) {
    const d = (pos[v * 3] - seedPoint[0]) ** 2 + (pos[v * 3 + 1] - seedPoint[1]) ** 2 + (pos[v * 3 + 2] - seedPoint[2]) ** 2;
    if (d < best) { best = d; seed = v; }
  }
  if (seed < 0 || best > 9) return null;
  const label = new Uint8Array(count);
  const flood = (start, id, limit) => {
    if (start < 0 || label[start]) return 0;
    const origin = vertexAt(pos, start);
    const stack = [start];
    label[start] = id;
    let n = 0;
    while (stack.length) {
      const v = stack.pop();
      if (++n > count / 4) break;
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
        const q = adj.list[j];
        if (label[q] || curv[q] < -1.05) continue;
        const dx = pos[q * 3] - origin[0], dy = pos[q * 3 + 1] - origin[1], dz = pos[q * 3 + 2] - origin[2];
        const drop = -(dx * O[0] + dy * O[1] + dz * O[2]);
        const along = Math.hypot(dx, dy, dz);
        if (along > limit || drop > 6.5) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    return n;
  };
  flood(seed, 1, 6.2);
  const sx = pos[seed * 3], sy = pos[seed * 3 + 1], sz = pos[seed * 3 + 2];
  let first = -1, firstH = -Infinity;
  for (let v = 0; v < count; v++) {
    if (label[v] === 1) continue;
    const dx = pos[v * 3] - sx, dy = pos[v * 3 + 1] - sy, dz = pos[v * 3 + 2] - sz;
    const radial = Math.hypot(dx, dy, dz);
    const height = dx * O[0] + dy * O[1] + dz * O[2];
    if (radial < 5 || radial > 16 || height < firstH) continue;
    firstH = height; first = v;
  }
  const fx = first >= 0 ? pos[first * 3] - sx : 0, fy = first >= 0 ? pos[first * 3 + 1] - sy : 0, fz = first >= 0 ? pos[first * 3 + 2] - sz : 0;
  let second = -1, secondH = -Infinity;
  for (let v = 0; v < count; v++) {
    if (label[v] === 1 || v === first) continue;
    const dx = pos[v * 3] - sx, dy = pos[v * 3 + 1] - sy, dz = pos[v * 3 + 2] - sz;
    const radial = Math.hypot(dx, dy, dz);
    const height = dx * O[0] + dy * O[1] + dz * O[2];
    if (radial < 5 || radial > 16 || height < secondH || dx * fx + dy * fy + dz * fz >= 0) continue;
    secondH = height; second = v;
  }
  flood(first, 2, 7.5);
  flood(second, 2, 7.5);
  for (let v = 0; v < count; v++) if (label[v] === 1) label[v] = 0;
  return label;
}

/**
 * Splits the prepared jaw into jaw, preparation die and neighbouring teeth. The die is flooded
 * inside the margin; neighbours are flooded from each side of the crown and stopped at the
 * concave crease where a tooth meets the gum.
 */
export function segmentJaw(scan, margin, frame, { crownTop = null } = {}) {
  const { pos, count, adj } = scan;
  const curv = scan.curvature || (scan.curvature = convexity(scan));
  const label = new Uint8Array(count);
  const { occlusal: O, mesial: M, facial: F } = frame;
  const c = margin.reduce((s, p) => V.add(s, p), [0, 0, 0]).map((x) => x / margin.length);
  const barrier = new Uint8Array(count);
  const near = distanceBand(pos, count, margin, c, 14);
  for (let v = 0; v < count; v++) if (near[v] < 0.11) barrier[v] = 1;
  // The die: everything reachable from the highest scan point over the margin centre.
  let seed = -1, seedH = -Infinity;
  const rad = frame.rimRadius * 0.45;
  for (let v = 0; v < count; v++) {
    if (near[v] > 14) continue;
    const q = [pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]];
    const h = V.dot(q, O);
    const r = V.len(V.sub(q, V.mul(O, h)));
    if (r < rad && h > seedH && h < 12) { seedH = h; seed = v; }
  }
  let flooded = 0;
  if (seed >= 0) {
    const stack = [seed];
    label[seed] = LABEL.PREP;
    while (stack.length) {
      const v = stack.pop();
      flooded++;
      if (flooded > count / 4) break;
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
        const q = adj.list[j];
        if (!label[q] && !barrier[q]) { label[q] = LABEL.PREP; stack.push(q); }
      }
    }
    // A leak means the margin does not close on this scan; report no die rather than a wrong one.
    if (flooded > count / 4) label.fill(LABEL.JAW);
  }
  const floodSide = (dirAxis, sign, id) => {
    const reach = crownTop ? crownTop : frame.rimRadius;
    let start = -1, bestD = Infinity;
    const base = V.add(c, V.add(V.mul(dirAxis, sign * (reach + 3.5)), V.mul(O, 2.5)));
    for (let v = 0; v < count; v++) {
      if (label[v]) continue;
      const d = (pos[v * 3] - base[0]) ** 2 + (pos[v * 3 + 1] - base[1]) ** 2 + (pos[v * 3 + 2] - base[2]) ** 2;
      if (d < bestD) { bestD = d; start = v; }
    }
    if (start < 0 || bestD > 36) return 0;
    const seedPos = vertexAt(pos, start);
    let total = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const v = stack.pop();
      total++;
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
        const q = adj.list[j];
        if (label[q]) continue;
        if (curv[q] < -1.1) continue;
        const dq = [pos[q * 3] - seedPos[0], pos[q * 3 + 1] - seedPos[1], pos[q * 3 + 2] - seedPos[2]];
        if (Math.abs(V.dot(dq, dirAxis)) > 6.5 || Math.abs(V.dot(dq, F)) > 6 || V.dot(dq, O) < -8) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    return total;
  };
  const nm = floodSide(M, 1, LABEL.NEIGHBOR_M);
  const nd = floodSide(M, -1, LABEL.NEIGHBOR_D);
  return { label, prepVerts: flooded, neighborM: nm, neighborD: nd };
}

/** Distance to the margin polyline, computed only near it (everything else reports a large value). */
function distanceBand(pos, count, margin, center, limit) {
  const out = new Float32Array(count).fill(1e3);
  const dense = resampleLoop(margin, Math.max(margin.length, 240));
  const cell = 1;
  const grid = new Map();
  const key = (x, y, z) => (Math.floor(x / cell) + 512) * 1048576 + (Math.floor(y / cell) + 512) * 1024 + (Math.floor(z / cell) + 512);
  dense.forEach((p) => {
    const k = key(p[0], p[1], p[2]);
    (grid.get(k) || grid.set(k, []).get(k)).push(p);
  });
  const l2 = limit * limit;
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const dx = x - center[0], dy = y - center[1], dz = z - center[2];
    if (dx * dx + dy * dy + dz * dz > l2 * 1.5) continue;
    out[v] = limit;
    let best = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
      const list = grid.get(key(x + a * cell, y + b * cell, z + e * cell));
      if (!list) continue;
      for (const p of list) {
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
        if (d < best) best = d;
      }
    }
    if (best < Infinity) out[v] = Math.sqrt(best);
  }
  return out;
}

/**
 * Undercuts on the die for an insertion direction: surface a straight path along `axis`
 * cannot reach. Value is the height of material shadowing that vertex, 0 where it is clear.
 */
export function undercutMap(scan, verts, axis, bvh) {
  const { pos, norm } = scan;
  const values = new Map();
  let area = 0, total = 0, max = 0;
  for (const v of verts) {
    const n = norm[v * 3] * axis[0] + norm[v * 3 + 1] * axis[1] + norm[v * 3 + 2] * axis[2];
    const o = [pos[v * 3] + axis[0] * 0.02, pos[v * 3 + 1] + axis[1] * 0.02, pos[v * 3 + 2] + axis[2] * 0.02];
    let depth = 0;
    if (n < 0.02) {
      const hit = bvh.raycast(o, axis);
      if (hit) depth = hit.t;
    }
    values.set(v, depth);
    total++;
    if (depth > 0.02) { area++; if (depth > max) max = depth; }
  }
  return { values, fraction: total ? area / total : 0, max };
}

/** Best-fit insertion axis: tilts the start axis to minimise undercut vertices, coarse then fine. */
export function bestInsertionAxis(scan, verts, axis, bvh) {
  let best = axis, bestScore = Infinity;
  const u = V.norm(V.cross(axis, Math.abs(axis[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const w = V.cross(axis, u);
  const sample = verts.filter((_, i) => i % Math.max(1, Math.floor(verts.length / 2500)) === 0);
  const evaluate = (d) => {
    const r = undercutMap(scan, sample, d, bvh);
    const tilt = Math.acos(clamp(V.dot(d, axis), -1, 1));
    return r.fraction + tilt * 0.002;
  };
  for (const a of [0, 3, 6, 10, 15]) {
    for (let s = 0; s < (a ? 12 : 1); s++) {
      const th = (s / 12) * Math.PI * 2;
      const t = Math.tan((a * Math.PI) / 180);
      const d = V.norm(V.add(axis, V.add(V.mul(u, t * Math.cos(th)), V.mul(w, t * Math.sin(th)))));
      const score = evaluate(d);
      if (score < bestScore) { bestScore = score; best = d; }
    }
  }
  return best;
}

/* ---------------------------------------------------------- bridge units */

/**
 * A pontic built from the crown's own anatomy: the outer surface is kept and the intaglio is
 * replaced by a closed ovate base, so the copy stays one valid shell with the same topology.
 */
export function makePontic(crown, seg, frame, { at, axis = null, scale = [1, 1, 1], baseDome = 1 } = {}) {
  const { pos, count, idx } = crown;
  const out = new Float32Array(pos.length);
  const { center, occlusal: O, facial: F, mesial: M } = frame;
  const rimPts = Array.from(seg.rimLoop, (v) => vertexAt(pos, v));
  const reach = rimPts.reduce((m, p) => Math.max(m, V.dist(p, center)), 0);
  const O2 = axis ? V.norm(axis) : O;
  // Local axes: same arch-relative orientation, re-orthogonalised if the occlusal axis differs.
  const F2 = V.norm(V.sub(F, V.mul(O2, V.dot(F, O2))));
  const M2 = V.cross(O2, F2);
  const signM = V.dot(M2, M) >= 0 ? 1 : -1;
  for (let v = 0; v < count; v++) {
    const p = vertexAt(pos, v);
    const q = V.sub(p, center);
    const fc = V.dot(q, F), mc = V.dot(q, M);
    let oc = V.dot(q, O);
    if (seg.intaglio[v]) {
      // Flatten onto the rim, then bow apically into an ovate base.
      const rim = closestOnLoop([center[0] + F[0] * fc + M[0] * mc, center[1] + F[1] * fc + M[1] * mc, center[2] + F[2] * fc + M[2] * mc], rimPts);
      const rimH = V.dot(V.sub(rim, center), O);
      const inward = clamp(Math.hypot(fc, mc) / (reach || 1), 0, 1);
      const t = 1 - inward;
      oc = rimH - baseDome * Math.sin((t * Math.PI) / 2) * smoothstep(0, 0.35, t);
    }
    const f = fc * scale[1], m = mc * scale[0], o = oc * scale[2];
    out[v * 3] = at[0] + F2[0] * f + M2[0] * m * signM + O2[0] * o;
    out[v * 3 + 1] = at[1] + F2[1] * f + M2[1] * m * signM + O2[1] * o;
    out[v * 3 + 2] = at[2] + F2[2] * f + M2[2] * m * signM + O2[2] * o;
  }
  return { positions: out, indices: idx.slice() };
}

/** Closed ellipsoid: the fallback pontic when a case has no crown to copy anatomy from. */
export function makeEllipsoid(center, axes, radii, rings = 28, segments = 40) {
  const pos = [];
  const idx = [];
  const add = (a, b, c) => [0, 1, 2].map((k) => center[k] + axes[0][k] * a * radii[0] + axes[1][k] * b * radii[1] + axes[2][k] * c * radii[2]);
  pos.push(...add(0, 0, 1));
  for (let i = 1; i < rings; i++) {
    const phi = (i / rings) * Math.PI;
    for (let j = 0; j < segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      pos.push(...add(Math.sin(phi) * Math.cos(th), Math.sin(phi) * Math.sin(th), Math.cos(phi)));
    }
  }
  pos.push(...add(0, 0, -1));
  const last = pos.length / 3 - 1;
  const at = (i, j) => 1 + (i - 1) * segments + (j % segments);
  for (let j = 0; j < segments; j++) idx.push(0, at(1, j), at(1, j + 1));
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  for (let j = 0; j < segments; j++) idx.push(last, at(rings - 1, j + 1), at(rings - 1, j));
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Closest pair of surface points between two units, biased by an optional height preference. */
export function closestPair(a, b, { prefer = null, preferWeight = 0 } = {}) {
  let best = Infinity, pa = null, pb = null;
  const stride = Math.max(1, Math.floor(a.count / 6000));
  for (let v = 0; v < a.count; v += stride) {
    const p = vertexAt(a.pos, v);
    const c = b.bvh.closest(p, Math.min(best + 2, 30));
    if (!c) continue;
    const cost = c.d + (prefer ? Math.abs(V.dot(V.sub(p, prefer.origin), prefer.dir)) * preferWeight : 0);
    if (cost < best) { best = cost; pa = p; pb = c.point; }
  }
  return pa ? { a: pa, b: pb, d: V.dist(pa, pb) } : null;
}

/**
 * Connector between two units: a closed lofted tube with an elliptical cross-section.
 * `width` is across the arch tangent's normal, `height` along the occlusal axis. The ends are
 * sunk `embed` mm into the units so the shells overlap and can be merged.
 */
export function makeConnector(a, b, occlusal, { width = 3, height = 3.5, waist = 1, embed = 0.8, rings = 14, segments = 24 } = {}) {
  const dir = V.norm(V.sub(b, a));
  const start = V.sub(a, V.mul(dir, embed));
  const end = V.add(b, V.mul(dir, embed));
  let up = V.sub(occlusal, V.mul(dir, V.dot(occlusal, dir)));
  up = V.len(up) > 1e-3 ? V.norm(up) : V.norm(V.cross(dir, [1, 0, 0]));
  const side = V.cross(dir, up);
  const pos = [];
  const idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = V.add(start, V.mul(V.sub(end, start), t));
    const taper = waist + (1 - waist) * Math.abs(2 * t - 1) ** 2;
    for (let j = 0; j < segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      const s = Math.cos(th) * (width / 2) * taper, h = Math.sin(th) * (height / 2) * taper;
      pos.push(c[0] + side[0] * s + up[0] * h, c[1] + side[1] * s + up[1] * h, c[2] + side[2] * s + up[2] * h);
    }
  }
  const startCap = pos.length / 3;
  pos.push(...start);
  const endCap = startCap + 1;
  pos.push(...end);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const p = i * segments + j, q = i * segments + (j + 1) % segments;
      const r = (i + 1) * segments + j, s = (i + 1) * segments + (j + 1) % segments;
      idx.push(p, r, s, p, s, q);
    }
  }
  for (let j = 0; j < segments; j++) {
    idx.push(startCap, j, (j + 1) % segments);
    idx.push(endCap, rings * segments + (j + 1) % segments, rings * segments + j);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), area: (Math.PI / 4) * width * height * waist * waist };
}

/* ------------------------------------------------------ boolean union */

/**
 * Merges overlapping closed shells into one watertight solid. Each shell is voxelised to a
 * signed distance field and the union is contoured with marching tetrahedra, whose shared
 * grid edges make the output closed and manifold by construction.
 */
export function unionMeshes(meshes, h = 0.1, onProgress = null) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { positions: p } of meshes) {
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < lo[k]) lo[k] = p[i + k];
        if (p[i + k] > hi[k]) hi[k] = p[i + k];
      }
    }
  }
  const pad = h * 4;
  // A tiny irrational offset keeps grid columns from hitting triangle edges exactly.
  const org = [lo[0] - pad + h * 0.01731, lo[1] - pad + h * 0.02357, lo[2] - pad + h * 0.01119];
  const nx = Math.ceil((hi[0] - lo[0] + 2 * pad) / h) + 1;
  const ny = Math.ceil((hi[1] - lo[1] + 2 * pad) / h) + 1;
  const nz = Math.ceil((hi[2] - lo[2] + 2 * pad) / h) + 1;
  const N = nx * ny * nz;
  if (N > 6e7) throw new Error("Merged object is too large for this voxel size.");
  const big = h * 1000;
  const field = new Float32Array(N).fill(big);
  const band = new Float32Array(N);
  const inside = new Uint8Array(N);
  const at = (i, j, k) => i + nx * (j + ny * k);
  meshes.forEach(({ positions: p, indices: idx }, mi) => {
    band.fill(big);
    inside.fill(0);
    const columns = new Map();
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let t = 0; t < idx.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        a[k] = p[idx[t] * 3 + k]; b[k] = p[idx[t + 1] * 3 + k]; c[k] = p[idx[t + 2] * 3 + k];
      }
      const pad2 = 2.5 * h;
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - pad2 - org[0]) / h));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) + pad2 - org[0]) / h));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - pad2 - org[1]) / h));
      const j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) + pad2 - org[1]) / h));
      const k0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - pad2 - org[2]) / h));
      const k1 = Math.min(nz - 1, Math.ceil((Math.max(a[2], b[2], c[2]) + pad2 - org[2]) / h));
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = triDist(org[0] + i * h, org[1] + j * h, org[2] + k * h, a, b, c);
        const n = at(i, j, k);
        if (d < band[n]) band[n] = d;
      }
      // Parity crossings along +z for the inside test.
      const denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(denom) < 1e-12) continue;
      const ci0 = Math.max(0, Math.ceil((Math.min(a[0], b[0], c[0]) - org[0]) / h));
      const ci1 = Math.min(nx - 1, Math.floor((Math.max(a[0], b[0], c[0]) - org[0]) / h));
      const cj0 = Math.max(0, Math.ceil((Math.min(a[1], b[1], c[1]) - org[1]) / h));
      const cj1 = Math.min(ny - 1, Math.floor((Math.max(a[1], b[1], c[1]) - org[1]) / h));
      for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) {
        const x = org[0] + i * h, y = org[1] + j * h;
        const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denom;
        const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denom;
        const w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        const z = u * a[2] + v * b[2] + w * c[2];
        const key = i + nx * j;
        const list = columns.get(key);
        if (list) list.push(z);
        else columns.set(key, [z]);
      }
    }
    for (const [key, zs] of columns) {
      zs.sort((s, q) => s - q);
      const i = key % nx, j = (key - i) / nx;
      for (let z = 0; z + 1 < zs.length; z += 2) {
        const k0 = Math.max(0, Math.ceil((zs[z] - org[2]) / h));
        const k1 = Math.min(nz - 1, Math.floor((zs[z + 1] - org[2]) / h));
        for (let k = k0; k <= k1; k++) inside[at(i, j, k)] = 1;
      }
    }
    for (let n = 0; n < N; n++) {
      const s = inside[n] ? -band[n] : band[n];
      if (s < field[n]) field[n] = s;
    }
    if (onProgress) onProgress((mi + 1) / (meshes.length + 1));
  });
  return marchingTets(field, nx, ny, nz, org, h);
}

function triDist(x, y, z, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = x - a[0], apy = y - a[1], apz = z - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  const bpx = x - b[0], bpy = y - b[1], bpz = z - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  const cpx = x - c[0], cpy = y - c[1], cpz = z - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) { qx = a[0]; qy = a[1]; qz = a[2]; }
  else if (d3 >= 0 && d4 <= d3) { qx = b[0]; qy = b[1]; qz = b[2]; }
  else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); qx = a[0] + abx * t; qy = a[1] + aby * t; qz = a[2] + abz * t; }
  else if (d6 >= 0 && d5 <= d6) { qx = c[0]; qy = c[1]; qz = c[2]; }
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); qx = a[0] + acx * t; qy = a[1] + acy * t; qz = a[2] + acz * t; }
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + d5 - d6); qx = b[0] + (c[0] - b[0]) * t; qy = b[1] + (c[1] - b[1]) * t; qz = b[2] + (c[2] - b[2]) * t; }
  else { const s = 1 / (va + vb + vc); const v = vb * s, w = vc * s; qx = a[0] + abx * v + acx * w; qy = a[1] + aby * v + acy * w; qz = a[2] + abz * v + acz * w; }
  return Math.hypot(x - qx, y - qy, z - qz);
}

const CUBE = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
// Freudenthal split: six tetrahedra around the 0-6 diagonal, consistent between neighbouring cubes.
const TETS = [[0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6]];

function marchingTets(field, nx, ny, nz, org, h) {
  const at = (i, j, k) => i + nx * (j + ny * k);
  const verts = [];
  const indices = [];
  const edges = new Map();
  const N = field.length;
  const vert = (a, b, ax, ay, az, bx, by, bz) => {
    const key = a < b ? a * N + b : b * N + a;
    let id = edges.get(key);
    if (id !== undefined) return id;
    const fa = field[a], fb = field[b];
    // The clamp keeps every vertex strictly inside its edge, so no triangle degenerates to a point.
    const t = clamp(fa / (fa - fb), 0.03, 0.97);
    id = verts.length / 3;
    verts.push(org[0] + (ax + (bx - ax) * t) * h, org[1] + (ay + (by - ay) * t) * h, org[2] + (az + (bz - az) * t) * h);
    edges.set(key, id);
    return id;
  };
  const v = new Array(4), n = new Array(4), c = new Array(4);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let any = 0, neg = 0;
    for (let q = 0; q < 8; q++) {
      const d = CUBE[q];
      if (field[at(i + d[0], j + d[1], k + d[2])] < 0) neg++;
      any++;
    }
    if (neg === 0 || neg === any) continue;
    for (const tet of TETS) {
      for (let q = 0; q < 4; q++) {
        c[q] = CUBE[tet[q]];
        n[q] = at(i + c[q][0], j + c[q][1], k + c[q][2]);
        v[q] = field[n[q]] < 0;
      }
      const inside = [], outside = [];
      for (let q = 0; q < 4; q++) (v[q] ? inside : outside).push(q);
      if (!inside.length || !outside.length) continue;
      const P = (p, q) => vert(n[p], n[q], i + c[p][0], j + c[p][1], k + c[p][2], i + c[q][0], j + c[q][1], k + c[q][2]);
      const tris = [];
      if (inside.length === 1) {
        const [a] = inside, [b, d, e] = outside;
        tris.push([P(a, b), P(a, d), P(a, e), a, null]);
      } else if (inside.length === 3) {
        const [a] = outside, [b, d, e] = inside;
        tris.push([P(a, b), P(a, d), P(a, e), a, null]);
      } else {
        const [a, b] = inside, [d, e] = outside;
        const p0 = P(a, d), p1 = P(a, e), p2 = P(b, e), p3 = P(b, d);
        tris.push([p0, p1, p2], [p0, p2, p3]);
      }
      // Orient each triangle so its normal leaves the solid (toward the positive side).
      let cx = 0, cy = 0, cz = 0;
      for (const q of inside) { cx += c[q][0]; cy += c[q][1]; cz += c[q][2]; }
      cx = org[0] + (i + cx / inside.length) * h;
      cy = org[1] + (j + cy / inside.length) * h;
      cz = org[2] + (k + cz / inside.length) * h;
      for (const tri of tris) {
        const A = tri[0] * 3, B = tri[1] * 3, C = tri[2] * 3;
        const nrm = V.cross(
          [verts[B] - verts[A], verts[B + 1] - verts[A + 1], verts[B + 2] - verts[A + 2]],
          [verts[C] - verts[A], verts[C + 1] - verts[A + 1], verts[C + 2] - verts[A + 2]],
        );
        const toIn = [cx - verts[A], cy - verts[A + 1], cz - verts[A + 2]];
        if (V.dot(nrm, toIn) > 0) indices.push(tri[0], tri[2], tri[1]);
        else indices.push(tri[0], tri[1], tri[2]);
      }
    }
  }
  return { positions: new Float32Array(verts), indices: new Uint32Array(indices) };
}

/* ------------------------------------------------------------- sections */

/** Mesh/plane intersection as line segments, with the section's extents along two in-plane axes. */
export function sliceMesh(pos, idx, n, d, axisA = null, axisB = null) {
  const segs = [];
  const side = (i) => pos[i * 3] * n[0] + pos[i * 3 + 1] * n[1] + pos[i * 3 + 2] * n[2] - d;
  const lerp = (i, j, si, sj) => {
    const t = si / (si - sj);
    return [pos[i * 3] + (pos[j * 3] - pos[i * 3]) * t, pos[i * 3 + 1] + (pos[j * 3 + 1] - pos[i * 3 + 1]) * t, pos[i * 3 + 2] + (pos[j * 3 + 2] - pos[i * 3 + 2]) * t];
  };
  let length = 0;
  const ext = { a0: Infinity, a1: -Infinity, b0: Infinity, b1: -Infinity };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const sa = side(a), sb = side(b), sc = side(c);
    if ((sa > 0 && sb > 0 && sc > 0) || (sa <= 0 && sb <= 0 && sc <= 0)) continue;
    const pts = [];
    if (sa > 0 !== sb > 0) pts.push(lerp(a, b, sa, sb));
    if (sb > 0 !== sc > 0) pts.push(lerp(b, c, sb, sc));
    if (sc > 0 !== sa > 0) pts.push(lerp(c, a, sc, sa));
    if (pts.length !== 2) continue;
    segs.push(...pts[0], ...pts[1]);
    length += V.dist(pts[0], pts[1]);
    if (axisA) {
      for (const p of pts) {
        const u = V.dot(p, axisA), w = V.dot(p, axisB);
        if (u < ext.a0) ext.a0 = u;
        if (u > ext.a1) ext.a1 = u;
        if (w < ext.b0) ext.b0 = w;
        if (w > ext.b1) ext.b1 = w;
      }
    }
  }
  return { segments: new Float32Array(segs), length, width: ext.a1 - ext.a0, height: ext.b1 - ext.b0 };
}

/** Uniform 1-to-4 subdivision, for sculpting finer detail than the original mesh allows. */
export function subdivide(pos, idx) {
  const n = pos.length / 3;
  const map = new Map();
  const out = Array.from(pos);
  const mid = (a, b) => {
    const key = a < b ? a * n + b : b * n + a;
    let m = map.get(key);
    if (m === undefined) {
      m = out.length / 3;
      out.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
      map.set(key, m);
    }
    return m;
  };
  const next = new Uint32Array(idx.length * 4);
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    next.set([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca], o);
    o += 12;
  }
  return { positions: new Float32Array(out), indices: next };
}
