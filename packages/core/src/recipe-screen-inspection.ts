import { snapshot, type Device, type SnapshotNode } from "./device.js";
import { now } from "./events.js";
import { isTerminalIosMutationError } from "./ios-mutation-policy.js";
import { isTerminalInputError } from "./input-not-dispatched.js";
import type { FreshDeviceObservation, RecipeStepContext } from "./recipe-runner-context.js";
import type { RecipeStep } from "./recipes.js";
import { isTransientError } from "./retry.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

const CAUSE_CODES = {
  MAIN_THREAD_TIMEOUT: "timeout",
  ETIMEDOUT: "timeout",
  RUNNER_BUSY: "runner-busy",
  RUNNER_WEDGED: "runner-wedged",
  APP_NOT_RUNNING: "app-unavailable",
  APP_NOT_FOREGROUND: "app-unavailable",
  ECONNRESET: "transport-unavailable",
  ECONNREFUSED: "transport-unavailable",
  EPIPE: "transport-unavailable",
} as const;
export type ScreenInspectionIssue = {
  state: "empty-success" | "failed-read";
  stage: "semantic-read" | "raster-read";
  readAttempts: number;
  cause?: {
    category:
      | "timeout"
      | "runner-busy"
      | "runner-wedged"
      | "app-unavailable"
      | "transport-unavailable"
      | "permission-denied"
      | "stale-observation"
      | "inspection-in-flight"
      | "unknown";
    code?: keyof typeof CAUSE_CODES;
  };
};

/** Preserve useful attribution without persisting arbitrary driver/AX error text. */
export function safeScreenReadCause(error: unknown): NonNullable<ScreenInspectionIssue["cause"]> {
  const record =
    error && typeof error === "object"
      ? (error as { code?: unknown; details?: { runnerErrorCode?: unknown } })
      : undefined;
  const code = [record?.details?.runnerErrorCode, record?.code].find(
    (value): value is keyof typeof CAUSE_CODES =>
      typeof value === "string" && Object.hasOwn(CAUSE_CODES, value),
  );
  if (code) return { category: CAUSE_CODES[code], code };
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const category = /timeout|timed out/i.test(message)
    ? "timeout"
    : /RUNNER_WEDGED|execution watchdog|main thread has been stuck/i.test(message)
      ? "runner-wedged"
      : /RUNNER_BUSY|still finishing a previous command/i.test(message)
        ? "runner-busy"
        : /permission denied|not authorized|unauthorized/i.test(message)
          ? "permission-denied"
          : /stale|predates.*input/i.test(message)
            ? "stale-observation"
            : /already in flight|in-flight/i.test(message)
              ? "inspection-in-flight"
              : /socket|usbmux|connection reset|ECONNRESET|disconnected|offline/i.test(message)
                ? "transport-unavailable"
                : /app.*not.*(?:running|foreground)|active app session|open first/i.test(message)
                  ? "app-unavailable"
                  : "unknown";
  return { category };
}

export function rethrowTerminalScreenRead(error: unknown): void {
  if (
    (error instanceof Error && error.name === "JobCancelledError") ||
    isTerminalIosMutationError(error) ||
    isTerminalInputError(error)
  )
    throw error;
}

export class RecipeScreenInspectionError extends Error {
  constructor(
    readonly inspection: ScreenInspectionIssue,
    screenTitle: string,
    readonly rasterFailure?: NonNullable<ScreenInspectionIssue["cause"]>,
  ) {
    super(
      `screen-inspection-unavailable: ${inspection.stage === "semantic-read" ? "accessibility" : "raster"} inspection unavailable; screen identity unproven (expected “${screenTitle.slice(0, 160)}”; ${inspection.stage} ${inspection.state}; reads ${inspection.readAttempts}${inspection.cause ? `; cause ${inspection.cause.category}${inspection.cause.code ? `/${inspection.cause.code}` : ""}` : ""})`,
    );
    this.name = "RecipeScreenInspectionError";
  }
}

export function retainedScreenInspectionError(
  ctx: RecipeStepContext,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
  inspection: ScreenInspectionIssue,
  rasterFailure?: NonNullable<ScreenInspectionIssue["cause"]>,
): RecipeScreenInspectionError {
  const error = new RecipeScreenInspectionError(inspection, step.screenTitle, rasterFailure);
  (ctx.job?.artifacts ?? ctx.artifacts)?.push({
    kind: "screen-inspection-failure",
    capturedAt: now(),
    data: {
      schemaVersion: 1,
      screenId: step.screenId,
      ...(step.id ? { recipeStepId: step.id } : {}),
      inspection,
      ...(rasterFailure ? { rasterFailure } : {}),
    },
  });
  return error;
}

/** Keep the existing simultaneous semantic/raster observation and one transient
 * re-observation. Empty success is an unavailable proof, never a failed read. */
export async function observeDestinationAttempt(
  device: Device,
  reusable: FreshDeviceObservation | undefined,
  captureRaster: (() => Promise<ScreenshotPayload>) | undefined,
  observeSnapshot: (device: Device) => Promise<SnapshotNode[]> = (target) =>
    snapshot(target, { retryAttempts: 1 }),
): Promise<{
  nodes: SnapshotNode[];
  observedAt: number;
  inspection?: ScreenInspectionIssue;
  rasterFailure?: NonNullable<ScreenInspectionIssue["cause"]>;
  screenshot?: ScreenshotPayload;
}> {
  const raster = captureRaster?.().then(
    (screenshot) => ({ screenshot }),
    (error: unknown) => ({ error }),
  );
  let readAttempts = 0;
  const read = async () => {
    readAttempts += 1;
    return { nodes: await observeSnapshot(device) };
  };
  const semantics = (async () => {
    if (reusable?.nodes) return { nodes: reusable.nodes };
    try {
      return await read();
    } catch (error) {
      rethrowTerminalScreenRead(error);
      if (!isTransientError(error)) return { error };
      try {
        return await read();
      } catch (retryError) {
        rethrowTerminalScreenRead(retryError);
        return { error: retryError };
      }
    }
  })();
  const [semanticResult, rasterResult] = await Promise.all([
    semantics,
    raster ?? Promise.resolve({ screenshot: undefined }),
  ]);
  if ("error" in semanticResult) rethrowTerminalScreenRead(semanticResult.error);
  if ("error" in rasterResult) rethrowTerminalScreenRead(rasterResult.error);
  const nodes =
    "nodes" in semanticResult && Array.isArray(semanticResult.nodes) ? semanticResult.nodes : [];
  const inspection: ScreenInspectionIssue | undefined =
    "error" in semanticResult
      ? {
          state: "failed-read",
          stage: "semantic-read",
          readAttempts,
          cause: safeScreenReadCause(semanticResult.error),
        }
      : nodes.length === 0
        ? { state: "empty-success", stage: "semantic-read", readAttempts }
        : undefined;
  return {
    nodes,
    observedAt: reusable?.observedAt ?? now(),
    ...(inspection ? { inspection } : {}),
    ...("error" in rasterResult ? { rasterFailure: safeScreenReadCause(rasterResult.error) } : {}),
    ...("screenshot" in rasterResult && rasterResult.screenshot
      ? { screenshot: rasterResult.screenshot }
      : {}),
  };
}
