import { cp, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { applyReviewChecklistTodosToPack, parseReviewChecklistTodoFile } from "@relay/core";
import { startedPlanBatchId } from "./cli-run-flags.js";
import { UsageError } from "./errors.js";

export function exportedPackRootDir(result: unknown): string {
  if (!result || typeof result !== "object" || !("rootDir" in result)) {
    throw new Error("Combine export did not return a pack directory");
  }
  const rootDir = result.rootDir;
  if (typeof rootDir !== "string" || !rootDir.trim()) {
    throw new Error("Combine export did not return a pack directory");
  }
  return rootDir;
}

export async function finalizeExportedEvidencePack(input: {
  rootDir: string;
  exportDir?: string;
  todoFile?: string;
}): Promise<{ rootDir: string; exportDir?: string }> {
  if (input.todoFile) {
    const path = isAbsolute(input.todoFile) ? input.todoFile : resolve(input.todoFile);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new UsageError(`--todo file not found: ${input.todoFile}`);
      }
      throw error;
    }
    await applyReviewChecklistTodosToPack(input.rootDir, parseReviewChecklistTodoFile(raw));
  }
  if (!input.exportDir) return { rootDir: input.rootDir };
  const dest = isAbsolute(input.exportDir) ? input.exportDir : resolve(input.exportDir);
  if (dest === input.rootDir) return { rootDir: input.rootDir, exportDir: dest };
  await mkdir(dest, { recursive: true });
  await cp(input.rootDir, dest, { recursive: true, force: true });
  return { rootDir: input.rootDir, exportDir: dest };
}

export async function exportWatchedCombinePack(input: {
  operationId: string;
  exportDir?: string;
  todoFile?: string;
  started: unknown;
  invoke: (operationId: string, payload: unknown) => Promise<unknown>;
  output: { result: (operationId: string, value: unknown) => void };
}): Promise<void> {
  if (!input.exportDir && !input.todoFile) return;
  if (input.operationId !== "job.combine.start") return;
  const batchId = startedPlanBatchId(input.started);
  if (!batchId) throw new Error("Plan export needs a campaign or batch id");
  const exported = await input.invoke("job.combine.export", { batchId });
  const finalized = await finalizeExportedEvidencePack({
    rootDir: exportedPackRootDir(exported),
    exportDir: input.exportDir,
    todoFile: input.todoFile,
  });
  input.output.result("job.combine.export", {
    ...(exported && typeof exported === "object" ? exported : {}),
    ...finalized,
  });
}

export async function finalizeCombineExportResult(input: {
  operationId: string;
  result: unknown;
  summarized: unknown;
  exportDir?: string;
  todoFile?: string;
}): Promise<unknown> {
  if (input.operationId !== "job.combine.export") return input.summarized;
  if (!input.exportDir && !input.todoFile) return input.summarized;
  const finalized = await finalizeExportedEvidencePack({
    rootDir: exportedPackRootDir(input.result),
    exportDir: input.exportDir,
    todoFile: input.todoFile,
  });
  return input.summarized && typeof input.summarized === "object"
    ? { ...input.summarized, ...finalized }
    : finalized;
}
