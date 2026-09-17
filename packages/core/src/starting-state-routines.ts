import type {
  ActionSpec,
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTestStartingState,
  RoutineEffects,
  StartingStateShareContext,
} from "@relay/protocol";
import {
  leftoverContradictsFact,
  mutatingWorkMayShare,
  type RoutineLeftoverSurface,
  type RoutineStartingStateFact,
} from "@relay/protocol";
import { leftoverSkipForbidden } from "./coverage-step-outcome.js";
import type { RecipeStep } from "@relay/protocol";

export type StartingStateIssueCode =
  | "leftover-home-claim"
  | "transition-source-mismatch"
  | "unsafe-sharing"
  | "lane-is-not-account";

export type StartingStateIssue = {
  code: StartingStateIssueCode;
  message: string;
  testId: string;
  previousTestId?: string;
};

export class UnsafeStartingStateError extends Error {
  readonly code = "unsafe-starting-state";
  readonly testId: string;
  readonly previousTestId?: string;
  readonly issueCode: StartingStateIssueCode;

  constructor(issue: StartingStateIssue) {
    super(issue.message);
    this.name = "UnsafeStartingStateError";
    this.testId = issue.testId;
    this.previousTestId = issue.previousTestId;
    this.issueCode = issue.code;
  }
}

type Cursor = {
  leftover: RoutineLeftoverSurface[];
  facts: Set<RoutineStartingStateFact>;
};

function flattenSteps(steps: readonly AppMapScenarioTestStep[]): AppMapScenarioTestStep[] {
  const out: AppMapScenarioTestStep[] = [];
  const visit = (items: readonly AppMapScenarioTestStep[]): void => {
    for (const step of items) {
      if (step.execution?.status === "disabled") continue;
      out.push(step);
      if (step.kind === "decision") {
        visit(step.thenSteps);
        if (step.elseSteps) visit(step.elseSteps);
      } else if (step.kind === "loop") {
        visit(step.steps);
      }
    }
  };
  visit(steps);
  return out;
}

function asEffects(
  value: RoutineEffects | AppMapTestStartingState | undefined,
): RoutineEffects | undefined {
  if (!value) return undefined;
  const leftover = value.leftover;
  const requires = value.requires;
  const establishes = "establishes" in value ? value.establishes : undefined;
  if (
    !leftover?.length &&
    !requires?.length &&
    !establishes?.length &&
    !value.sharing &&
    !value.accountIsolation
  ) {
    return undefined;
  }
  return {
    ...(establishes ? { establishes } : {}),
    ...(requires ? { requires } : {}),
    ...(leftover ? { leftover } : {}),
    ...(value.sharing ? { sharing: value.sharing } : {}),
    ...(value.accountIsolation ? { accountIsolation: value.accountIsolation } : {}),
    ...(value.accountIsolationNote ? { accountIsolationNote: value.accountIsolationNote } : {}),
  };
}

function routineEffects(map: AppMap, routineId: string): RoutineEffects | undefined {
  return asEffects(map.routines[routineId]?.effects);
}

function actionRoutineIds(actions: readonly ActionSpec[]): string[] {
  return actions.flatMap((action) => (action.kind === "routine" ? [action.routineId] : []));
}

function mergeLeftover(
  current: readonly RoutineLeftoverSurface[],
  next: readonly RoutineLeftoverSurface[] | undefined,
): RoutineLeftoverSurface[] {
  if (!next?.length) return [...current];
  return [...new Set([...current, ...next])];
}

function revokeContradictedFacts(
  facts: Set<RoutineStartingStateFact>,
  leftover: readonly RoutineLeftoverSurface[],
): void {
  for (const fact of [...facts]) {
    if (leftoverContradictsFact(leftover, fact)) facts.delete(fact);
  }
}

function applyEffects(cursor: Cursor, effects: RoutineEffects | undefined, cleanup: boolean): void {
  if (!effects) return;
  if (cleanup) {
    cursor.leftover = [];
    for (const fact of effects.establishes ?? []) cursor.facts.add(fact);
    return;
  }
  if (effects.leftover?.length) cursor.leftover = mergeLeftover(cursor.leftover, effects.leftover);
  revokeContradictedFacts(cursor.facts, cursor.leftover);
  for (const fact of effects.establishes ?? []) {
    if (!leftoverContradictsFact(cursor.leftover, fact)) cursor.facts.add(fact);
  }
}

