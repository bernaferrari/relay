/**
 * Parse browser-only actuation steps. Every shape here is a physical browser
 * interaction native targets reject at the platform gate, and every target
 * must resolve through the browser actuation contract: an identifier or
 * label the locator can prove, or an explicit point. Keeping this family in
 * one module keeps the recipe parser's product-flow cases easier to review.
 */
import { isAbsolute } from "node:path";
import type { RecipeStep, StepTarget } from "@relay/protocol";
import { isNumber, isString, parseTarget, stepErr } from "./recipe-validation-support.js";

/** Browser actuation resolves identifiers and labels semantically or falls
 * back to an explicit point. Ref/text/relation strategies have no browser
 * locator contract, and a relativeTo point is resolved by a browser runtime
 * that does not exist yet, so accepting any of them here would defer a
 * certain failure to execution time. */
function browserActuatableTarget(target: StepTarget): boolean {
  const point = target.point && !target.point.relativeTo ? target.point : undefined;
  return Boolean(target.identifier?.trim() || target.label?.trim() || point);
}

function parseActuationTarget(
  raw: unknown,
  index: number,
  field: string,
  stepKind: string,
): StepTarget {
  const target = parseTarget(raw, index, field);
  if (!browserActuatableTarget(target)) {
    throw stepErr(
      index,
      `${stepKind} requires ${field} with at least one of identifier/label/point`,
    );
  }
  return target;
}

export function parseActuationRecipeStep(
  raw: Record<string, unknown>,
  kind: string,
  index: number,
  note?: string,
): RecipeStep | undefined {
  switch (kind) {
    case "hover": {
      const target = parseActuationTarget(raw.target, index, "target", "hover");
      return { kind: "hover", target, ...(note ? { note } : {}) };
    }
    case "select": {
      const target = parseTarget(raw.target, index, "target");
      if (!target.identifier?.trim() && !target.label?.trim()) {
        throw stepErr(index, "select requires a semantic identifier or label target");
      }
      if (!isString(raw.option) || !raw.option.trim()) {
        throw stepErr(index, "select requires option: string");
      }
      return { kind: "select", target, option: raw.option, ...(note ? { note } : {}) };
    }
    case "press-key": {
      const keys = [
        "escape",
        "tab",
        "enter",
        "backspace",
        "delete",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        "home",
        "end",
        "pageup",
        "pagedown",
        "a",
        "c",
        "k",
        "v",
        "x",
        "z",
      ] as const;
      if (!isString(raw.key) || !(keys as readonly string[]).includes(raw.key)) {
        throw stepErr(index, `press-key requires key: one of ${keys.join(", ")}`);
      }
      const modifierNames = ["control", "meta", "shift", "alt", "controlOrMeta"] as const;
      let modifiers: Extract<RecipeStep, { kind: "press-key" }>["modifiers"];
      if (raw.modifiers !== undefined) {
        if (
          !Array.isArray(raw.modifiers) ||
          raw.modifiers.some((m) => !(modifierNames as readonly string[]).includes(m as string))
        ) {
          throw stepErr(index, `press-key modifiers must be some of ${modifierNames.join(", ")}`);
        }
        modifiers = raw.modifiers as Extract<RecipeStep, { kind: "press-key" }>["modifiers"];
      }
      return {
        kind: "press-key",
        key: raw.key as (typeof keys)[number],
        ...(modifiers?.length ? { modifiers } : {}),
        ...(note ? { note } : {}),
      };
    }
    case "drag": {
      const from = parseActuationTarget(raw.from, index, "from", "drag");
      const to = parseActuationTarget(raw.to, index, "to", "drag");
      return { kind: "drag", from, to, ...(note ? { note } : {}) };
    }
    case "upload-file": {
      if (!isString(raw.file) || !raw.file.trim()) {
        throw stepErr(index, "upload-file requires file: string");
      }
      // The file reference is a workspace-relative path by contract. Absolute
      // paths are rejected here; traversal and symlink escapes are rejected
      // at execution time, where the workspace root is real.
      if (isAbsolute(raw.file)) {
        throw stepErr(index, "upload-file file must be workspace-relative, not absolute");
      }
      const target =
        raw.target === undefined ? undefined : parseTarget(raw.target, index, "target");
      if (target && !browserActuatableTarget(target)) {
        throw stepErr(index, "upload-file target needs at least one of identifier/label/point");
      }
      return {
        kind: "upload-file",
        file: raw.file,
        ...(target ? { target } : {}),
        ...(note ? { note } : {}),
      };
    }
    case "switch-tab": {
      const hasIndex = raw.index !== undefined;
      const hasUrl = raw.url !== undefined;
      if (hasIndex === hasUrl) {
        throw stepErr(index, "switch-tab requires exactly one of index or url");
      }
      if (hasIndex) {
        if (!isNumber(raw.index) || !Number.isInteger(raw.index) || raw.index < 0) {
          throw stepErr(index, "switch-tab index must be a non-negative integer");
        }
        return { kind: "switch-tab", index: raw.index, ...(note ? { note } : {}) };
      }
      if (!isString(raw.url) || !raw.url.trim()) {
        throw stepErr(index, "switch-tab requires url: non-empty string");
      }
      return { kind: "switch-tab", url: raw.url, ...(note ? { note } : {}) };
    }
    default:
      return undefined;
  }
}
