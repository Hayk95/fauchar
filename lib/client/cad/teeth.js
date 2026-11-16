/**
 * FAUCHAR tooth identification on jaw scans: finds each tooth along the dental arch and gives it
 * an FDI number from the arch's own geometry. No training data is involved, so every number can
 * be traced back to a measured width, a measured gap and the side of the midline it sits on.
 *
 * Pipeline: occlusal plane -> height map -> arch centreline -> cross-section profile along the
 * arch -> interdental valleys -> sequence of teeth fitted to anatomical widths -> mesh labels.
 */
import { V, clamp } from "./mesh.js";
import { convexity } from "./ops.js";

/** Typical mesiodistal crown widths in mm, central incisor to third molar. */
const WIDTHS = {
  upper: [8.6, 6.6, 7.6, 7.0, 6.8, 10.3, 9.8, 8.8],
  lower: [5.3, 5.8, 6.9, 7.0, 7.1, 11.0, 10.6, 10.5],
};

/** Arch order seen from the patient's right to the patient's left. */
export const ARCH_ORDER = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
};

export const jawOfFdi = (fdi) => (Math.floor(fdi / 10) <= 2 ? "upper" : "lower");

const CELL = 0.35;

/* --------------------------------------------------------- height map */

function makeFrame(occlusal) {
  const O = V.norm(occlusal);
  const a = V.norm(V.cross(O, Math.abs(O[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  return { O, a, b: V.cross(O, a) };
}

/** Height along the occlusal axis of the surface seen from the occlusal side. */
function heightMap(pos, idx, frame, cell = CELL) {
  const { O, a, b } = frame;
  const n = pos.length / 3;
  const pu = new Float32Array(n), pv = new Float32Array(n), ph = new Float32Array(n);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const u = x * a[0] + y * a[1] + z * a[2];
    const v = x * b[0] + y * b[1] + z * b[2];
    pu[i] = u; pv[i] = v; ph[i] = x * O[0] + y * O[1] + z * O[2];
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  const w = Math.ceil((u1 - u0) / cell) + 2, h = Math.ceil((v1 - v0) / cell) + 2;
  const grid = new Float32Array(w * h).fill(-1e9);
  for (let t = 0; t < idx.length; t += 3) {
    const A = idx[t], B = idx[t + 1], C = idx[t + 2];
    const ax = (pu[A] - u0) / cell, ay = (pv[A] - v0) / cell;
    const bx = (pu[B] - u0) / cell, by = (pv[B] - v0) / cell;
    const cx = (pu[C] - u0) / cell, cy = (pv[C] - v0) / cell;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) {
      const k = Math.round(ay) * w + Math.round(ax);
      if (k >= 0 && k < grid.length && ph[A] > grid[k]) grid[k] = ph[A];
      continue;
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const l0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const l2 = 1 - l0 - l1;
        if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
        const z = l0 * ph[A] + l1 * ph[B] + l2 * ph[C];
        const k = y * w + x;
        if (z > grid[k]) grid[k] = z;
      }
    }
  }
  return { grid, w, h, u0, v0, cell, pu, pv, ph };
}

const sample = (m, u, v) => {
  const x = Math.round((u - m.u0) / m.cell), y = Math.round((v - m.v0) / m.cell);
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return -1e9;
  return m.grid[y * m.w + x];
};

function percentile(values, p) {
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

/** Tilts the axis onto the plane through the tooth tips, which is the true occlusal plane. */
function refineOcclusal(pos, idx, start) {
  let O = V.norm(start);
  for (let it = 0; it < 3; it++) {
    const f = makeFrame(O);
    const m = heightMap(pos, idx, f, 1);
    const tips = [];
    const coarse = 8;
    for (let y = 0; y < m.h; y += coarse) {
      for (let x = 0; x < m.w; x += coarse) {
        let best = -1e9, bx = 0, by = 0;
        for (let j = y; j < Math.min(m.h, y + coarse); j++) {
          for (let i = x; i < Math.min(m.w, x + coarse); i++) {
            const g = m.grid[j * m.w + i];
            if (g > best) { best = g; bx = i; by = j; }
          }
        }
        if (best > -1e8) tips.push([m.u0 + bx * m.cell, m.v0 + by * m.cell, best]);
      }
    }
    if (tips.length < 8) return O;
    const top = percentile(tips.map((t) => t[2]), 0.92);
    const use = tips.filter((t) => t[2] > top - 5);
    // Least-squares plane h = p*u + q*v + r through those tips.
    let su = 0, sv = 0, sh = 0, suu = 0, svv = 0, suv = 0, suh = 0, svh = 0;
    for (const [u, v, h] of use) {
      su += u; sv += v; sh += h; suu += u * u; svv += v * v; suv += u * v; suh += u * h; svh += v * h;
    }
    const N = use.length;
    const cu = suu - (su * su) / N, cv = svv - (sv * sv) / N, cuv = suv - (su * sv) / N;
    const cuh = suh - (su * sh) / N, cvh = svh - (sv * sh) / N;
    const d = cu * cv - cuv * cuv;
    if (Math.abs(d) < 1e-6) return O;
    const p = (cuh * cv - cvh * cuv) / d, q = (cvh * cu - cuh * cuv) / d;
    // Scan bases are rarely tilted by more than this; beyond it the plane fit is unreliable.
    if (Math.hypot(p, q) > 0.6) return O;
    O = V.norm(V.sub(O, V.add(V.mul(f.a, p), V.mul(f.b, q))));
  }
  return O;
}

/* ------------------------------------------------------------ the arch */

function archCurve(m, top) {
  const band = top - 5.5;
  const cells = [];
  for (let y = 0; y < m.h; y += 2) {
    for (let x = 0; x < m.w; x += 2) {
      if (m.grid[y * m.w + x] > band) cells.push([m.u0 + x * m.cell, m.v0 + y * m.cell]);
    }
  }
  if (cells.length < 50) return null;
  // Centre of the best-fit circle. Unlike the centroid it stays on the inside of the curve however
  // little of the arch was scanned, so a partial arch shows up as a wide empty range of directions.
  const fit = fitCircle(cells);
  const cu = fit[0], cv = fit[1];
  const bins = 90;
  const sum = new Float64Array(bins), count = new Float64Array(bins);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.grid[y * m.w + x] <= band) continue;
      const du = m.u0 + x * m.cell - cu, dv = m.v0 + y * m.cell - cv;
      const r = Math.hypot(du, dv);
      if (r < 0.5) continue;
      const b = Math.floor(((Math.atan2(dv, du) + Math.PI) / (Math.PI * 2)) * bins) % bins;
      sum[b] += r;
      count[b]++;
    }
  }
  const empty = (b) => count[b] < 6;
  // The opening of the U is the longest run of empty directions.
  let bestLen = 0, bestStart = 0, run = 0, start = 0;
  for (let i = 0; i < bins * 2; i++) {
    if (empty(i % bins)) {
      if (!run) start = i;
      run++;
      if (run > bestLen && run <= bins) { bestLen = run; bestStart = start; }
    } else run = 0;
  }
  const gapDeg = (bestLen / bins) * 360;
  const first = (bestStart + bestLen) % bins;
  const raw = [];
  for (let i = 0; i < bins - bestLen; i++) {
    const b = (first + i) % bins;
    if (empty(b)) continue;
    const th = ((b + 0.5) / bins) * Math.PI * 2 - Math.PI;
    const r = sum[b] / count[b];
    raw.push([cu + Math.cos(th) * r, cv + Math.sin(th) * r]);
  }
  if (raw.length < 6) return null;
  let curve = smoothPolyline(resample2(raw, 1), 6);
  // Recentre on the band: polar averages sit too far inside on the long posterior segments.
  for (let it = 0; it < 4; it++) {
    const next = curve.map((p, i) => {
      const q = curve[Math.min(curve.length - 1, i + 1)], o = curve[Math.max(0, i - 1)];
      const t = norm2([q[0] - o[0], q[1] - o[1]]);
      const nrm = [-t[1], t[0]];
      let s = 0, c = 0;
      for (let w = -8; w <= 8; w += 0.35) {
        if (sample(m, p[0] + nrm[0] * w, p[1] + nrm[1] * w) > band) { s += w; c++; }
      }
      return c ? [p[0] + nrm[0] * (s / c), p[1] + nrm[1] * (s / c)] : p;
    });
    curve = smoothPolyline(next, 4);
  }
  curve = extendEnds(m, resample2(curve, 0.5), band);
  return { points: resample2(smoothPolyline(curve, 3), 0.25), center: [cu, cv], gapDeg };
}

