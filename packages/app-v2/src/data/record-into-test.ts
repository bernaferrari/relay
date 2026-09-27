import type { AppMapScenarioTestStep } from "@relay/protocol";
import type { Platform } from "../platform/types";
import type { TestEditorProductService } from "./test-editor-product-service";

/** A recording started from a saved Test adds its steps to that Test. */
export type RecordingInto = {
  testId: string;
  testName: string;
  appMapId: string;
  /** Insert after this step; absent appends to the end. */
  afterStepId?: string;
};

const key = (workflowId: string) => `relay:recording-into:${workflowId}`;

export async function rememberRecordingInto(
  platform: Platform,
  workflowId: string,
  into: RecordingInto,
): Promise<void> {
  await Promise.resolve(platform.storage.set(key(workflowId), JSON.stringify(into)));
}

export async function readRecordingInto(
  platform: Platform,
  workflowId: string,
): Promise<RecordingInto | undefined> {
  try {
    const raw = await Promise.resolve(platform.storage.get(key(workflowId)));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<RecordingInto>;
    return typeof value.testId === "string" &&
      typeof value.appMapId === "string" &&
      typeof value.testName === "string"
      ? {
          testId: value.testId,
          testName: value.testName,
          appMapId: value.appMapId,
          ...(typeof value.afterStepId === "string" ? { afterStepId: value.afterStepId } : {}),
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function forgetRecordingInto(platform: Platform, workflowId: string): Promise<void> {
  await Promise.resolve(platform.storage.remove?.(key(workflowId)));
}

/**
 * Move the steps of a just-saved recording into the Test it was recorded for,
 * then delete the helper Test. Returns the id of the first added step.
 */
export async function foldRecordingIntoTest(
  service: TestEditorProductService,
  input: { recordedTestId: string; into: RecordingInto },
): Promise<string | undefined> {
  const recorded = await service.get(input.recordedTestId);
  const target = await service.get(input.into.testId);
  if (!recorded || !target) throw new TypeError("The Test to add these steps to is gone.");
  const topLevel = target.test.steps.map((step) => step.id);
  const after = input.into.afterStepId ? topLevel.indexOf(input.into.afterStepId) : -1;
  const start = after >= 0 ? after + 1 : topLevel.length;
  const steps: AppMapScenarioTestStep[] = recorded.test.steps.map((step) => ({
    ...structuredClone(step),
    id: `step-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
  }));
  await service.edit({
    document: target,
    edits: steps.map((step, index) => ({ kind: "step.add", step, index: start + index })),
  });
  await service.remove?.({ appMapId: recorded.appMapId, testId: recorded.test.id });
  return steps[0]?.id;
}
