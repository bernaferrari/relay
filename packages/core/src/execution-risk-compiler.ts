import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AuthoringInteraction,
  ExecutionExternalEffect,
  ExecutionRisk,
  ExecutionRiskLevel,
  RecipeStep,
} from "@relay/protocol";
import {
  AppMapTestCompileError,
  compileAppMapScenarioTest,
  type AppMapTestCompileOptions,
} from "./app-map-test-compiler.js";
import { stepsForInteraction } from "./authoring-action-steps.js";

export const EXECUTION_RISK_CODES = {
  alertMutation: "interaction.alert-mutation",
  appInstallation: "interaction.app-installation",
  appUninstall: "interaction.app-uninstall",
  clipboardAccess: "interaction.clipboard-access",
  deviceState: "interaction.device-state",
  externalAnalysis: "interaction.external-analysis",
  externalApp: "interaction.external-app",
  invalidInteraction: "execution.invalid-interaction",
  locationOverride: "interaction.location-override",
  logsClear: "evidence.logs-clear",
  manualCheckpoint: "interaction.manual-checkpoint",
  missingRecipe: "execution.missing-recipe",
  networkBodyCapture: "evidence.network-body-capture",
  opaqueFlow: "execution.opaque-flow",
  opaqueScript: "execution.opaque-script",
  permissionChange: "interaction.permission-change",
  recipeCycle: "execution.recipe-cycle",
  scenarioUncompilable: "execution.scenario-uncompilable",
  systemSetting: "interaction.system-setting",
  dynamicTour: "interaction.dynamic-tour",
  reviewedCommunication: "reviewed-effect.communication",
  reviewedPurchase: "reviewed-effect.purchase",
  reviewedAccountMutation: "reviewed-effect.account-mutation",
  reviewedDataDeletion: "reviewed-effect.data-deletion",
  reviewedPermissionChange: "reviewed-effect.permission-change",
  reviewedInstallation: "reviewed-effect.installation",
  reviewedExternalApp: "reviewed-effect.external-app",
} as const;

export type ExecutionRiskCode = (typeof EXECUTION_RISK_CODES)[keyof typeof EXECUTION_RISK_CODES];

type FrozenRiskRecipe = {
  id: string;
  steps: readonly RecipeStep[];
};

type FrozenRiskGraph = Readonly<Record<string, FrozenRiskRecipe>>;

export type ExecutionRiskCompilationSource =
  | {
      kind: "compiled-test";
      test: Pick<AppMapCompiledTest, "rootRecipeId" | "recipes">;
    }
  | {
      kind: "recipe-graph";
      rootRecipeId: string;
      recipes: FrozenRiskGraph;
    }
  | {
      kind: "scenario-test";
      appMap: AppMap;
      test: AppMapScenarioTest;
      options?: AppMapTestCompileOptions;
    }
  | {
      kind: "interactions";
      interactions: ReadonlyArray<{ id: string; interaction: AuthoringInteraction }>;
    };

type RiskReason = ExecutionRisk["reasons"][number];
type Confirmation = ExecutionRisk["confirmation"];

type Bounds = {
  maximumActions?: number;
  maximumDurationMs?: number;
};

const RISK_RANK: Record<ExecutionRiskLevel, number> = {
  safe: 0,
  guarded: 1,
  destructive: 2,
  prohibited: 3,
};

const CONFIRMATION_RANK: Record<Confirmation, number> = {
  none: 0,
  "once-per-run": 1,
  "per-step": 2,
  "human-only": 3,
};

const EXTERNAL_EFFECT_ORDER: readonly ExecutionExternalEffect[] = [
  "communication",
  "purchase",
  "account-mutation",
  "data-deletion",
  "permission-change",
  "installation",
  "external-app",
];

function addOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined || right === undefined) return undefined;
  const result = left + right;
  return Number.isSafeInteger(result) ? result : undefined;
}

function multiplyOptional(value: number | undefined, count: number): number | undefined {
  if (value === undefined || !Number.isSafeInteger(count) || count < 0) return undefined;
  const result = value * count;
  return Number.isSafeInteger(result) ? result : undefined;
}

function sequence(left: Bounds, right: Bounds): Bounds {
  return {
    maximumActions: addOptional(left.maximumActions, right.maximumActions),
    maximumDurationMs: addOptional(left.maximumDurationMs, right.maximumDurationMs),
  };
}