/**
 * Polar sampling gives out before the scan does and tends to hook at the ends. Cuts the hooks off,
 * then walks each end straight on, re-centring as it goes, until the band of teeth really stops.
 */
function extendEnds(m, pts, band) {
  const grow = (list) => {
    const out = list.slice(0, Math.max(8, list.length - 10));
    for (let step = 0; step < 80; step++) {
      const a = out[out.length - 1], b = out[Math.max(0, out.length - 13)];
      const t = norm2([a[0] - b[0], a[1] - b[1]]);
      const nrm = [-t[1], t[0]];
      const p = [a[0] + t[0] * 0.5, a[1] + t[1] * 0.5];
      let s = 0, c = 0;
      for (let w = -6; w <= 6; w += 0.35) {
        if (sample(m, p[0] + nrm[0] * w, p[1] + nrm[1] * w) > band) { s += w; c++; }
      }
      if (c < 4) break;
      const shift = clamp(s / c, -0.25, 0.25);
      out.push([p[0] + nrm[0] * shift, p[1] + nrm[1] * shift]);
    }
    return out;
  };
  return grow(grow(pts).reverse()).reverse();
}

/** Algebraic (Kasa) circle fit. */
function fitCircle(pts) {
  let su = 0, sv = 0;
  for (const p of pts) { su += p[0]; sv += p[1]; }
  const mu = su / pts.length, mv = sv / pts.length;
  let uu = 0, vv = 0, uv = 0, uuu = 0, vvv = 0, uvv = 0, vuu = 0;
  for (const p of pts) {
    const u = p[0] - mu, v = p[1] - mv;
    uu += u * u; vv += v * v; uv += u * v;
    uuu += u * u * u; vvv += v * v * v; uvv += u * v * v; vuu += v * u * u;
  }
  const d = uu * vv - uv * uv;
  if (Math.abs(d) < 1e-6) return [mu, mv];
  const a = (uuu + uvv) / 2, b = (vvv + vuu) / 2;
  return [mu + (a * vv - b * uv) / d, mv + (b * uu - a * uv) / d];
}

