/** Strict, transport-safe validation for the bounded iOS XCTest operation
 * lifecycle returned alongside a snapshot. Kept out of the broad operations
 * registry so the state machine is inspectable on its own. */
import type { IosSessionOperationLifecycle } from "./target-contract.js";
import { fail, number, record } from "./operation-parser-primitives.js";

const iosSessionOperations = new Set<IosSessionOperationLifecycle["operation"]>([
  "preview",
  "snapshot",
  "screenshot",
  "interaction",
  "evidence",
]);
const iosSessionOutcomes = new Set<IosSessionOperationLifecycle["outcome"]>([
  "passed",
  "unavailable",
  "in-flight",
]);
const iosSessionCodes = new Set<IosSessionOperationLifecycle["code"]>([
  "IOS_SESSION_OPERATION_READY",
  "IOS_SESSION_OPERATION_UNAVAILABLE",
  "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT",
]);
const iosSessionStages = new Set<IosSessionOperationLifecycle["stages"][number]["stage"]>([
  "preview",
  "xctest-availability",
  "accessibility-query",
  "repair",
]);
const iosSessionStageOutcomes = new Set<IosSessionOperationLifecycle["stages"][number]["outcome"]>([
  "passed",
  "failed",
  "skipped",
  "in-flight",
]);

export function assertIosSessionOperationLifecycle(value: unknown, label: string): void {
  const lifecycle = record(value, label);
  if (
    !iosSessionOperations.has(
      String(lifecycle.operation) as IosSessionOperationLifecycle["operation"],
    )
  ) {
    fail(`${label} operation`, "is unsupported");
  }
  if (
    !iosSessionOutcomes.has(String(lifecycle.outcome) as IosSessionOperationLifecycle["outcome"])
  ) {
    fail(`${label} outcome`, "is unsupported");
  }
  if (!iosSessionCodes.has(String(lifecycle.code) as IosSessionOperationLifecycle["code"])) {
    fail(`${label} code`, "is unsupported");
  }
  if (lifecycle.attempts !== 1) fail(`${label} attempts`, "must be exactly one");
  if (lifecycle.repairAttempted !== false) fail(`${label} repairAttempted`, "must be false");
  number(lifecycle.durationMs, `${label} durationMs`);
  if (!Array.isArray(lifecycle.stages)) fail(`${label} stages`, "must be an array");
  for (const [index, stageValue] of lifecycle.stages.entries()) {
    const stage = record(stageValue, `${label} stage ${index}`);
    if (
      !iosSessionStages.has(
        String(stage.stage) as IosSessionOperationLifecycle["stages"][number]["stage"],
      )
    ) {
      fail(`${label} stage ${index} stage`, "is unsupported");
    }
    if (
      !iosSessionStageOutcomes.has(
        String(stage.outcome) as IosSessionOperationLifecycle["stages"][number]["outcome"],
      )
    ) {
      fail(`${label} stage ${index} outcome`, "is unsupported");
    }
  }
  const expectedCode =
    lifecycle.outcome === "passed"
      ? "IOS_SESSION_OPERATION_READY"
      : lifecycle.outcome === "unavailable"
        ? "IOS_SESSION_OPERATION_UNAVAILABLE"
        : "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT";
  if (lifecycle.code !== expectedCode) {
    fail(`${label} code`, "does not match the operation outcome");
  }
  if (lifecycle.outcome !== "in-flight") return;
  const stages = lifecycle.stages.map((stageValue, index) =>
    record(stageValue, `${label} stage ${index}`),
  );
  if (
    !stages.some((stage) => stage.stage === "xctest-availability" && stage.outcome === "skipped") ||
    !stages.some((stage) => stage.stage === "accessibility-query" && stage.outcome === "in-flight")
  ) {
    fail(`${label} stages`, "must keep XCTest availability unclaimed while AX is in flight");
  }
}
