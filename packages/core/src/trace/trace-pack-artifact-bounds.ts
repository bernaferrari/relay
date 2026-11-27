import type { TracePackObject } from "@relay/protocol";

export type TracePackExportLimits = {
  maxArtifacts?: number;
  maxArtifactBytes?: number;
  maxTotalArtifactBytes?: number;
};

export type RequiredTracePackArtifactLimits = Required<TracePackExportLimits>;

const DEFAULT_LIMITS = {
  maxArtifacts: 10_000,
  maxArtifactBytes: 512 * 1024 * 1024,
  maxTotalArtifactBytes: 1024 * 1024 * 1024,
} as const;

export function tracePackArtifactLimits(
  input: TracePackExportLimits,
): RequiredTracePackArtifactLimits {
  const result = { ...DEFAULT_LIMITS, ...input };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`TracePack ${name} must be a positive safe integer`);
    }
  }
  return result;
}

export function assertTracePackArtifactBounds(
  objects: readonly TracePackObject[],
  requestedLimits: TracePackExportLimits = {},
): void {
  const limits = tracePackArtifactLimits(requestedLimits);
  const artifacts = objects.filter((object) => object.kind !== "frozen-run");
  if (artifacts.length > limits.maxArtifacts) {
    throw new Error(`TracePack artifact object limit exceeded (${limits.maxArtifacts})`);
  }
  let total = 0;
  for (const object of artifacts) {
    if (object.bytes > limits.maxArtifactBytes) {
      throw new Error(`TracePack artifact object exceeds byte limit: ${object.path}`);
    }
    if (
      object.encoding === "base64" &&
      typeof object.content === "string" &&
      object.content.length > Math.ceil(limits.maxArtifactBytes / 3) * 4 + 4
    ) {
      throw new Error(`TracePack artifact encoding exceeds byte limit: ${object.path}`);
    }
    total += object.bytes;
    if (total > limits.maxTotalArtifactBytes) {
      throw new Error(
        `TracePack aggregate artifact byte limit exceeded (${limits.maxTotalArtifactBytes})`,
      );
    }
  }
}
