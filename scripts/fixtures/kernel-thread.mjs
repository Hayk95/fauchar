// Runs the exact browser module-worker handler in a Node thread for protocol tests.
import { parentPort } from "node:worker_threads";
globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) };
await import("../../lib/client/cad/kernel-worker.js");
parentPort.on("message", data => self.onmessage({ data }));
