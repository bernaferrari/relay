import type {
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTest,
} from "@relay/protocol";
import { APP_MAP_TEST_INTENT_SCHEMA_VERSION } from "@relay/protocol";

export const SCENARIO_STEP_KINDS = [
  "instruction",
  "validation",
  "extraction",
  "manual",
  "module",
  "decision",
  "loop",
  "script",
] as const;

export type ScenarioStepKind = (typeof SCENARIO_STEP_KINDS)[number];

export const SCENARIO_STEP_LABELS: Record<ScenarioStepKind, string> = {
  instruction: "Instruction",
  validation: "Validation",
  extraction: "Extraction",
  manual: "Manual checkpoint",
  module: "Module",
  decision: "Decision",
  loop: "Loop",
  script: "Script",
};

const STEP_PROMPTS: Record<ScenarioStepKind, string> = {
  instruction: "Describe what the person should do",
  validation: "Describe what must be true",
  extraction: "Describe the value to collect",
  manual: "Describe what needs human confirmation",
  module: "Describe the reusable behavior",
  decision: "Describe the decision",
  loop: "Describe what should repeat",
  script: "Describe the safe transform",
};

export function createScenarioStep(
  kind: ScenarioStepKind,
  id: string = crypto.randomUUID(),
): AppMapScenarioTestStep {
  const base = { id, kind, intent: STEP_PROMPTS[kind] } as const;
  const binding = {
    status: "unresolved" as const,
    reason: `Finish the ${SCENARIO_STEP_LABELS[kind].toLocaleLowerCase()} binding before running.`,
  };
  if (kind === "decision") return { ...base, kind, binding, thenSteps: [] };
  if (kind === "loop") return { ...base, kind, binding, steps: [] };
  return { ...base, kind, binding } as AppMapScenarioTestStep;
}

