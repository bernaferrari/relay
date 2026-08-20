import { createHash } from "node:crypto";
import {
  appMapCombineCellValueEntries,
  canonicalAppMapCombineCellValues,
  compareUtf8Bytewise,
  sameAppMapCombineCellValues,
} from "@relay/protocol";
import type { AppMapCombineCellRuntimeProfile } from "@relay/protocol";

export {
  appMapCombineCellValueEntries,
  canonicalAppMapCombineCellValues,
  compareUtf8Bytewise,
  sameAppMapCombineCellValues,
};

const CELL_ID_PREFIX = "c";
const CELL_ID_HEX_LENGTH = 32;

export function appMapCombineCellIdentityPayload(
  testId: string,
  values: Record<string, string>,
): { testId: string; values: Array<{ variableId: string; valueId: string }> } {
  return { testId, values: appMapCombineCellValueEntries(values) };
}

/** Bounded identifier-safe digest of canonical testId + sorted variable/value pairs. */
export function appMapCombineCellId(testId: string, values: Record<string, string>): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(appMapCombineCellIdentityPayload(testId, values)))
    .digest("hex")
    .slice(0, CELL_ID_HEX_LENGTH);
  return `${CELL_ID_PREFIX}${digest}`;
}

export function isAppMapCombineCellId(value: string): boolean {
  return new RegExp(`^${CELL_ID_PREFIX}[a-f0-9]{${CELL_ID_HEX_LENGTH}}$`, "u").test(value);
}

export function canonicalAppMapCombineCellRuntimeProfile(
  binding: AppMapCombineCellRuntimeProfile,
): AppMapCombineCellRuntimeProfile {
  return {
    testId: binding.testId,
    values: canonicalAppMapCombineCellValues(binding.values),
    targetProfileId: binding.targetProfileId,
  };
}

export function appMapCombineCellBindingId(binding: AppMapCombineCellRuntimeProfile): string {
  return appMapCombineCellId(binding.testId, binding.values);
}

/** Collision-free wrapper prefix. Index plus content digest so `a-b` and `a_b` never share helpers. */
export function appMapCombineCellVariablePrefix(variableId: string, index: number): string {
  const digest = createHash("sha256").update(variableId, "utf8").digest("hex").slice(0, 12);
  return `v${index}_${digest}`;
}