const norm2 = (d) => {
  const l = Math.hypot(d[0], d[1]) || 1;
  return [d[0] / l, d[1] / l];
};

function resample2(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = step - carry;
    while (at <= d) {
      out.push([a[0] + ((b[0] - a[0]) * at) / d, a[1] + ((b[1] - a[1]) * at) / d]);
      at += step;
    }
    carry = d - (at - step);
  }
  return out;
}

function smoothPolyline(pts, passes) {
  let cur = pts;
  for (let it = 0; it < passes; it++) {
    cur = cur.map((p, i) => {
      if (i === 0 || i === cur.length - 1) return p;
      return [(cur[i - 1][0] + 2 * p[0] + cur[i + 1][0]) / 4, (cur[i - 1][1] + 2 * p[1] + cur[i + 1][1]) / 4];
    });
  }
  return cur;
}

/** Change of direction along the arch between samples i and j, in radians. */
function turning(pts, i, j) {
  let sum = 0;
  let prev = null;
  for (let k = i; k + 8 <= j; k += 8) {
    const a = Math.atan2(pts[k + 8][1] - pts[k][1], pts[k + 8][0] - pts[k][0]);
    if (prev !== null) {
      let d = a - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      sum += d;
    }
    prev = a;
  }
  return Math.abs(sum);
}

/**
 * The apex is the most curved stretch of the arch that is also mirror-symmetric: midpoints of
 * paired points on either side stay on its axis. Straight posterior segments are symmetric too,
 * which is why curvature has to qualify a position first. Neither measure depends on how far back
 * each side happens to be scanned, which throws off anything based on the arch's ends.
 */
function archApex(curve) {
  const pts = curve.points;
  const n = pts.length;
  // Compare as much of each side as possible: short reaches look symmetric almost anywhere.
  const reach = Math.round(Math.min(110, n * 0.38));
  const cands = [];
  for (let c = reach; c < n - reach; c += 2) cands.push({ c, turn: turning(pts, c - reach, c + reach) });
  if (!cands.length) return { apex: n >> 1, symmetric: false };
  const maxTurn = Math.max(...cands.map((x) => x.turn));
  let best = cands[0], bestScore = Infinity;
  for (const x of cands) {
    if (x.turn < maxTurn * 0.75) continue;
    const { c } = x;
    const t = norm2([pts[c + 16][0] - pts[c - 16][0], pts[c + 16][1] - pts[c - 16][1]]);
    let sum = 0, cnt = 0;
    for (let k = 8; k <= reach; k += 4) {
      const mx = (pts[c + k][0] + pts[c - k][0]) / 2 - pts[c][0];
      const my = (pts[c + k][1] + pts[c - k][1]) / 2 - pts[c][1];
      const dev = mx * t[0] + my * t[1];
      sum += dev * dev;
      cnt++;
    }
    const score = sum / cnt;
    if (score < bestScore) { bestScore = score; best = x; }
  }
  return { apex: best.c, symmetric: true };
}

/* -------------------------------------------- profile along the arch */

/**
 * Material in each cross-section of the arch, above a floor just under the tooth necks. It dips
 * at every contact point, where the embrasures narrow the section from both sides.
 */
function archProfile(m, curve, top) {
  const pts = curve.points;
  const floor = top - 7;
  const mass = new Float32Array(pts.length);
  const crest = new Float32Array(pts.length);
  const normals = [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[Math.min(pts.length - 1, i + 4)], o = pts[Math.max(0, i - 4)];
    const t = norm2([q[0] - o[0], q[1] - o[1]]);
    const nrm = [-t[1], t[0]];
    normals.push(nrm);
    let s = 0, best = -1e9;
    for (let w = -7; w <= 7; w += 0.25) {
      const h = sample(m, pts[i][0] + nrm[0] * w, pts[i][1] + nrm[1] * w);
      if (h > floor) s += (h - floor) * 0.25;
      if (h > best) best = h;
    }
    mass[i] = s;
    crest[i] = best;
  }
  return { mass: blur(mass, 2), crest: blur(crest, 1), normals };
}

function blur(a, r) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += a[j]; c++; }
    out[i] = s / c;
  }
  return out;
}

