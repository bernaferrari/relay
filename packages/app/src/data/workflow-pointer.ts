import type { Platform } from "../platform/types";

const POINTER_KEY = "activeRecordingWorkflowId";
const MAX_POINTER_LENGTH = 512;

export function validWorkflowPointer(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const pointer = value.trim();
  return pointer && pointer.length <= MAX_POINTER_LENGTH ? pointer : undefined;
}

export async function readWorkflowPointer(platform: Platform): Promise<string | undefined> {
  return validWorkflowPointer(await platform.storage.get(POINTER_KEY));
}

export async function writeWorkflowPointer(platform: Platform, workflowId: string): Promise<void> {
  const pointer = validWorkflowPointer(workflowId);
  if (!pointer) throw new TypeError("The recording workflow identifier is invalid.");
  await platform.storage.set(POINTER_KEY, pointer);
}

export async function clearWorkflowPointer(platform: Platform): Promise<void> {
  await platform.storage.remove?.(POINTER_KEY);
}

export async function clearWorkflowPointerIfCurrent(
  platform: Platform,
  workflowId: string,
): Promise<boolean> {
  if ((await readWorkflowPointer(platform)) !== workflowId) return false;
  await clearWorkflowPointer(platform);
  return true;
}
