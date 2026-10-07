import {
  matchesEntranceStep,
  requestedNativeTap,
  recordedStepDigest,
  unavailableRecordedEntrance,
} from "./recorded-entrance-proof.js";
import type {
  ActionSpec,
  AppMap,
  AppMapCompiledRecipe,
  AppMapCompiledStepProvenance,
  AssertionSpec,
  CaptureCoverage,
  Connection,
  RecipeStep,
  Routine,
  SemanticRevealPlan,
  StepTarget,
} from "@relay/protocol";
import { compiledAppMapStepId } from "./app-map-compiler.js";
import { semanticTargetMatches } from "./scroll-surface-semantic-index.js";

function stableStep(step: RecipeStep, actionId: string, index: number): RecipeStep {
  return {
    ...structuredClone(step),
    id: step.id?.trim() || compiledAppMapStepId("relay-action", `${actionId}-${index + 1}`),
  };
}

function semanticRevealPlans(
  map: AppMap,
  screenId: string | undefined,
  target: StepTarget,
): SemanticRevealPlan[] {
  const screen = screenId ? map.screens[screenId] : undefined;
  if (!screen) return [];
  const plans: SemanticRevealPlan[] = [];
  for (const variantId of screen.variantIds) {
    const surfaces = [...(map.screenVariants[variantId]?.scrollSurfaces ?? [])].sort(
      (left, right) => right.capturedAt - left.capturedAt,
    );
    const surface = surfaces.find((candidate) =>
      candidate.semanticIndex?.anchors.some((anchor) =>
        semanticTargetMatches(target, anchor.target),
      ),
    );
    if (!surface?.semanticIndex) continue;
    const targetAnchor = surface.semanticIndex.anchors.find((anchor) =>
      semanticTargetMatches(target, anchor.target),
    );
    if (!targetAnchor) continue;
    plans.push({
      ...structuredClone(surface.semanticIndex),
      surfaceId: surface.id,
      captureId: surface.captureId,
      targetOrder: targetAnchor.order,
      targetDocumentY: targetAnchor.documentY,
    });
  }
  return plans;
}

export function connectionActionsStartWithWaitFor(connection: Connection | undefined): boolean {
  const first = connection?.actions[0];
  if (!first) return false;
  if (first.kind === "steps" || first.kind === "recorded") {
    return first.steps[0]?.kind === "wait-for";
  }
  return false;
}

function stampActionCoverage(step: RecipeStep, coverage?: CaptureCoverage): RecipeStep {
  if (!coverage || step.coverage) return step;
  return { ...step, coverage };
}