function alternative(left: Bounds, right: Bounds): Bounds {
  return {
    maximumActions:
      left.maximumActions === undefined || right.maximumActions === undefined
        ? undefined
        : Math.max(left.maximumActions, right.maximumActions),
    maximumDurationMs:
      left.maximumDurationMs === undefined || right.maximumDurationMs === undefined
        ? undefined
        : Math.max(left.maximumDurationMs, right.maximumDurationMs),
  };
}

class RiskAccumulator {
  level: ExecutionRiskLevel = "safe";
  confirmation: Confirmation = "none";
  cleanupRequired = false;
  readonly reasons = new Map<string, RiskReason>();
  readonly externalEffects = new Set<ExecutionExternalEffect>();
  readonly appBoundaries = new Set<string>();

  addBoundary(boundary: string | undefined): void {
    if (boundary?.trim()) this.appBoundaries.add(boundary.trim());
  }

  addRisk(input: {
    level: ExecutionRiskLevel;
    confirmation?: Confirmation;
    code: ExecutionRiskCode;
    explanation: string;
    stepId?: string;
    externalEffects?: readonly ExecutionExternalEffect[];
    cleanupRequired?: boolean;
  }): void {
    if (RISK_RANK[input.level] > RISK_RANK[this.level]) this.level = input.level;
    const confirmation =
      input.confirmation ??
      (input.level === "safe" ? "none" : input.level === "guarded" ? "once-per-run" : "human-only");
    if (CONFIRMATION_RANK[confirmation] > CONFIRMATION_RANK[this.confirmation]) {
      this.confirmation = confirmation;
    }
    const reason: RiskReason = {
      ...(input.stepId ? { stepId: input.stepId } : {}),
      code: input.code,
      explanation: input.explanation,
    };
    this.reasons.set(`${reason.code}\u0000${reason.stepId ?? ""}`, reason);
    for (const effect of input.externalEffects ?? []) this.externalEffects.add(effect);
    if (input.cleanupRequired) this.cleanupRequired = true;
  }

  result(bounds: Bounds): ExecutionRisk {
    return {
      schemaVersion: 1,
      level: this.level,
      reasons: [...this.reasons.values()].sort(
        (left, right) =>
          left.code.localeCompare(right.code) ||
          (left.stepId ?? "").localeCompare(right.stepId ?? ""),
      ),
      externalEffects: EXTERNAL_EFFECT_ORDER.filter((effect) => this.externalEffects.has(effect)),
      confirmation: this.confirmation,
      expectedAppBoundaries: [...this.appBoundaries].sort((left, right) =>
        left.localeCompare(right),
      ),
      ...(bounds.maximumActions !== undefined ? { maximumActions: bounds.maximumActions } : {}),
      ...(bounds.maximumDurationMs !== undefined
        ? { maximumDurationMs: bounds.maximumDurationMs }
        : {}),
      cleanupRequired: this.cleanupRequired,
    };
  }
}

function riskStepId(recipeId: string, step: RecipeStep, index: number): string {
  return step.id?.trim() || `${recipeId}:step-${index + 1}`;
}

const REVIEWED_EFFECT_RISK: Record<
  ExecutionExternalEffect,
  {
    level: ExecutionRiskLevel;
    confirmation: Confirmation;
    code: ExecutionRiskCode;
    cleanupRequired?: boolean;
  }
> = {
  communication: {
    level: "guarded",
    confirmation: "per-step",
    code: EXECUTION_RISK_CODES.reviewedCommunication,
  },
  purchase: {
    level: "destructive",
    confirmation: "human-only",
    code: EXECUTION_RISK_CODES.reviewedPurchase,
  },
  "account-mutation": {
    level: "destructive",
    confirmation: "human-only",
    code: EXECUTION_RISK_CODES.reviewedAccountMutation,
    cleanupRequired: true,
  },
  "data-deletion": {
    level: "destructive",
    confirmation: "human-only",
    code: EXECUTION_RISK_CODES.reviewedDataDeletion,
  },
  "permission-change": {
    level: "guarded",
    confirmation: "once-per-run",
    code: EXECUTION_RISK_CODES.reviewedPermissionChange,
    cleanupRequired: true,
  },
  installation: {
    level: "guarded",
    confirmation: "once-per-run",
    code: EXECUTION_RISK_CODES.reviewedInstallation,
    cleanupRequired: true,
  },
  "external-app": {
    level: "guarded",
    confirmation: "once-per-run",
    code: EXECUTION_RISK_CODES.reviewedExternalApp,
  },
};

