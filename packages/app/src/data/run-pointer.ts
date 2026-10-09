import type { Platform } from "../platform/types";

const RUN_POINTER_KEY = "activeRunWorkflow";

export type RunPointer = {
  workflowId: string;
  runId: string;
  testId: string;
};

function bounded(value: unknown): string | undefined {
  const result = typeof value === "string" ? value.trim() : "";
  return result && result.length <= 512 ? result : undefined;
}

export function parseRunPointer(value: unknown): RunPointer | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const workflowId = bounded(parsed.workflowId);
    const runId = bounded(parsed.runId);
    const testId = bounded(parsed.testId);
    return workflowId && runId && testId ? { workflowId, runId, testId } : undefined;
  } catch {
    return undefined;
  }
}

export async function readRunPointer(platform: Platform): Promise<RunPointer | undefined> {
  return parseRunPointer(await platform.storage.get(RUN_POINTER_KEY));
}

export async function writeRunPointer(platform: Platform, pointer: RunPointer): Promise<void> {
  const valid = parseRunPointer(JSON.stringify(pointer));
  if (!valid) throw new TypeError("The run workflow pointer is invalid.");
  await platform.storage.set(RUN_POINTER_KEY, JSON.stringify(valid));
}

export async function clearRunPointerIfCurrent(
  platform: Platform,
  runId: string,
): Promise<boolean> {
  if ((await readRunPointer(platform))?.runId !== runId) return false;
  await platform.storage.remove?.(RUN_POINTER_KEY);
  return true;
}
