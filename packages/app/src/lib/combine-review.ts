import { parseAppMapTestTupleIdentity, type AppMapTestTupleIdentity } from "@relay/protocol";
import type { JobInfo } from "./api-types";

type FrozenCombineInputs = {
  kind?: unknown;
  appMapId?: unknown;
  testId?: unknown;
  combineId?: unknown;
  world?: unknown;
  values?: unknown;
  expectedScreenshots?: unknown;
};

export type CombineValue = { name: string; value: string };
export type CombineCapture = {
  index: number;
  caption: string;
  frame: NonNullable<JobInfo["frames"]>[number] | undefined;
};
export type CombineRow = {
  job: JobInfo;
  world: string;
  values: CombineValue[];
  captures: CombineCapture[];
  expectedScreenshots?: number;
  missingCaptures: number;
};
export type CombineInsight = {
  kind: "failure" | "missing-capture";
  label: string;
  count: number;
  detail: string;
};
export type CombineReview = {
  batchId?: string;
  rows: CombineRow[];
  captureLabels: string[];
  passed: number;
  failed: number;
  active: number;
  complete: number;
  missingCaptures: number;
  problemRuns: number;
  insights: CombineInsight[];
};

export const combineReviewPageSize = 12;

function frozenInputs(job: JobInfo): FrozenCombineInputs | undefined {
  if (job.matrixCase) return job.matrixCase;
  const data = job.artifacts?.find((artifact) => artifact.kind === "frozen-inputs")?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  return data as FrozenCombineInputs;
}

export function isCombineJob(job: JobInfo): boolean {
  const kind = frozenInputs(job)?.kind;
  return kind === "combine" || kind === "combine-cell";
}

/** One identity projection for live summaries and hydrated persisted Runs. */
export function combineCaseIdentity(job: JobInfo): AppMapTestTupleIdentity | undefined {
  const data = frozenInputs(job);
  if (data?.kind !== "combine" && data?.kind !== "combine-cell") return undefined;
  return parseAppMapTestTupleIdentity(data);
}

function readableCaption(caption: string | undefined, index: number): string {
  const value = caption?.replace(/^(screen|tour|final):/, "").trim();
  return value || `Screenshot ${index + 1}`;
}