function leftoverBlocksRequires(
  leftover: readonly RoutineLeftoverSurface[],
  requires: readonly RoutineStartingStateFact[] | undefined,
): RoutineStartingStateFact[] {
  if (!leftover.length || !requires?.length) return [];
  return requires.filter((fact) => leftoverContradictsFact(leftover, fact));
}

function homeClaimMessage(testId: string, leftover: readonly RoutineLeftoverSurface[]): string {
  return `Test ${testId} claims Home starting state while leftover ${leftover.join(", ")} remains. Run a cleanup Routine (home-chrome) first.`;
}

export function collectTestEffects(map: AppMap, test: AppMapScenarioTest): RoutineEffects {
  const leftover: RoutineLeftoverSurface[] = [...(test.startingState?.leftover ?? [])];
  const establishes: RoutineStartingStateFact[] = [];
  let sharing = test.startingState?.sharing;
  let accountIsolation = test.startingState?.accountIsolation;
  let accountIsolationNote = test.startingState?.accountIsolationNote;
  const cursor: Cursor = { leftover: [...leftover], facts: new Set() };
  for (const step of flattenSteps(test.steps)) {
    if (step.kind === "module" && step.binding.status === "resolved") {
      const effects = routineEffects(map, step.binding.routineId);
      applyEffects(cursor, effects, false);
      if (effects?.sharing) sharing = effects.sharing;
      if (effects?.accountIsolation) accountIsolation = effects.accountIsolation;
      if (effects?.accountIsolationNote) accountIsolationNote = effects.accountIsolationNote;
    }
    if (step.kind === "instruction" && step.binding.status === "resolved") {
      for (const connectionId of step.binding.connectionIds) {
        const connection = map.connections[connectionId];
        if (!connection) continue;
        for (const routineId of actionRoutineIds(connection.actions)) {
          const effects = routineEffects(map, routineId);
          applyEffects(cursor, effects, false);
          if (effects?.sharing) sharing = effects.sharing;
          if (effects?.accountIsolation) accountIsolation = effects.accountIsolation;
          if (effects?.accountIsolationNote) accountIsolationNote = effects.accountIsolationNote;
        }
      }
      if (step.cleanup) {
        applyEffects(cursor, routineEffects(map, step.cleanup.routineId), true);
      }
    }
  }
  leftover.length = 0;
  leftover.push(...cursor.leftover);
  establishes.push(...cursor.facts);
  if (!sharing) sharing = test.startingState?.sharing;
  return {
    leftover,
    establishes,
    requires: test.startingState?.requires,
    ...(sharing ? { sharing } : {}),
    ...(accountIsolation ? { accountIsolation } : {}),
    ...(accountIsolationNote ? { accountIsolationNote } : {}),
  };
}

export function assessIntraTestStartingState(
  map: AppMap,
  test: AppMapScenarioTest,
): StartingStateIssue[] {
  const issues: StartingStateIssue[] = [];
  const cursor: Cursor = { leftover: [], facts: new Set() };
  for (const step of flattenSteps(test.steps)) {
    if (step.kind === "module" && step.binding.status === "resolved") {
      const effects = routineEffects(map, step.binding.routineId);
      const blocked = leftoverBlocksRequires(cursor.leftover, effects?.requires);
      if (blocked.includes("home-visible") || blocked.length) {
        issues.push({
          code: "leftover-home-claim",
          message: homeClaimMessage(test.id, cursor.leftover),
          testId: test.id,
        });
      }
      applyEffects(cursor, effects, false);
    }
    if (step.kind === "instruction" && step.binding.status === "resolved") {
      for (const connectionId of step.binding.connectionIds) {
        const connection = map.connections[connectionId];
        if (!connection) continue;
        for (const routineId of actionRoutineIds(connection.actions)) {
          applyEffects(cursor, routineEffects(map, routineId), false);
        }
      }
      if (step.cleanup) applyEffects(cursor, routineEffects(map, step.cleanup.routineId), true);
    }
  }
  return issues;
}

