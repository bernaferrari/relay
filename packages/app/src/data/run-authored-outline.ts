import type {
  ReportAuthoredOutline,
  ReportAuthoredStep,
  ReportTimelineItem,
} from "./run-report-model";
import { reportTraceSteps } from "./run-story";

type ObjectRecord = Record<string, unknown>;
type Occurrence = { raw: ObjectRecord; item: ReportTimelineItem; position: number };
const pair = (recipeId: string, stepId: string) => JSON.stringify([recipeId, stepId]);
const object = (value: unknown): ObjectRecord | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectRecord) : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
const time = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

function frozenExecution(run: ObjectRecord) {
  const intents = list(run.artifacts)
    .map(object)
    .filter(
      (item) =>
        item?.kind === "app-map-test-execution-intent" ||
        item?.kind === "app-map-combine-cell-execution-intent",
    );
  if (intents.length !== 1) return undefined;
  const artifact = intents[0]!;
  const data = object(artifact.data);
  if (data?.schemaVersion !== 1 || data.kind !== artifact.kind) return undefined;
  const execution =
    artifact.kind === "app-map-combine-cell-execution-intent" ? object(data.child) : data;
  const plan = object(execution?.plan);
  const graph = object(execution?.recipeGraph);
  const rootId = text(plan?.rootRecipeId);
  const testId = text(object(plan?.test)?.id);
  const root = rootId ? object(graph?.[rootId]) : undefined;
  if (
    execution?.schemaVersion !== 1 ||
    execution.kind !== "app-map-test-execution-intent" ||
    plan?.schemaVersion !== 1 ||
    !graph ||
    !rootId ||
    !testId ||
    root?.id !== rootId ||
    !Array.isArray(root.steps)
  )
    return undefined;
  if (
    artifact.kind === "app-map-combine-cell-execution-intent" &&
    object(data.wrapper)?.childRootRecipeId !== rootId
  )
    return undefined;
  return { plan, graph, rootId, testId, rootSteps: root.steps };
}

function stepIdentity(recipeId: string, step: ObjectRecord, index: number) {
  return text(step.id) ?? `${recipeId}:${index + 1}`;
}

function descendantRecipes(graph: ObjectRecord, step: ObjectRecord): Set<string> | undefined {
  const visited = new Set<string>();
  const visit = (recipeId: string): boolean => {
    if (visited.has(recipeId)) return true;
    const recipe = object(graph[recipeId]);
    if (recipe?.id !== recipeId || !Array.isArray(recipe.steps)) return false;
    visited.add(recipeId);
    return recipe.steps.every((value) => {
      const child = object(value);
      return child && references(child).every(visit);
    });
  };
  return references(step).every(visit) ? visited : undefined;
}

function references(step: ObjectRecord): string[] {
  const recovery = object(object(step.check)?.recovery);
  const cleanup = object(object(step.check)?.cleanup);
  return [
    step.recipeId,
    step.thenRecipeId,
    step.elseRecipeId,
    recovery?.recipeId,
    cleanup?.recipeId,
  ].flatMap((value) => (text(value) ? [text(value)!] : []));
}

function recipeStepTitle(step: ObjectRecord): string {
  if (step.kind === "expect")
    return step.condition === "gone" ? "Check control is gone" : "Check control is visible";
  if (step.kind === "wait-response") return "Wait for a new reply";
  if (step.kind === "extract-response") return "Read the reply";
  if (step.kind === "type") return "Type text";
  return text(step.title) ?? "Test action";
}

function occurrenceWithin(child: Occurrence, parent: Occurrence, endPosition: number) {
  const start = time(parent.raw.startedAt);
  const end = time(parent.raw.finishedAt);
  const childStart = time(child.raw.startedAt);
  const childEnd = time(child.raw.finishedAt);
  return (
    start !== undefined &&
    end !== undefined &&
    end >= start &&
    childStart !== undefined &&
    childEnd !== undefined &&
    childEnd >= childStart &&
    child.position > parent.position &&
    child.position < endPosition &&
    childStart >= start &&
    childEnd <= end
  );
}

function summaryState(anchors: readonly ReportTimelineItem[]): ReportTimelineItem["state"] {
  for (const state of ["failed", "blocked", "running", "recovered"] as const) {
    if (anchors.some((item) => item.state === state)) return state;
  }
  return anchors.length && anchors.every((item) => item.state === "passed") ? "passed" : "pending";
}