function checkpointIdentity(caption: string | undefined): string | undefined {
  return caption?.trim() || undefined;
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

type RequestedScreenshot = ReturnType<typeof requestedScreenshotFrames>[number];

function alignScreenshotFrames(
  screenshots: RequestedScreenshot[],
  captureLabels: string[],
  captureIdentities: Array<string | undefined>,
): Array<RequestedScreenshot | undefined> {
  const aligned: Array<RequestedScreenshot | undefined> = captureLabels.map(() => undefined);
  const used = new Set<number>();
  for (const [captureIndex, identity] of captureIdentities.entries()) {
    if (!identity) continue;
    const screenshotIndex = screenshots.findIndex(
      (screenshot, index) =>
        !used.has(index) && checkpointIdentity(screenshot.frame.caption) === identity,
    );
    if (screenshotIndex < 0) continue;
    aligned[captureIndex] = screenshots[screenshotIndex];
    used.add(screenshotIndex);
  }

  const hasIdentityMatch = used.size > 0;
  for (const [captureIndex, label] of captureLabels.entries()) {
    if (aligned[captureIndex]) continue;
    // Old runs can have localized or unlabeled captions. Positional fallback is
    // safe only when no checkpoint identity matched, every column is present,
    // or the column is still an expected-count placeholder. Once an identity
    // anchor proves a partial run skipped an earlier checkpoint, shifting the
    // later capture left would present evidence under the wrong checkpoint.
    const mayUsePosition =
      !hasIdentityMatch ||
      screenshots.length >= captureLabels.length ||
      label === `Screenshot ${captureIndex + 1}`;
    const positional = screenshots[captureIndex];
    if (!mayUsePosition || !positional || used.has(captureIndex)) continue;
    aligned[captureIndex] = positional;
    used.add(captureIndex);
  }
  return aligned;
}

function valuesFor(job: JobInfo): CombineValue[] {
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

export function projectCombineReview(rows: JobInfo[]): CombineReview | null {
  const combineRuns = rows
    .filter(isCombineJob)
    .sort((left, right) => (left.caseIndex ?? 0) - (right.caseIndex ?? 0));
  if (!combineRuns.length) return null;
  // Reserve the complete result shape as soon as a Combine starts. Otherwise
  // columns appear one by one while screenshots arrive and the review table
  // visibly jumps during the run.
  const captureCount = Math.max(
    0,
    ...combineRuns.map((job) => {
      const expected = frozenInputs(job)?.expectedScreenshots;
      return Math.max(
        requestedScreenshotFrames(job).length,
        typeof expected === "number" && Number.isFinite(expected) ? expected : 0,
      );
    }),
  );
  const templateScreenshots = combineRuns
    .map(requestedScreenshotFrames)
    .reduce<RequestedScreenshot[]>(
      (template, screenshots) => (screenshots.length > template.length ? screenshots : template),
      [],
    );
  const captureLabels = Array.from({ length: captureCount }, (_, index) => {
    const frame = templateScreenshots[index]?.frame;
    return readableCaption(frame?.caption, index);
  });
  const captureIdentities = Array.from({ length: captureCount }, (_, index) =>
    checkpointIdentity(templateScreenshots[index]?.frame.caption),
  );
  const projected = combineRuns.map((job, rowIndex): CombineRow => {
    const data = frozenInputs(job);
    const screenshots = requestedScreenshotFrames(job);
    const world =
      typeof data?.world === "string" && data.world.trim() ? data.world : `Run ${rowIndex + 1}`;
    const expected = data?.expectedScreenshots;
    const terminal = ["ok", "healed", "error", "cancelled"].includes(job.status);
    const expectedCount =
      typeof expected === "number" && Number.isFinite(expected) ? Math.max(0, expected) : undefined;
    const alignedScreenshots = alignScreenshotFrames(screenshots, captureLabels, captureIdentities);
    return {
      job,
      world,
      values: valuesFor(job),
      captures: captureLabels.map((caption, index) => {
        const screenshot = alignedScreenshots[index];
        return {
          index: screenshot?.index ?? index,
          caption,
          frame: screenshot?.frame,
        };
      }),
      missingCaptures:
        terminal && expectedCount !== undefined
          ? alignedScreenshots.slice(0, expectedCount).filter((screenshot) => !screenshot).length
          : 0,
      ...(expectedCount !== undefined ? { expectedScreenshots: expectedCount } : {}),
    };
  });
  const active = combineRuns.filter((job) =>
    ["queued", "running", "paused"].includes(job.status),
  ).length;
  const failed = combineRuns.filter(
    (job) => job.status === "error" || job.status === "cancelled",
  ).length;
  const passed = combineRuns.filter((job) => job.status === "ok" || job.status === "healed").length;
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
  const insights: CombineInsight[] = [
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
    ...(combineRuns[0]?.batchId ? { batchId: combineRuns[0].batchId } : {}),
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

export function filterCombineRows(
  review: CombineReview,
  input: { query?: string; problemsOnly?: boolean },
): CombineRow[] {
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

export function combineUsesLocaleVariable(review: CombineReview): boolean {
  return review.rows.some((row) =>
    row.values.some((value) => /(?:language|locale)/i.test(value.name.trim())),
  );
}

export function combineProblemRetryLabel(review: CombineReview): string {
  const count = review.problemRuns;
  if (combineUsesLocaleVariable(review)) {
    return `Retry ${count} problem ${count === 1 ? "locale" : "locales"}`;
  }
  return `Retry ${count} problem ${count === 1 ? "run" : "runs"}`;
}

export type CurrentLocaleRetry = {
  appMapId: string;
  testId: string;
  variableIds: string[];
  selected: Record<string, string[]>;
};

/** Build the narrow “fix → rerun current Test” request only when this is a
 * one-dimensional locale Combine. Multi-variable problem cells need an
 * exact case-list API; expanding unions here could silently run extra cells. */
export function currentLocaleCombineRetry(review: CombineReview): CurrentLocaleRetry | null {
  const problems = review.rows.filter(
    (row) => row.missingCaptures > 0 || ["error", "cancelled"].includes(row.job.status),
  );
  if (!problems.length) return null;
  const first = combineCaseIdentity(problems[0]!.job);
  if (!first) return null;
  const selected = new Map<string, Set<string>>();
  for (const row of problems) {
    const combineCase = combineCaseIdentity(row.job);
    if (
      !combineCase ||
      combineCase.appMapId !== first.appMapId ||
      combineCase.testId !== first.testId
    ) {
      return null;
    }
    const dimensions = Object.entries(combineCase.values).filter(
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
    testId: first.testId,
    variableIds: [...selected.keys()].sort((left, right) => left.localeCompare(right)),
    selected: Object.fromEntries(
      [...selected]
        .map(([name, values]): [string, string[]] => [name, [...values]])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

/** Keeps large value sets calm in the UI without hiding evidence from export. */
export function pageCombineRows(
  rows: CombineRow[],
  visibleCount = combineReviewPageSize,
): CombineRow[] {
  return rows.slice(0, Math.max(0, visibleCount));
}

export function stepIndexForCombineCapture(job: JobInfo, frameIndex: number): number {
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
