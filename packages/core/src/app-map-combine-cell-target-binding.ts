import {
  EXECUTION_TARGET_REF_VERSION,
  LOCAL_AGENT_DEVICE_PROVIDER_KEY,
  LOCAL_BROWSER_PROVIDER_KEY,
  canonicalAppMapCombineCellValues,
  isExecutionTargetRef,
  sameAppMapCombineCellValues,
  type AppMapCombineCellTargetBinding,
  type AppMapCombinePreflightIssue,
  type ExecutionTargetRef,
  type LocalAgentDeviceExecutionTargetRef,
} from "@relay/protocol";

export type CombineCellTargetBindingCell = {
  cellId: string;
  testId: string;
  testName: string;
  values: Record<string, string>;
  worldLabel: string;
};

export type LocalExecutionTarget = Extract<
  ExecutionTargetRef,
  { kind: "local-device" | "local-browser" }
>;

function issue(
  code: AppMapCombinePreflightIssue["code"],
  message: string,
  extra: Partial<AppMapCombinePreflightIssue> = {},
): AppMapCombinePreflightIssue {
  return { code, message, ...extra };
}

/** Build an explicit local reference for the legacy one-target API shape. */
export function localExecutionTargetRef(input: {
  targetId: string;
  platform: "android" | "ios" | "browser";
}): LocalExecutionTarget {
  const targetId = input.targetId.trim();
  if (!targetId) throw new Error("Combine targetId is required");
  if (input.platform === "browser") {
    return {
      schemaVersion: EXECUTION_TARGET_REF_VERSION,
      kind: "local-browser",
      provider: { key: LOCAL_BROWSER_PROVIDER_KEY, scope: "local" },
      targetId,
      platform: "browser",
      identity: { kind: "browser-target", value: targetId },
    };
  }
  return {
    schemaVersion: EXECUTION_TARGET_REF_VERSION,
    kind: "local-device",
    provider: { key: LOCAL_AGENT_DEVICE_PROVIDER_KEY, scope: "local" },
    targetId,
    platform: input.platform,
    identity: { kind: "device-serial", value: targetId },
  };
}

/** Do not silently reinterpret a future provider session as a local device. */
export function localExecutionTargetForCombine(target: unknown): LocalExecutionTarget | undefined {
  if (!isExecutionTargetRef(target)) return undefined;
  if (target.kind === "local-device") {
    if (
      target.provider.key !== LOCAL_AGENT_DEVICE_PROVIDER_KEY ||
      target.provider.scope !== "local" ||
      target.identity.kind !== "device-serial" ||
      target.identity.value !== target.targetId
    ) {
      return undefined;
    }
    return structuredClone(target);
  }
  if (target.kind === "local-browser") {
    if (
      target.provider.key !== LOCAL_BROWSER_PROVIDER_KEY ||
      target.provider.scope !== "local" ||
      target.identity.kind !== "browser-target" ||
      target.identity.value !== target.targetId
    ) {
      return undefined;
    }
    return structuredClone(target);
  }
  return undefined;
}

export function canonicalAppMapCombineCellTargetBinding(
  binding: AppMapCombineCellTargetBinding,
): AppMapCombineCellTargetBinding {
  return {
    testId: binding.testId,
    values: canonicalAppMapCombineCellValues(binding.values),
    target: structuredClone(binding.target),
  };
}

export type AppMapCombineCellTargetBindingAssessment = {
  issues: AppMapCombinePreflightIssue[];
  byCellId: Map<string, LocalExecutionTarget>;
};

function bindingIdentity(
  binding: Pick<AppMapCombineCellTargetBinding, "testId" | "values">,
): string {
  return JSON.stringify({
    testId: binding.testId,
    values: canonicalAppMapCombineCellValues(binding.values),
  });
}

/**
 * Validates explicit per-cell execution targets without inferring any target
 * from nearby cells. `fallbackTarget` exists solely for the established
 * single-target route and is expanded to every cell before execution.
 */
