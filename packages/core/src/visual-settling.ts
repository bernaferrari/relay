import { createHash } from "node:crypto";

/** Require 500ms of matching fresh rasters. Animated surfaces remain usable,
 * but are explicitly reported as unsettled rather than silently called stable. */
export async function captureSettledRaster<T>(input: {
  capture(): Promise<T>;
  bytes(value: T): Uint8Array;
  discard?(value: T): Promise<void>;
  wait?(ms: number): Promise<void>;
  clock?(): number;
}): Promise<{ value: T; settled: boolean; samples: number }> {
  const wait = input.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  let value: T | undefined;
  let previous: string | undefined;
  let matches = 0;
  try {
    for (let samples = 1; samples <= 4; samples++) {
      if (samples > 1) await wait(500);
      const next = await input.capture();
      if (value !== undefined) await input.discard?.(value);
      value = next;
      const signature = createHash("sha256").update(input.bytes(next)).digest("hex");
      matches = signature === previous ? matches + 1 : 1;
      previous = signature;
      if (matches >= 2 || samples === 4 || (samples > 1 && clock() - startedAt >= 2000)) {
        return { value: next, settled: matches >= 2, samples };
      }
    }
    throw new Error("Visual capture produced no frame");
  } catch (error) {
    if (value !== undefined) await input.discard?.(value);
    throw error;
  }
}