export function actionSteps(
  map: AppMap,
  action: ActionSpec,
  sourceScreenId: string | undefined,
  assertionStep: (map: AppMap, actionId: string, assertion: AssertionSpec) => RecipeStep,
): RecipeStep[] {
  const steps: RecipeStep[] = (() => {
    switch (action.kind) {
      case "recorded":
      case "steps":
        return action.steps.map((step, index) => {
          const entrance =
            step.recordedEntrance ??
            (action.kind === "recorded" &&
            action.entranceCaptureVersion === 1 &&
            requestedNativeTap(step)
              ? {
                  schemaVersion: 1 as const,
                  takeId: action.takeId,
                  takeRevision: action.takeRevision,
                  actionId: action.id,
                  stepDigest: recordedStepDigest(step),
                  status: "unavailable" as const,
                }
              : undefined);
          const valid =
            entrance &&
            action.kind === "recorded" &&
            entrance.takeId === action.takeId &&
            entrance.takeRevision === action.takeRevision &&
            matchesEntranceStep(step, entrance);
          return stableStep(
            entrance && !valid
              ? { ...step, recordedEntrance: unavailableRecordedEntrance(entrance) }
              : entrance
                ? { ...step, recordedEntrance: entrance }
                : step,
            action.id,
            index,
          );
        });
      case "tap":
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "tap",
            target: structuredClone(action.target),
            ...(action.expectedApp ? { expectedApp: action.expectedApp } : {}),
            ...(action.fallbackTargets?.length
              ? { fallbackTargets: structuredClone(action.fallbackTargets) }
              : {}),
          },
        ];
      case "text":
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "type",
            text: action.text,
            ...(action.target ? { target: structuredClone(action.target) } : {}),
          },
        ];
      case "gesture":
        return action.gesture.kind === "swipe"
          ? [
              {
                id: compiledAppMapStepId("relay-action", action.id),
                kind: "swipe",
                from: structuredClone(action.gesture.from),
                to: structuredClone(action.gesture.to),
                ...(action.gesture.durationMs === undefined
                  ? {}
                  : { durationMs: action.gesture.durationMs }),
              },
            ]
          : [
              {
                id: compiledAppMapStepId("relay-action", action.id),
                kind: "scroll",
                direction: action.gesture.direction,
                ...(action.gesture.amount === undefined ? {} : { amount: action.gesture.amount }),
              },
            ];
      case "reveal": {
        const navigation = semanticRevealPlans(map, sourceScreenId, action.target);
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "reveal",
            target: structuredClone(action.target),
            ...(action.direction ? { direction: action.direction } : {}),
            ...(action.maxAttempts === undefined ? {} : { maxAttempts: action.maxAttempts }),
            ...(navigation.length ? { navigation } : {}),
          },
        ];
      }
      case "back":
      case "home":
        return [
          { id: compiledAppMapStepId("relay-action", action.id), kind: "key", key: action.kind },
        ];
      case "app":
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "app",
            action: action.action,
            ...(action.app ? { app: action.app } : {}),
            ...(action.action === "open" && action.url ? { url: action.url } : {}),
            ...(action.action === "open" && action.relaunch !== undefined
              ? { relaunch: action.relaunch }
              : {}),
          },
        ];
      case "wait":
        return action.ms === 0
          ? []
          : [
              {
                id: compiledAppMapStepId("relay-action", action.id),
                kind: "sleep",
                ms: action.ms,
              },
            ];
      case "assertion":
        return [assertionStep(map, action.id, action.assertion)];
      case "routine":
        return [
          {
            id: compiledAppMapStepId("relay-action", action.id),
            kind: "module",
            recipeId: `app-map:${map.id}:routine:${action.routineId}:r${map.revision}`,
            ...(action.bindings ? { bindings: structuredClone(action.bindings) } : {}),
          },
        ];
      case "passive":
        return [];
    }
  })();
  return steps.map((step) => {
    const navigation =
      step.kind === "reveal" && !step.navigation?.length
        ? semanticRevealPlans(map, sourceScreenId, step.target)
        : [];
    return stampActionCoverage(
      {
        ...step,
        ...(navigation.length ? { navigation } : {}),
        ...(action.optional ? { optional: true as const } : {}),
        ...(action.when ? { when: structuredClone(action.when) } : {}),
      },
      action.coverage,
    );
  });
}

export function compileRecipe(input: {
  map: AppMap;
  id: string;
  title: string;
  description?: string;
  parameters?: Routine["parameters"];
  ownerKind: "connection" | "routine";
  ownerId: string;
  sourceScreenId?: string;
  actions: ActionSpec[];
  ensureRoutine?: (routineId: string) => void;
  assertionStep: (map: AppMap, actionId: string, assertion: AssertionSpec) => RecipeStep;
}): AppMapCompiledRecipe {
  const steps: RecipeStep[] = [];
  const stepProvenance: AppMapCompiledStepProvenance[] = [];
  for (const action of input.actions) {
    if (action.kind === "routine") input.ensureRoutine?.(action.routineId);
    for (const step of actionSteps(input.map, action, input.sourceScreenId, input.assertionStep)) {
      const stepIndex = steps.length;
      steps.push(step);
      stepProvenance.push({
        recipeId: input.id,
        stepIndex,
        stepId: step.id!,
        origin: "action",
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        actionId: action.id,
      });
    }
  }
  return {
    id: input.id,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    parameters: structuredClone(input.parameters ?? []),
    steps,
    stepProvenance,
  };
}
