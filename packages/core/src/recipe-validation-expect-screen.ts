import type { RecipeStep } from "@relay/protocol";
import { MAX_WAIT_MS, isNumber, isObject, isString, stepErr } from "./recipe-validation-support.js";
import { parseExpectScreenCampaignFields } from "./recipe-validation-campaign.js";
import { parseNamedPixelRegions } from "./recipe-validation-judges.js";

export function parseExpectScreenStep(
  raw: Record<string, unknown>,
  index: number,
  note?: string,
): Extract<RecipeStep, { kind: "expect-screen" }> {
  if (!isString(raw.screenId) || !raw.screenId.trim()) {
    throw stepErr(index, "expect-screen.screenId is required");
  }
  if (!isString(raw.screenTitle) || !raw.screenTitle.trim()) {
    throw stepErr(index, "expect-screen.screenTitle is required");
  }
  if (!isString(raw.fingerprint) || !/^[a-f0-9]{64}$/u.test(raw.fingerprint)) {
    throw stepErr(index, "expect-screen.fingerprint must be a SHA-256 fingerprint");
  }
  if (raw.expectedApp !== undefined && (!isString(raw.expectedApp) || !raw.expectedApp.trim())) {
    throw stepErr(index, "expect-screen.expectedApp must be a non-empty package identifier");
  }
  if (
    raw.aliases !== undefined &&
    (!Array.isArray(raw.aliases) ||
      raw.aliases.length > 256 ||
      !raw.aliases.every((alias) => isString(alias) && /^[a-f0-9]{64}$/u.test(alias)))
  ) {
    throw stepErr(index, "expect-screen.aliases must be SHA-256 fingerprints");
  }
  let screenTimeoutMs: number | undefined;
  if (raw.timeoutMs !== undefined) {
    if (
      !isNumber(raw.timeoutMs) ||
      !Number.isInteger(raw.timeoutMs) ||
      raw.timeoutMs < 0 ||
      raw.timeoutMs > MAX_WAIT_MS
    ) {
      throw stepErr(index, `expect-screen.timeoutMs must be an integer <= ${MAX_WAIT_MS}`);
    }
    screenTimeoutMs = raw.timeoutMs;
  }
  if (
    raw.observations !== undefined &&
    (!Array.isArray(raw.observations) ||
      raw.observations.length > 256 ||
      !raw.observations.every(
        (observation) =>
          isObject(observation) &&
          isString(observation.fingerprint) &&
          /^[a-f0-9]{64}$/u.test(observation.fingerprint) &&
          Array.isArray(observation.nodes) &&
          Array.isArray(observation.volatileSignals),
      ))
  ) {
    throw stepErr(index, "expect-screen.observations must be semantic observations");
  }
  let recovery: Extract<RecipeStep, { kind: "expect-screen" }>["recovery"];
  if (raw.recovery !== undefined) {
    if (!isObject(raw.recovery) || raw.recovery.strategy !== "back") {
      throw stepErr(index, 'expect-screen.recovery.strategy must be "back"');
    }
    if (
      raw.recovery.maxAttempts !== undefined &&
      (!isNumber(raw.recovery.maxAttempts) ||
        !Number.isInteger(raw.recovery.maxAttempts) ||
        raw.recovery.maxAttempts < 1 ||
        raw.recovery.maxAttempts > 12)
    ) {
      throw stepErr(index, "expect-screen.recovery.maxAttempts must be an integer from 1 to 12");
    }
    if (
      raw.recovery.restoreParentViewport !== undefined &&
      typeof raw.recovery.restoreParentViewport !== "boolean"
    ) {
      throw stepErr(index, "expect-screen.recovery.restoreParentViewport must be a boolean");
    }
    recovery = {
      strategy: "back",
      ...(raw.recovery.maxAttempts !== undefined ? { maxAttempts: raw.recovery.maxAttempts } : {}),
      ...(raw.recovery.restoreParentViewport === true ? { restoreParentViewport: true } : {}),
    };
  }
  const ignoreRegions = parseNamedPixelRegions(
    raw.ignoreRegions,
    index,
    "expect-screen.ignoreRegions",
  );
  return {
    kind: "expect-screen",
    screenId: raw.screenId,
    screenTitle: raw.screenTitle,
    fingerprint: raw.fingerprint,
    ...(isString(raw.expectedApp) ? { expectedApp: raw.expectedApp.trim() } : {}),
    ...(screenTimeoutMs !== undefined ? { timeoutMs: screenTimeoutMs } : {}),
    ...(raw.aliases?.length ? { aliases: [...raw.aliases] as string[] } : {}),
    ...(raw.observations?.length
      ? {
          observations: structuredClone(raw.observations) as Extract<
            RecipeStep,
            { kind: "expect-screen" }
          >["observations"],
        }
      : {}),
    ...(recovery ? { recovery } : {}),
    ...parseExpectScreenCampaignFields(raw, index),
    ...(ignoreRegions ? { ignoreRegions } : {}),
    ...(note ? { note } : {}),
  };
}
