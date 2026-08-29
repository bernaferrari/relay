import type { AppMapScope, LogicalProductState, ProductActionIntent } from "./model.js";
import { appMapFail } from "./errors.js";
import { assertEntity } from "./entity-validation.js";
import {
  finiteTimestamp,
  identifier,
  objectValue,
  optionalText,
  requiredText,
  safeInteger,
} from "./validation-primitives.js";

export function assertLogicalProductState(
  state: LogicalProductState,
  scope: AppMapScope,
  label: string,
): void {
  assertEntity(state, scope, label);
  requiredText(state.name, `${label}.name`);
  optionalText(state.description, `${label}.description`);
}

export function assertProductActionIntent(
  intent: ProductActionIntent,
  scope: AppMapScope,
  label: string,
): void {
  assertEntity(intent, scope, label);
  requiredText(intent.name, `${label}.name`);
  optionalText(intent.description, `${label}.description`);
}

export function assertReviewedBinding(
  value: unknown,
  identityField: "logicalStateId" | "intentId",
  label: string,
): void {
  const binding = objectValue(value, label);
  const allowed = new Set([identityField, "revision", "reviewedAt", "reviewedBy"]);
  const unknown = Object.keys(binding).find((key) => !allowed.has(key));
  if (unknown) appMapFail("invalid-map", `${label} contains unknown field ${unknown}`);
  identifier(binding[identityField], `${label}.${identityField}`);
  safeInteger(binding.revision, `${label}.revision`);
  if (binding.revision === 0) appMapFail("invalid-map", `${label}.revision must be positive`);
  finiteTimestamp(binding.reviewedAt, `${label}.reviewedAt`);
  requiredText(binding.reviewedBy, `${label}.reviewedBy`);
}
