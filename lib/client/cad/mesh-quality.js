/** Mesh inspection and conservative face cleanup. Coordinates and vertex IDs stay fixed. */
const MAX_FACES = 750_000;
const MAX_VERTICES = 2_000_000;

export function validateIndexedMesh(positions, indices) {
  if (!positions?.length || positions.length % 3 || !indices?.length || indices.length % 3) {
    throw new Error("Choose a non-empty indexed triangle mesh.");
  }
  const vertices = positions.length / 3;
  if (vertices > MAX_VERTICES || indices.length / 3 > MAX_FACES) {
    throw new Error("Mesh inspection supports up to 750,000 triangles and 2,000,000 vertices per object.");
  }
  for (const value of positions) {
    if (!Number.isFinite(value)) throw new Error("The mesh contains non-finite coordinates.");
  }
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertices) throw new Error("The mesh contains an invalid vertex index.");
  }
}

function faceKey(a, b, c) {
  const low = Math.min(a, b, c), high = Math.max(a, b, c);
  return `${low}:${a + b + c - low - high}:${high}`;
}

function doubleArea(positions, a, b, c) {
  const ax = positions[b * 3] - positions[a * 3];
  const ay = positions[b * 3 + 1] - positions[a * 3 + 1];
  const az = positions[b * 3 + 2] - positions[a * 3 + 2];
  const bx = positions[c * 3] - positions[a * 3];
  const by = positions[c * 3 + 1] - positions[a * 3 + 1];
  const bz = positions[c * 3 + 2] - positions[a * 3 + 2];
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}

export function inspectMesh({ positions, indices }, progress = () => {}) {
  validateIndexedMesh(positions, indices);
  const count = indices.length / 3, vertices = positions.length / 3;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const rank = new Uint8Array(count), used = new Uint8Array(vertices);
  const faceSeen = new Set(), edges = new Map();
  const area = new Float64Array(count);
  let degenerateFaces = 0, duplicateFaces = 0;
  function root(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function join(a, b) {
    a = root(a); b = root(b);
    if (a === b) return;
    if (rank[a] < rank[b]) [a, b] = [b, a];
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
  }
  for (let face = 0; face < count; face++) {
    const a = indices[face * 3], b = indices[face * 3 + 1], c = indices[face * 3 + 2];
    used[a] = used[b] = used[c] = 1;
    area[face] = doubleArea(positions, a, b, c) / 2;
    if (area[face] < 5e-13) degenerateFaces++;
    const key = faceKey(a, b, c);
    if (faceSeen.has(key)) duplicateFaces++; else faceSeen.add(key);
    // Repeated vertex IDs cannot form a valid edge neighborhood.
    if (a === b || b === c || c === a) continue;
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      const edgeKey = Math.min(from, to) * vertices + Math.max(from, to);
      const direction = from < to ? 1 : -1;
      const previous = edges.get(edgeKey);
      if (previous) {
        previous.count++;
        previous.direction += direction;
        join(face, previous.face);
      } else edges.set(edgeKey, { face, count: 1, direction });
    }
    if (face % 16384 === 0) progress(face / count * .7);
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0;
  for (const edge of edges.values()) {
    if (edge.count === 1) boundaryEdges++;
    else if (edge.count > 2) nonManifoldEdges++;
    else if (edge.direction !== 0) inconsistentEdges++;
  }
  const groups = new Map();
  for (let face = 0; face < count; face++) {
    const id = root(face);
    const group = groups.get(id) || { root: id, triangles: 0, area: 0 };
    group.triangles++; group.area += area[face]; groups.set(id, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.triangles - a.triangles || a.root - b.root);
  const ids = new Map(sorted.map((group, index) => [group.root, index]));
  const componentIds = new Int32Array(count);
  for (let face = 0; face < count; face++) componentIds[face] = ids.get(root(face));
  progress(1);
  return {
    componentIds,
    report: {
      vertices, triangles: count, unusedVertices: used.reduce((sum, value) => sum + 1 - value, 0),
      degenerateFaces, duplicateFaces, boundaryEdges, nonManifoldEdges, inconsistentEdges,
      components: sorted.map((group, id) => ({ id, triangles: group.triangles, area: group.area })),
      closedOriented: boundaryEdges === 0 && nonManifoldEdges === 0 && inconsistentEdges === 0 && degenerateFaces === 0 && duplicateFaces === 0,
    },
  };
}

export function cleanMeshFaces({ positions, indices }, progress = () => {}) {
  validateIndexedMesh(positions, indices);
  const seen = new Set(), keptFaces = [], cleaned = [];
  for (let face = 0; face < indices.length / 3; face++) {
    const a = indices[face * 3], b = indices[face * 3 + 1], c = indices[face * 3 + 2];
    const key = faceKey(a, b, c);
    if (doubleArea(positions, a, b, c) < 1e-12 || seen.has(key)) continue;
    seen.add(key); keptFaces.push(face); cleaned.push(a, b, c);
  }
  if (!keptFaces.length) throw new Error("Cleanup would leave no usable triangles.");
  return {
    positions: positions.slice(), indices: Uint32Array.from(cleaned), keptFaces: Uint32Array.from(keptFaces),
    removedFaces: indices.length / 3 - keptFaces.length,
    ...inspectMesh({ positions, indices: cleaned }, progress),
  };
}

export function extractMeshComponent({ positions, indices, componentIds, componentId }) {
  validateIndexedMesh(positions, indices);
  if (!componentIds || componentIds.length !== indices.length / 3 || !Number.isInteger(componentId) || componentId < 0) {
    throw new Error("Inspect the mesh and choose a connected component.");
  }
  const remap = new Map(), points = [], triangles = [];
  for (let face = 0; face < componentIds.length; face++) {
    if (componentIds[face] !== componentId) continue;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = indices[face * 3 + corner];
      if (!remap.has(vertex)) {
        remap.set(vertex, points.length / 3);
        points.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
      }
      triangles.push(remap.get(vertex));
    }
  }
  if (!triangles.length) throw new Error("The selected component no longer exists.");
  const PositionArray = positions instanceof Float64Array ? Float64Array : Float32Array;
  return { positions: PositionArray.from(points), indices: Uint32Array.from(triangles) };
}
