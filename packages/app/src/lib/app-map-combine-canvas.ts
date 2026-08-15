import type { AppMap } from "@relay/protocol";
import type { JobInfo } from "./api-types";
import { projectRunMatrix } from "./run-matrix-review";
import { combineHeadline, combineValueLabel, projectCombine } from "./app-map-combine-presentation";
import { SCREEN_CARD_WIDTH } from "./app-map-canvas-layout";

export type CanvasCombineCardModel = {
  id: string;
  name: string;
  position: { x: number; y: number };
  startsAt?: { screenId: string; title: string; position: { x: number; y: number } };
  modifiers: Array<{ id: string; name: string; values: string[] }>;
  tests: string[];
  cellCount: number;
  run?: {
    jobId: string;
    batchId?: string;
    complete: number;
    total: number;
    passed: number;
    problems: number;
    active: number;
  };
};

export type CanvasCombineSection = "modifiers" | "tests" | "plan";

export const CANVAS_COMBINE_CARD_WIDTH = 300;
export const CANVAS_COMBINE_CARD_HEIGHT = 160;

const CARD_GAP = 28;
const CARD_STACK = CANVAS_COMBINE_CARD_HEIGHT + 16;
const PREVIEW_VALUES = 3;

function selectedOptions<T extends { id: string }>(
  options: T[],
  selected: string[] | undefined,
): T[] {
  if (!selected) return options;
  const selectedIds = new Set(selected);
  return options.filter((option) => selectedIds.has(option.id));
}

export function canvasCombineCards(
  map: Pick<AppMap, "combines" | "tests" | "variables">,
  screenFor: (
    screenId: string,
  ) => { position: { x: number; y: number }; title: string } | undefined,
  jobs: readonly JobInfo[] = [],
): CanvasCombineCardModel[] {
  const combines = Object.values(map.combines ?? {});
  return combines.map((combine, index) => {
    const tests = combine.testIds
      .map((id) => map.tests?.[id])
      .filter((test): test is NonNullable<typeof test> => Boolean(test));
    const variables = combine.variableIds
      .map((id) => map.variables?.[id])
      .filter((variable): variable is NonNullable<typeof variable> => Boolean(variable));
    const rootScreenId = tests
      .flatMap((test) =>
        test.steps.flatMap((step) =>
          step.kind === "validation" &&
          step.binding.status === "resolved" &&
          step.binding.kind === "assertion" &&
          step.binding.assertion.kind === "screen"
            ? [step.binding.assertion.screenId]
            : [],
        ),
      )
      .find((id) => id.trim());
    const rootScreen = rootScreenId ? screenFor(rootScreenId) : undefined;
    const anchor = rootScreen?.position;
    const modifiers = variables.map((variable) => ({
      id: variable.id,
      name: variable.name,
      values: selectedOptions(variable.options, combine.selected?.[variable.id])
        .map((option) => combineValueLabel(option))
        .filter(Boolean)
        .slice(0, PREVIEW_VALUES),
    }));
    const testNames = tests.map((test) => test.name).filter(Boolean);
    const projection = projectCombine(
      variables.map((variable) => ({
        id: variable.id,
        name: variable.name,
        values: selectedOptions(variable.options, combine.selected?.[variable.id]).map(
          (option) => ({
            id: option.id,
            label: combineValueLabel(option),
          }),
        ),
      })),
      tests.map((test) => ({ id: test.id, name: test.name, kind: test.kind })),
      combine.strategy ?? (variables.length > 1 ? "cartesian" : "zip"),
      1,
    );
    const ownedJobs = jobs.filter((job) => job.matrixCase?.combineId === combine.id);
    const newest = ownedJobs.reduce<JobInfo | undefined>(
      (latest, job) => (!latest || job.queuedAt > latest.queuedAt ? job : latest),
      undefined,
    );
    const batchJobs = newest?.batchId
      ? ownedJobs.filter((job) => job.batchId === newest.batchId)
      : newest
        ? [newest]
        : [];
    const runReview = projectRunMatrix(batchJobs);
    return {
      id: combine.id,
      name: combineHeadline({
        variableNames: variables.map((variable) => variable.name),
        testNames,
        cellCount: projection.cellCount,
      }),
      position: {
        x: (anchor?.x ?? 48) + SCREEN_CARD_WIDTH + CARD_GAP,
        y: (anchor?.y ?? 48) + index * CARD_STACK,
      },
      ...(rootScreenId && rootScreen
        ? {
            startsAt: {
              screenId: rootScreenId,
              title: rootScreen.title,
              position: rootScreen.position,
            },
          }
        : {}),
      modifiers,
      tests: testNames,
      cellCount: projection.cellCount,
      ...(runReview && newest
        ? {
            run: {
              jobId: newest.id,
              ...(newest.batchId ? { batchId: newest.batchId } : {}),
              complete: runReview.complete,
              total: runReview.rows.length,
              passed: runReview.passed,
              problems: runReview.problemRuns,
              active: runReview.active,
            },
          }
        : {}),
    };
  });
}