/** Local minima of the profile with their prominence, in arch samples. */
function findValleys(mass, massRef) {
  const out = [];
  const n = mass.length;
  for (let i = 2; i < n - 2; i++) {
    if (mass[i] > mass[i - 1] || mass[i] >= mass[i + 1]) continue;
    let left = mass[i], right = mass[i];
    for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
      if (mass[j] > left) left = mass[j];
      if (mass[j] < mass[i]) break;
    }
    for (let j = i + 1; j <= Math.min(n - 1, i + 40); j++) {
      if (mass[j] > right) right = mass[j];
      if (mass[j] < mass[i]) break;
    }
    const prom = Math.min(left, right) - mass[i];
    if (prom > 0.15) out.push({ i, prom });
  }
  // A missing tooth is a flat low stretch: no minimum at its ends, yet those ends bound the teeth.
  const low = massRef * 0.3;
  for (let i = 1; i < n; i++) {
    if ((mass[i - 1] < low) !== (mass[i] < low)) {
      if (!out.some((v) => Math.abs(v.i - i) < 3)) out.push({ i, prom: massRef * 0.08, edge: true });
    }
  }
  return out.sort((a, b) => a.i - b.i);
}

/* ---------------------------------------- fitting the tooth sequence */

const SAMPLES_PER_MM = 4;

/**
 * Best run of teeth outward from the midline. Dynamic programme over valleys and tooth position:
 * each tooth is scored on its width against the anatomical prior and on how clear the valley
 * closing it is. A long stretch with little material is a missing tooth, not a very wide one.
 */
function fitSide(valleys, start, end, dir, widths, massRef, mass) {
  const stops = [{ i: start, prom: 1 }];
  for (const v of valleys) {
    if ((v.i - start) * dir > 2 * SAMPLES_PER_MM) stops.push(v);
  }
  stops.sort((p, q) => (p.i - q.i) * dir);
  const last = Math.abs(end - start) / SAMPLES_PER_MM;
  stops.push({ i: end, prom: 0.2, tail: true });
  // Teeth in tight contact can leave no valley. Allow a cut anywhere in a long stretch, at a price,
  // so a span too wide for one tooth is split by width rather than ending the count.
  for (let j = stops.length - 1; j > 0; j--) {
    const span = Math.abs(stops[j].i - stops[j - 1].i);
    if (span < 8 * SAMPLES_PER_MM) continue;
    const add = [];
    for (let q = 2 * SAMPLES_PER_MM; q < span - 1.5 * SAMPLES_PER_MM; q += 2) add.push({ i: stops[j - 1].i + q * dir, prom: 0, soft: true });
    stops.splice(j, 0, ...add);
  }
  const pos = stops.map((s) => Math.abs(s.i - start) / SAMPLES_PER_MM);
  const meanMass = (a, b) => {
    let s = 0, c = 0;
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) { s += mass[k]; c++; }
    return c ? s / c : 0;
  };
  // A real tooth has no empty stretch inside it. Averages alone let one straddle half a gap.
  const hasHole = (a, b) => {
    let run = 0;
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) {
      run = mass[k] < massRef * 0.1 ? run + 1 : 0;
      if (run > 2 * SAMPLES_PER_MM) return true;
    }
    return false;
  };
  const N = stops.length;
  const T = 8;
  const best = Array.from({ length: N }, () => new Float64Array(T + 1).fill(Infinity));
  const back = Array.from({ length: N }, () => Array(T + 1).fill(null));
  best[0][0] = 0;
  const reward = 4.5;
  for (let i = 0; i < N; i++) {
    for (let t = 0; t <= T; t++) {
      const c0 = best[i][t];
      if (c0 === Infinity) continue;
      for (let k = i + 1; k < N; k++) {
        const w = pos[k] - pos[i];
        if (w > 26) break;
        const hole = hasHole(stops[i].i, stops[k].i);
        const m = meanMass(stops[i].i, stops[k].i);
        const present = m > massRef * 0.3 && !hole;
        // A prepared tooth is short, so it carries little material, but it still stands
        // between two clear valleys and has the width of a tooth. A bare ridge has neither.
        const stump = !present && !hole && m > massRef * 0.05 && !stops[k].tail && i > 0 && stops[i].prom > massRef * 0.12 && stops[k].prom > massRef * 0.12 && w > 2.5 && w < 11;
        if (t < T && (present || stump)) {
          const z = (w - widths[t]) / (t >= 5 ? 1.5 : 1.15);
          const zs = stump ? Math.max(0, Math.abs(z) - 1.5) : z;
          const cost = zs * zs - reward + (stops[k].soft ? 2.5 : 0) - Math.min(2.2, stops[k].prom / (massRef * 0.08)) * (stops[k].tail ? 0 : 1);
          if (c0 + cost < best[k][t + 1]) {
            best[k][t + 1] = c0 + cost;
            back[k][t + 1] = { i, t, kind: "tooth", z: zs, stump };
          }
        }
        // A scan usually stops part-way through its last tooth. Name it, but say it is cut off.
        if (t < T && present && stops[k].tail && w >= 3 && w < widths[t] - 1.5) {
          const cost = -1.2;
          if (c0 + cost < best[k][t + 1]) {
            best[k][t + 1] = c0 + cost;
            back[k][t + 1] = { i, t, kind: "tooth", z: 1.2, partial: true };
          }
        }
        if (!present && (hole || m < massRef * 0.3)) {
          // Edentulous span: skip as many positions as fit, or none if the scan simply ends.
          let skip = 0, sum = 0;
          for (let q = t; q < T; q++) {
            if (sum + widths[q] * 0.5 >= w) break;
            sum += widths[q];
            skip++;
          }
          // Teeth drift into a gap, so a slightly narrower space still counts one position.
          if (!skip && t < T && w > widths[t] * 0.45) skip = 1;
          const nt = t + skip;
          // Consuming empty space without moving on a position is how a count silently slips.
          const gapCost = skip ? 0.5 : 0.5 + w * 0.8;
          if (c0 + gapCost < best[k][nt]) {
            best[k][nt] = c0 + gapCost;
            back[k][nt] = { i, t, kind: "gap" };
          }
        }
      }
    }
  }
  let bi = 0, bt = 0, bc = 0;
  for (let i = 0; i < N; i++) {
    for (let t = 0; t <= T; t++) {
      // Whatever lies beyond the last accepted tooth is free, but only short of a full tooth is cheap.
      const left = Math.max(0, last - pos[i]);
      let material = 0;
      if (t < T && left > 3) {
        for (let q = stops[i].i; q !== end; q += dir) if (mass[q] > massRef * 0.3) material++;
      }
      // Scan left over with material on it is teeth not accounted for, and must cost more than a poor fit.
      const c = best[i][t] + 0.9 * (material / SAMPLES_PER_MM);
      if (c < bc) { bc = c; bi = i; bt = t; }
    }
  }
  const teeth = [];
  for (let i = bi, t = bt; back[i][t];) {
    const b = back[i][t];
    if (b.kind === "tooth") teeth.push({ pos: t - 1, from: stops[b.i].i, to: stops[i].i, z: b.z, prom: stops[i].prom, tail: !!stops[i].tail, stump: b.stump, partial: b.partial });
    i = b.i;
    t = b.t;
  }
  return { teeth: teeth.reverse(), cost: bc };
}

