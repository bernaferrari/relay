import { repeatPilotSpecSchema, type RepeatPolicySpec } from "@relay/protocol";
import { appMapFail } from "./errors.js";
import { objectValue } from "./validation-primitives.js";

export function assertRepeatPolicy(
  value: unknown,
  label: string,
): asserts value is RepeatPolicySpec {
  if (value === undefined) return;
  const policy = objectValue(value, label);
  for (const key of Object.keys(policy)) {
    if (key !== "pilot" && key !== "resume" && key !== "valueModes") {
      appMapFail("invalid-map", `${label} has unknown field ${key}`);
    }
  }
  if (
    policy.resume !== undefined &&
    policy.resume !== "untouched" &&
    policy.resume !== "failed" &&
    policy.resume !== "all"
  ) {
    appMapFail("invalid-map", `${label}.resume is invalid`);
  }
  if (policy.pilot !== undefined && !repeatPilotSpecSchema.safeParse(policy.pilot).success) {
    appMapFail("invalid-map", `${label}.pilot is invalid`);
  }
  if (policy.valueModes !== undefined) {
    const modes = objectValue(policy.valueModes, `${label}.valueModes`);
    for (const [dimensionId, mode] of Object.entries(modes)) {
      if (!dimensionId.trim() || (mode !== "all" && mode !== "supported")) {
        appMapFail("invalid-map", `${label}.valueModes is invalid`);
      }
    }
  }
}
