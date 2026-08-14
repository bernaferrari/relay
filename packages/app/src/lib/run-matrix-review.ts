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
  missingCaptures: number;
};
export type RunMatrixInsight = {
  kind: "failure" | "missing-capture";
  label: string;
  count: number;
  detail: string;
};
export type RunMatrixReview = {
  batchId?: string;
  rows: RunMatrixRow[];
  captureLabels: string[];
  passed: number;
  failed: number;
  active: number;
  complete: number;
  missingCaptures: number;
  problemRuns: number;
  insights: RunMatrixInsight[];
};

export const matrixReviewPageSize = 12;

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

function requestedScreenshotFrames(job: JobInfo): Array<{
  index: number;
  frame: NonNullable<JobInfo["frames"]>[number];
}> {
  const frames = job.frames ?? [];
  const requested = frames.flatMap((frame, index) =>
    /^(screen|tour|final):/.test(frame.caption ?? "") ? [{ index, frame }] : [],
  );
  // Reusable screenshot tours label their intentional captures. Keep setup
  // before/after evidence in replay, but do not let it double the review grid.
  return requested.length ? requested : frames.map((frame, index) => ({ index, frame }));
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
        requestedScreenshotFrames(job).length,
        typeof expected === "number" && Number.isFinite(expected) ? expected : 0,
      );
    }),
  );
  const captureLabels = Array.from({ length: captureCount }, (_, index) => {
    const frame = matrixRows.map(requestedScreenshotFrames).find((frames) => frames[index])?.[
      index
    ]?.frame;
    return readableCaption(frame?.caption, index);
  });
  const projected = matrixRows.map((job, rowIndex): RunMatrixRow => {
    const data = frozenInputs(job);
    const screenshots = requestedScreenshotFrames(job);
    const world =
      typeof data?.world === "string" && data.world.trim() ? data.world : `Run ${rowIndex + 1}`;
    const expected = data?.expectedScreenshots;
    const terminal = ["ok", "healed", "error", "cancelled"].includes(job.status);
    const expectedCount =
      typeof expected === "number" && Number.isFinite(expected) ? Math.max(0, expected) : undefined;
    return {
      job,
      world,
      values: valuesFor(job),
      captures: captureLabels.map((caption, index) => {
        const screenshot = screenshots[index];
        return {
          index: screenshot?.index ?? index,
          caption,
          frame: screenshot?.frame,
        };
      }),
      missingCaptures:
        terminal && expectedCount !== undefined
          ? Math.max(0, expectedCount - screenshots.length)
          : 0,
      ...(expectedCount !== undefined ? { expectedScreenshots: expectedCount } : {}),
    };
  });
  const active = matrixRows.filter((job) =>
    ["queued", "running", "paused"].includes(job.status),
  ).length;
  const failed = matrixRows.filter(
    (job) => job.status === "error" || job.status === "cancelled",
  ).length;
  const passed = matrixRows.filter((job) => job.status === "ok" || job.status === "healed").length;
  const failedValues = new Map<string, { count: number; label: string }>();
  const missingByCapture = new Map<string, number>();
  for (const row of projected) {
    if (row.job.status === "error" || row.job.status === "cancelled") {
      const dimensions = row.values.length
        ? row.values.map((value) => `${value.name}: ${value.value}`)
        : [row.world];
      for (const label of dimensions) {
        failedValues.set(label, {
          label,
          count: (failedValues.get(label)?.count ?? 0) + 1,
        });
      }
    }
    if (row.missingCaptures > 0) {
      for (const capture of row.captures
        .filter((item) => !item.frame)
        .slice(0, row.missingCaptures)) {
        missingByCapture.set(capture.caption, (missingByCapture.get(capture.caption) ?? 0) + 1);
      }
    }
  }
  const insights: RunMatrixInsight[] = [
    ...[...failedValues.values()].map((item) => ({
      kind: "failure" as const,
      label: item.label,
      count: item.count,
      detail: `${item.count} failed ${item.count === 1 ? "run" : "runs"}`,
    })),
    ...[...missingByCapture].map(([label, count]) => ({
      kind: "missing-capture" as const,
      label,
      count,
      detail: `Missing in ${count} ${count === 1 ? "run" : "runs"}`,
    })),
  ]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 4);
  return {
    ...(matrixRows[0]?.batchId ? { batchId: matrixRows[0].batchId } : {}),
    rows: projected,
    captureLabels,
    passed,
    failed,
    active,
    complete: passed + failed,
    missingCaptures: projected.reduce((total, row) => total + row.missingCaptures, 0),
    problemRuns: projected.filter(
      (row) =>
        row.missingCaptures > 0 || row.job.status === "error" || row.job.status === "cancelled",
    ).length,
    insights,
  };
}