/* ---------------------------------------------------------- public API */

/**
 * Identifies the teeth on one jaw scan, in model coordinates.
 * `occlusal` is the rough direction the teeth point; `anchor` is { fdi, point } for a tooth whose
 * number is already known (a restoration in the case), used to resolve partial scans.
 */
export function detectTeeth(pos, idx, jaw, { occlusal, anchor = null } = {}) {
  const O = refineOcclusal(pos, idx, occlusal);
  const frame = makeFrame(O);
  const m = heightMap(pos, idx, frame);
  const cells = [];
  for (let k = 0; k < m.grid.length; k += 3) if (m.grid[k] > -1e8) cells.push(m.grid[k]);
  if (cells.length < 100) return { teeth: [], status: "no-surface", occlusal: O };
  const top = percentile(cells, 0.985);
  const curve = archCurve(m, top);
  if (!curve) return { teeth: [], status: "no-arch", occlusal: O };
  const { mass, normals, crest } = archProfile(m, curve, top);
  const massRef = percentile(mass, 0.7);
  const valleys = findValleys(mass, massRef);
  const pts = curve.points;
  const n = pts.length;
  // A whole arch is long enough to hold both sides of the mouth and clearly curves round.
  const archLength = n / SAMPLES_PER_MM;
  const archTurn = (turning(pts, 0, n - 1) * 180) / Math.PI;
  const { apex, symmetric } = archApex(curve);
  const fullArch = archLength > 60 && archTurn > 60 && symmetric;
  const S = jaw === "upper" ? V.mul(O, -1) : O;
  const widths = WIDTHS[jaw];
  const model = {
    jaw, occlusal: O, frame, map: m, curve, mass, crest, normals, valleys, top, fullArch, archLength, archTurn, status: "ok", anteriorKnown: fullArch, teeth: [],
  };

  let toRightIsLow = true;
  let midline = -1;
  if (fullArch) {
    // Anterior is opposite the opening of the U, and the patient's right follows from the handedness.
    const centre = uvToWorld(frame, curve.center);
    let A = V.sub(uvToWorld(frame, pts[apex]), centre);
    A = V.norm(V.sub(A, V.mul(O, V.dot(A, O))));
    model.anterior = A;
    model.apex = apex;
    const R = V.cross(A, S);
    model.right = R;
    toRightIsLow = V.dot(V.sub(uvToWorld(frame, pts[0]), uvToWorld(frame, pts[n - 1])), R) > 0;
    let best = null;
    const near = valleys.filter((v) => Math.abs(v.i - apex) < 7 * SAMPLES_PER_MM);
    for (const v of near.length ? near : [{ i: apex, prom: 0 }]) {
      const low = fitSide(valleys, v.i, 0, -1, widths, massRef, mass);
      const high = fitSide(valleys, v.i, n - 1, 1, widths, massRef, mass);
      // The midline should also be roughly where the two sides balance.
      const off = Math.abs(v.i - apex) / SAMPLES_PER_MM;
      // Left and right teeth come in matching widths, so a midline one tooth off shows up here.
      let mirror = 0;
      for (const a of low.teeth) {
        const b = high.teeth.find((x) => x.pos === a.pos);
        if (!b || a.stump || b.stump || a.partial || b.partial) continue;
        const d = Math.abs(a.from - a.to) / SAMPLES_PER_MM - Math.abs(b.from - b.to) / SAMPLES_PER_MM;
        mirror += d * d * 0.6;
      }
      const cost = low.cost + high.cost + mirror + off * off * 0.08 - Math.min(2, v.prom / (massRef * 0.08));
      if (!best || cost < best.cost) best = { cost, low, high, mid: v.i };
    }
    midline = best.mid;
    const lowSide = toRightIsLow ? 1 : 2;
    best.low.teeth.forEach((t) => model.teeth.push(makeTooth(jaw, lowSide, t, massRef)));
    best.high.teeth.forEach((t) => model.teeth.push(makeTooth(jaw, lowSide === 1 ? 2 : 1, t, massRef)));
  } else {
    // A partial scan has no midline to count from. Find the teeth; only an anchor can name them.
    const fit = fitPartial(valleys, n, widths, massRef, mass);
    fit.forEach((t) => model.teeth.push({ fdi: null, from: Math.min(t.from, t.to), to: Math.max(t.from, t.to), confidence: 0.4 }));
    model.status = "partial";
  }
  model.midline = midline;
  finishTeeth(model);
  if (anchor) applyAnchor(model, anchor);
  return model;
}

