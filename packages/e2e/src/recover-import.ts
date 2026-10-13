import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FinishedRun } from "e2e";
import { importFinishedRun, runDirectory } from "./import-run.js";
import type { ImportRequirements } from "./import-spec.js";

/** Repairs only evidence delivery. Never starts a process or repeats application actions. */
export async function recoverImportedRun(directory: string, runId: string, signal: AbortSignal) {
  const root = runDirectory(directory, runId);
  const spec = JSON.parse(await readFile(resolve(root, "import-spec.json"), "utf8")) as {
    schemaVersion: string;
    runId: string;
    requirements: ImportRequirements;
  };
  if (spec.schemaVersion !== "relay-e2e-import-spec-1" || spec.runId !== runId)
    throw new Error("Invalid retained import specification");
  const report: FinishedRun["report"] = JSON.parse(
    await readFile(resolve(root, "report.json"), "utf8"),
  );
  const source = JSON.parse(await readFile(resolve(root, "import-source.json"), "utf8"));
  return importFinishedRun(
    {
      ...source,
      report,
      status: report.run.status,
      exitCode: report.run.exitCode,
      traces: new Map(source.traces),
    },
    { directory, ...spec.requirements },
    signal,
  );
}
