/**
 * A tiny, transient signal for a rendered device preview.
 *
 * This is intentionally not a durable screen identity. It exists only to
 * invalidate a semantic overlay when the pixels have moved far enough that a
 * previously-proven XCTest tree may no longer describe what is on screen.
 * Callers feed it a deliberately small downsample (DeviceVideoStream uses
 * 24×24) and it caps sampling before doing any per-pixel work.
 */

export type VisualFrameSample = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type VisualFrameSignal = {
  /** Stable until a material preview change is observed. */
  fingerprint: string;
  /** Monotonic timestamp supplied by the renderer. */
  sampledAt: number;
  /** Fraction of downsampled pixels that crossed the per-pixel threshold. */
  changedRatio: number;
  /** Mean RGB distance across every downsampled pixel. */
  meanDelta: number;
  /** The previous accepted visual fingerprint, when this is a change. */
  previousFingerprint?: string;
};

export type VisualFrameDetectorOptions = {
  /** Never inspect more often than this. Defaults to 400ms (2.5Hz). */
  minIntervalMs?: number;
  /** RGB distance required before one pixel counts as changed. Defaults to 42. */
  pixelDeltaThreshold?: number;
  /** Changed-pixel share required to call a frame materially different. Defaults to 8%. */
  minChangedRatio?: number;
};

export type VisualFrameDetectorState = {
  lastSampledAt?: number;
  baseline?: VisualFrameSample;
  fingerprint?: string;
};

export type VisualFrameDetectorResult = {
  state: VisualFrameDetectorState;
  /** False when the cadence deliberately skipped this decoded frame. */
  sampled: boolean;
  /** Present for the initial frame and each material change, never for noise. */
  signal?: VisualFrameSignal;
};

const DEFAULT_MIN_INTERVAL_MS = 400;
const DEFAULT_PIXEL_DELTA_THRESHOLD = 42;
const DEFAULT_MIN_CHANGED_RATIO = 0.08;

function normalizedOptions(options: VisualFrameDetectorOptions) {
  return {
    minIntervalMs: Math.max(0, options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS),
    pixelDeltaThreshold: Math.max(0, options.pixelDeltaThreshold ?? DEFAULT_PIXEL_DELTA_THRESHOLD),
    minChangedRatio: Math.min(1, Math.max(0, options.minChangedRatio ?? DEFAULT_MIN_CHANGED_RATIO)),
  };
}

/**
 * Check cadence before asking Canvas for pixels. This is intentionally public
 * so the video renderer can avoid a GPU readback for frames we will discard.
 */
export function visualFrameSampleDue(
  state: VisualFrameDetectorState,
  sampledAt: number,
  options: VisualFrameDetectorOptions = {},
): boolean {
  const { minIntervalMs } = normalizedOptions(options);
  return (
    state.lastSampledAt === undefined ||
    sampledAt < state.lastSampledAt ||
    sampledAt - state.lastSampledAt >= minIntervalMs
  );
}

function validFrame(frame: VisualFrameSample): boolean {
  return (
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.data.byteLength >= frame.width * frame.height * 4
  );
}

function copyFrame(frame: VisualFrameSample): VisualFrameSample {
  return {
    width: frame.width,
    height: frame.height,
    data: new Uint8ClampedArray(frame.data),
  };
}

/**
 * Fast, deterministic 32-bit FNV-1a over a quantized RGB thumbnail.
 *
 * Quantization makes normal video compression variation less likely to
 * produce an entirely new transient identity. The material-change test below
 * remains the authority for whether the identity is allowed to advance.
 */
export function visualFrameFingerprint(frame: VisualFrameSample): string {
  let hash = 0x811c9dc5;
  const pixels = frame.width * frame.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    hash ^= frame.data[offset]! >>> 4;
    hash = Math.imul(hash, 0x01000193);
    hash ^= frame.data[offset + 1]! >>> 4;
    hash = Math.imul(hash, 0x01000193);
    hash ^= frame.data[offset + 2]! >>> 4;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${frame.width}x${frame.height}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compareFrames(
  baseline: VisualFrameSample,
  current: VisualFrameSample,
  pixelDeltaThreshold: number,
) {
  const pixels = current.width * current.height;
  let changedPixels = 0;
  let totalDelta = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const delta =
      Math.abs(baseline.data[offset]! - current.data[offset]!) +
      Math.abs(baseline.data[offset + 1]! - current.data[offset + 1]!) +
      Math.abs(baseline.data[offset + 2]! - current.data[offset + 2]!);
    totalDelta += delta;
    if (delta >= pixelDeltaThreshold) changedPixels += 1;
  }
  return {
    changedRatio: pixels === 0 ? 0 : changedPixels / pixels,
    meanDelta: pixels === 0 ? 0 : totalDelta / pixels,
  };
}

/**
 * Inspect a small decoded frame at a bounded cadence.
 *
 * Small movement/noise retains the accepted baseline and fingerprint. That is
 * important: comparing every frame only to the immediately previous frame
 * would allow a gradual transition to evade the material-change threshold.
 */
export function inspectVisualFrame(
  state: VisualFrameDetectorState,
  frame: VisualFrameSample,
  sampledAt: number,
  options: VisualFrameDetectorOptions = {},
): VisualFrameDetectorResult {
  const config = normalizedOptions(options);
  if (!visualFrameSampleDue(state, sampledAt, config)) {
    return { state, sampled: false };
  }

  // A bad browser frame must never poison the last proven visual state.
  if (!validFrame(frame)) {
    return {
      state: { ...state, lastSampledAt: sampledAt },
      sampled: true,
    };
  }

  const nextBase: VisualFrameDetectorState = {
    ...state,
    lastSampledAt: sampledAt,
  };
  if (
    !state.baseline ||
    !state.fingerprint ||
    state.baseline.width !== frame.width ||
    state.baseline.height !== frame.height
  ) {
    const fingerprint = visualFrameFingerprint(frame);
    const previousFingerprint = state.fingerprint;
    return {
      state: {
        ...nextBase,
        baseline: copyFrame(frame),
        fingerprint,
      },
      sampled: true,
      signal: {
        fingerprint,
        sampledAt,
        changedRatio: previousFingerprint ? 1 : 0,
        meanDelta: previousFingerprint ? 255 * 3 : 0,
        ...(previousFingerprint ? { previousFingerprint } : {}),
      },
    };
  }

  const comparison = compareFrames(state.baseline, frame, config.pixelDeltaThreshold);
  if (comparison.changedRatio < config.minChangedRatio) {
    return { state: nextBase, sampled: true };
  }

  const fingerprint = visualFrameFingerprint(frame);
  return {
    state: {
      ...nextBase,
      baseline: copyFrame(frame),
      fingerprint,
    },
    sampled: true,
    signal: {
      fingerprint,
      sampledAt,
      ...comparison,
      previousFingerprint: state.fingerprint,
    },
  };
}
