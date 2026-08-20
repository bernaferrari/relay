/**
 * Compile-time scheduling for independent App Map checks.
 *
 * This is deliberately separate from recipe compilation: it only reads the
 * frozen App Map and compiled graph, then proposes a reviewable execution
 * order. It never changes authored ordering across a cleanup, handoff, or
 * unproven document-position boundary.
 */
import type { AppMap, AppMapCompiledTest, StepTarget } from "@relay/protocol";
import type { Recipe } from "./recipes.js";

function textKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized || undefined;
}

function documentPositionForConnection(
  map: AppMap,
  connectionId: string,
): { documentY: number; sourceScreenId: string } | undefined {
  const connection = map.connections[connectionId];
  if (!connection) return undefined;
  const targets: StepTarget[] = connection.navigation?.targetAlternatives.length
    ? connection.navigation.targetAlternatives.map((target) => {
        if (target.kind === "identifier") return { identifier: target.identifier };
        if (target.kind === "accessibility") {
          return { label: target.label, ...(target.role ? { role: target.role } : {}) };
        }
        return structuredClone(target.anchor);
      })
    : connection.actions.flatMap((action) => {
        if (action.kind === "tap" || action.kind === "reveal") return [action.target];
        if (action.kind !== "recorded" && action.kind !== "steps") return [];
        return action.steps.flatMap((step) =>
          step.kind === "tap" || step.kind === "reveal" ? [step.target] : [],
        );
      });
  if (!targets.length) return undefined;
  const candidatePositions = Object.values(map.screenVariants)
    .filter((variant) => variant.screenId === connection.fromScreenId)
    .flatMap((variant) => {
      const surface = [...(variant.scrollSurfaces ?? [])].sort(
        (left, right) => right.capturedAt - left.capturedAt,
      )[0];
      return surface?.semanticIndex?.anchors ?? [];
    })
    .flatMap((anchor) => {
      const anchorIdentifier = textKey(anchor.target.identifier);
      const anchorLabel = textKey(anchor.label ?? anchor.target.label);
      const matches = targets.some((target) => {
        const semantic = target.relation?.anchor ?? target;
        return (
          (semantic.identifier !== undefined &&
            anchorIdentifier === textKey(semantic.identifier)) ||
          (semantic.label !== undefined && anchorLabel === textKey(semantic.label)) ||
          (semantic.text !== undefined && anchorLabel?.includes(textKey(semantic.text) ?? ""))
        );
      });
      return matches ? [anchor.documentY] : [];
    });
  return candidatePositions.length
    ? { documentY: Math.min(...candidatePositions), sourceScreenId: connection.fromScreenId }
    : undefined;
}

export function proposeAppMapTestExecutionSchedule(
  map: AppMap,
  rootRecipeId: string,
  graph: Readonly<Record<string, Recipe>>,
): NonNullable<AppMapCompiledTest["executionSchedule"]> {
  const root = graph[rootRecipeId];
  if (!root) return { schemaVersion: 1, mode: "authored", checks: [] };
  let authoredCheckIndex = 0;
  const checks = root.steps.flatMap((step) => {
    if (step.kind !== "module" || !step.check) return [];
    const authoredIndex = authoredCheckIndex++;
    const dependencies = step.check.transitionDependencies ?? [];
    const sourceScreenId = step.check.warmSourceScreenId ?? dependencies[0]?.originScreenId;
    const external = dependencies.some((dependency) => Boolean(dependency.expectedApp));
    const documentDependency = dependencies
      .map((dependency, index) => ({
        index,
        position: documentPositionForConnection(map, dependency.connectionId),
      }))
      .reverse()
      .find((candidate) => candidate.position !== undefined);
    const directDocumentLeaf = documentDependency?.index === dependencies.length - 1;
    const documentY = documentDependency?.position?.documentY;
    const scheduleSourceScreenId = directDocumentLeaf
      ? documentDependency?.position?.sourceScreenId
      : undefined;
    const reason:
      | "cleanup-boundary"
      | "external-handoff"
      | "prerequisite-boundary"
      | "unknown-document-position"
      | undefined = step.check.cleanup
      ? "cleanup-boundary"
      : external
        ? "external-handoff"
        : !directDocumentLeaf
          ? "prerequisite-boundary"
          : documentY === undefined
            ? "unknown-document-position"
            : undefined;
    return [
      {
        checkId: step.check.id,
        recipeId: step.recipeId,
        authoredIndex,
        proposedIndex: authoredIndex,
        ...((scheduleSourceScreenId ?? sourceScreenId)
          ? { sourceScreenId: scheduleSourceScreenId ?? sourceScreenId }
          : {}),
        ...(documentY === undefined ? {} : { documentY }),
        disposition: reason ? ("fixed" as const) : ("scheduled" as const),
        ...(reason ? { reason } : {}),
      },
    ];
  });
  // The scheduler deliberately reorders only contiguous checks that begin at
  // the same proven screen. Any fixed check is a barrier: moving work across
  // it could bypass cleanup, an external handoff, or an unproven document
  // coordinate.
  for (let start = 0; start < checks.length;) {
    const first = checks[start]!;
    if (first.disposition !== "scheduled" || !first.sourceScreenId) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (
      end < checks.length &&
      checks[end]!.disposition === "scheduled" &&
      checks[end]!.sourceScreenId === first.sourceScreenId
    ) {
      end += 1;
    }
    const segment = checks
      .slice(start, end)
      .sort(
        (left, right) =>
          left.documentY! - right.documentY! || left.authoredIndex - right.authoredIndex,
      );
    checks.splice(start, segment.length, ...segment);
    start = end;
  }
  const proposedIndexes = new Map(checks.map((check, index) => [check.checkId, index]));
  const withIndexes = checks.map((check) => ({
    ...check,
    proposedIndex: proposedIndexes.get(check.checkId)!,
  }));
  return {
    schemaVersion: 1,
    mode: withIndexes.some((check) => check.proposedIndex !== check.authoredIndex)
      ? "review-required"
      : "authored",
    checks: withIndexes,
  };
}
