import type { NamedControlTarget } from "./device-target-resolution.js";
import type { TargetContext } from "./target-context.js";

/** A pure identifier needs current selector proof, without unrelated Home chrome. */
export function namedControlObservationOptions(
  target: NamedControlTarget,
  platform: TargetContext["platform"],
) {
  return {
    ...(target.identifier?.trim() ? { includeIdentifiers: [target.identifier] } : {}),
    ...(target.label?.trim() ? { includeLabels: [target.label] } : {}),
    requestedChromeOnly:
      platform === "ios" &&
      Boolean(target.identifier?.trim()) &&
      !target.label?.trim() &&
      !target.text?.trim() &&
      !target.heading?.trim() &&
      !target.role?.trim() &&
      !target.relation &&
      !target.point,
  };
}
