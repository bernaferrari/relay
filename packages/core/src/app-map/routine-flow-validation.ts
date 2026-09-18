import {
  isRoutineAccountIsolation,
  isRoutineLeftoverSurface,
  isRoutineSharingPolicy,
  isRoutineStartingStateFact,
  type RoutineEffects,
} from "@relay/protocol";
import { appMapFail } from "./errors.js";
import type { AppMapScope, Flow, Routine } from "./model.js";
import { assertActions } from "./action-validation.js";
import { assertEntity } from "./entity-validation.js";
import {
  finiteTimestamp,
  identifier,
  objectValue,
  optionalText,
  requiredText,
  stringArray,
} from "./validation-primitives.js";

function assertUniqueEnumList(
  values: readonly string[] | undefined,
  label: string,
  allowed: (value: string) => boolean,
  kind: string,
): void {
  if (values === undefined) return;
  if (!Array.isArray(values)) appMapFail("invalid-map", `${label} must be an array`);
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (typeof value !== "string" || !allowed(value)) {
      appMapFail("invalid-map", `${label}[${index}] must be a ${kind}`);
    }
    if (seen.has(value)) appMapFail("duplicate-id", `${label} contains duplicate ${value}`);
    seen.add(value);
  });
}

export function assertRoutineEffects(effects: RoutineEffects, label: string): void {
  objectValue(effects, label);
  const unknown = Object.keys(effects).filter(
    (key) =>
      ![
        "establishes",
        "requires",
        "leftover",
        "sharing",
        "accountIsolation",
        "accountIsolationNote",
      ].includes(key),
  );
  if (unknown.length) appMapFail("invalid-map", `${label} contains unknown field ${unknown[0]}`);
  assertUniqueEnumList(
    effects.establishes,
    `${label}.establishes`,
    isRoutineStartingStateFact,
    "starting-state fact",
  );
  assertUniqueEnumList(
    effects.requires,
    `${label}.requires`,
    isRoutineStartingStateFact,
    "starting-state fact",
  );
  assertUniqueEnumList(
    effects.leftover,
    `${label}.leftover`,
    isRoutineLeftoverSurface,
    "leftover surface",
  );
  if (effects.sharing !== undefined && !isRoutineSharingPolicy(effects.sharing)) {
    appMapFail("invalid-map", `${label}.sharing is unsupported`);
  }
  if (
    effects.accountIsolation !== undefined &&
    !isRoutineAccountIsolation(effects.accountIsolation)
  ) {
    appMapFail("invalid-map", `${label}.accountIsolation is unsupported`);
  }
  optionalText(effects.accountIsolationNote, `${label}.accountIsolationNote`, 500);
}

export function assertRoutine(routine: Routine, scope: AppMapScope, label: string): void {
  assertEntity(routine, scope, label);
  requiredText(routine.name, `${label}.name`);
  optionalText(routine.description, `${label}.description`);
  if (!Array.isArray(routine.parameters))
    appMapFail("invalid-map", `${label}.parameters must be an array`);
  const names = new Set<string>();
  routine.parameters.forEach((parameter, index) => {
    objectValue(parameter, `${label}.parameters[${index}]`);
    identifier(parameter.name, `${label}.parameters[${index}].name`);
    if (names.has(parameter.name))
      appMapFail("duplicate-id", `${label} contains duplicate parameter ${parameter.name}`);
    names.add(parameter.name);
    optionalText(parameter.label, `${label}.parameters[${index}].label`);
    optionalText(parameter.description, `${label}.parameters[${index}].description`);
    if (parameter.default !== undefined && typeof parameter.default !== "string")
      appMapFail("invalid-map", `${label}.parameters[${index}].default must be a string`);
    if (parameter.required !== undefined && typeof parameter.required !== "boolean")
      appMapFail("invalid-map", `${label}.parameters[${index}].required must be boolean`);
  });
  assertActions(routine.actions, `${label}.actions`);
  if (routine.requirementAction !== undefined) {
    if (
      typeof routine.requirementAction !== "string" ||
      (routine.requirementAction !== "capture-view" && routine.requirementAction !== "test-action")
    ) {
      appMapFail("invalid-map", `${label}.requirementAction is unsupported`);
    }
  }
  if (routine.effects !== undefined) assertRoutineEffects(routine.effects, `${label}.effects`);
}

export function assertFlow(flow: Flow, scope: AppMapScope, label: string): void {
  assertEntity(flow, scope, label);
  requiredText(flow.name, `${label}.name`);
  identifier(flow.startScreenId, `${label}.startScreenId`);
  if (flow.setup !== undefined) {
    objectValue(flow.setup, `${label}.setup`);
    identifier(flow.setup.routineId, `${label}.setup.routineId`);
    if (flow.setup.bindings !== undefined) {
      objectValue(flow.setup.bindings, `${label}.setup.bindings`);
      for (const [name, value] of Object.entries(flow.setup.bindings)) {
        identifier(name, `${label}.setup.bindings key`);
        if (typeof value !== "string")
          appMapFail("invalid-map", `${label}.setup.bindings.${name} must be a string`);
      }
    }
  }
  stringArray(flow.connectionIds, `${label}.connectionIds`);
}