/** Partial scans: split at the clear valleys, keeping tooth-sized spans. */
function fitPartial(valleys, n, widths, massRef, mass) {
  const strong = valleys.filter((v) => v.prom > massRef * 0.06).map((v) => v.i);
  const cuts = [0, ...strong, n - 1];
  const out = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const w = (cuts[i + 1] - cuts[i]) / SAMPLES_PER_MM;
    let m = 0;
    for (let k = cuts[i]; k <= cuts[i + 1]; k++) m += mass[k];
    m /= cuts[i + 1] - cuts[i] + 1;
    if (w > 3.5 && w < 15 && m > massRef * 0.3) out.push({ from: cuts[i], to: cuts[i + 1] });
  }
  return out;
}

function makeTooth(jaw, quadrantSide, t, massRef) {
  const quadrant = jaw === "upper" ? quadrantSide : quadrantSide === 1 ? 4 : 3;
  const fdi = quadrant * 10 + t.pos + 1;
  const fit = Math.exp(-(t.z * t.z) / 4);
  const clear = clamp(t.prom / (massRef * 0.1), 0, 1);
  return { fdi, from: Math.min(t.from, t.to), to: Math.max(t.from, t.to), stump: !!t.stump, partial: !!t.partial, confidence: +(0.35 + 0.4 * fit + 0.25 * (t.tail ? 0.5 : clear)).toFixed(2) };
}

function uvToWorld(frame, p, h = 0) {
  return V.add(V.add(V.mul(frame.a, p[0]), V.mul(frame.b, p[1])), V.mul(frame.O, h));
}

function finishTeeth(model) {
  model.teeth.sort((p, q) => p.from - q.from);
  for (const t of model.teeth) toothGeometry(model, t);
  markLowPreparation(model.teeth);
}

/**
 * The width fit only calls a tooth a stump when it carries little material. A preparation that
 * keeps its width but lost its crown height is caught here: clearly below the arch and both neighbours.
 */
function markLowPreparation(teeth) {
  if (teeth.length < 3 || teeth.some((t) => t.stump)) return;
  const heights = teeth.map((t) => t.height).filter(Number.isFinite).sort((a, b) => a - b);
  const median = heights[heights.length >> 1];
  let pick = -1, depth = 0;
  teeth.forEach((t, i) => {
    if (t.partial || !Number.isFinite(t.height)) return;
    const prev = teeth[i - 1]?.height ?? Infinity, next = teeth[i + 1]?.height ?? Infinity;
    const drop = median - t.height;
    if (drop > 2.5 && t.height < prev - 1.2 && t.height < next - 1.2 && drop > depth) { pick = i; depth = drop; }
  });
  if (pick >= 0) { teeth[pick].stump = true; teeth[pick].lowCrown = true; }
}

export function toothGeometry(model, t) {
  const { curve, frame, crest, top } = model;
  const mid = Math.round((t.from + t.to) / 2);
  const p = curve.points[clamp(mid, 0, curve.points.length - 1)];
  let h = -1e9;
  for (let i = t.from; i <= t.to; i++) if (crest[i] > h) h = crest[i];
  t.width = (t.to - t.from) / SAMPLES_PER_MM;
  t.center = uvToWorld(frame, p, Math.min(h, top));
  t.height = h;
  return t;
}

