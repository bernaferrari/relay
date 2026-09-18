import type { AppMap, Connection, RecipeStep, StepTarget } from "@relay/protocol";
import { compiledAppMapStepId } from "./app-map-compiler.js";

function navigationTarget(
  target: NonNullable<Connection["navigation"]>["targetAlternatives"][number],
): StepTarget {
  switch (target.kind) {
    case "identifier":
      return { identifier: target.identifier };
    case "accessibility":
      return { label: target.label, ...(target.role ? { role: target.role } : {}) };
    case "element-relative":
      return {
        point: {
          x: 0,
          y: 0,
          relativeTo: {
            target: structuredClone(target.anchor),
            xRatio: target.xRatio,
            yRatio: target.yRatio,
          },
        },
      };
  }
}

export function navigationStep(
  connection: Connection,
): Extract<RecipeStep, { kind: "tap" }> | undefined {
  const contract = connection.navigation;
  if (!contract) return undefined;
  const [primary, ...fallbacks] = contract.targetAlternatives.map(navigationTarget);
  if (!primary) return undefined;
  return {
    id: compiledAppMapStepId("relay-navigation", connection.id),
    kind: "tap",
    target: primary,
    ...(fallbacks.length ? { fallbackTargets: fallbacks } : {}),
    navigationContract: {
      connectionId: connection.id,
      expectedScreenId: contract.expectedDestination.screenId,
      expectedFingerprint: contract.expectedDestination.identity.fingerprint,
      evidenceIds: [...contract.expectedDestination.evidenceIds],
    },
  };
}

export function destinationExpectation(
  map: AppMap,
  connection: Connection,
  screenExpectation: (
    map: AppMap,
    screen: AppMap["screens"][string],
    stepId: string,
    evidenceSurface?: AppMap["screens"][string]["evidenceSurface"],
  ) => RecipeStep,
): RecipeStep {
  const destination =
    map.screens[
      (connection.destination as Extract<Connection["destination"], { kind: "screen" }>).screenId
    ]!;
  const hasOutgoingConnection = Object.values(map.connections).some(
    (candidate) => candidate.fromScreenId === destination.id && candidate.state !== "draft",
  );
  return screenExpectation(
    map,
    connection.navigation
      ? {
          ...destination,
          identity: structuredClone(connection.navigation.expectedDestination.identity),
        }
      : destination,
    compiledAppMapStepId("relay-destination", connection.id),
    destination.evidenceSurface ?? (hasOutgoingConnection ? "ordinary" : "dead-end"),
  );
}
