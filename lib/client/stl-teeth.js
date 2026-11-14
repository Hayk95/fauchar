/**
 * Dental scan orientation for jaw STLs. Tooth identification lives in lib/client/cad/teeth.js.
 */

function toWorld(x, y, z, upAxis, invert = false) {
  let p = upAxis === "z" ? [x, z, -y] : [x, y, z];
  if (invert) p = [p[0], -p[1], p[2]];
  return p;
}

/**
 * Guess scanner up-axis + whether occlusal needs flipping so lower sits below upper
 * and crowns point toward the bite (not into the grid).
 */
export function detectScanOrientation(meshes) {
  // meshes: [{ jaw, positions }]
  const sample = (positions, maxN = 25000) => {
    const n = positions.length / 3;
    const step = Math.max(1, Math.floor(n / maxN));
    const xs = [];
    const ys = [];
    const zs = [];
    for (let i = 0; i < n; i += step) {
      xs.push(positions[i * 3]);
      ys.push(positions[i * 3 + 1]);
      zs.push(positions[i * 3 + 2]);
    }
    const span = (a) => Math.max(...a) - Math.min(...a);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return { spanX: span(xs), spanY: span(ys), spanZ: span(zs), meanX: mean(xs), meanY: mean(ys), meanZ: mean(zs) };
  };

  /** How clearly "up" (+worldY) is the occlusal side for a lower (or −Y for upper). */
  const protrusionClarity = (positions, upAxis, invert, jaw) => {
    const n = positions.length / 3;
    const step = Math.max(1, Math.floor(n / 40000));
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    const pts = [];
    for (let i = 0; i < n; i += step) {
      const p = toWorld(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], upAxis, invert);
      pts.push(p);
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    const cell = Math.max(0.8, Math.hypot(maxX - minX, maxZ - minZ) / 80);
    const gw = Math.max(8, Math.ceil((maxX - minX) / cell) + 1);
    const gh = Math.max(8, Math.ceil((maxZ - minZ) / cell) + 1);
    const hi = new Float32Array(gw * gh);
    const lo = new Float32Array(gw * gh);
    const hit = new Uint8Array(gw * gh);
    hi.fill(-1e9);
    lo.fill(1e9);
    for (const p of pts) {
      const ix = Math.min(gw - 1, Math.max(0, Math.floor((p[0] - minX) / cell)));
      const iz = Math.min(gh - 1, Math.max(0, Math.floor((p[2] - minZ) / cell)));
      const k = iz * gw + ix;
      hit[k] = 1;
      if (p[1] > hi[k]) hi[k] = p[1];
      if (p[1] < lo[k]) lo[k] = p[1];
    }
    let sum = 0;
    let count = 0;
    for (let k = 0; k < hit.length; k++) {
      if (!hit[k]) continue;
      // Lower: tips should be the high side; upper: tips the low side
      const tip = jaw === "upper" ? lo[k] : hi[k];
      const base = jaw === "upper" ? hi[k] : lo[k];
      sum += tip - base;
      count++;
    }
    return count ? sum / count : 0;
  };

  const stats = meshes.map((m) => ({ jaw: m.jaw, positions: m.positions, ...sample(m.positions) }));
  if (!stats.length) return { upAxis: "z", invert: false };

  const avg = {
    x: stats.reduce((s, t) => s + t.spanX, 0) / stats.length,
    y: stats.reduce((s, t) => s + t.spanY, 0) / stats.length,
    z: stats.reduce((s, t) => s + t.spanZ, 0) / stats.length,
  };
  let upAxis = "z";
  const widest = Math.max(avg.x, avg.y, avg.z);
  if (avg.y === widest && avg.z < avg.y * 0.55 && avg.x < avg.y * 0.85) upAxis = "y";
  else if (avg.z >= avg.y * 0.35) upAxis = "z";

  const upper = stats.find((s) => s.jaw === "upper");
  const lower = stats.find((s) => s.jaw === "lower");
  const probe = lower || upper;
  let invert = false;
  if (probe) {
    const s0 = protrusionClarity(probe.positions, upAxis, false, probe.jaw);
    const s1 = protrusionClarity(probe.positions, upAxis, true, probe.jaw);
    // Prefer orientation where tips clearly sit on the expected side of the gingiva.
    invert = s1 > s0 + 0.15;
  }
  if (upper && lower) {
    const meanVert = (s, inv) => {
      const m = upAxis === "z" ? s.meanZ : s.meanY;
      return inv ? -m : m;
    };
    // After orient, upper centroid should sit above lower.
    if (meanVert(lower, invert) > meanVert(upper, invert)) invert = !invert;
  }

  return { upAxis, invert };
}
