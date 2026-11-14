/**
 * FAUCHAR Workspace — STL parsing worker.
 *
 * Parses binary or ASCII STL, validates it, welds coincident vertices,
 * computes smooth normals, a unique edge list (for wireframe) and model
 * statistics. Everything runs locally; nothing is uploaded.
 *
 * In:  { id, buffer: ArrayBuffer, name }
 * Out: { id, type: "progress", value } | { id, type: "done", mesh, stats } | { id, type: "error", message }
 */
"use strict";

const MAX_TRIANGLES = 6_000_000;

self.onmessage = (event) => {
  const { id, buffer, name } = event.data;
  try {
    const result = processSTL(buffer, (value) => self.postMessage({ id, type: "progress", value }));
    const { mesh, stats } = result;
    self.postMessage({ id, type: "done", mesh, stats, name }, [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer, mesh.edges.buffer]);
  } catch (error) {
    self.postMessage({ id, type: "error", message: error.message || String(error) });
  }
};

function processSTL(buffer, progress) {
  if (!buffer || buffer.byteLength < 15) throw new Error("The file is empty or too small to be an STL mesh.");
  const raw = isBinary(buffer) ? parseBinary(buffer) : parseASCII(buffer);
  const triCount = raw.length / 9;
  if (triCount === 0) throw new Error("The file contains no triangles.");
  if (triCount > MAX_TRIANGLES) throw new Error(`The mesh has ${triCount.toLocaleString("en-US")} triangles; the limit is ${MAX_TRIANGLES.toLocaleString("en-US")}.`);
  for (let i = 0; i < raw.length; i += 997) {
    if (!Number.isFinite(raw[i])) throw new Error("The file contains invalid (non-numeric) vertex coordinates.");
  }
  progress(0.35);
  return weld(raw, progress);
}

function isBinary(buffer) {
  if (buffer.byteLength < 84) return false;
  const count = new DataView(buffer).getUint32(80, true);
  if (84 + count * 50 === buffer.byteLength) return true;
  // Some exporters write "solid" in binary headers; fall back to sniffing for ASCII keywords.
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength))).toLowerCase();
  return !(head.trimStart().startsWith("solid") && head.includes("facet"));
}

function parseBinary(buffer) {
  const dv = new DataView(buffer);
  const count = dv.getUint32(80, true);
  if (84 + count * 50 > buffer.byteLength) throw new Error("The binary STL is truncated: the header declares more triangles than the file contains.");
  const out = new Float32Array(count * 9);
  let o = 84;
  for (let t = 0; t < count; t++) {
    o += 12;
    for (let k = 0; k < 9; k++) {
      out[t * 9 + k] = dv.getFloat32(o, true);
      o += 4;
    }
    o += 2;
  }
  return out;
}

function parseASCII(buffer) {
  const text = new TextDecoder().decode(buffer);
  if (!/^\s*solid/i.test(text) || !/facet/i.test(text)) throw new Error("This does not look like an STL file (no binary header or ASCII \"solid\" block).");
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const values = [];
  let m;
  while ((m = re.exec(text))) values.push(+m[1], +m[2], +m[3]);
  if (values.length % 9 !== 0) throw new Error("The ASCII STL has an incomplete facet (vertex count is not a multiple of three).");
  return new Float32Array(values);
}

function weld(raw, progress) {
  const triCount = raw.length / 9;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < raw.length; i += 3) {
    const x = raw[i], y = raw[i + 1], z = raw[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const eps = diag * 1e-6;
  const inv = 1 / eps;

  const map = new Map();
  const positions = [];
  const indices = new Uint32Array(triCount * 3);
  let degenerate = 0;
  for (let v = 0; v < triCount * 3; v++) {
    const x = raw[v * 3], y = raw[v * 3 + 1], z = raw[v * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let index = map.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      map.set(key, index);
      positions.push(x, y, z);
    }
    indices[v] = index;
    if (v % 300000 === 0) progress(0.35 + 0.35 * (v / (triCount * 3)));
  }
  const vCount = positions.length / 3;
  const pos = new Float32Array(positions);

  // Normals, area, signed volume, edge use counts.
  const nor = new Float32Array(pos.length);
  let area = 0;
  let volume = 0;
  const edgeUse = new Map();
  const edgeList = [];
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    area += 0.5 * Math.hypot(nx, ny, nz);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (const v of [a, b, c]) {
      nor[v * 3] += nx;
      nor[v * 3 + 1] += ny;
      nor[v * 3 + 2] += nz;
    }
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const lo = p < q ? p : q;
      const hi = p < q ? q : p;
      const key = lo * vCount + hi;
      const n = edgeUse.get(key);
      if (n === undefined) {
        edgeUse.set(key, 1);
        edgeList.push(lo, hi);
      } else edgeUse.set(key, n + 1);
    }
    if (t % 200000 === 0) progress(0.7 + 0.25 * (t / triCount));
  }
  for (let v = 0; v < nor.length; v += 3) {
    const l = Math.hypot(nor[v], nor[v + 1], nor[v + 2]) || 1;
    nor[v] /= l;
    nor[v + 1] /= l;
    nor[v + 2] /= l;
  }
  let boundary = 0;
  let nonManifold = 0;
  for (const n of edgeUse.values()) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
  }
  progress(1);

  const closed = boundary === 0 && nonManifold === 0;
  return {
    mesh: { positions: pos, normals: nor, indices, edges: new Uint32Array(edgeList) },
    stats: {
      triangles: triCount,
      vertices: vCount,
      bbox: [minX, minY, minZ, maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      area,
      volume: closed ? Math.abs(volume) : null,
      boundaryEdges: boundary,
      nonManifoldEdges: nonManifold,
      degenerate,
      closed,
    },
  };
}
