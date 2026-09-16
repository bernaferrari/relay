import { createHash } from "node:crypto";

export type VisualCapturePolicy = "fast" | "stable" | "sequence";

/** Fast and Sequence each take one fresh image with no stability claim.
 *  Stable keeps the 500ms matching-raster loop. Sequence names its frames at
 *  the review layer; this helper never invents those phase names and never
 *  treats a 1-minute outage as a 10-second one. */
export async function captureSettledRaster<T>(input: {
  capture(): Promise<T>;
  bytes(value: T): Uint8Array;
  discard?(value: T): Promise<void>;
  wait?(ms: number): Promise<void>;
  clock?(): number;
  policy?: VisualCapturePolicy;
}): Promise<{ value: T; settled: boolean; samples: number; stabilityMeasured: boolean }> {
  const wait = input.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  let value: T | undefined;
  let previous: string | undefined;
  let matches = 0;
  try {
    if (input.policy === "fast" || input.policy === "sequence") {
      const next = await input.capture();
      return { value: next, settled: false, samples: 1, stabilityMeasured: false };
    }
    for (let samples = 1; samples <= 4; samples++) {
      if (samples > 1) await wait(500);
      const next = await input.capture();
      if (value !== undefined) await input.discard?.(value);
      value = next;
      const signature = createHash("sha256").update(input.bytes(next)).digest("hex");
      matches = signature === previous ? matches + 1 : 1;
      previous = signature;
      if (matches >= 2 || samples === 4 || (samples > 1 && clock() - startedAt >= 2000)) {
        return { value: next, settled: matches >= 2, samples, stabilityMeasured: true };
      }
    }
    throw new Error("Visual capture produced no frame");
  } catch (error) {
    if (value !== undefined) await input.discard?.(value);
    throw error;
  }
}