/** Index of the arch sample nearest to a model-space point. */
export function archIndexAt(model, point) {
  const { frame, curve } = model;
  const u = V.dot(point, frame.a), v = V.dot(point, frame.b);
  let best = 0, bd = Infinity;
  curve.points.forEach((p, i) => {
    const d = (p[0] - u) ** 2 + (p[1] - v) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return { index: best, distance: Math.sqrt(bd) };
}

/** Which arch end runs toward the patient's right, as far as this model knows it. */
function orderedTeeth(model) {
  // Arch samples run in one direction; the numbering tells which way that is.
  const known = model.teeth.filter((t) => t.fdi);
  if (known.length < 2) return { list: model.teeth, reversed: false };
  const order = ARCH_ORDER[model.jaw];
  const a = known[0], b = known[known.length - 1];
  return { list: model.teeth, reversed: order.indexOf(a.fdi) > order.indexOf(b.fdi) };
}

/**
 * Names the tooth at position `i` and renumbers the others in sequence along the arch. Direction
 * comes from the existing numbering, or `reversed` when there is none yet.
 */
export function renumberFromTooth(model, i, fdi, reversed = null) {
  const order = ARCH_ORDER[jawOfFdi(fdi)];
  const dir = (reversed ?? orderedTeeth(model).reversed) ? -1 : 1;
  const at = order.indexOf(fdi);
  model.teeth.forEach((t, k) => {
    const o = at + (k - i) * dir;
    t.fdi = o >= 0 && o < order.length ? order[o] : null;
    t.manual = true;
  });
  model.status = "ok";
}

/**
 * The appointment names one tooth. A prepared stump can place that number, but the arch count
 * stays a proposal until the technician confirms it. A missing or ambiguous preparation is not
 * relabelled.
 */
export function anchorJobTooth(model, fdi) {
  if (!model || jawOfFdi(fdi) !== model.jaw) return model;
  model.jobTooth = fdi;
  if (model.status !== "anchored" && model.status !== "reviewed") {
    const stumps = model.teeth.filter((t) => t.stump && t.center);
    if (stumps.length === 1 && stumps[0].fdi !== fdi) applyAnchor(model, { fdi, point: stumps[0].center });
  }
  const hit = model.teeth.find((t) => t.fdi === fdi);
  model.jobToothConfirmed = model.status === "reviewed" || !!hit?.manual;
  return model;
}

function applyAnchor(model, anchor) {
  const { index } = archIndexAt(model, anchor.point);
  const i = model.teeth.findIndex((t) => index >= t.from && index <= t.to);
  if (i < 0) return;
  model.anchorChecked = { fdi: anchor.fdi, found: model.teeth[i].fdi };
  if (model.teeth[i].fdi === anchor.fdi) return;
  // The case states which tooth the restoration is on. That outranks the width fit.
  const reversed = model.anteriorKnown ? orderedTeeth(model).reversed : guessReversed(model, anchor);
  renumberFromTooth(model, i, anchor.fdi, reversed);
  model.teeth.forEach((t) => { t.manual = false; t.anchored = true; });
  model.status = "anchored";
}

/** Partial scan with an anchor: posterior teeth are wider, so width says which way the molars lie. */
function guessReversed(model, anchor) {
  const t = model.teeth;
  if (t.length < 2) return false;
  const half = t.length >> 1;
  const avg = (a) => a.reduce((s, x) => s + x.width, 0) / (a.length || 1);
  const lowWider = avg(t.slice(0, half)) > avg(t.slice(half));
  const order = ARCH_ORDER[jawOfFdi(anchor.fdi)];
  const idx = order.indexOf(anchor.fdi);
  // Position in the order: the molars lie toward the nearer end of it.
  const molarsAtOrderStart = idx < order.length / 2;
  return lowWider !== molarsAtOrderStart;
}

/* ---------------------------------------------------------- mesh labels */

/**
 * Assigns every scan vertex to a tooth (or -1 for gum and base). Each tooth is flooded over the
 * mesh from its crown, between its two cuts across the arch, and stops at the concave crease
 * where tooth meets gum.
 */
export function labelTeeth(mesh, model, { crease = -0.42 } = {}) {
  const { adj, count } = mesh;
  // Scan noise makes single-vertex curvature leaky, so the crease is read from a smoothed copy.
  const curv = mesh.smoothCurvature || (mesh.smoothCurvature = smoothField(mesh, mesh.curvature || (mesh.curvature = convexity(mesh)), 3));
  const { frame, curve, map, normals } = model;
  const label = new Int16Array(count).fill(-1);
  const pts = curve.points;
  const n = pts.length;
  // Each vertex's arch coordinates via a lookup on the height-map grid, far cheaper than a search.
  const coarse = 1;
  const gw = Math.ceil(map.w * (map.cell / coarse)) + 1, gh = Math.ceil(map.h * (map.cell / coarse)) + 1;
  const near = new Int32Array(gw * gh).fill(-1);
  const dist = new Float32Array(gw * gh).fill(1e9);
  for (let i = 0; i < n; i += 2) {
    const x = (pts[i][0] - map.u0) / coarse, y = (pts[i][1] - map.v0) / coarse;
    const R = 10;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = Math.round(x) + dx, cy = Math.round(y) + dy;
        if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        const k = cy * gw + cx;
        if (d < dist[k]) { dist[k] = d; near[k] = i; }
      }
    }
  }
  const archAt = (v) => {
    const x = Math.round((map.pu[v] - map.u0) / coarse), y = Math.round((map.pv[v] - map.v0) / coarse);
    if (x < 0 || y < 0 || x >= gw || y >= gh) return null;
    let i = near[y * gw + x];
    if (i < 0) return null;
    // Refine against neighbouring samples, since the grid only stored every other one.
    let bd = Infinity, bi = i;
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) {
      const d = (pts[j][0] - map.pu[v]) ** 2 + (pts[j][1] - map.pv[v]) ** 2;
      if (d < bd) { bd = d; bi = j; }
    }
    const nrm = normals[bi];
    const w = (map.pu[v] - pts[bi][0]) * nrm[0] + (map.pv[v] - pts[bi][1]) * nrm[1];
    return { i: bi, w };
  };
  const allowed = new Uint8Array(count);
  const toothOf = new Int16Array(n).fill(-1);
  model.teeth.forEach((t, ti) => {
    for (let i = t.from; i <= t.to; i++) toothOf[i] = ti;
  });
  const owner = new Int16Array(count).fill(-1);
  for (let v = 0; v < count; v++) {
    const a = archAt(v);
    if (!a || Math.abs(a.w) > 8) continue;
    const ti = toothOf[a.i];
    if (ti < 0) continue;
    // No crown is longer than this for its position, however far a flood might leak down the gum.
    const t = model.teeth[ti];
    const pos = t.fdi ? t.fdi % 10 : 5;
    const crown = t.stump ? 8 : pos <= 3 ? 11.5 : pos <= 5 ? 9.5 : 8.5;
    if (map.ph[v] < t.height - crown) continue;
    owner[v] = ti;
    allowed[v] = 1;
  }
  model.teeth.forEach((t, ti) => {
    // Start from the vertices near the crest of this span: they are always on the crown.
    const stack = [];
    for (let v = 0; v < count; v++) {
      if (owner[v] === ti && map.ph[v] > t.height - 1.2) {
        label[v] = ti;
        stack.push(v);
      }
    }
    let size = 0;
    while (stack.length) {
      const v = stack.pop();
      size++;
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
        const q = adj.list[j];
        if (label[q] !== -1 || owner[q] !== ti || curv[q] < crease) continue;
        label[q] = ti;
        stack.push(q);
      }
    }
    t.vertices = size;
  });
  tidyLabels(mesh, label, model);
  return label;
}

