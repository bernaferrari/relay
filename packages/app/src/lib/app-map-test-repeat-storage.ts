import {
  isLegacyWorkflowRef,
  type DurableWorkflowHandle,
  type WorkflowRef,
} from "@relay/workflows";

export type RepeatStorageKeys = {
  durable: string;
  legacy: string;
};

export function repeatStorageKeys(appMapId: string, testId: string): RepeatStorageKeys {
  return {
    durable: `relay:repeat:v2:${appMapId}:${testId}`,
    legacy: `relay:repeat:v1:${appMapId}:${testId}`,
  };
}

export function readStoredRepeat(
  storage: Storage,
  keys: RepeatStorageKeys,
): {
  handle?: DurableWorkflowHandle;
  legacyRef?: WorkflowRef;
} {
  const stored = storage.getItem(keys.durable);
  const parsed = stored ? (JSON.parse(stored) as Partial<DurableWorkflowHandle>) : undefined;
  const handle =
    typeof parsed?.workflowId === "string" &&
    parsed.workflowId.length > 0 &&
    Number.isSafeInteger(parsed.expectedVersion) &&
    parsed.expectedVersion! > 0
      ? ({
          workflowId: parsed.workflowId,
          expectedVersion: parsed.expectedVersion!,
        } satisfies DurableWorkflowHandle)
      : undefined;
  const legacy = storage.getItem(keys.legacy);
  const legacyRef = legacy && isLegacyWorkflowRef(legacy) ? legacy : undefined;
  return { ...(handle ? { handle } : {}), ...(legacyRef ? { legacyRef } : {}) };
}

export function writeStoredRepeat(
  storage: Storage,
  keys: RepeatStorageKeys,
  handle: DurableWorkflowHandle,
): void {
  storage.setItem(keys.durable, JSON.stringify(handle));
  storage.removeItem(keys.legacy);
}

export function removeStoredRepeat(storage: Storage, keys: RepeatStorageKeys): void {
  storage.removeItem(keys.durable);
  storage.removeItem(keys.legacy);
}
