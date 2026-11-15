/** Places one closed tooth mesh onto a drawn margin. The cervical end sits on the line; height stays in millimetres. */
import { V } from "./mesh.js";

function principalAxes(positions) {
  const n = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < positions.length; i += 3) { cx += positions[i]; cy += positions[i + 1]; cz += positions[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - cx, y = positions[i + 1] - cy, z = positions[i + 2] - cz;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  const A = [xx, xy, xz, xy, yy, yz, xz, yz, zz];
  const R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const at = (m, r, c) => m[r * 3 + c];
  const set = (m, r, c, v) => { m[r * 3 + c] = v; };
  for (let iter = 0; iter < 24; iter++) {
    let p = 0, q = 1, big = Math.abs(at(A, 0, 1));
    if (Math.abs(at(A, 0, 2)) > big) { big = Math.abs(at(A, 0, 2)); p = 0; q = 2; }
    if (Math.abs(at(A, 1, 2)) > big) { big = Math.abs(at(A, 1, 2)); p = 1; q = 2; }
    const scale = Math.abs(at(A, 0, 0)) + Math.abs(at(A, 1, 1)) + Math.abs(at(A, 2, 2)) + 1;
    if (big < 1e-12 * scale) break;
    const app = at(A, p, p), aqq = at(A, q, q), apq = at(A, p, q);
    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t), s = t * c;
    for (let k = 0; k < 3; k++) {
      if (k === p || k === q) continue;
      const aik = at(A, k, p), ajk = at(A, k, q);
      const nik = c * aik - s * ajk, njk = s * aik + c * ajk;
      set(A, k, p, nik); set(A, p, k, nik); set(A, k, q, njk); set(A, q, k, njk);
    }
    set(A, p, p, c * c * app - 2 * s * c * apq + s * s * aqq);
    set(A, q, q, s * s * app + 2 * s * c * apq + c * c * aqq);
    set(A, p, q, 0); set(A, q, p, 0);
    for (let k = 0; k < 3; k++) {
      const vip = at(R, k, p), viq = at(R, k, q);
      set(R, k, p, c * vip - s * viq);
      set(R, k, q, s * vip + c * viq);
    }
  }
  return {
    center: [cx, cy, cz],
    axes: [[R[0], R[3], R[6]], [R[1], R[4], R[7]], [R[2], R[5], R[8]]],
  };
}

/** The wide, flat end of the mesh is the cervix. `dir` points from that end toward the chewing surface. */
function cervicalEnd(positions, dir) {
  const n = positions.length / 3;
  let hmin = Infinity, hmax = -Infinity;
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    h[i] = dir[0] * positions[i * 3] + dir[1] * positions[i * 3 + 1] + dir[2] * positions[i * 3 + 2];
    if (h[i] < hmin) hmin = h[i];
    if (h[i] > hmax) hmax = h[i];
  }
  const extent = Math.max(hmax - hmin, 1e-6);
  const cut = hmin + extent * 0.08;
  const ids = [];
  for (let i = 0; i < n; i++) if (h[i] <= cut) ids.push(i);
  if (ids.length < 6) return null;
  const cervical = [0, 0, 0];
  let hsum = 0, h2 = 0;
  for (const i of ids) {
    cervical[0] += positions[i * 3]; cervical[1] += positions[i * 3 + 1]; cervical[2] += positions[i * 3 + 2];
    hsum += h[i]; h2 += h[i] * h[i];
  }
  cervical[0] /= ids.length; cervical[1] /= ids.length; cervical[2] /= ids.length;
  const meanH = hsum / ids.length;
  const std = Math.sqrt(Math.max(0, h2 / ids.length - meanH * meanH));
  const radii = [];
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const q = [positions[i * 3] - cervical[0], positions[i * 3 + 1] - cervical[1], positions[i * 3 + 2] - cervical[2]];
    const along = V.dot(q, dir);
    const radial = Math.hypot(q[0] - dir[0] * along, q[1] - dir[1] * along, q[2] - dir[2] * along);
    if (h[i] <= cut) radii.push(radial);
    if (radial > maxR) maxR = radial;
  }
  radii.sort((a, b) => a - b);
  const rim = radii.slice(Math.floor(radii.length * 0.55));
  const radius = rim.reduce((s, r) => s + r, 0) / rim.length;
  const flat = 1 - std / extent;
  const wide = radius / (maxR || 1);
  return { score: flat * 0.7 + wide * 0.3, cervical, dir, radius };
}

function majorAxis(points, origin, normal) {
  const x0 = V.norm(V.cross(Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], normal));
  const y0 = V.cross(normal, x0);
  let xx = 0, xy = 0, yy = 0;
  for (const p of points) {
    const q = V.sub(p, origin);
    const u = V.dot(q, x0), v = V.dot(q, y0);
    xx += u * u; xy += u * v; yy += v * v;
  }
  const phi = 0.5 * Math.atan2(2 * xy, xx - yy);
  return V.norm(V.add(V.mul(x0, Math.cos(phi)), V.mul(y0, Math.sin(phi))));
}

export function seatTooth(positions, margin, axis) {
  if (!positions || positions.length < 30) throw new Error("The dropped STL has no usable tooth surface.");
  if (!margin || margin.length < 8) throw new Error("Draw a closed margin before placing the STL.");
  const z = V.norm(axis);
  if (!axis || axis.length !== 3 || V.len(z) < 0.9) throw new Error("Set the insertion direction before placing the STL.");
  const { axes } = principalAxes(positions);
  let best = null;
  for (const axisDir of axes) {
    for (const sign of [1, -1]) {
      const end = cervicalEnd(positions, V.mul(axisDir, sign));
      if (end && (!best || end.score > best.score)) best = end;
    }
  }
  if (!best || best.radius < 0.4) throw new Error("Could not find the cervical end of this STL.");
  const marginCenter = V.mul(margin.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / margin.length);
  let marginR = 0;
  for (const p of margin) {
    const q = V.sub(p, marginCenter);
    const along = V.dot(q, z);
    marginR += Math.hypot(q[0] - z[0] * along, q[1] - z[1] * along, q[2] - z[2] * along);
  }
  marginR /= margin.length;
  const scale = marginR / best.radius;
  if (!(scale > 0.25 && scale < 4)) throw new Error("This STL does not match the margin size.");
  const toothMajor = majorAxis(
    Array.from({ length: positions.length / 3 }, (_, i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]),
    best.cervical, best.dir,
  );
  let marginMajor = majorAxis(margin, marginCenter, z);
  if (V.dot(toothMajor, marginMajor) < 0) marginMajor = V.mul(marginMajor, -1);
  const srcX = toothMajor;
  const srcY = V.cross(best.dir, srcX);
  const dstX = marginMajor;
  const dstY = V.cross(z, dstX);
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const q = [positions[i] - best.cervical[0], positions[i + 1] - best.cervical[1], positions[i + 2] - best.cervical[2]];
    const lx = V.dot(q, srcX) * scale, ly = V.dot(q, srcY) * scale, lz = V.dot(q, best.dir);
    out[i] = marginCenter[0] + dstX[0] * lx + dstY[0] * ly + z[0] * lz;
    out[i + 1] = marginCenter[1] + dstX[1] * lx + dstY[1] * ly + z[1] * lz;
    out[i + 2] = marginCenter[2] + dstX[2] * lx + dstY[2] * ly + z[2] * lz;
  }
  return {
    positions: out,
    frame: { center: marginCenter, occlusal: z, mesial: dstX, facial: dstY, rimRadius: marginR },
  };
}