/**
 * Each tooth keeps only its largest connected patch, and small holes inside a tooth are filled.
 * Otherwise specks on the gum and scan noise on the crown would each get an outline of their own.
 */
function tidyLabels(mesh, label, model) {
  const { adj, count } = mesh;
  const seen = new Uint8Array(count);
  const best = new Map();
  const patches = [];
  for (let s = 0; s < count; s++) {
    if (seen[s]) continue;
    const id = label[s];
    const verts = [s];
    const touching = new Set();
    seen[s] = 1;
    for (let h = 0; h < verts.length; h++) {
      const v = verts[h];
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) {
        const q = adj.list[j];
        if (label[q] !== id) touching.add(label[q]);
        else if (!seen[q]) { seen[q] = 1; verts.push(q); }
      }
    }
    patches.push({ id, verts, touching });
    if (id >= 0 && verts.length > (best.get(id)?.verts.length ?? 0)) best.set(id, { verts });
  }
  for (const p of patches) {
    if (p.id >= 0 && best.get(p.id).verts !== p.verts) for (const v of p.verts) label[v] = -1;
  }
  for (const p of patches) {
    if (p.id !== -1 || p.verts.length > 1500) continue;
    const around = [...p.touching].filter((x) => x >= 0);
    if (around.length === 1 && p.touching.size === 1) for (const v of p.verts) label[v] = around[0];
  }
  model.teeth.forEach((t, i) => { t.vertices = best.get(i)?.verts.length ?? 0; });
}

function smoothField(mesh, field, passes) {
  const { adj, count } = mesh;
  let cur = field;
  for (let it = 0; it < passes; it++) {
    const next = new Float32Array(count);
    for (let v = 0; v < count; v++) {
      let s = cur[v];
      const n = adj.offset[v + 1] - adj.offset[v];
      for (let j = adj.offset[v]; j < adj.offset[v + 1]; j++) s += cur[adj.list[j]];
      next[v] = s / (n + 1);
    }
    cur = next;
  }
  return cur;
}

/** Mesh edges between one tooth and its surroundings, as world-space line segments. */
export function toothBoundaryLines(mesh, label, toWorld, selectedIndex = null) {
  const { pos, idx } = mesh;
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k], b = idx[t + (k + 1) % 3], c = idx[t + (k + 2) % 3];
      // Each triangle contributes the edge across which the label changes, once.
      if (label[a] === label[b] && label[a] !== label[c] &&
          (selectedIndex === null || label[a] === selectedIndex || label[c] === selectedIndex)) {
        const m = (x, y) => toWorld([(pos[x * 3] + pos[y * 3]) / 2, (pos[x * 3 + 1] + pos[y * 3 + 1]) / 2, (pos[x * 3 + 2] + pos[y * 3 + 2]) / 2]);
        out.push(...m(a, c), ...m(b, c));
      }
    }
  }
  return new Float32Array(out);
}

export const toothAt = (model, point) => {
  const { index, distance } = archIndexAt(model, point);
  if (distance > 9) return -1;
  return model.teeth.findIndex((t) => index >= t.from && index <= t.to);
};
