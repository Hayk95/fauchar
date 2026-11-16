/** Axis-aligned plane clipping. Original surfaces are split; no caps are invented. */
import { validateIndexedMesh } from "./mesh-quality.js";

export function clipMeshByPlane({ positions, indices, axis, offset, side }, progress = () => {}) {
  validateIndexedMesh(positions, indices);
  if (![0, 1, 2].includes(axis) || !Number.isFinite(offset) || ![1, -1].includes(side)) {
    throw new Error("Choose X, Y or Z, a finite plane coordinate and a side to keep.");
  }
  const points = [], triangles = [], originals = new Map(), crossings = new Map();
  let removedFaces = 0, splitFaces = 0;
  const distance = vertex => side * (positions[vertex * 3 + axis] - offset);
  const original = vertex => {
    if (!originals.has(vertex)) {
      originals.set(vertex, points.length / 3);
      points.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    }
    return originals.get(vertex);
  };
  const crossing = (a, b) => {
    if (distance(a) === 0) return original(a);
    if (distance(b) === 0) return original(b);
    const key = Math.min(a, b) * (positions.length / 3) + Math.max(a, b);
    if (!crossings.has(key)) {
      const t = (offset - positions[a * 3 + axis]) / (positions[b * 3 + axis] - positions[a * 3 + axis]);
      const p = [0, 1, 2].map(k => positions[a * 3 + k] * (1 - t) + positions[b * 3 + k] * t);
      p[axis] = offset;
      if (!p.every(Number.isFinite)) throw new Error("Plane intersection exceeds the supported coordinate range.");
      crossings.set(key, points.length / 3); points.push(...p);
    }
    return crossings.get(key);
  };
  for (let face = 0; face < indices.length / 3; face++) {
    const corners = Array.from(indices.subarray ? indices.subarray(face * 3, face * 3 + 3) : indices.slice(face * 3, face * 3 + 3));
    const inside = corners.map(v => distance(v) >= 0), count = inside.filter(Boolean).length;
    if (!count) { removedFaces++; continue; }
    if (count < 3) splitFaces++;
    const polygon = [];
    for (let k = 0; k < 3; k++) {
      const prev = (k + 2) % 3;
      if (inside[k] !== inside[prev]) polygon.push(crossing(corners[prev], corners[k]));
      if (inside[k]) polygon.push(original(corners[k]));
    }
    const unique = polygon.filter((v, i) => polygon.indexOf(v) === i);
    for (let k = 1; k < unique.length - 1; k++) triangles.push(unique[0], unique[k], unique[k + 1]);
    if (triangles.length / 3 > 750000 || points.length / 3 > 2000000) {
      throw new Error("The cut exceeds the 750,000 triangle / 2,000,000 vertex output budget.");
    }
    if (face % 16384 === 0) progress(face / (indices.length / 3));
  }
  if (!triangles.length) throw new Error("This plane leaves no triangles on the selected side. Change its coordinate or side.");
  const PositionArray = positions instanceof Float64Array ? Float64Array : Float32Array;
  progress(1);
  return { positions: PositionArray.from(points), indices: Uint32Array.from(triangles), removedFaces, splitFaces,
    unchanged: removedFaces === 0 && splitFaces === 0 };
}
