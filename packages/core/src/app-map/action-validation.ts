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
  if (value.relativeTo) {
    const { target, xRatio, yRatio } = value.relativeTo;
    objectValue(target, `${label}.relativeTo.target`);
    optionalText(target.identifier, `${label}.relativeTo.target.identifier`);
    optionalText(target.ref, `${label}.relativeTo.target.ref`);
    optionalText(target.label, `${label}.relativeTo.target.label`);
    optionalText(target.role, `${label}.relativeTo.target.role`);
    optionalText(target.text, `${label}.relativeTo.target.text`);
    if (!target.identifier && !target.ref && !target.label && !target.text) {
      appMapFail("invalid-map", `${label}.relativeTo.target must contain a semantic selector`);
    }
    if (
      !Number.isFinite(xRatio) ||
      xRatio < 0 ||
      xRatio > 1 ||
      !Number.isFinite(yRatio) ||
      yRatio < 0 ||
      yRatio > 1
    ) {
      appMapFail("invalid-map", `${label}.relativeTo ratios must be between 0 and 1`);
    }
  }
}

export function assertTarget(value: StepTarget, label: string): void {
  objectValue(value, label);
  optionalText(value.identifier, `${label}.identifier`);
  optionalText(value.ref, `${label}.ref`);
  optionalText(value.label, `${label}.label`);
  optionalText(value.role, `${label}.role`);
  optionalText(value.text, `${label}.text`);
  if (value.relation) {
    objectValue(value.relation, `${label}.relation`);
    if (value.relation.kind !== "following-row") {
      appMapFail("invalid-map", `${label}.relation.kind is unsupported`);
    }
    const anchor = objectValue(value.relation.anchor, `${label}.relation.anchor`);
    optionalText(anchor.identifier as string | undefined, `${label}.relation.anchor.identifier`);
    optionalText(anchor.ref as string | undefined, `${label}.relation.anchor.ref`);
    optionalText(anchor.label as string | undefined, `${label}.relation.anchor.label`);
    optionalText(anchor.role as string | undefined, `${label}.relation.anchor.role`);
    optionalText(anchor.text as string | undefined, `${label}.relation.anchor.text`);
    if (!anchor.identifier && !anchor.ref && !anchor.label && !anchor.text) {
      appMapFail("invalid-map", `${label}.relation.anchor must contain a semantic selector`);
    }
  }
  if (value.point) assertPoint(value.point, `${label}.point`);
  if (
    !value.identifier &&
    !value.ref &&
    !value.label &&
    !value.text &&
    !value.relation &&
    !value.point
  ) {
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
    if (action.optional !== undefined && typeof action.optional !== "boolean") {
      appMapFail("invalid-map", `${item}.optional must be a boolean`);
    }
    if (action.when !== undefined) {
      objectValue(action.when, `${item}.when`);
      assertTarget(action.when.target, `${item}.when.target`);
      if (!(action.when.condition === "present" || action.when.condition === "absent")) {
        appMapFail("invalid-map", `${item}.when.condition is unsupported`);
      }
      if (action.when.region !== undefined) {
        objectValue(action.when.region, `${item}.when.region`);
        const values = [
          action.when.region.minX,
          action.when.region.maxX,
          action.when.region.minY,
          action.when.region.maxY,
        ].filter((value): value is number => value !== undefined);
        if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
          appMapFail("invalid-map", `${item}.when.region values must be between 0 and 1`);
        }
        if (
          action.when.region.minX !== undefined &&
          action.when.region.maxX !== undefined &&
          action.when.region.minX >= action.when.region.maxX
        ) {
          appMapFail("invalid-map", `${item}.when.region minX must be less than maxX`);
        }
        if (
          action.when.region.minY !== undefined &&
          action.when.region.maxY !== undefined &&
          action.when.region.minY >= action.when.region.maxY
        ) {
          appMapFail("invalid-map", `${item}.when.region minY must be less than maxY`);
        }
      }
    }
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
      case "steps":
        if (!Array.isArray(action.steps) || action.steps.length === 0) {
          appMapFail("invalid-map", `${item}.steps must contain at least one step`);
        }
        try {
          validateRecipeSteps(action.steps);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appMapFail("invalid-map", `${item}.steps are invalid: ${message}`);
        }
        break;
      case "tap":
        assertTarget(action.target, `${item}.target`);
        if (action.expectedApp !== undefined) {
          requiredText(action.expectedApp, `${item}.expectedApp`, 240);
        }
        if (action.fallbackTargets !== undefined) {
          if (!Array.isArray(action.fallbackTargets) || action.fallbackTargets.length > 8) {
            appMapFail("invalid-map", `${item}.fallbackTargets must contain at most 8 targets`);
          }
          action.fallbackTargets.forEach((target, fallbackIndex) =>
            assertTarget(target, `${item}.fallbackTargets[${fallbackIndex}]`),
          );
        }
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
      case "reveal":
        assertTarget(action.target, `${item}.target`);
        if (
          !action.target.identifier &&
          !action.target.ref &&
          !action.target.label &&
          !action.target.text
        ) {
          appMapFail("invalid-map", `${item}.target requires a semantic selector`);
        }
        if (
          action.direction !== undefined &&
          action.direction !== "up" &&
          action.direction !== "down" &&
          action.direction !== "auto"
        ) {
          appMapFail("invalid-map", `${item}.direction is unsupported`);
        }
        if (action.maxAttempts !== undefined)
          safeInteger(action.maxAttempts, `${item}.maxAttempts`);
        break;
      case "back":
      case "home":
        break;
      case "app":
        if (!(action.action === "open" || action.action === "close")) {
          appMapFail("invalid-map", `${item}.action is unsupported`);
        }
        optionalText(action.app, `${item}.app`);
        if (action.action === "open") {
          optionalText(action.url, `${item}.url`);
          if (action.relaunch !== undefined && typeof action.relaunch !== "boolean") {
            appMapFail("invalid-map", `${item}.relaunch must be a boolean`);
          }
          if (!action.app && !action.url) {
            appMapFail("invalid-map", `${item} must name an app or URL to open`);
          }
        } else if (!action.app) {
          appMapFail("invalid-map", `${item} must name an app to close`);
        }
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
