import { fail, number, record, string } from "./operation-parser-primitives.js";

const targetRuntimeCapabilityStates = new Set(["unproven", "proven", "unavailable"]);
const targetRuntimeCapabilityModes = new Set(["pixels", "accessibility", "evidence"]);
const targetRuntimeCapabilityFreshness = new Set(["current", "stale", "unproven"]);
const targetRuntimeCapabilityModeByKey = {
  previewPixels: "pixels",
  semanticControl: "accessibility",
  evidenceCapture: "evidence",
} as const;
const targetRuntimeCapabilityReasons = new Set([
  "not-yet-proven",
  "target-stopped",
  "developer-mode-disabled",
  "developer-services-unavailable",
  "probe-failed",
  "probe-in-flight",
  "input-changed",
  "visual-changed",
]);

export function assertTargetRuntimeReadiness(value: unknown, label: string): void {
  const readiness = record(value, label);
  for (const capability of Object.keys(targetRuntimeCapabilityModeByKey) as Array<
    keyof typeof targetRuntimeCapabilityModeByKey
  >) {
    const state = record(readiness[capability], `${label} ${capability}`);
    if (!targetRuntimeCapabilityModes.has(String(state.mode))) {
      fail(`${label} ${capability} mode`, "must be pixels, accessibility, or evidence");
    }
    if (state.mode !== targetRuntimeCapabilityModeByKey[capability]) {
      fail(
        `${label} ${capability} mode`,
        `must be ${targetRuntimeCapabilityModeByKey[capability]}`,
      );
    }
    if (!targetRuntimeCapabilityStates.has(String(state.state))) {
      fail(`${label} ${capability} state`, "must be unproven, proven, or unavailable");
    }
    if (!targetRuntimeCapabilityFreshness.has(String(state.freshness))) {
      fail(`${label} ${capability} freshness`, "must be current, stale, or unproven");
    }
    const proven = state.state === "proven";
    if (proven && state.freshness === "unproven") {
      fail(`${label} ${capability} freshness`, "cannot be unproven after a successful proof");
    }
    if (!proven && state.freshness !== "unproven") {
      fail(`${label} ${capability} freshness`, "must be unproven without a successful proof");
    }
    if (proven && state.proof === undefined) {
      fail(`${label} ${capability} proof`, "is required when state is proven");
    }
    if (!proven && state.proof !== undefined) {
      fail(`${label} ${capability} proof`, "is only allowed when state is proven");
    }
    if (state.proof !== undefined) {
      const proof = record(state.proof, `${label} ${capability} proof`);
      number(proof.at, `${label} ${capability} proof at`);
      if (proof.observedNodeCount !== undefined) {
        number(proof.observedNodeCount, `${label} ${capability} proof observedNodeCount`);
      }
      if (proof.durationMs !== undefined) {
        number(proof.durationMs, `${label} ${capability} proof durationMs`);
      }
    }
    if (state.lastError !== undefined) {
      if (proven) {
        fail(`${label} ${capability} lastError`, "is not allowed when state is proven");
      }
      const lastError = record(state.lastError, `${label} ${capability} lastError`);
      number(lastError.at, `${label} ${capability} lastError at`);
      if (!targetRuntimeCapabilityReasons.has(String(lastError.reason))) {
        fail(`${label} ${capability} lastError reason`, "is unsupported");
      }
      if (lastError.observedNodeCount !== undefined) {
        number(lastError.observedNodeCount, `${label} ${capability} lastError observedNodeCount`);
      }
      if (lastError.durationMs !== undefined) {
        number(lastError.durationMs, `${label} ${capability} lastError durationMs`);
      }
      if (lastError.message !== undefined) {
        string(lastError.message, `${label} ${capability} lastError message`);
        if ((lastError.message as string).length > 480) {
          fail(`${label} ${capability} lastError message`, "must be at most 480 characters");
        }
      }
    }
    if (state.invalidated !== undefined) {
      if (!proven || state.freshness !== "stale" || capability !== "semanticControl") {
        fail(
          `${label} ${capability} invalidated`,
          "is only allowed for stale proven semantic control",
        );
      }
      const invalidated = record(state.invalidated, `${label} ${capability} invalidated`);
      number(invalidated.at, `${label} ${capability} invalidated at`);
      if (!new Set(["input-changed", "visual-changed"]).has(String(invalidated.reason))) {
        fail(
          `${label} ${capability} invalidated reason`,
          "must be input-changed or visual-changed",
        );
      }
    }
    if (proven && state.freshness === "stale" && state.invalidated === undefined) {
      fail(`${label} ${capability} invalidated`, "is required when a semantic proof is stale");
    }
    if (state.reason !== undefined && !targetRuntimeCapabilityReasons.has(String(state.reason))) {
      fail(`${label} ${capability} reason`, "is unsupported");
    }
    if (state.nextProbeAt !== undefined) {
      number(state.nextProbeAt, `${label} ${capability} nextProbeAt`);
      if (
        capability !== "semanticControl" ||
        state.state !== "unavailable" ||
        state.lastError === undefined ||
        record(state.lastError, `${label} ${capability} lastError`).reason !== "probe-failed"
      ) {
        fail(
          `${label} ${capability} nextProbeAt`,
          "is only allowed after an unavailable semantic probe failure",
        );
      }
    }
  }
}
