/**
 * Inside of the crown: ring sampling, undercut block-out and milling-tool compensation.
 *
 * Cylindrical model about the insertion axis z through the margin centre. For every meridian (one margin
 * segment, outward direction `dirs[i]`) and every height the preparation has a radius; the crown is seated
 * along z, so the intaglio radius at a height can never be smaller than the largest preparation radius above
 * that height (block-out, optionally flaring by a small angle; optionally left alone in a zone above the
 * margin). A milled intaglio is what the tool can sweep, so the designed radial profile is widened until its
 * morphological opening by the tool tip (ball or bullnose, entering from the margin) still contains the ideal
 * profile. Both work per meridian in the (height, radius) plane and only ever move intaglio points outward.
 * Original implementation of publicly documented DentalCAD behaviour; no vendor code.
 */
import { V, smoothstep } from "./mesh.js";

export const INTAGLIO_DEFAULTS = {
  blockout: true, blockoutAngle: 0, blockoutZone: 0.3,
  toolCompensation: false, toolDiameter: 1, bullnose: false, toolFlat: 0,
};

/** Validated options with defaults for anything missing. Throws on values outside the supported range. */
export function intaglioOptions(src = {}) {
  const o = { ...INTAGLIO_DEFAULTS };
  for (const k of Object.keys(o)) {
    if (src[k] === undefined || src[k] === null) continue;
    o[k] = typeof o[k] === "boolean" ? !!src[k] : Number(src[k]);
  }
  if (!o.bullnose) o.toolFlat = 0;
  const bad = ![o.blockoutAngle, o.blockoutZone, o.toolDiameter, o.toolFlat].every(Number.isFinite)
    || o.blockoutAngle < 0 || o.blockoutAngle > 10 || o.blockoutZone < 0 || o.blockoutZone > 2
    || o.toolDiameter < 0.3 || o.toolDiameter > 3 || o.toolFlat < 0 || o.toolFlat > 100;
  if (bad) throw new Error("Block-out or milling tool settings are outside the supported range.");
  return o;
}

/**
 * Intaglio rings: ring 0 on the margin (offset by the margin gap), rings above sampled straight down the
 * insertion axis inside the margin footprint, offset by the cement gap. Appends vertices/triangles through
 * the caller's `push` and `addTri`.
 */
export function buildIntaglioRings({ loop, center, z, sample, rings, segments, gap, marginGap, push, addTri }) {
  const inner = [];
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
  return { inner, innerTop, dirs };
}

const STEP = 0.05;

/**
 * Block out undercuts and compensate the milling tool on intaglio rings built by `buildIntaglioRings`.
 * Mutates `vertices` (and `loop` where the crown edge itself has to open at zone 0).
 * @returns {{ blockout: object|null, tool: object|null }} what was changed, for the toast and the saved source.
 */
