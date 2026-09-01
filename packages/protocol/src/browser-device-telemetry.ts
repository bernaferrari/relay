import * as z from "zod/v4";

/** Product budgets for the managed Browser Device. They describe observed
 * Relay-side work, not a claim about the browser's internal paint pipeline. */
export const BROWSER_DEVICE_PERFORMANCE_BUDGETS = {
  frameCaptureP95Ms: 250,
  interactionP95Ms: 250,
  observedFpsMin: 10,
} as const;

export const BROWSER_DEVICE_TELEMETRY_SCHEMA_VERSION = 1 as const;

export type BrowserDeviceBudgetStatus = "within" | "exceeded" | "unmeasured";

export type BrowserDeviceLatencyMetric = {
  samples: number;
  p50Ms?: number;
  p95Ms?: number;
  maxMs?: number;
};

export type BrowserDeviceTelemetry = {
  schemaVersion: typeof BROWSER_DEVICE_TELEMETRY_SCHEMA_VERSION;
  frameCapture: BrowserDeviceLatencyMetric;
  interaction: BrowserDeviceLatencyMetric;
  observedFps?: number;
  frameCount: number;
  droppedFrames: number;
  budgets: {
    frameCapture: BrowserDeviceBudgetStatus;
    interaction: BrowserDeviceBudgetStatus;
    observedFps: BrowserDeviceBudgetStatus;
  };
};

const natural = z.number().int().nonnegative();
const metric = z
  .object({
    samples: natural,
    p50Ms: natural.optional(),
    p95Ms: natural.optional(),
    maxMs: natural.optional(),
  })
  .strict();

export const browserDeviceTelemetrySchema = z
  .object({
    schemaVersion: z.literal(BROWSER_DEVICE_TELEMETRY_SCHEMA_VERSION),
    frameCapture: metric,
    interaction: metric,
    observedFps: z.number().finite().nonnegative().max(60).optional(),
    frameCount: natural,
    droppedFrames: natural,
    budgets: z
      .object({
        frameCapture: z.enum(["within", "exceeded", "unmeasured"]),
        interaction: z.enum(["within", "exceeded", "unmeasured"]),
        observedFps: z.enum(["within", "exceeded", "unmeasured"]),
      })
      .strict(),
  })
  .strict();

export function percentile(values: readonly number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function latencyMetric(values: readonly number[]): BrowserDeviceLatencyMetric {
  if (!values.length) return { samples: 0 };
  return {
    samples: values.length,
    p50Ms: Math.round(percentile(values, 0.5)!),
    p95Ms: Math.round(percentile(values, 0.95)!),
    maxMs: Math.round(Math.max(...values)),
  };
}

function budgetStatus(
  value: number | undefined,
  budget: number,
  predicate: (value: number, budget: number) => boolean = (current, limit) => current <= limit,
): BrowserDeviceBudgetStatus {
  return value === undefined ? "unmeasured" : predicate(value, budget) ? "within" : "exceeded";
}

/** Build the bounded session projection from recent monotonic samples. The
 * caller owns retention and supplies no private page or target identifiers. */
export function summarizeBrowserDeviceTelemetry(input: {
  frameCaptureMs: readonly number[];
  interactionMs: readonly number[];
  frameTimesMs: readonly number[];
  frameCount?: number;
  droppedFrames?: number;
}): BrowserDeviceTelemetry {
  const frameCapture = latencyMetric(input.frameCaptureMs);
  const interaction = latencyMetric(input.interactionMs);
  const first = input.frameTimesMs[0];
  const last = input.frameTimesMs.at(-1);
  const observedFps =
    input.frameTimesMs.length >= 2 && last !== undefined && first !== undefined && last > first
      ? Math.min(60, (1_000 * (input.frameTimesMs.length - 1)) / (last - first))
      : undefined;
  return {
    schemaVersion: BROWSER_DEVICE_TELEMETRY_SCHEMA_VERSION,
    frameCapture,
    interaction,
    ...(observedFps === undefined ? {} : { observedFps: Math.round(observedFps * 10) / 10 }),
    frameCount: Math.max(0, Math.floor(input.frameCount ?? input.frameTimesMs.length)),
    droppedFrames: Math.max(0, Math.floor(input.droppedFrames ?? 0)),
    budgets: {
      frameCapture: budgetStatus(
        frameCapture.p95Ms,
        BROWSER_DEVICE_PERFORMANCE_BUDGETS.frameCaptureP95Ms,
      ),
      interaction: budgetStatus(
        interaction.p95Ms,
        BROWSER_DEVICE_PERFORMANCE_BUDGETS.interactionP95Ms,
      ),
      observedFps: budgetStatus(
        observedFps,
        BROWSER_DEVICE_PERFORMANCE_BUDGETS.observedFpsMin,
        (current, minimum) => current >= minimum,
      ),
    },
  };
}