export function filterRunMatrixRows(
  review: RunMatrixReview,
  input: { query?: string; problemsOnly?: boolean },
): RunMatrixRow[] {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  return review.rows.filter((row) => {
    const problem =
      row.missingCaptures > 0 || row.job.status === "error" || row.job.status === "cancelled";
    if (input.problemsOnly && !problem) return false;
    if (!query) return true;
    return [
      row.world,
      ...row.values.flatMap((value) => [value.name, value.value]),
      ...row.captures.map((capture) => capture.caption),
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}

export function matrixUsesLocaleDimension(review: RunMatrixReview): boolean {
  return review.rows.some((row) =>
    row.values.some((value) => /(?:language|locale)/i.test(value.name.trim())),
  );
}

export function problemRetryLabel(review: RunMatrixReview): string {
  const count = review.problemRuns;
  if (matrixUsesLocaleDimension(review)) {
    return `Retry ${count} problem ${count === 1 ? "locale" : "locales"}`;
  }
  return `Retry ${count} problem ${count === 1 ? "run" : "runs"}`;
}

export type CurrentLocaleRetry = {
  appMapId: string;
  combineId: string;
  selected: Record<string, string[]>;
};

/** Build the narrow “fix → rerun current Test” request only when this is a
 * one-dimensional locale matrix. Multi-dimensional problem cells need an
 * exact case-list API; expanding unions here could silently run extra cells. */
export function currentLocaleRetry(review: RunMatrixReview): CurrentLocaleRetry | null {
  const problems = review.rows.filter(
    (row) => row.missingCaptures > 0 || ["error", "cancelled"].includes(row.job.status),
  );
  if (!problems.length) return null;
  const first = problems[0]!.job.matrixCase;
  if (!first?.appMapId || !first.combineId) return null;
  const selected = new Map<string, Set<string>>();
  for (const row of problems) {
    const matrixCase = row.job.matrixCase;
    if (
      !matrixCase ||
      matrixCase.appMapId !== first.appMapId ||
      matrixCase.combineId !== first.combineId
    ) {
      return null;
    }
    const dimensions = Object.entries(matrixCase.values).filter(
      ([name, value]) =>
        !/_((identifier)|(label)|(text))$/i.test(name) && typeof value === "string" && value.trim(),
    );
    if (dimensions.length !== 1 || !/(?:language|locale)/i.test(dimensions[0]![0])) return null;
    const [name, value] = dimensions[0]!;
    const values = selected.get(name) ?? new Set<string>();
    values.add(value);
    selected.set(name, values);
  }
  return {
    appMapId: first.appMapId,
    combineId: first.combineId,
    selected: Object.fromEntries(
      [...selected]
        .map(([name, values]): [string, string[]] => [name, [...values]])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

/** Keeps large value sets calm in the UI without hiding evidence from export. */
export function pageRunMatrixRows(
  rows: RunMatrixRow[],
  visibleCount = matrixReviewPageSize,
): RunMatrixRow[] {
  return rows.slice(0, Math.max(0, visibleCount));
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
