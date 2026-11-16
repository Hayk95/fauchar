/** User-owned STL library; browser-local, never uploaded to an inference service. */
import { meshStats, parseBinarySTL } from "./mesh.js";
export function validateLibraryMesh(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > 20 * 1024 * 1024) throw new Error("Library STL must be binary and at most 20 MB.");
  const geometry = parseBinarySTL(buffer);
  if (geometry.indices.length / 3 > 100000) throw new Error("Use a library STL with at most 100,000 triangles.");
  if (!geometry.positions.length || [...geometry.positions].some(v => !Number.isFinite(v))) throw new Error("Library geometry contains invalid coordinates.");
  const stats = meshStats(geometry.positions, geometry.indices);
  if (stats.invalid || stats.degenerate || !stats.closed || stats.volume <= 0) throw new Error("Library restorations must be closed, non-degenerate meshes with positive volume.");
  return { geometry, stats };
}
function database() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Browser storage is unavailable.")); return; }
    const request = indexedDB.open("fauchar-restoration-library", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("models", { keyPath: "id" }); request.result.createObjectStore("catalog", { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other library tabs to upgrade storage."));
  });
}
async function transaction(mode, run, stores = ["models"]) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode), request = run(tx);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || new Error("Library storage failed."));
      tx.onabort = () => reject(tx.error || new Error("Library storage was interrupted."));
    });
  } finally { db.close(); }
}
export async function addLibraryModel(file, fdi) {
  const buffer = await file.arrayBuffer(), { stats } = validateLibraryMesh(buffer);
  const id = crypto.randomUUID();
  const model = { id, name: file.name.replace(/\.stl$/i, "").slice(0, 100), fdi, buffer, triangles: stats.triangles, created: Date.now() };
  const { buffer: bytes, ...metadata } = model;
  await transaction("readwrite", tx => { tx.objectStore("catalog").put(metadata); return tx.objectStore("models").put({ ...metadata, buffer: bytes }); }, ["models", "catalog"]);
  return model;
}
export async function listLibraryModels() {
  const models = await transaction("readonly", tx => tx.objectStore("catalog").getAll(), ["catalog"]);
  return models.sort((a,b) => b.created-a.created);
}
export const getLibraryModel = id => transaction("readonly", tx => tx.objectStore("models").get(id));
