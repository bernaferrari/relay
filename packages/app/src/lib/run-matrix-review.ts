import type { JobInfo } from "./api-types";

type FrozenMatrixInputs = {
  kind?: unknown;
  world?: unknown;
  values?: unknown;
  expectedScreenshots?: unknown;
};

export type RunMatrixValue = { name: string; value: string };
export type RunMatrixCapture = {
  index: number;
  caption: string;
  frame: NonNullable<JobInfo["frames"]>[number] | undefined;
};
export type RunMatrixRow = {
  job: JobInfo;
  world: string;
  values: RunMatrixValue[];
  captures: RunMatrixCapture[];
  expectedScreenshots?: number;
};
export type RunMatrixReview = {
  rows: RunMatrixRow[];
  captureLabels: string[];
  passed: number;
  failed: number;
  active: number;
  complete: number;
};

function frozenInputs(job: JobInfo): FrozenMatrixInputs | undefined {
  if (job.matrixCase) return job.matrixCase;
  const data = job.artifacts?.find((artifact) => artifact.kind === "frozen-inputs")?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  return data as FrozenMatrixInputs;
}

export function isRunMatrixJob(job: JobInfo): boolean {
  return job.matrixCase?.kind === "combine" || frozenInputs(job)?.kind === "combine";
}

function readableCaption(caption: string | undefined, index: number): string {
  const value = caption?.replace(/^(screen|tour|final):/, "").trim();
  return value || `Screenshot ${index + 1}`;
}

function valuesFor(job: JobInfo): RunMatrixValue[] {
  const data = frozenInputs(job)?.values;
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const values = data as Record<string, unknown>;
  return Object.entries(values).flatMap(([name, raw]) => {
    if (/_((identifier)|(label)|(text))$/.test(name)) return [];
    if (typeof raw !== "string" || !raw.trim() || raw === "-") return [];
    const label = values[`${name}_label`];
    return [
      {
        name,
        value: typeof label === "string" && label.trim() && label !== "-" ? label : raw,
      },
    ];
  });
}

export function projectRunMatrix(rows: JobInfo[]): RunMatrixReview | null {
  const matrixRows = rows
    .filter(isRunMatrixJob)
    .sort((left, right) => (left.caseIndex ?? 0) - (right.caseIndex ?? 0));
  if (!matrixRows.length) return null;
  // Reserve the complete result shape as soon as a matrix starts. Otherwise
  // columns appear one by one while screenshots arrive and the review table
  // visibly jumps during the run.
  const captureCount = Math.max(
    0,
    ...matrixRows.map((job) => {
      const expected = frozenInputs(job)?.expectedScreenshots;
      return Math.max(
        job.frames?.length ?? 0,
        typeof expected === "number" && Number.isFinite(expected) ? expected : 0,
      );
    }),
  );
  const captureLabels = Array.from({ length: captureCount }, (_, index) => {
    const frame = matrixRows.find((job) => job.frames?.[index])?.frames?.[index];
    return readableCaption(frame?.caption, index);
  });
  const projected = matrixRows.map((job, rowIndex): RunMatrixRow => {
    const data = frozenInputs(job);
    const world =
      typeof data?.world === "string" && data.world.trim() ? data.world : `Run ${rowIndex + 1}`;
    const expected = data?.expectedScreenshots;
    return {
      job,
      world,
      values: valuesFor(job),
      captures: captureLabels.map((caption, index) => ({
        index,
        caption,
        frame: job.frames?.[index],
      })),
      ...(typeof expected === "number" && Number.isFinite(expected)
        ? { expectedScreenshots: expected }
        : {}),
    };
  });
  const active = matrixRows.filter((job) =>
    ["queued", "running", "paused"].includes(job.status),
  ).length;
  const failed = matrixRows.filter(
    (job) => job.status === "error" || job.status === "cancelled",
  ).length;
  const passed = matrixRows.filter((job) => job.status === "ok" || job.status === "healed").length;
  return {
    rows: projected,
    captureLabels,
    passed,
    failed,
    active,
    complete: passed + failed,
  };
}

export function stepIndexForMatrixCapture(job: JobInfo, frameIndex: number): number {
  const target = job.frames?.[frameIndex];
  if (!target) return 0;
  const step = job.steps?.findIndex((candidate) =>
    candidate.frames?.some(
      (frame) => frame.path === target.path && frame.capturedAt === target.capturedAt,
    ),
  );
  return step !== undefined && step >= 0
    ? step
    : Math.min(frameIndex, (job.steps?.length ?? 1) - 1);
}