function classifyReviewedEffects(
  accumulator: RiskAccumulator,
  step: RecipeStep,
  stepId: string,
): void {
  for (const effect of step.reviewedExternalEffects?.effects ?? []) {
    const policy = REVIEWED_EFFECT_RISK[effect];
    accumulator.addRisk({
      ...policy,
      stepId,
      explanation: `The reviewed Test declares the external effect ${effect}.`,
      externalEffects: [effect],
    });
  }
}

/** Omit a wall-clock bound as soon as one operation lacks an authored ceiling.
 * Summing known waits while ignoring target/adapter work would look precise
 * while understating the real maximum. */
function leafBounds(step: RecipeStep): Bounds {
  switch (step.kind) {
    case "tap":
      return { maximumActions: Math.max(1, step.tapCount ?? 1) };
    case "type":
    case "scroll":
    case "swipe":
    case "key":
    case "clipboard":
    case "app":
    case "device":
    case "rotate":
    case "settings":
    case "location":
    case "permission":
      return { maximumActions: 1 };
    case "reveal":
      return step.maxAttempts === undefined ? {} : { maximumActions: step.maxAttempts };
    case "alert":
      return { maximumActions: step.action === "accept" || step.action === "dismiss" ? 1 : 0 };
    case "logs":
      return { maximumActions: step.action === "clear" ? 1 : 0 };
    case "sleep":
      return { maximumActions: 0, maximumDurationMs: step.ms };
    case "pause": {
      const verificationDuration = step.verifyAfter?.timeoutMs;
      return {
        maximumActions: 0,
        ...(step.timeoutMs === undefined || (step.verifyAfter && verificationDuration === undefined)
          ? {}
          : {
              maximumDurationMs: step.timeoutMs + (verificationDuration ?? 0),
            }),
      };
    }
    case "wait-for":
    case "expect":
    case "expect-screen":
      return {
        maximumActions: 0,
        ...(step.timeoutMs === undefined ? {} : { maximumDurationMs: step.timeoutMs }),
      };
    case "wait-response":
      return {
        maximumActions: 0,
        ...(step.timeoutMs === undefined
          ? {}
          : { maximumDurationMs: step.timeoutMs + (step.stableForMs ?? 0) }),
      };
    case "expect-set":
      return {
        maximumActions: 0,
        ...(step.timeoutMs === undefined ? {} : { maximumDurationMs: step.timeoutMs }),
      };
    case "assert-layout":
      return {
        maximumActions: 0,
        ...(step.timeoutMs === undefined ? {} : { maximumDurationMs: step.timeoutMs }),
      };
    case "capture-surface":
    case "tour":
    case "flow":
    case "script":
      return {};
    case "extract":
    case "assert-content":
    case "evaluate-semantic":
    case "review":
    case "screenshot":
    case "network":
      return { maximumActions: 0 };
    case "module":
    case "branch":
    case "repeat":
      throw new Error(`Nested step ${step.kind} must be analyzed through its recipe graph`);
  }
}

