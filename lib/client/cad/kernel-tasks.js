import { createCrown } from "./crown-builder.js";
import { unionMeshes } from "./ops.js";
import { meshStats } from "./mesh.js";

/** Shared by the module worker and headless regression tests. */
export function runKernelTask(type, payload, progress = () => {}) {
  if (type === "crown") return createCrown(payload);
  if (type === "merge") {
    if (!Number.isFinite(payload.voxel) || payload.voxel < 0.05 || payload.voxel > 0.2 || !payload.meshes?.length) throw new Error("Select a merge resolution between 0.05 and 0.2 mm.");
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const mesh of payload.meshes) for (let i = 0; i < mesh.positions.length; i++) {
      const k = i % 3, value = mesh.positions[i];
      if (!Number.isFinite(value)) throw new Error("Cannot merge non-finite geometry.");
      lo[k] = Math.min(lo[k], value); hi[k] = Math.max(hi[k], value);
    }
    const cells = lo.reduce((n, v, k) => n * (Math.ceil((hi[k] - v) / payload.voxel + 8) + 1), 1);
    if (cells > 8_000_000) throw new Error("Merge exceeds the browser memory budget. Choose a coarser voxel size or fewer units.");
    const mesh = unionMeshes(payload.meshes, payload.voxel, progress);
    return { ...mesh, stats: meshStats(mesh.positions, mesh.indices) };
  }
  throw new Error(`Unknown CAD task: ${type}`);
}
