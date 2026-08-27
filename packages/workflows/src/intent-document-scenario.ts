import type { AppMap, AppMapScenarioTest, AppMapScenarioTestStep } from "@relay/protocol";
import type {
  IntentCheckStep,
  IntentDocument,
  IntentDocumentStep,
  IntentModuleStep,
  IntentPathStep,
} from "./intent-document.js";

function unsupported(step: AppMapScenarioTestStep, detail: string): never {
  throw new Error(`Test step ${step.id} cannot use the thin source view: ${detail}`);
}

/** Guard every optional authored field before projecting a step. Thin source
 * must either represent a semantic choice or refuse the Test; retaining some
 * fields only because apply happens to have the old Test in memory would make
 * the YAML look complete when it is not. */
function assertRepresentableStepSemantics(step: AppMapScenarioTestStep): void {
  if (step.note !== undefined) unsupported(step, "notes are not represented");
  if (step.execution !== undefined) {
    unsupported(step, "disabled execution decisions are not represented");
  }
  if (step.kind === "instruction") {
    if (step.cleanup !== undefined) unsupported(step, "cleanup is not represented");
    // `true` is represented by a checkpoint bound to the destination screen.
    // Explicit `false` cannot be reconstructed exactly from an absent field.
    if (step.capture === false) unsupported(step, "an explicit capture: false is not represented");
    return;
  }
  if (step.capture !== undefined) unsupported(step, "step capture is not represented");
}

function destinationScreenId(map: AppMap, connectionIds: readonly string[]): string | undefined {
  const final = map.connections[connectionIds.at(-1) ?? ""];
  return final?.destination.kind === "screen" ? final.destination.screenId : undefined;
}

function projectStep(map: AppMap, step: AppMapScenarioTestStep): IntentDocumentStep {
  assertRepresentableStepSemantics(step);
  if (step.kind === "instruction") {
    if (step.binding.status !== "resolved" || step.binding.kind !== "connections") {
      return unsupported(step, "its reviewed path is unresolved");
    }
    if (step.binding.connectionIds.length === 0) {
      return unsupported(step, "its reviewed path is empty");
    }
    for (const connectionId of step.binding.connectionIds) {
      if (!map.connections[connectionId]) {
        return unsupported(step, `connection ${connectionId} is missing`);
      }
    }
    const checkpointScreenId = step.capture
      ? destinationScreenId(map, step.binding.connectionIds)
      : undefined;
    if (step.capture && !checkpointScreenId) {
      return unsupported(step, "its checkpoint has no reviewed destination screen");
    }
    return {
      kind: "path",
      id: step.id,
      intent: step.intent,
      connectionIds: [...step.binding.connectionIds],
      ...(checkpointScreenId ? { checkpointScreenId } : {}),
    } satisfies IntentPathStep;
  }
  if (step.kind === "module") {
    if (step.binding.status !== "resolved" || step.binding.kind !== "routine") {
      return unsupported(step, "its reviewed module is unresolved");
    }
    if (!map.routines[step.binding.routineId]) {
      return unsupported(step, `module ${step.binding.routineId} is missing`);
    }
    return {
      kind: "module",
      id: step.id,
      intent: step.intent,
      moduleId: step.binding.routineId,
      ...(step.binding.bindings ? { bindings: { ...step.binding.bindings } } : {}),
    } satisfies IntentModuleStep;
  }
  if (step.kind === "validation") {
    if (step.binding.status !== "resolved") {
      return unsupported(step, "its reviewed check is unresolved");
    }
    return {
      kind: "check",
      id: step.id,
      intent: step.intent,
      testStepId: step.id,
    } satisfies IntentCheckStep;
  }
  return unsupported(step, `${step.kind} requires the advanced Test editor`);
}

/** Project the golden-loop subset of a canonical Test into concise source.
 * Unsupported or unresolved steps fail closed instead of leaking compiled
 * selectors or pretending that a lossy document can replace the Test. */
export function intentDocumentFromScenarioTest(
  map: AppMap,
  test: AppMapScenarioTest,
): IntentDocument {
  return {
    schemaVersion: 1,
    kind: "test-intent",
    name: test.name,
    appMapId: map.id,
    testId: test.id,
    steps: test.steps.map((step) => projectStep(map, step)),
  };
}

function bindPath(map: AppMap, step: IntentPathStep): AppMapScenarioTestStep {
  for (const connectionId of step.connectionIds) {
    if (!map.connections[connectionId]) throw new Error(`connection ${connectionId} is missing`);
  }
  const destination = destinationScreenId(map, step.connectionIds);
  if (step.checkpointScreenId && destination !== step.checkpointScreenId) {
    throw new Error(
      `checkpoint ${step.checkpointScreenId} is not the destination of path ${step.id}`,
    );
  }
  return {
    kind: "instruction",
    id: step.id,
    intent: step.intent,
    binding: { status: "resolved", kind: "connections", connectionIds: [...step.connectionIds] },
    ...(step.checkpointScreenId ? { capture: true } : {}),
  };
}

/** Apply concise source to the same canonical Test identity. Existing checks
 * retain their reviewed assertion bindings; adding opaque executable content
 * through YAML is intentionally unsupported. */
export function applyIntentDocumentToScenarioTest(input: {
  map: AppMap;
  current: AppMapScenarioTest;
  document: IntentDocument;
  updatedAt?: number;
}): AppMapScenarioTest {
  const { map, current, document } = input;
  if (document.appMapId !== map.id || document.testId !== current.id) {
    throw new Error("Relay intent source does not identify the open App Map and Test");
  }
  // Validate the complete current document before rebuilding any step. This
  // also prevents a hand-constructed IntentDocument from deleting a semantic
  // field or an advanced step that the normal projection would have rejected.
  intentDocumentFromScenarioTest(map, current);
  if (document.description !== undefined) {
    throw new Error(
      "description is not supported by the canonical Test source adapter and was not applied",
    );
  }
  if (document.repeat !== undefined) {
    throw new Error(
      "repeat is not supported by the thin Test source adapter and no Repeat configuration was changed",
    );
  }
  const existing = new Map(current.steps.map((step) => [step.id, step]));
  const steps = document.steps.map((step): AppMapScenarioTestStep => {
    if (step.kind === "path") return bindPath(map, step);
    if (step.kind === "module") {
      if (!map.routines[step.moduleId]) throw new Error(`module ${step.moduleId} is missing`);
      return {
        kind: "module",
        id: step.id,
        intent: step.intent,
        binding: {
          status: "resolved",
          kind: "routine",
          routineId: step.moduleId,
          ...(step.bindings ? { bindings: { ...step.bindings } } : {}),
        },
      };
    }
    if (step.kind === "check") {
      const prior = existing.get(step.testStepId);
      if (!prior || prior.kind !== "validation" || prior.binding.status !== "resolved") {
        throw new Error(`check ${step.testStepId} is not an existing reviewed check`);
      }
      if (step.id !== prior.id) {
        throw new Error(`check ${step.testStepId} must keep its canonical step id`);
      }
      return { ...structuredClone(prior), intent: step.intent };
    }
    throw new Error(`standalone checkpoint ${step.id} must be attached to a reviewed path`);
  });
  return {
    ...structuredClone(current),
    name: document.name,
    steps,
    updatedAt: input.updatedAt ?? current.updatedAt,
  };
}
