import type {
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTestCompileDiagnostic,
} from "@relay/protocol";

export type AppMapTestCompileErrorCode =
  | "unresolved-step"
  | "missing-reference"
  | "draft-connection"
  | "compiled-step-limit"
  | "cold-coverage-effect"
  | "unresolved-navigation"
  | "target-surface-required"
  | "target-profile-ambiguous"
  | "route-variant-not-found"
  | "route-variant-ambiguous"
  | "unsupported-platform";

export class AppMapTestCompileError extends Error {
  constructor(
    readonly code: AppMapTestCompileErrorCode,
    readonly testId: string,
    readonly stepId: string,
    message: string,
    readonly diagnostics: readonly AppMapTestCompileDiagnostic[] = [],
  ) {
    super(message);
    this.name = "AppMapTestCompileError";
  }
}

export function appMapTestCompileFail(
  code: AppMapTestCompileErrorCode,
  test: AppMapScenarioTest,
  step: AppMapScenarioTestStep,
  message: string,
): never {
  throw new AppMapTestCompileError(code, test.id, step.id, message);
}
