import type { AppMapScope, Proposal, ProposalChange } from "./model.js";
import { appMapFail } from "./errors.js";
import {
  finiteTimestamp,
  identifier,
  objectValue,
  optionalText,
  requiredText,
  safeInteger,
  stringArray,
} from "./validation-primitives.js";

function allowedKeys(value: object, keys: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) appMapFail("invalid-map", `${label} contains unknown field ${unknown}`);
}

export function assertProposalRepair(
  repairValue: NonNullable<Proposal["repair"]>,
  scope: AppMapScope,
  label: string,
  assertChange: (change: ProposalChange, scope: AppMapScope, label: string) => void,
): void {
  const repair = objectValue(repairValue, label);
  allowedKeys(
    repair,
    [
      "kind",
      "testId",
      "repairTargetIds",
      "sourceRunIds",
      "sourceCheckIds",
      "evidenceFramePaths",
      "equivalentDiffKey",
      "inverseChanges",
      "approvedRevision",
      "reverted",
    ],
    label,
  );
  if (!(["retarget", "accept-current", "disable"] as unknown[]).includes(repair.kind)) {
    appMapFail("invalid-map", `${label}.kind is unsupported`);
  }
  identifier(repair.testId, `${label}.testId`);
  for (const field of ["repairTargetIds", "sourceRunIds", "sourceCheckIds"] as const) {
    stringArray(repair[field], `${label}.${field}`);
    if (repair[field].length === 0)
      appMapFail("invalid-map", `${label}.${field} must not be empty`);
  }
  if (!Array.isArray(repair.evidenceFramePaths) || repair.evidenceFramePaths.length === 0) {
    appMapFail("invalid-map", `${label}.evidenceFramePaths must not be empty`);
  }
  repair.evidenceFramePaths.forEach((path, index) =>
    requiredText(path, `${label}.evidenceFramePaths[${index}]`, 2_000),
  );
  requiredText(repair.equivalentDiffKey, `${label}.equivalentDiffKey`);
  if (!Array.isArray(repair.inverseChanges) || repair.inverseChanges.length === 0) {
    appMapFail("invalid-map", `${label}.inverseChanges must not be empty`);
  }
  repair.inverseChanges.forEach((change, index) =>
    assertChange(change, scope, `${label}.inverseChanges[${index}]`),
  );
  if (repair.approvedRevision !== undefined) {
    safeInteger(repair.approvedRevision, `${label}.approvedRevision`);
  }
  if (repair.reverted !== undefined) {
    const reverted = objectValue(repair.reverted, `${label}.reverted`);
    allowedKeys(reverted, ["actorId", "at", "reason"], `${label}.reverted`);
    identifier(reverted.actorId, `${label}.reverted.actorId`);
    finiteTimestamp(reverted.at, `${label}.reverted.at`);
    optionalText(reverted.reason, `${label}.reverted.reason`);
  }
}
