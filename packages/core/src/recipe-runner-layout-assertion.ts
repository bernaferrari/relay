import type { Device } from "./device.js";
import { sleep, snapshot } from "./device.js";
import { cooperativeCheckpoint } from "./control.js";
import { now } from "./events.js";
import type { RecipeStep } from "./recipes.js";
import {
  assertNonOverlappingLayout,
  LayoutAssertionError,
  type NonOverlappingLayoutResult,
} from "./recipe-layout-assertion.js";
import { DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS } from "./recipe-runner-support.js";

type LayoutAssertionArtifact = {
  kind: string;
  capturedAt: number;
  data: unknown;
};

export async function runLayoutAssertionStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "assert-layout" }>,
  context: {
    log: (message: string) => void;
    artifacts?: LayoutAssertionArtifact[];
  },
): Promise<void> {
  const timeout = Math.min(step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS);
  const deadline = Date.now() + timeout;
  let result: NonOverlappingLayoutResult | undefined;
  let lastError: unknown;
  while (!result) {
    await cooperativeCheckpoint();
    const nodes = await snapshot(device);
    try {
      result = assertNonOverlappingLayout(nodes, step);
    } catch (error) {
      lastError = error;
      // An overlap is a stable product failure and ambiguity is unsafe to
      // guess around. Only a temporarily missing element may settle.
      if (!(error instanceof LayoutAssertionError) || error.code !== "unavailable") break;
    }
    if (result || Date.now() >= deadline) break;
    await sleep(Math.max(0, Math.min(400, deadline - Date.now())), device);
  }
  if (!result) {
    const error =
      lastError instanceof LayoutAssertionError
        ? lastError
        : new Error("layout assertion could not resolve element bounds");
    context.artifacts?.push({
      kind: "layout-assertion",
      capturedAt: now(),
      data: {
        relation: step.relation,
        first: step.first,
        second: step.second,
        passed: false,
        error: error.message,
        ...(error instanceof LayoutAssertionError && error.target
          ? { unavailableTarget: error.target }
          : {}),
        ...(error instanceof LayoutAssertionError && error.bounds ? { overlap: error.bounds } : {}),
      },
    });
    throw error;
  }
  context.artifacts?.push({
    kind: "layout-assertion",
    capturedAt: now(),
    data: {
      relation: step.relation,
      first: result.first,
      second: result.second,
      overlap: result.overlap,
      passed: true,
    },
  });
  context.log("layout assertion: passed (non-overlap)");
}
