import { runKernelTask } from "./kernel-tasks.js";

self.onmessage = ({ data: { id, type, payload } }) => {
  try {
    const result = runKernelTask(type, payload, value => self.postMessage({ id, progress: value }));
    const buffers = [result.positions, result.indices, result.componentIds, result.keptFaces, result.segments]
      .filter(value => value?.buffer instanceof ArrayBuffer).map(value => value.buffer);
    self.postMessage({ id, result }, [...new Set(buffers)]);
  } catch (error) {
    self.postMessage({ id, error: error.message || "CAD calculation failed." });
  }
};
