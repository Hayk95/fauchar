/**
 * FAUCHAR CAD kernel: indexed-mesh primitives with no DOM or WebGL dependency,
 * so every operation can be tested headlessly on real scans.
 */

export function computeNormals(pos, idx, out = new Float32Array(pos.length)) {
  out.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v], out[v + 1], out[v + 2]) || 1;
    out[v] /= l; out[v + 1] /= l; out[v + 2] /= l;
  }
  return out;
}

/** Vertex adjacency in compressed form: neighbours of v are list[offset[v] .. offset[v + 1]). */
export function buildAdjacency(nVerts, idx) {
  const sets = Array.from({ length: nVerts }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    sets[a].add(b); sets[a].add(c);
    sets[b].add(a); sets[b].add(c);
    sets[c].add(a); sets[c].add(b);
  }
  const offset = new Int32Array(nVerts + 1);
  let total = 0;
  for (let v = 0; v < nVerts; v++) {
    offset[v] = total;
    total += sets[v].size;
  }
  offset[nVerts] = total;
  const list = new Int32Array(total);
  for (let v = 0; v < nVerts; v++) {
    let o = offset[v];
    for (const q of sets[v]) list[o++] = q;
  }
  return { offset, list };
}

export function uniqueEdges(idx, nVerts) {
  const seen = new Set();
  const edges = [];
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const p = idx[t + k], q = idx[t + (k + 1) % 3];
      const key = p < q ? p * nVerts + q : q * nVerts + p;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(p, q);
      }
    }
  }
  return new Uint32Array(edges);
}

