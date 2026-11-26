import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import {
  analyzeScreenshot,
  screenshotAnalysisDimensions,
  type ScreenshotAnalysis,
} from "./screenshot-analysis.js";

const source = new URL("./screenshot-analysis-worker.ts", import.meta.url);
const workerUrl = existsSync(source)
  ? source
  : new URL("./screenshot-analysis-worker.cjs", import.meta.url);
const ANALYSIS_TIMEOUT_MS = 20_000;
const MAX_ANALYSIS_WORKERS = 4;
let activeWorkers = 0;

function sourceLoaderArgs(): string[] {
  const args: string[] = [];
  for (let index = 0; index < process.execArgv.length; index++) {
    const arg = process.execArgv[index]!;
    if (
      arg === "--import" ||
      arg === "--require" ||
      arg === "-r" ||
      arg === "--loader" ||
      arg === "--experimental-loader"
    ) {
      const value = process.execArgv[++index];
      if (value) args.push(arg, value);
    } else if (/^--(?:import|require|loader|experimental-loader)=/.test(arg)) args.push(arg);
  }
  return args;
}

/** Large screenshot decoding must not block live device I/O. Each request
 * owns one short-lived worker and receives only analysis metadata back. */
export async function analyzeScreenshotAsync(bytes: Uint8Array): Promise<ScreenshotAnalysis> {
  const dimensions = screenshotAnalysisDimensions(bytes);
  const png = Buffer.from(bytes);
  const pixels = dimensions ? dimensions.width * dimensions.height : 0;
  if (pixels < 1_000_000) return analyzeScreenshot(png);
  if (activeWorkers >= MAX_ANALYSIS_WORKERS)
    throw new Error("Screenshot analysis is busy. Try the capture again.");
  activeWorkers++;
  let worker: Worker | undefined;
  try {
    worker = new Worker(workerUrl, {
      workerData: png,
      // Retain the source loader alone. Test/inline callers can carry host
      // startup flags that Node rejects when explicitly passed to a worker.
      execArgv: workerUrl.pathname.endsWith(".cjs") ? [] : sourceLoaderArgs(),
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    return await new Promise<ScreenshotAnalysis>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Screenshot analysis timed out")),
        ANALYSIS_TIMEOUT_MS,
      );
      worker!.once("message", (result: ScreenshotAnalysis) => {
        clearTimeout(timeout);
        resolve(result);
      });
      worker!.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      worker!.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Screenshot analysis worker exited before returning a result (${code})`));
      });
    });
  } finally {
    try {
      await worker?.terminate();
    } finally {
      activeWorkers--;
    }
  }
}
