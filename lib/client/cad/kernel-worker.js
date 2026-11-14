import { runKernelTask } from "./kernel-tasks.js";

self.onmessage = ({ data: { id, type, payload } }) => {
  try {
    const result = runKernelTask(type, payload, value => self.postMessage({ id, progress: value }));
    self.postMessage({ id, result }, [result.positions.buffer, result.indices.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message || "CAD calculation failed." });
  }
};
