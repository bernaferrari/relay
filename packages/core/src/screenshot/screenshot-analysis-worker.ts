import { parentPort, workerData } from "node:worker_threads";
import { analyzeScreenshot } from "./screenshot-analysis.js";

if (!parentPort) throw new Error("Screenshot analysis requires a worker channel");
parentPort.postMessage(analyzeScreenshot(workerData as Uint8Array));
parentPort.close();
