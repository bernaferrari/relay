import type { StepPoint, StepTarget } from "@relay/protocol";
import { validateRecipeSteps } from "../recipes.js";
import { appMapFail } from "./errors.js";
import type { ActionSpec } from "./model.js";
import {
  identifier,
  objectValue,
  optionalText,
  requiredText,
  safeInteger,
  stringArray,
} from "./validation-primitives.js";

function assertPoint(value: StepPoint, label: string): void {
  objectValue(value, label);
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    appMapFail("invalid-map", `${label} coordinates must be finite numbers`);
  }
  if (
    value.referenceBounds &&
    (!Number.isFinite(value.referenceBounds.width) ||
      value.referenceBounds.width <= 0 ||
      !Number.isFinite(value.referenceBounds.height) ||
      value.referenceBounds.height <= 0)
  ) {
    appMapFail("invalid-map", `${label}.referenceBounds dimensions must be positive`);
  }
}

function assertTarget(value: StepTarget, label: string): void {
  objectValue(value, label);
  optionalText(value.ref, `${label}.ref`);
  optionalText(value.label, `${label}.label`);
  optionalText(value.text, `${label}.text`);
  if (value.point) assertPoint(value.point, `${label}.point`);
  if (!value.ref && !value.label && !value.text && !value.point) {
    appMapFail("invalid-map", `${label} must contain a semantic or coordinate target`);
  }
}

export function assertActions(actions: ActionSpec[], label: string): void {
  if (!Array.isArray(actions)) appMapFail("invalid-map", `${label} must be an array`);
  const seen = new Set<string>();
  actions.forEach((action, index) => {
    const item = `${label}[${index}]`;
    objectValue(action, item);
    identifier(action.id, `${item}.id`);
    if (seen.has(action.id)) {
      appMapFail("duplicate-id", `${label} contains duplicate action ${action.id}`);
    }
    seen.add(action.id);
    optionalText(action.label, `${item}.label`);
    switch (action.kind) {
      case "recorded":
        identifier(action.takeId, `${item}.takeId`);
        safeInteger(action.takeRevision, `${item}.takeRevision`);
        if (action.takeRevision === 0)
          appMapFail("invalid-map", `${item}.takeRevision must be positive`);
        if (!Array.isArray(action.steps) || action.steps.length === 0) {
          appMapFail("invalid-map", `${item}.steps must contain at least one step`);
        }
        try {
          validateRecipeSteps(action.steps);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appMapFail("invalid-map", `${item}.steps are invalid: ${message}`);
        }
        stringArray(action.evidenceIds, `${item}.evidenceIds`);
        break;
      case "tap":
        assertTarget(action.target, `${item}.target`);
        break;
      case "text":
        if (typeof action.text !== "string")
          appMapFail("invalid-map", `${item}.text must be a string`);
        if (action.target) assertTarget(action.target, `${item}.target`);
        break;
      case "gesture":
        objectValue(action.gesture, `${item}.gesture`);
        if (action.gesture.kind === "swipe") {
          assertPoint(action.gesture.from, `${item}.gesture.from`);
          assertPoint(action.gesture.to, `${item}.gesture.to`);
          if (action.gesture.durationMs !== undefined)
            safeInteger(action.gesture.durationMs, `${item}.gesture.durationMs`);
        } else if (action.gesture.kind === "scroll") {
          if (!(action.gesture.direction === "up" || action.gesture.direction === "down"))
            appMapFail("invalid-map", `${item}.gesture.direction is unsupported`);
          if (action.gesture.amount !== undefined)
            safeInteger(action.gesture.amount, `${item}.gesture.amount`);
        } else appMapFail("invalid-map", `${item}.gesture.kind is unsupported`);
        break;
      case "back":
      case "home":
        break;
      case "wait":
        safeInteger(action.ms, `${item}.ms`);
        break;
      case "assertion": {
        const assertion = action.assertion;
        objectValue(assertion, `${item}.assertion`);
        if (assertion.kind === "screen")
          identifier(assertion.screenId, `${item}.assertion.screenId`);
        else if (assertion.kind === "target") {
          assertTarget(assertion.target, `${item}.assertion.target`);
          if (!(assertion.condition === "visible" || assertion.condition === "gone"))
            appMapFail("invalid-map", `${item}.assertion.condition is unsupported`);
          if (assertion.timeoutMs !== undefined)
            safeInteger(assertion.timeoutMs, `${item}.assertion.timeoutMs`);
        } else if (assertion.kind === "content") {
          requiredText(assertion.input, `${item}.assertion.input`);
          if (typeof assertion.expected !== "string")
            appMapFail("invalid-map", `${item}.assertion.expected must be a string`);
          if (
            !(
              assertion.match === "exact" ||
              assertion.match === "contains" ||
              assertion.match === "not-contains"
            )
          )
            appMapFail("invalid-map", `${item}.assertion.match is unsupported`);
        } else appMapFail("invalid-map", `${item}.assertion.kind is unsupported`);
        break;
      }
      case "routine":
        identifier(action.routineId, `${item}.routineId`);
        if (action.bindings !== undefined) {
          for (const [name, value] of Object.entries(
            objectValue(action.bindings, `${item}.bindings`),
          )) {
            identifier(name, `${item}.bindings key`);
            if (typeof value !== "string")
              appMapFail("invalid-map", `${item}.bindings.${name} must be a string`);
          }
        }
        break;
      case "passive":
        if (
          !(
            action.reason === "automatic" ||
            action.reason === "observe-only" ||
            action.reason === "external"
          )
        )
          appMapFail("invalid-map", `${item}.reason is unsupported`);
        break;
      default:
        appMapFail("invalid-map", `${item}.kind is unsupported`);
    }
  });
}