function classifyLeaf(accumulator: RiskAccumulator, step: RecipeStep, stepId: string): void {
  if (step.kind === "tap" || step.kind === "expect-screen") {
    accumulator.addBoundary(step.expectedApp);
  }

  switch (step.kind) {
    case "app":
      accumulator.addBoundary(step.app);
      if (step.url || step.action === "switcher") {
        accumulator.addBoundary(step.url ? "external-url" : "system-app-switcher");
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.externalApp,
          explanation: "The Test may cross into an external application boundary.",
          stepId,
          externalEffects: ["external-app"],
        });
      }
      if (step.action === "install" || step.action === "update") {
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.appInstallation,
          explanation: "The Test installs or updates an application on the target.",
          stepId,
          externalEffects: ["installation"],
          cleanupRequired: true,
        });
      } else if (step.action === "uninstall") {
        accumulator.addRisk({
          level: "destructive",
          code: EXECUTION_RISK_CODES.appUninstall,
          explanation: "The Test uninstalls an application and may remove its local data.",
          stepId,
          externalEffects: ["data-deletion", "installation"],
          cleanupRequired: true,
        });
      } else if (step.action === "set-locale") {
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.deviceState,
          explanation: "The Test changes application locale state on the target.",
          stepId,
          cleanupRequired: true,
        });
      }
      return;
    case "key":
      if (step.key === "home") {
        accumulator.addBoundary("system-home");
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.externalApp,
          explanation: "The Test leaves the foreground application for the system home surface.",
          stepId,
          externalEffects: ["external-app"],
        });
      }
      return;
    case "clipboard":
      accumulator.addRisk({
        level: "guarded",
        code: EXECUTION_RISK_CODES.clipboardAccess,
        explanation: "The Test reads or changes the target clipboard.",
        stepId,
        cleanupRequired: step.action === "write" || step.action === "paste",
      });
      return;
    case "device":
      if (step.action === "lock" || step.action === "unlock") {
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.deviceState,
          explanation: "The Test changes the target lock state.",
          stepId,
          cleanupRequired: true,
        });
      }
      return;
    case "settings":
      accumulator.addRisk({
        level: "guarded",
        code: EXECUTION_RISK_CODES.systemSetting,
        explanation: "The Test changes a system setting on the target.",
        stepId,
        cleanupRequired: true,
      });
      return;
    case "location":
      accumulator.addRisk({
        level: "guarded",
        code: EXECUTION_RISK_CODES.locationOverride,
        explanation: "The Test overrides the target location fixture.",
        stepId,
        cleanupRequired: true,
      });
      return;
    case "permission":
      accumulator.addRisk({
        level: "guarded",
        code: EXECUTION_RISK_CODES.permissionChange,
        explanation: "The Test changes an application permission on the target.",
        stepId,
        externalEffects: ["permission-change"],
        cleanupRequired: true,
      });
      return;
    case "alert":
      if (step.action === "accept" || step.action === "dismiss") {
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.alertMutation,
          explanation: "The Test confirms or dismisses a system alert.",
          stepId,
        });
      }
      return;
    case "pause":
      accumulator.addRisk({
        level: "guarded",
        confirmation: "human-only",
        code: EXECUTION_RISK_CODES.manualCheckpoint,
        explanation: "The Test contains a manual checkpoint that requires a person.",
        stepId,
      });
      return;
    case "evaluate-semantic":
      if (step.provider || step.secondProvider) {
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.externalAnalysis,
          explanation: "The Test may send captured content to an external analysis provider.",
          stepId,
        });
      }
      return;
    case "network":
      if (step.include === "body" || step.include === "all") {
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.networkBodyCapture,
          explanation: "The Test captures potentially sensitive network bodies.",
          stepId,
        });
      }
      return;
    case "logs":
      if (step.action === "clear") {
        accumulator.addRisk({
          level: "guarded",
          code: EXECUTION_RISK_CODES.logsClear,
          explanation: "The Test clears target logs before collecting new evidence.",
          stepId,
        });
      }
      return;
    case "tour":
      accumulator.addRisk({
        level: "guarded",
        code: EXECUTION_RISK_CODES.dynamicTour,
        explanation: "The Test dynamically explores multiple controls on the current screen.",
        stepId,
      });
      return;
    case "flow":
      accumulator.addRisk({
        level: "prohibited",
        code: EXECUTION_RISK_CODES.opaqueFlow,
        explanation: "The frozen Test contains an opaque coded flow that policy cannot inspect.",
        stepId,
      });
      return;
    case "script":
      accumulator.addRisk({
        level: "prohibited",
        code: EXECUTION_RISK_CODES.opaqueScript,
        explanation: "The frozen Test contains arbitrary script source that policy cannot inspect.",
        stepId,
      });
      return;
    case "tap":
    case "type":
    case "scroll":
    case "reveal":
    case "swipe":
    case "rotate":
    case "sleep":
    case "wait-for":
    case "wait-response":
    case "expect":
    case "expect-set":
    case "expect-screen":
    case "extract":
    case "assert-content":
    case "assert-layout":
    case "review":
    case "screenshot":
    case "capture-surface":
      return;
    case "module":
    case "branch":
    case "repeat":
      throw new Error(`Nested step ${step.kind} must be analyzed through its recipe graph`);
  }
}

