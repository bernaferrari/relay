import type { ActionSpec, AppMap, RecipeStep } from "@relay/protocol";
import { connectionStepsFromActions } from "./app-map-projection";

export type AppMapExecutionStepOrigin = {
  connectionId: string;
  actionIndex: number;
  stepIndex: number;
};

export type AppMapExecutionPlan = {
  steps: RecipeStep[];
  origins: AppMapExecutionStepOrigin[];
};

function orderedConnections(connections: AppMap["connections"]) {
  return Object.values(connections).toSorted(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

/**
 * Read-only execution projection for the open App Map.
 *
 * Connections remain the authoring authority. RecipeStep is used here only as
 * the runner-facing projection needed by playback, evidence, and the one-step
 * debugger. Every projected row retains its canonical Connection origin.
 */
export function appMapExecutionPlan(connections: AppMap["connections"]): AppMapExecutionPlan {
  const steps: RecipeStep[] = [];
  const origins: AppMapExecutionStepOrigin[] = [];
  for (const connection of orderedConnections(connections)) {
    connection.actions.forEach((action, actionIndex) => {
      connectionStepsFromActions([action]).forEach((step, stepIndex) => {
        steps.push(structuredClone(step));
        origins.push({ connectionId: connection.id, actionIndex, stepIndex });
      });
    });
  }
  return { steps, origins };
}

function metadata(action: ActionSpec): Pick<ActionSpec, "id" | "label" | "optional" | "when"> {
  return {
    id: action.id,
    ...(action.label ? { label: action.label } : {}),
    ...(action.optional === undefined ? {} : { optional: action.optional }),
    ...(action.when ? { when: structuredClone(action.when) } : {}),
  };
}

function replaceProjectedStep(
  action: ActionSpec,
  stepIndex: number,
  next: RecipeStep,
): ActionSpec | null {
  if (action.kind === "recorded" || action.kind === "steps") {
    if (!action.steps[stepIndex]) return null;
    const steps = action.steps.map((step, index) =>
      index === stepIndex ? structuredClone(next) : structuredClone(step),
    );
    return { ...structuredClone(action), steps };
  }
  if (action.kind === "tap" && next.kind === "tap") {
    return { ...structuredClone(action), target: structuredClone(next.target) };
  }
  if (action.kind === "wait" && next.kind === "sleep") {
    return { ...structuredClone(action), ms: next.ms };
  }
  if (action.kind === "gesture" && action.gesture.kind === "swipe" && next.kind === "swipe") {
    return {
      ...structuredClone(action),
      gesture: {
        kind: "swipe",
        from: structuredClone(next.from),
        to: structuredClone(next.to),
        ...(next.durationMs === undefined ? {} : { durationMs: next.durationMs }),
      },
    };
  }
  // A projection-kind change is explicit deterministic Connection authoring,
  // never a write to a renderer-owned recipe document.
  return { ...metadata(action), kind: "steps", steps: [structuredClone(next)] };
}

export function connectionUpdateForExecutionStep(input: {
  connections: AppMap["connections"];
  index: number;
  step: RecipeStep;
}): { connectionId: string; actions: ActionSpec[] } | null {
  const plan = appMapExecutionPlan(input.connections);
  const origin = plan.origins[input.index];
  if (!origin) return null;
  const connection = input.connections[origin.connectionId];
  const action = connection?.actions[origin.actionIndex];
  if (!connection || !action) return null;
  const replacement = replaceProjectedStep(action, origin.stepIndex, input.step);
  if (!replacement) return null;
  return {
    connectionId: connection.id,
    actions: connection.actions.map((candidate, index) =>
      index === origin.actionIndex ? replacement : structuredClone(candidate),
    ),
  };
}