export function assessAppMapCombineCellTargetBindings(input: {
  cells: readonly CombineCellTargetBindingCell[];
  bindings?: readonly AppMapCombineCellTargetBinding[];
  fallbackTarget?: LocalExecutionTarget;
  knownTests?: ReadonlySet<string>;
  knownValues?: Record<string, ReadonlySet<string>>;
  rejectUnselectedBindings?: boolean;
}): AppMapCombineCellTargetBindingAssessment {
  const issues: AppMapCombinePreflightIssue[] = [];
  const byCellId = new Map<string, LocalExecutionTarget>();
  const required = new Set(input.cells.map((cell) => cell.cellId));
  const seen = new Set<string>();

  if (input.bindings === undefined && input.fallbackTarget) {
    for (const cell of input.cells)
      byCellId.set(cell.cellId, structuredClone(input.fallbackTarget));
    return { issues, byCellId };
  }
  const bindings = input.bindings ?? [];
  if (!bindings.length && input.cells.length) {
    issues.push(
      issue("zero-target-bindings", "Bind an execution target to every selected Combine cell."),
    );
  }
  for (const raw of bindings) {
    const binding = canonicalAppMapCombineCellTargetBinding(raw);
    const identity = bindingIdentity(binding);
    const expected = input.cells.find(
      (cell) =>
        cell.testId === binding.testId && sameAppMapCombineCellValues(cell.values, binding.values),
    );
    const cellId = expected?.cellId ?? identity;
    if (seen.has(identity)) {
      issues.push(
        issue("duplicate-target-binding", `Cell ${cellId} has more than one execution target.`, {
          cellId,
          testId: binding.testId,
          values: binding.values,
        }),
      );
      continue;
    }
    seen.add(identity);
    const unknownTest = input.knownTests && !input.knownTests.has(binding.testId);
    const unknownValue = Object.entries(binding.values).some(([variableId, valueId]) => {
      const allowed = input.knownValues?.[variableId];
      return allowed ? !allowed.has(valueId) : Boolean(input.knownValues);
    });
    if (unknownTest || unknownValue) {
      issues.push(
        issue(
          "foreign-target-binding",
          `Target binding for ${binding.testId} is not a Combine cell.`,
          {
            cellId,
            testId: binding.testId,
            values: binding.values,
          },
        ),
      );
      continue;
    }
    if (!expected) {
      if (input.rejectUnselectedBindings) {
        issues.push(
          issue(
            "extra-target-binding",
            `Target binding for ${binding.testId} is outside this Combine.`,
            {
              cellId,
              testId: binding.testId,
              values: binding.values,
            },
          ),
        );
      }
      continue;
    }
    if (
      expected.testId !== binding.testId ||
      !sameAppMapCombineCellValues(expected.values, binding.values)
    ) {
      issues.push(
        issue(
          "mismatched-target-binding",
          `Target binding for ${cellId} does not match its cell.`,
          {
            cellId,
            testId: binding.testId,
            values: binding.values,
          },
        ),
      );
      continue;
    }
    const target = localExecutionTargetForCombine(binding.target);
    if (!target) {
      issues.push(
        issue(
          "unsupported-target-binding",
          `Cell ${cellId} must name a coherent local device or local browser target.`,
          { cellId, testId: binding.testId, values: binding.values },
        ),
      );
      continue;
    }
    byCellId.set(cellId, target);
  }
  for (const cell of input.cells) {
    if (byCellId.has(cell.cellId)) continue;
    issues.push(
      issue(
        "missing-target-binding",
        `Bind an execution target to ${cell.testName} · ${cell.worldLabel}.`,
        { cellId: cell.cellId, testId: cell.testId, values: cell.values },
      ),
    );
  }
  if (input.rejectUnselectedBindings && seen.size > required.size) {
    issues.push(
      issue("extra-target-binding", "This Combine has target bindings outside the selected cells."),
    );
  }
  return { issues, byCellId };
}

export function localDeviceTargetForCombine(
  target: LocalExecutionTarget,
): LocalAgentDeviceExecutionTargetRef | undefined {
  return target.kind === "local-device" ? target : undefined;
}