export function createScenarioTest(
  map: AppMap,
  name: string,
  id: string = crypto.randomUUID(),
  at = Date.now(),
): AppMapScenarioTest {
  return {
    id,
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    name,
    kind: "scenario",
    intentSchemaVersion: APP_MAP_TEST_INTENT_SCHEMA_VERSION,
    steps: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function moveScenarioStep(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string,
  direction: -1 | 1,
): AppMapScenarioTestStep[] {
  const from = steps.findIndex((step) => step.id === stepId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= steps.length) return [...steps];
  const next = steps.map((step) => structuredClone(step));
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

function renewNestedIds(
  step: AppMapScenarioTestStep,
  makeId: () => string,
): AppMapScenarioTestStep {
  const copy = { ...structuredClone(step), id: makeId() };
  if (copy.kind === "decision") {
    copy.thenSteps = copy.thenSteps.map((item) => renewNestedIds(item, makeId));
    if (copy.elseSteps) copy.elseSteps = copy.elseSteps.map((item) => renewNestedIds(item, makeId));
  }
  if (copy.kind === "loop") copy.steps = copy.steps.map((item) => renewNestedIds(item, makeId));
  return copy;
}

export function duplicateScenarioStep(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string,
  makeId: () => string = () => crypto.randomUUID(),
): AppMapScenarioTestStep[] {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return [...steps];
  const next = steps.map((step) => structuredClone(step));
  next.splice(index + 1, 0, renewNestedIds(next[index]!, makeId));
  return next;
}

export type ScenarioDiagnostic = {
  stepId?: string;
  tone: "blocker" | "warning";
  message: string;
};

function inspectStep(map: AppMap, step: AppMapScenarioTestStep, out: ScenarioDiagnostic[]): void {
  if (!step.intent.trim()) out.push({ stepId: step.id, tone: "blocker", message: "Add intent." });
  if (step.binding.status === "unresolved") {
    out.push({ stepId: step.id, tone: "blocker", message: step.binding.reason });
  } else if (step.kind === "instruction") {
    if (!step.binding.connectionIds.length) {
      out.push({ stepId: step.id, tone: "blocker", message: "Choose a mapped connection." });
    }
    for (const id of step.binding.connectionIds) {
      const connection = map.connections[id];
      if (!connection)
        out.push({ stepId: step.id, tone: "blocker", message: `Connection ${id} is missing.` });
      else if (connection.state !== "ready")
        out.push({
          stepId: step.id,
          tone: "blocker",
          message: "A selected connection still needs review.",
        });
    }
  } else if (step.kind === "module" && !step.binding.routineId.trim()) {
    out.push({ stepId: step.id, tone: "blocker", message: "Choose a reusable module." });
  } else if (step.kind === "module" && !map.routines[step.binding.routineId]) {
    out.push({ stepId: step.id, tone: "blocker", message: "The selected module is missing." });
  } else if (step.kind === "script" && !step.binding.source.trim()) {
    out.push({ stepId: step.id, tone: "blocker", message: "Add a script source." });
  } else if (step.kind === "manual" && !step.binding.message.trim()) {
    out.push({ stepId: step.id, tone: "blocker", message: "Add checkpoint instructions." });
  } else if (step.kind === "loop" && step.steps.length === 0) {
    out.push({ stepId: step.id, tone: "warning", message: "This loop has no body yet." });
  } else if (step.kind === "decision" && step.thenSteps.length === 0) {
    out.push({ stepId: step.id, tone: "warning", message: "This decision has no Then steps yet." });
  }
  if (step.kind === "decision") {
    step.thenSteps.forEach((item) => inspectStep(map, item, out));
    step.elseSteps?.forEach((item) => inspectStep(map, item, out));
  }
  if (step.kind === "loop") step.steps.forEach((item) => inspectStep(map, item, out));
}

export function scenarioDiagnostics(map: AppMap, test: AppMapScenarioTest): ScenarioDiagnostic[] {
  const diagnostics: ScenarioDiagnostic[] = [];
  if (!test.name.trim()) diagnostics.push({ tone: "blocker", message: "Name this test." });
  if (!test.steps.length) diagnostics.push({ tone: "blocker", message: "Add the first step." });
  test.steps.forEach((step) => inspectStep(map, step, diagnostics));
  return diagnostics;
}

export function fullSurfaceScreenIds(test: AppMapScenarioTest): string[] {
  return [
    ...new Set(
      (test.surfaceBindings ?? [])
        .filter((binding) => binding.captureMode === "full-surface")
        .map((binding) => binding.screenId),
    ),
  ];
}

export function testKindDescription(test: AppMapTest): string {
  const count = scenarioStepCount(test.steps);
  return `${count} ${count === 1 ? "step" : "steps"}`;
}

export function scenarioStepCount(steps: readonly AppMapScenarioTestStep[]): number {
  return steps.reduce((count, step) => {
    if (step.kind === "decision") {
      return (
        count + 1 + scenarioStepCount(step.thenSteps) + scenarioStepCount(step.elseSteps ?? [])
      );
    }
    if (step.kind === "loop") return count + 1 + scenarioStepCount(step.steps);
    return count + 1;
  }, 0);
}

export function scenarioStepSummary(map: AppMap, step: AppMapScenarioTestStep): string {
  if (step.binding.status === "unresolved") return step.binding.reason;
  if (step.kind === "instruction") {
    return step.binding.connectionIds
      .map((id) => map.connections[id]?.label?.trim() || id)
      .join(" → ");
  }
  if (step.kind === "validation") {
    if (step.binding.kind === "assertion") {
      const assertion = step.binding.assertion;
      if (assertion.kind === "screen")
        return `Screen is ${map.screens[assertion.screenId]?.title ?? assertion.screenId}`;
      if (assertion.kind === "target")
        return `${assertion.target.identifier ?? assertion.target.label ?? "Target"} is ${assertion.condition}`;
      return `${assertion.input} ${assertion.match} ${assertion.expected}`;
    }
    return "Structured validation";
  }
  if (step.kind === "extraction") return `Save as {{${step.binding.as}}}`;
  if (step.kind === "manual") return step.binding.message;
  if (step.kind === "module")
    return map.routines[step.binding.routineId]?.name ?? step.binding.routineId;
  if (step.kind === "decision")
    return `${step.binding.input} ${step.binding.operator} ${step.binding.expected ?? ""}`.trim();
  if (step.kind === "loop")
    return `${step.binding.count}× · ${step.steps.length} nested ${step.steps.length === 1 ? "step" : "steps"}`;
  return step.binding.source.split("\n")[0] || "Script";
}

export type ScenarioBindingField = {
  label: string;
  value: string;
  kind: "text" | "textarea" | "number";
  placeholder?: string;
  hint?: string;
};

export function scenarioBindingField(
  step: AppMapScenarioTestStep,
): ScenarioBindingField | undefined {
  if (step.kind === "validation") {
    const value =
      step.binding.status === "resolved" &&
      step.binding.kind === "assertion" &&
      step.binding.assertion.kind === "target"
        ? (step.binding.assertion.target.identifier ?? "")
        : "";
    return { label: "Target identifier", value, kind: "text", placeholder: "continue-button" };
  }
  if (step.kind === "manual") {
    return {
      label: "Instructions for the person",
      value: step.binding.status === "resolved" ? step.binding.message : "",
      kind: "textarea",
    };
  }
  if (step.kind === "loop") {
    return {
      label: "Repeat count",
      value: String(step.binding.status === "resolved" ? step.binding.count : 1),
      kind: "number",
      hint: `${step.steps.length} nested ${step.steps.length === 1 ? "step" : "steps"}`,
    };
  }
  if (step.kind === "script") {
    return {
      label: "Constrained transform source",
      value: step.binding.status === "resolved" ? step.binding.source : "",
      kind: "textarea",
    };
  }
  return undefined;
}

export function resolveScenarioBinding(
  step: AppMapScenarioTestStep,
  rawValue: string,
): AppMapScenarioTestStep {
  const value = rawValue.trim();
  if (step.kind === "validation") {
    return {
      ...step,
      binding: value
        ? {
            status: "resolved",
            kind: "assertion",
            assertion: {
              kind: "target",
              target: { identifier: value },
              condition: "visible",
            },
          }
        : { status: "unresolved", reason: "Add the stable identifier to validate." },
    };
  }
  if (step.kind === "manual") {
    return {
      ...step,
      binding: value
        ? { status: "resolved", kind: "pause", message: value }
        : { status: "unresolved", reason: "Add checkpoint instructions." },
    };
  }
  if (step.kind === "loop") {
    return {
      ...step,
      binding: {
        status: "resolved",
        kind: "repeat",
        count: Math.max(1, Math.min(20, Number(value) || 1)),
      },
    };
  }
  if (step.kind === "script") {
    return {
      ...step,
      binding: value
        ? { status: "resolved", kind: "script", source: value }
        : { status: "unresolved", reason: "Add a validated script source." },
    };
  }
  return step;
}
