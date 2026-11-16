/** Heavy operations never silently fall back to blocking the UI thread. */
export class KernelWorker {
  constructor() { this.worker = null; this.job = null; this.seq = 0; }
  run(type, payload, progress) {
    if (this.job) return Promise.reject(new Error("Wait for the current CAD operation or cancel it first."));
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL("./kernel-worker.js", import.meta.url), { type: "module" });
        this.worker.onmessage = ({ data }) => {
          const job = this.job;
          if (!job || job.id !== data.id) return;
          if (data.progress !== undefined) { job.progress?.(data.progress); return; }
          this.job = null;
          if (data.error) job.reject(new Error(data.error));
          else job.resolve(data.result);
        };
        this.worker.onerror = () => this.cancel("The CAD worker could not run. Check browser worker support.");
      }
      return new Promise((resolve, reject) => {
        this.job = { id: ++this.seq, resolve, reject, progress };
        // Structured cloning preserves editable meshes and undo buffers on the main thread.
        try { this.worker.postMessage({ id: this.seq, type, payload }); }
        catch (error) { this.job = null; reject(error); }
      });
    } catch (error) { return Promise.reject(error); }
  }
  cancel(message = "CAD operation cancelled.") {
    this.worker?.terminate(); this.worker = null;
    const job = this.job; this.job = null;
    job?.reject(new Error(message));
  }
  dispose() { this.cancel("CAD session closed."); }
}