export function assessSequentialStartingState(
  map: AppMap,
  testIds: readonly string[],
): StartingStateIssue[] {
  const issues: StartingStateIssue[] = [];
  const cursor: Cursor = { leftover: [], facts: new Set() };
  let previousTestId: string | undefined;
  for (const testId of testIds) {
    const test = map.tests[testId];
    if (!test) continue;
    const blocked = leftoverBlocksRequires(cursor.leftover, test.startingState?.requires);
    if (blocked.includes("home-visible")) {
      issues.push({
        code: "leftover-home-claim",
        message: homeClaimMessage(testId, cursor.leftover),
        testId,
        previousTestId,
      });
    } else if (blocked.length) {
      issues.push({
        code: "leftover-home-claim",
        message: `Test ${testId} requires ${blocked.join(", ")} while leftover ${cursor.leftover.join(", ")} remains.`,
        testId,
        previousTestId,
      });
    }
    const sourceIssues = assessTransitionDeclaredSource(map, test);
    issues.push(...sourceIssues);
    const effects = collectTestEffects(map, test);
    applyEffects(cursor, effects, false);
    previousTestId = testId;
  }
  return issues;
}

export function assessTransitionDeclaredSource(
  map: AppMap,
  test: AppMapScenarioTest,
): StartingStateIssue[] {
  const sourceScreenId = test.startingState?.sourceScreenId;
  if (!sourceScreenId) return [];
  const issues: StartingStateIssue[] = [];
  for (const step of flattenSteps(test.steps)) {
    if (step.kind !== "instruction" || step.binding.status !== "resolved") continue;
    for (const connectionId of step.binding.connectionIds) {
      const connection = map.connections[connectionId];
      if (!connection) continue;
      const transition =
        test.requirementAction === "test-action" ||
        connection.coverage === "transition" ||
        connection.actions.some(
          (action) => "coverage" in action && action.coverage === "transition",
        );
      if (!transition) continue;
      if (connection.fromScreenId !== sourceScreenId) {
        issues.push({
          code: "transition-source-mismatch",
          message: `coverage:transition opener ${connectionId} must run from declared source ${sourceScreenId}, not leftover ${connection.fromScreenId}.`,
          testId: test.id,
        });
      }
    }
  }
  return issues;
}

export function assessMutatingRoutineSharing(
  map: AppMap,
  placements: readonly StartingStateShareContext[],
): StartingStateIssue[] {
  const issues: StartingStateIssue[] = [];
  const tests = placements.map((placement) => ({
    placement,
    test: map.tests[placement.testId],
    effects: map.tests[placement.testId]
      ? collectTestEffects(map, map.tests[placement.testId]!)
      : undefined,
  }));
  for (let index = 0; index < tests.length; index += 1) {
    const left = tests[index]!;
    if (!left.test || !left.effects) continue;
    if (!left.effects.leftover?.length && !left.effects.sharing) continue;
    for (let other = index + 1; other < tests.length; other += 1) {
      const right = tests[other]!;
      if (!right.test) continue;
      if (mutatingWorkMayShare(left.effects, left.placement, right.placement)) continue;
      const sameAccount =
        left.placement.accountId && left.placement.accountId === right.placement.accountId;
      const distinctLanes =
        left.placement.laneId &&
        right.placement.laneId &&
        left.placement.laneId !== right.placement.laneId;
      const code = sameAccount && distinctLanes ? "lane-is-not-account" : "unsafe-sharing";
      issues.push({
        code,
        message:
          code === "lane-is-not-account"
            ? `Test ${left.test.id} mutating leftover (${left.effects.leftover?.join(", ") ?? "declared"}) cannot share account ${left.placement.accountId} across Lanes ${left.placement.laneId} and ${right.placement.laneId}. ${left.effects.accountIsolationNote ?? "Browser Lane isolation is not server-side account isolation."}`
            : `Test ${left.test.id} mutating leftover (${left.effects.leftover?.join(", ") ?? "declared"}) cannot be shared (${left.effects.sharing ?? "fail-closed"}). Use an isolated account or fail closed.`,
        testId: right.test.id,
        previousTestId: left.test.id,
      });
    }
  }
  return issues;
}

export function transitionOpenerMustRun(step: RecipeStep): boolean {
  return step.coverage === "transition" || leftoverSkipForbidden(step);
}

export function throwIfUnsafeStartingState(issues: readonly StartingStateIssue[]): void {
  if (!issues[0]) return;
  throw new UnsafeStartingStateError(issues[0]);
}