function compileGraphRisk(
  rootRecipeId: string,
  recipes: FrozenRiskGraph,
  accumulator = new RiskAccumulator(),
): ExecutionRisk {
  const memo = new Map<string, Bounds>();

  const analyzeRecipe = (recipeId: string, stack: readonly string[]): Bounds => {
    const cached = memo.get(recipeId);
    if (cached) return cached;
    if (stack.includes(recipeId)) {
      accumulator.addRisk({
        level: "prohibited",
        code: EXECUTION_RISK_CODES.recipeCycle,
        explanation: "The frozen Test contains a cyclic reusable recipe graph.",
      });
      return {};
    }
    const recipe = recipes[recipeId];
    if (!recipe) {
      accumulator.addRisk({
        level: "prohibited",
        code: EXECUTION_RISK_CODES.missingRecipe,
        explanation: "The frozen Test references a recipe that is not present in its graph.",
      });
      return {};
    }
    const nextStack = [...stack, recipeId];
    let recipeBounds: Bounds = { maximumActions: 0, maximumDurationMs: 0 };
    for (const [index, step] of recipe.steps.entries()) {
      const stepId = riskStepId(recipeId, step, index);
      classifyReviewedEffects(accumulator, step, stepId);
      let stepBounds: Bounds;
      if (step.kind === "module") {
        stepBounds = analyzeRecipe(step.recipeId, nextStack);
      } else if (step.kind === "branch") {
        const thenBounds = analyzeRecipe(step.thenRecipeId, nextStack);
        const elseBounds = step.elseRecipeId
          ? analyzeRecipe(step.elseRecipeId, nextStack)
          : { maximumActions: 0, maximumDurationMs: 0 };
        stepBounds = alternative(thenBounds, elseBounds);
      } else if (step.kind === "repeat") {
        const repeated = analyzeRecipe(step.recipeId, nextStack);
        stepBounds = {
          maximumActions: multiplyOptional(repeated.maximumActions, step.count),
          maximumDurationMs: multiplyOptional(repeated.maximumDurationMs, step.count),
        };
      } else {
        classifyLeaf(accumulator, step, stepId);
        stepBounds = leafBounds(step);
      }

      const recoveryRecipeId = step.check?.recovery?.recipeId;
      if (recoveryRecipeId) {
        stepBounds = sequence(stepBounds, analyzeRecipe(recoveryRecipeId, nextStack));
      }
      const cleanupRecipeId = step.check?.cleanup?.recipeId;
      if (cleanupRecipeId) {
        accumulator.cleanupRequired = true;
        stepBounds = sequence(stepBounds, analyzeRecipe(cleanupRecipeId, nextStack));
      }
      recipeBounds = sequence(recipeBounds, stepBounds);
    }
    memo.set(recipeId, recipeBounds);
    return recipeBounds;
  };

  return accumulator.result(analyzeRecipe(rootRecipeId, []));
}

function prohibitedRisk(
  code: ExecutionRiskCode,
  explanation: string,
  stepId?: string,
): ExecutionRisk {
  const accumulator = new RiskAccumulator();
  accumulator.addRisk({ level: "prohibited", code, explanation, ...(stepId ? { stepId } : {}) });
  return accumulator.result({});
}

/**
 * Compile one frozen execution representation into policy input. This module
 * only classifies already-authored work; it never executes, repairs, or
 * approves a Test. Missing graph data and opaque code fail closed.
 */
export function compileExecutionRisk(source: ExecutionRiskCompilationSource): ExecutionRisk {
  if (source.kind === "compiled-test") {
    return compileGraphRisk(source.test.rootRecipeId, source.test.recipes);
  }
  if (source.kind === "recipe-graph") {
    return compileGraphRisk(source.rootRecipeId, source.recipes);
  }
  if (source.kind === "scenario-test") {
    try {
      const compiled = compileAppMapScenarioTest(source.appMap, source.test, source.options);
      return compileGraphRisk(compiled.plan.rootRecipeId, compiled.plan.recipes);
    } catch (error) {
      return prohibitedRisk(
        EXECUTION_RISK_CODES.scenarioUncompilable,
        "The scenario Test could not be compiled into a complete frozen execution graph.",
        error instanceof AppMapTestCompileError ? error.stepId : undefined,
      );
    }
  }

  const recipeId = "authoring-interactions";
  try {
    const steps = source.interactions.flatMap(({ id, interaction }) =>
      stepsForInteraction(interaction, id),
    );
    return compileGraphRisk(recipeId, { [recipeId]: { id: recipeId, steps } });
  } catch {
    return prohibitedRisk(
      EXECUTION_RISK_CODES.invalidInteraction,
      "The authoring interactions could not be converted into a valid frozen execution plan.",
    );
  }
}