export function shapeIntaglio({ vertices, inner, innerTop, loop, center, z, dirs, scan, gap, marginGap, options }) {
  const o = intaglioOptions(options);
  const rings = inner.length, segments = dirs.length;
  const at = id => [vertices[id * 3], vertices[id * 3 + 1], vertices[id * 3 + 2]];
  const set = (id, p) => { vertices[id * 3] = p[0]; vertices[id * 3 + 1] = p[1]; vertices[id * 3 + 2] = p[2]; };
  const heightOf = p => V.dot(V.sub(p, center), z);
  const radiusOf = (p, i) => V.dot(V.sub(p, center), dirs[i]);
  const cementAt = r => marginGap + (gap - marginGap) * Math.min(1, (r / rings) * 8);
  const marginH = loop.map(heightOf);
  const topH = heightOf(at(innerTop));
  const h0 = Math.min(...marginH) - STEP;
  const N = Math.max(8, Math.min(800, Math.ceil((topH - h0) / STEP) + 2));
  const hAt = k => h0 + k * STEP;
  const lerpAt = (arr, h) => {
    const x = (h - h0) / STEP, k = Math.max(0, Math.min(N - 2, Math.floor(x))), t = Math.max(0, Math.min(1, x - k));
    const a = arr[k], b = arr[k + 1];
    if (!Number.isFinite(a)) return b;
    if (!Number.isFinite(b)) return a;
    return a + (b - a) * t;
  };
  const report = { blockout: null, tool: null };

  if (o.blockout) {
    const tan = Math.tan((o.blockoutAngle * Math.PI) / 180);
    let maxDepth = 0, affected = 0;
    for (let i = 0; i < segments; i++) {
      const rimR = radiusOf(loop[i], i);
      // Preparation radius at every height on this meridian: a ray from the axis outward leaves the die
      // through its own surface first. Only a profile continuous from the margin counts; a jump outward is a
      // neighbour, gingiva or scan artefact, never the die.
      const prep = new Float64Array(N).fill(-Infinity);
      let ref = rimR, seen = false;
      for (let k = 0; k < N; k++) {
        const h = hAt(k);
        if (h < marginH[i] - 1e-6 || h > topH + 1e-6) continue;
        const hit = scan.raycast(V.add(center, V.mul(z, h)), dirs[i]);
        if (!hit || hit.t > rimR + 1.2) { if (seen) break; continue; }
        if (hit.t > ref + 0.25) continue;
        prep[k] = hit.t; ref = hit.t; seen = true;
      }
      // One noisy row must not block out the whole wall below it: median of three rows.
      const med = Float64Array.from(prep);
      for (let k = 1; k < N - 1; k++) {
        const a = prep[k - 1], b = prep[k], c = prep[k + 1];
        if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) med[k] = a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
      }
      // Hull: nothing above may be wider than the wall here; the block-out angle lets the wall flare downward.
      const hull = new Float64Array(N);
      let run = -Infinity;
      for (let k = N - 1; k >= 0; k--) { run = Math.max(med[k], Number.isFinite(run) ? run + STEP * tan : run); hull[k] = run; }
      let moved = false;
      for (let r = 0; r < rings; r++) {
        const id = inner[r][i], p = at(id), h = heightOf(p), rho = radiusOf(p, i);
        // An undercut means die material above this point at a larger radius; a point on a flat top is not
        // under anything, so the hull is read a little above the point.
        const need = lerpAt(hull, h + 0.08) + cementAt(r);
        if (!Number.isFinite(need)) continue;
        // Zone 0 blocks straight down to the crown edge (open margin where the die is undercut there);
        // a zone keeps the edge on the margin and blends the block-out in above it.
        const w = o.blockoutZone > 0 ? (r === 0 ? 0 : smoothstep(0, o.blockoutZone, h - marginH[i])) : 1;
        const d = Math.max(0, need - rho) * w;
        if (d < 1e-4) continue;
        set(id, V.add(p, V.mul(dirs[i], d)));
        if (r === 0) loop[i] = V.add(loop[i], V.mul(dirs[i], d));
        maxDepth = Math.max(maxDepth, d); moved = true;
      }
      if (moved) affected++;
    }
    report.blockout = { maxDepth, fraction: affected / segments, angle: o.blockoutAngle, zone: o.blockoutZone };
  }

  if (o.toolCompensation) {
    const R = o.toolDiameter / 2, a = (R * o.toolFlat) / 100, c = Math.max(1e-3, R - a);
    const m = Math.max(1, Math.round(c / STEP));
    // Half-width of the tool tip `j` grid rows above its corner centre; the shank behind it is R wide.
    const W = j => { const dh = Math.min(c, j * STEP); return a + Math.sqrt(Math.max(0, c * c - dh * dh)); };
    let maxRelief = 0, wallRelief = 0;
    for (let i = 0; i < segments; i++) {
      // Envelope of this meridian: the largest intaglio radius at every height, margin to apex.
      const ids = inner.map(ring => ring[i]); ids.push(innerTop);
      const pts = ids.map(at);
      const f = new Float64Array(N).fill(NaN);
      for (let e = 0; e + 1 < pts.length; e++) {
        const ha = heightOf(pts[e]), hb = heightOf(pts[e + 1]);
        const ra = Math.max(0, radiusOf(pts[e], i)), rb = Math.max(0, radiusOf(pts[e + 1], i));
        const k0 = Math.max(0, Math.ceil((Math.min(ha, hb) - h0) / STEP)), k1 = Math.min(N - 1, Math.floor((Math.max(ha, hb) - h0) / STEP));
        for (let k = k0; k <= k1; k++) {
          const t = Math.abs(hb - ha) < 1e-9 ? 0 : (hAt(k) - ha) / (hb - ha);
          const r = ra + (rb - ra) * t;
          if (!(f[k] >= r)) f[k] = r;
        }
      }
      // The crown edge stays on the margin and, within the zone, the inside returns to the preparation; a die
      // that is wider there than at the drawn margin can never be reached by the tool anyway. The tool is
      // taken to enter at the top of that zone, so no relief is demanded from rows it cannot help.
      const start = marginH[i] + Math.max(o.blockoutZone, 0.3);
      let kLo = 0; while (kLo < N && (Number.isNaN(f[kLo]) || hAt(kLo) < start)) kLo++;
      let kHi = N - 1; while (kHi >= 0 && Number.isNaN(f[kHi])) kHi--;
      if (kHi - kLo < m + 2) continue;
      for (let k = kLo + 1; k <= kHi; k++) if (Number.isNaN(f[k])) f[k] = f[k - 1];
      // Opening of a radial profile by the tool: centres that fit (erosion), then what they sweep (dilation).
      const open = p => {
        const fe = new Float64Array(N).fill(-Infinity), fo = new Float64Array(N).fill(-Infinity);
        let below = Infinity;
        for (let k = kLo; k <= kHi; k++) {
          below = Math.min(below, p[k]);
          let v = below - R;
          for (let j = 0; j <= m && k + j <= kHi; j++) v = Math.min(v, p[k + j] - W(j));
          fe[k] = v >= 0 ? v : -Infinity;
        }
        let above = -Infinity;
        for (let k = kHi; k >= kLo; k--) {
          above = Math.max(above, fe[k]);
          let v = above + R;
          for (let j = 0; j <= m && k - j >= kLo; j++) v = Math.max(v, fe[k - j] + W(j));
          fo[k] = v;
        }
        return fo;
      };
      // Widen the designed profile until the milled result contains the ideal one. The relief at any height
      // never exceeds the tool radius: a void the tool cannot enter at all is reported, not invented.
      const d = Float64Array.from(f);
      for (let it = 0; it < 12; it++) {
        const fo = open(d);
        let worst = 0;
        for (let k = kLo; k <= kHi; k++) {
          const def = Math.min(f[k] + R - d[k], f[k] - fo[k]);
          if (def > 1e-9) { d[k] += def; worst = Math.max(worst, def); }
        }
        if (worst < 0.003) break;
      }
      const relief = new Float64Array(N);
      for (let k = 0; k < N; k++) relief[k] = Number.isFinite(d[k]) && Number.isFinite(f[k]) ? Math.max(0, d[k] - f[k]) : 0;
      // Only the envelope moves (a fissure at the same height as the wall is not the wall), never the edge,
      // and never wider than the rings below it: the inside must not fold over the crown edge.
      let widest = radiusOf(at(inner[0][i]), i);
      for (let r = 1; r < rings; r++) {
        const id = inner[r][i], p = at(id), h = heightOf(p), rho = radiusOf(p, i);
        if (rho < lerpAt(f, h) - 0.03) { widest = Math.max(widest, rho); continue; }
        let dlt = lerpAt(relief, h) * smoothstep(start, start + 0.3, h);
        dlt = Math.max(0, Math.min(dlt, widest + 0.02 - rho));
        widest = Math.max(widest, rho + dlt);
        if (dlt < 1e-4) continue;
        set(id, V.add(p, V.mul(dirs[i], dlt)));
        maxRelief = Math.max(maxRelief, dlt);
        // A ridge or peak at the top is narrower than the tool far more often than the axial wall is.
        if (h < topH - 0.6) wallRelief = Math.max(wallRelief, dlt);
      }
    }
    report.tool = { maxRelief, wallRelief, diameter: o.toolDiameter, bullnose: o.bullnose, flat: o.toolFlat };
  }
  return report;
}
