import { appMapFail } from "./errors.js";
import { MAX_INPUT_DATA_SET_VALUE_LENGTH } from "@relay/protocol";
import { assertEntity } from "./entity-validation.js";
import type {
  AppMapScope,
  AppMapVariable,
  AppMapVariableKind,
  VariableApply,
  VariableNavStep,
  VariableRow,
} from "./model.js";
import {
  identifier,
  objectValue,
  optionalText,
  requiredText,
  safeInteger,
} from "./validation-primitives.js";

const APP_MAP_VARIABLE_KINDS = new Set<AppMapVariableKind>([
  "language",
  "location",
  "account",
  "theme",
  "workspace",
  "build",
  "toggle",
  "custom",
]);

function assertVariableNavStep(step: VariableNavStep, label: string): void {
  if (step.kind === "wait") {
    safeInteger(step.ms, `${label}.ms`);
    return;
  }
  if (step.kind === "scroll") {
    if (step.direction !== "up" && step.direction !== "down") {
      appMapFail("invalid-map", `${label}.direction is unsupported`);
    }
    return;
  }
  if (step.kind === "openApp") {
    requiredText(step.app, `${label}.app`);
    return;
  }
  if (step.kind === "tap") {
    const target = step.target;
    if (!target.identifier?.trim() && !target.label?.trim() && !target.text?.trim()) {
      appMapFail("invalid-map", `${label}.target needs identifier, label, or text`);
    }
    if (step.fallbackTargets !== undefined) {
      if (!Array.isArray(step.fallbackTargets) || step.fallbackTargets.length > 8) {
        appMapFail("invalid-map", `${label}.fallbackTargets must contain at most 8 targets`);
      }
      step.fallbackTargets.forEach((fallback, index) => {
        if (!fallback.identifier?.trim() && !fallback.label?.trim() && !fallback.text?.trim()) {
          appMapFail(
            "invalid-map",
            `${label}.fallbackTargets[${index}] needs identifier, label, or text`,
          );
        }
      });
    }
    return;
  }
  if (step.kind !== "back" && step.kind !== "relaunch") {
    appMapFail("invalid-map", `${label}.kind is unsupported`);
  }
}

function assertVariableApply(apply: VariableApply, label: string): void {
  if (apply.kind === "input") {
    requiredText(apply.inputId, `${label}.inputId`);
    return;
  }
  if (apply.kind === "list") {
    if (apply.inConnectionId !== undefined)
      identifier(apply.inConnectionId, `${label}.inConnectionId`);
    if (apply.outConnectionId !== undefined)
      identifier(apply.outConnectionId, `${label}.outConnectionId`);
    if (apply.listScreenId !== undefined) identifier(apply.listScreenId, `${label}.listScreenId`);
    if (apply.pickStepId !== undefined) identifier(apply.pickStepId, `${label}.pickStepId`);
    if (apply.entryPath) {
      if (!Array.isArray(apply.entryPath))
        appMapFail("invalid-map", `${label}.entryPath must be an array`);
      apply.entryPath.forEach((step, index) =>
        assertVariableNavStep(step, `${label}.entryPath[${index}]`),
      );
    }
    if (apply.pickerPath) {
      if (!Array.isArray(apply.pickerPath))
        appMapFail("invalid-map", `${label}.pickerPath must be an array`);
      apply.pickerPath.forEach((step, index) =>
        assertVariableNavStep(step, `${label}.pickerPath[${index}]`),
      );
    }
    if (apply.exitPath) {
      if (!Array.isArray(apply.exitPath))
        appMapFail("invalid-map", `${label}.exitPath must be an array`);
      apply.exitPath.forEach((step, index) =>
        assertVariableNavStep(step, `${label}.exitPath[${index}]`),
      );
    }
    return;
  }
  if (apply.kind === "appLocale") {
    requiredText(apply.app, `${label}.app`);
    if (apply.relaunch !== undefined && typeof apply.relaunch !== "boolean") {
      appMapFail("invalid-map", `${label}.relaunch must be a boolean`);
    }
    return;
  }
  if (apply.kind === "toggle") {
    objectValue(apply.target, `${label}.target`);
    return;
  }
  appMapFail("invalid-map", `${label}.kind is unsupported`);
}

function assertVariableRow(row: VariableRow, label: string): void {
  requiredText(row.id, `${label}.id`);
  optionalText(row.value, `${label}.value`, MAX_INPUT_DATA_SET_VALUE_LENGTH);
  optionalText(row.identifier, `${label}.identifier`);
  optionalText(row.label, `${label}.label`);
  optionalText(row.text, `${label}.text`);
}

export function assertAppMapVariable(set: AppMapVariable, scope: AppMapScope, label: string): void {
  assertEntity(set, scope, label);
  requiredText(set.name, `${label}.name`);
  if (!APP_MAP_VARIABLE_KINDS.has(set.kind)) {
    appMapFail("invalid-map", `${label}.kind is unsupported`);
  }
  assertVariableApply(set.apply, `${label}.apply`);
  if (!Array.isArray(set.options)) appMapFail("invalid-map", `${label}.options must be an array`);
  const ids = new Set<string>();
  for (const [index, row] of set.options.entries()) {
    assertVariableRow(row, `${label}.options[${index}]`);
    if (set.apply.kind === "input") {
      identifier(row.id, `${label}.options[${index}].id`);
      requiredText(row.value, `${label}.options[${index}].value`, MAX_INPUT_DATA_SET_VALUE_LENGTH);
    }
    if (ids.has(row.id))
      appMapFail("duplicate-id", `${label}.options contains duplicate id ${row.id}`);
    ids.add(row.id);
  }
  optionalText(set.restoreId, `${label}.restoreId`);
}