export function meshStats(pos, idx) {
  const n = pos.length / 3;
  const use = new Map();
  let degenerate = 0;
  let area = 0;
  let volume = 0;
  let invalid = 0;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) invalid++;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const A = a * 3, B = b * 3, C = c * 3;
    const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2];
    const vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) degenerate++;
    area += l / 2;
    volume += (pos[A] * nx + pos[A + 1] * ny + pos[A + 2] * nz) / 6;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = p < q ? p * n + q : q * n + p;
      use.set(key, (use.get(key) || 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  for (const u of use.values()) {
    if (u === 1) boundary++;
    else if (u > 2) nonManifold++;
  }
  return { triangles: idx.length / 3, vertices: n, boundary, nonManifold, degenerate, invalid, area, volume: Math.abs(volume), closed: boundary === 0 && nonManifold === 0 };
}

/* ---------------------------------------------------------------- vectors */

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const vertexAt = (pos, v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];

/* -------------------------------------------------------------------- BVH */

/**
 * Bounding-volume hierarchy over triangles. Picking and exact closest-point queries,
 * refittable after vertices move so it stays valid during sculpting.
 * `tris` optionally restricts it to a subset of triangle indices.
 */
export class BVH {
  constructor(pos, idx, tris = null, leafSize = 6) {
    this.pos = pos;
    this.idx = idx;
    const count = tris ? tris.length : idx.length / 3;
    this.order = tris ? Int32Array.from(tris) : Int32Array.from({ length: count }, (_, i) => i);
    this.count = count;
    const maxNodes = Math.max(2, count * 2);
    this.bounds = new Float32Array(maxNodes * 6);
    this.left = new Int32Array(maxNodes);
    this.first = new Int32Array(maxNodes);
    this.num = new Int32Array(maxNodes);
    this.nodes = 0;
    this.leafSize = leafSize;
    this.centroids = new Float32Array(idx.length);
    for (let t = 0; t < idx.length / 3; t++) {
      for (let k = 0; k < 3; k++) {
        this.centroids[t * 3 + k] = (pos[idx[t * 3] * 3 + k] + pos[idx[t * 3 + 1] * 3 + k] + pos[idx[t * 3 + 2] * 3 + k]) / 3;
      }
    }
    if (count) this.build();
    this.centroids = null;
  }

  build() {
    const stack = [[0, this.count, this.nodes++]];
    while (stack.length) {
      const [start, end, node] = stack.pop();
      this.setBounds(node, start, end);
      const n = end - start;
      if (n <= this.leafSize) {
        this.left[node] = -1;
        this.first[node] = start;
        this.num[node] = n;
        continue;
      }
      const b = node * 6;
      const dx = this.bounds[b + 3] - this.bounds[b];
      const dy = this.bounds[b + 4] - this.bounds[b + 1];
      const dz = this.bounds[b + 5] - this.bounds[b + 2];
      const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;
      const mid = start + (n >> 1);
      this.select(start, end - 1, mid, axis);
      const l = this.nodes++;
      const r = this.nodes++;
      this.left[node] = l;
      this.num[node] = 0;
      stack.push([start, mid, l], [mid, end, r]);
    }
  }

  /** Quickselect, so the tree builds in O(n log n) without allocating sorted copies. */
  select(lo, hi, k, axis) {
    const o = this.order;
    const c = this.centroids;
    while (lo < hi) {
      const pivot = c[o[(lo + hi) >> 1] * 3 + axis];
      let i = lo, j = hi;
      while (i <= j) {
        while (c[o[i] * 3 + axis] < pivot) i++;
        while (c[o[j] * 3 + axis] > pivot) j--;
        if (i <= j) {
          const tmp = o[i]; o[i] = o[j]; o[j] = tmp;
          i++; j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return;
    }
  }

  setBounds(node, start, end) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const { pos, idx, order } = this;
    for (let i = start; i < end; i++) {
      const t = order[i] * 3;
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k] * 3;
        const x = pos[v], y = pos[v + 1], z = pos[v + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
    }
    const b = node * 6;
    this.bounds[b] = x0; this.bounds[b + 1] = y0; this.bounds[b + 2] = z0;
    this.bounds[b + 3] = x1; this.bounds[b + 4] = y1; this.bounds[b + 5] = z1;
  }

  /** Children always follow their parent, so a reverse pass refits bottom-up. */
  refit() {
    for (let node = this.nodes - 1; node >= 0; node--) {
      const l = this.left[node];
      if (l < 0) {
        this.setBounds(node, this.first[node], this.first[node] + this.num[node]);
        continue;
      }
      const a = l * 6, c = (l + 1) * 6, b = node * 6, B = this.bounds;
      for (let k = 0; k < 3; k++) {
        B[b + k] = Math.min(B[a + k], B[c + k]);
        B[b + 3 + k] = Math.max(B[a + 3 + k], B[c + 3 + k]);
      }
    }
  }

  /** Nearest hit along a ray, as { t, tri, u, v, point, normal }, or null. */
  raycast(o, d) {
    if (!this.count) return null;
    const { pos, idx, order, bounds, left, first, num } = this;
    const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
    let best = Infinity, bestTri = -1, bestU = 0, bestV = 0;
    const stack = [0];
    while (stack.length) {
      const node = stack.pop();
      const b = node * 6;
      let tmin = 0, tmax = best, miss = false;
      for (let k = 0; k < 3; k++) {
        let t0 = (bounds[b + k] - o[k]) * inv[k];
        let t1 = (bounds[b + 3 + k] - o[k]) * inv[k];
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tmin) tmin = t0;
        if (t1 < tmax) tmax = t1;
        if (tmax < tmin) { miss = true; break; }
      }
      if (miss) continue;
      const l = left[node];
      if (l >= 0) {
        stack.push(l, l + 1);
        continue;
      }
      for (let i = first[node], e = i + num[node]; i < e; i++) {
        const t3 = order[i] * 3;
        const A = idx[t3] * 3, B = idx[t3 + 1] * 3, C = idx[t3 + 2] * 3;
        const e1x = pos[B] - pos[A], e1y = pos[B + 1] - pos[A + 1], e1z = pos[B + 2] - pos[A + 2];
        const e2x = pos[C] - pos[A], e2y = pos[C + 1] - pos[A + 1], e2z = pos[C + 2] - pos[A + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det;
        const sx = o[0] - pos[A], sy = o[1] - pos[A + 1], sz = o[2] - pos[A + 2];
        const u = f * (sx * px + sy * py + sz * pz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
        if (v < 0 || u + v > 1) continue;
        const t = f * (e2x * qx + e2y * qy + e2z * qz);
        if (t > 1e-6 && t < best) {
          best = t; bestTri = order[i]; bestU = u; bestV = v;
        }
      }
    }
    if (bestTri < 0) return null;
    const point = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
    return { t: best, tri: bestTri, u: bestU, v: bestV, point, normal: triNormal(pos, idx, bestTri) };
  }

  /** Exact closest point on the triangles, as { d, point, tri, side }; side < 0 is behind the surface. */
  closest(p, maxDist = Infinity) {
    if (!this.count) return null;
    const { pos, idx, order, bounds, left, first, num } = this;
    let best2 = maxDist * maxDist;
    let bestTri = -1;
    const q = [0, 0, 0];
    const bestQ = [0, 0, 0];
    const boxD2 = (node) => {
      const b = node * 6;
      let s = 0;
      for (let k = 0; k < 3; k++) {
        const v = p[k];
        if (v < bounds[b + k]) s += (bounds[b + k] - v) ** 2;
        else if (v > bounds[b + 3 + k]) s += (v - bounds[b + 3 + k]) ** 2;
      }
      return s;
    };
    const stack = [0];
    while (stack.length) {
      const node = stack.pop();
      if (boxD2(node) >= best2) continue;
      const l = left[node];
      if (l >= 0) {
        // Visit the nearer child first so far branches get pruned.
        if (boxD2(l) < boxD2(l + 1)) stack.push(l + 1, l);
        else stack.push(l, l + 1);
        continue;
      }
      for (let i = first[node], e = i + num[node]; i < e; i++) {
        const t3 = order[i] * 3;
        closestOnTriangle(p, pos, idx[t3] * 3, idx[t3 + 1] * 3, idx[t3 + 2] * 3, q);
        const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d2 < best2) {
          best2 = d2; bestTri = order[i];
          bestQ[0] = q[0]; bestQ[1] = q[1]; bestQ[2] = q[2];
        }
      }
    }
    if (bestTri < 0) return null;
    const n = triNormal(pos, idx, bestTri);
    const side = (p[0] - bestQ[0]) * n[0] + (p[1] - bestQ[1]) * n[1] + (p[2] - bestQ[2]) * n[2];
    return { d: Math.sqrt(best2), point: bestQ.slice(), tri: bestTri, side };
  }
}

export function triNormal(pos, idx, tri) {
  const A = idx[tri * 3] * 3, B = idx[tri * 3 + 1] * 3, C = idx[tri * 3 + 2] * 3;
  return V.norm(V.cross(
    [pos[B] - pos[A], pos[B + 1] - pos[A + 1], pos[B + 2] - pos[A + 2]],
    [pos[C] - pos[A], pos[C + 1] - pos[A + 1], pos[C + 2] - pos[A + 2]],
  ));
}

/** Closest point on a triangle (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(p, pos, A, B, C, out) {
  const ax = pos[A], ay = pos[A + 1], az = pos[A + 2];
  const abx = pos[B] - ax, aby = pos[B + 1] - ay, abz = pos[B + 2] - az;
  const acx = pos[C] - ax, acy = pos[C + 1] - ay, acz = pos[C + 2] - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = p[0] - pos[B], bpy = p[1] - pos[B + 1], bpz = p[2] - pos[B + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = pos[B]; out[1] = pos[B + 1]; out[2] = pos[B + 2]; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v;
    return;
  }
  const cpx = p[0] - pos[C], cpy = p[1] - pos[C + 1], cpz = p[2] - pos[C + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = pos[C]; out[1] = pos[C + 1]; out[2] = pos[C + 2]; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = pos[B] + (pos[C] - pos[B]) * w;
    out[1] = pos[B + 1] + (pos[C + 1] - pos[B + 1]) * w;
    out[2] = pos[B + 2] + (pos[C + 2] - pos[B + 2]) * w;
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}

/* -------------------------------------------------------------------- STL */

export function parseBinarySTL(buffer) {
  const dv = new DataView(buffer);
  const count = dv.getUint32(80, true);
  if (84 + count * 50 !== buffer.byteLength) throw new Error("Not a binary STL");
  const map = new Map();
  const pos = [];
  const idx = new Uint32Array(count * 3);
  let o = 84;
  for (let t = 0; t < count; t++) {
    o += 12;
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
      o += 12;
      const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      let i = map.get(key);
      if (i === undefined) {
        i = pos.length / 3;
        map.set(key, i);
        pos.push(x, y, z);
      }
      idx[t * 3 + k] = i;
    }
    o += 2;
  }
  return { positions: new Float32Array(pos), indices: idx };
}

/** Binary STL from one or more meshes; facet normals are recomputed from the geometry. */
export function writeBinarySTL(meshes, header = "FAUCHAR Design") {
  const tris = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) & 0x7f : 32);
  dv.setUint32(80, tris, true);
  let o = 84;
  for (const { positions: p, indices: idx } of meshes) {
    for (let t = 0; t < idx.length; t += 3) {
      const a = vertexAt(p, idx[t]), b = vertexAt(p, idx[t + 1]), c = vertexAt(p, idx[t + 2]);
      const n = V.norm(V.cross(V.sub(b, a), V.sub(c, a)));
      for (const vec of [n, a, b, c]) {
        dv.setFloat32(o, vec[0], true);
        dv.setFloat32(o + 4, vec[1], true);
        dv.setFloat32(o + 8, vec[2], true);
        o += 12;
      }
      dv.setUint16(o, 0, true);
      o += 2;
    }
  }
  return buf;
}