/** Presentation only. An ambiguous occurrence keeps the existing diagnostic outline. */
export function authoredRunOutline(rawRun: unknown): ReportAuthoredOutline | undefined {
  const run = object(rawRun);
  const frozen = run && frozenExecution(run);
  if (!run || !frozen) return undefined;
  const { plan, graph, rootId, testId, rootSteps } = frozen;
  const owners = new Map<string, string>();
  for (const value of list(plan.stepProvenance)) {
    const source = object(value);
    const recipeId = text(source?.recipeId);
    const recipeStepId = text(source?.recipeStepId);
    const testStepId = text(source?.testStepId);
    const recipe = recipeId ? object(graph[recipeId]) : undefined;
    const index = source?.stepIndex;
    const step =
      Number.isInteger(index) && typeof index === "number"
        ? object(list(recipe?.steps)[index])
        : undefined;
    if (
      !source ||
      source.testId !== testId ||
      !recipeId ||
      !recipeStepId ||
      !testStepId ||
      recipe?.id !== recipeId ||
      !step ||
      stepIdentity(recipeId, step, index as number) !== recipeStepId
    )
      return undefined;
    const key = pair(recipeId, recipeStepId);
    if (owners.has(key)) return undefined;
    owners.set(key, testStepId);
  }
  const groups = new Map<string, { title: string; keys: string[]; children: Occurrence[] }>();
  let previousOwner: string | undefined;
  for (const [index, value] of rootSteps.entries()) {
    const step = object(value);
    if (!step) return undefined;
    const key = pair(rootId, stepIdentity(rootId, step, index));
    const owner = owners.get(key);
    if (!owner) continue;
    if (groups.has(owner) && previousOwner !== owner) return undefined;
    previousOwner = owner;
    const check = object(step.check);
    if (check && check.id !== owner) return undefined;
    const title = text(check?.title) ?? recipeStepTitle(step);
    const group = groups.get(owner) ?? { title, keys: [], children: [] };
    group.keys.push(key);
    groups.set(owner, group);
  }
  if (!groups.size) return undefined;
  if ([...owners.values()].some((owner) => !groups.has(owner))) return undefined;
  const presented = new Map(reportTraceSteps(run).map((item) => [item.id, item]));
  const occurrences: Occurrence[] = [];
  const byKey = new Map<string, Occurrence>();
  const ids = new Set<string>();
  for (const [position, value] of list(run.steps).entries()) {
    const raw = object(value);
    const id = text(raw?.id);
    const item = id ? presented.get(id) : undefined;
    if (!raw || !id || ids.has(id) || !item) return undefined;
    ids.add(id);
    const occurrence = {
      raw,
      position,
      item: {
        ...item,
        state:
          raw.status === "healed" || raw.status === "recovered"
            ? ("recovered" as const)
            : raw.status === "blocked"
              ? ("blocked" as const)
              : item.state,
        ...(time(raw.startedAt) === undefined ? {} : { startedAt: time(raw.startedAt) }),
        ...(time(raw.finishedAt) === undefined ? {} : { finishedAt: time(raw.finishedAt) }),
      },
    };
    occurrences.push(occurrence);
    const recipeId = text(raw.recipeId);
    const stepId = text(raw.recipeStepId);
    if (!recipeId || !stepId) continue;
    const key = pair(recipeId, stepId);
    if (byKey.has(key)) return undefined;
    byKey.set(key, occurrence);
  }
  const rootOccurrences = occurrences.filter((item) => item.raw.recipeId === rootId);
  let lastRootIndex = -1;
  let previousEnd = 0;
  const rootIndexes = new Map(
    rootSteps.map((value, index) => [
      pair(rootId, stepIdentity(rootId, object(value)!, index)),
      index,
    ]),
  );
  for (const occurrence of rootOccurrences) {
    const index = rootIndexes.get(pair(rootId, text(occurrence.raw.recipeStepId) ?? ""));
    const start = time(occurrence.raw.startedAt);
    const end = time(occurrence.raw.finishedAt);
    if (
      index === undefined ||
      index <= lastRootIndex ||
      start === undefined ||
      end === undefined ||
      end < start ||
      start < previousEnd
    )
      return undefined;
    lastRootIndex = index;
    previousEnd = end;
  }
  const supportingSteps: ReportTimelineItem[] = [];
  for (const occurrence of occurrences) {
    const recipeId = text(occurrence.raw.recipeId);
    const stepId = text(occurrence.raw.recipeStepId);
    const owner = recipeId && stepId ? owners.get(pair(recipeId, stepId)) : undefined;
    const recipe = recipeId ? object(graph[recipeId]) : undefined;
    if (
      recipe &&
      (!stepId ||
        !list(recipe.steps).some((value, index) => {
          const step = object(value);
          return step && stepIdentity(recipeId!, step, index) === stepId;
        }) ||
        (recipeId !== rootId && !owner))
    )
      return undefined;
    const group = owner ? groups.get(owner) : undefined;
    if (!group) {
      supportingSteps.push(occurrence.item);
      continue;
    }
    if (recipeId !== rootId) {
      const candidates = group.keys.flatMap((key) => {
        const anchor = byKey.get(key);
        const index = rootIndexes.get(key);
        const step = index === undefined ? undefined : object(rootSteps[index]);
        if (!anchor || !step) return [];
        const scope = descendantRecipes(graph, step);
        const next =
          rootOccurrences.find((item) => item.position > anchor.position)?.position ??
          occurrences.length;
        return scope?.has(recipeId!) && occurrenceWithin(occurrence, anchor, next) ? [anchor] : [];
      });
      if (candidates.length !== 1) return undefined;
    }
    group.children.push(occurrence);
  }
  if (![...groups.values()].some((group) => group.children.length)) return undefined;
  const steps: ReportAuthoredStep[] = [...groups].map(([id, group], index) => {
    const anchors = group.keys.flatMap((key) =>
      byKey.get(key)?.item ? [byKey.get(key)!.item] : [],
    );
    const children = group.children.map((child) => child.item);
    const frames = [...new Set(children.flatMap((child) => child.framePaths ?? []))];
    const failed = children.find((child) => child.state === "failed" || child.state === "blocked");
    return {
      id,
      index,
      title: group.title,
      state: summaryState(children),
      children,
      evidenceCount: frames.length,
      framePaths: frames,
      ...(anchors.length
        ? { durationMs: anchors.reduce((total, item) => total + (item.durationMs ?? 0), 0) }
        : {}),
      ...(failed?.failure ? { failure: failed.failure } : {}),
      ...(failed?.log ? { log: failed.log } : {}),
    };
  });
  return { steps, supportingSteps };
}
