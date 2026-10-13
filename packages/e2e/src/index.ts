import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Reporter, RunEvent } from "e2e";
import { atomicJson, importFinishedRun, runDirectory, type ImportOptions } from "./import-run.js";
export { importFinishedRun, runDirectory } from "./import-run.js";
export type { CaptureObligation, ImportOptions } from "./import-run.js";

/** No constructor side effects: upstream workers also instantiate config reporters. */
export function relayReporter(options: ImportOptions & { maxQueuedEventBytes?: number }): Reporter {
  let directory: string | undefined;
  let queue: string[] = [];
  let queuedBytes = 0;
  let dropped = 0;
  let failed = false;
  let draining: Promise<void> | undefined;
  let lastSequence = -1;
  const writes = new AbortController();
  const drain = () => {
    if (draining || !directory) return;
    const path = directory;
    draining = (async () => {
      await mkdir(path, { recursive: true });
      while (queue.length) {
        const batch = queue;
        queue = [];
        queuedBytes = 0;
        try {
          await writeFile(resolve(path, "events.jsonl"), batch.join(""), {
            flag: "a",
            signal: writes.signal,
          });
        } catch (error) {
          dropped += batch.length;
          throw error;
        }
      }
    })()
      .catch(() => {
        failed = true;
        dropped += queue.length;
        queue = [];
        queuedBytes = 0;
      })
      .finally(() => {
        draining = undefined;
        if (queue.length) drain();
      });
  };
  return {
    name: "relay",
    onEvent(event: RunEvent) {
      try {
        if (event.type === "run-started") directory = runDirectory(options.directory, event.runId);
        if (!directory || event.seq <= lastSequence) return;
        lastSequence = event.seq;
        if (failed) {
          dropped++;
          return;
        }
        const line = JSON.stringify(event) + "\n";
        const bytes = Buffer.byteLength(line);
        if (queuedBytes + bytes > (options.maxQueuedEventBytes ?? 1024 * 1024)) {
          dropped++;
          return;
        }
        queuedBytes += bytes;
        queue.push(line);
        drain();
      } catch {
        dropped++;
      }
    },
    async onRunFinished(run, signal) {
      const abortWrites = () => writes.abort(signal.reason);
      signal.addEventListener("abort", abortWrites, { once: true });
      if (signal.aborted) abortWrites();
      try {
        while (draining) {
          signal.throwIfAborted();
          await draining;
        }
        const imported = await importFinishedRun(run, options, signal);
        await atomicJson(
          resolve(imported.directory, "event-stream.json"),
          { complete: !failed && dropped === 0, dropped, writeFailed: failed },
          signal,
        );
        return [{ label: "Relay evidence", text: imported.directory }];
      } finally {
        signal.removeEventListener("abort", abortWrites);
      }
    },
  };
}
export { runE2EProject } from "./run-project.js";
export { recoverImportedRun } from "./recover-import.js";
export { discoverE2EProject, pinnedE2EProject } from "./project.js";
export type { DiscoveredE2ETest } from "./project.js";
export { atomicJson } from "./import-run.js";
export { importRequirements } from "./import-spec.js";
export type { FinishedRun } from "e2e";
