/**
 * Convert one saved App Map language Variable into the narrow locale-matrix
 * apply contract. Keeping this in core means the server never invents picker
 * navigation from a renderer selection, and list Variables retain their
 * recorded return path before a compiled Test body runs.
 */
import type { AppMap, AppMapVariable, VariableRow } from "@relay/protocol";
import type { LocaleRunScope } from "./locale-run.js";
import { resolveVariableApply } from "./option-run.js";

export type AppMapLanguageLocaleMatrixScope = {
  scope: LocaleRunScope;
  /** Android's OS-level app-locale contract cannot run on iOS. */
  targetPlatform?: "android";
};

function optionTarget(row: VariableRow): { identifier?: string; label?: string; text?: string } {
  const identifier = row.identifier?.trim();
  const label = row.label?.trim();
  const text = row.text?.trim();
  if (identifier) return { identifier };
  if (label) return { label };
  if (text) return { text };
  throw new Error(`Language Variable option ${JSON.stringify(row.id)} has no recorded selector`);
}

function requestedLocaleIds(variable: AppMapVariable, requested?: readonly string[]): string[] {
  const available = new Map(
    variable.options
      .map((option) => [option.id.trim(), option] as const)
      .filter(([id]) => Boolean(id)),
  );
  const candidates = requested?.length
    ? requested.map((locale) => locale.trim()).filter(Boolean)
    : [...available.keys()];
  const selected = [...new Set(candidates)];
  if (!selected.length)
    throw new Error(`Language Variable ${JSON.stringify(variable.name)} has no values`);
  for (const id of selected) {
    if (!available.has(id)) {
      throw new Error(
        `Language Variable ${JSON.stringify(variable.name)} has no value ${JSON.stringify(id)}`,
      );
    }
  }
  return selected;
}

/**
 * Derive only from the saved map. A Test-specific Locale Matrix may choose a
 * subset of the Variable's saved values, but it may not substitute unrecorded
 * targets or navigation supplied by the browser.
 */
export function localeMatrixScopeFromAppMapLanguageVariable(input: {
  map: AppMap;
  variableId: string;
  locales?: readonly string[];
  profileId?: string;
  preset?: "grok";
}): AppMapLanguageLocaleMatrixScope {
  const variable = input.map.variables[input.variableId];
  if (!variable) throw new Error(`Language Variable ${input.variableId} not found`);
  if (variable.kind !== "language") {
    throw new Error(`${JSON.stringify(variable.name)} is not a language Variable`);
  }
  if (variable.apply.kind === "toggle") {
    throw new Error(`${JSON.stringify(variable.name)} is not a locale-compatible Variable`);
  }
  const locales = requestedLocaleIds(variable, input.locales);
  const restoreId = variable.restoreId?.trim();
  if (restoreId && !variable.options.some((option) => option.id.trim() === restoreId)) {
    throw new Error(
      `Language Variable ${JSON.stringify(variable.name)} has no restore value ${JSON.stringify(restoreId)}`,
    );
  }
  if (variable.apply.kind === "appLocale") {
    return {
      scope: {
        locales,
        app: variable.apply.app,
        appLocale: variable.apply.app,
        ...(variable.apply.relaunch === false ? { relaunch: false } : {}),
        ...(restoreId ? { restoreLocale: restoreId } : {}),
        restoreAtEnd: true,
        screenshotEachLocale: variable.screenshotEach !== false,
      },
      targetPlatform: "android",
    };
  }

  const resolved = resolveVariableApply(variable, input.map, {
    ...(input.profileId?.trim() ? { profileId: input.profileId.trim() } : {}),
    ...(input.preset ? { preset: input.preset } : {}),
  });
  if (!resolved.entry.length) {
    throw new Error(`Record how ${JSON.stringify(variable.name)} opens before running a Test`);
  }
  if (!resolved.exit.length) {
    throw new Error(
      `Record how ${JSON.stringify(variable.name)} returns to the Test before running`,
    );
  }
  const requiredOptionIds = new Set([...locales, ...(restoreId ? [restoreId] : [])]);
  const languageOptions = Object.fromEntries(
    variable.options
      .filter((option) => requiredOptionIds.has(option.id.trim()))
      .map((option) => [option.id.trim(), optionTarget(option)]),
  );
  return {
    scope: {
      locales,
      entryPath: resolved.entry,
      exitPath: resolved.exit,
      languageOptions,
      ...(restoreId ? { restoreLocale: restoreId } : {}),
      restoreAtEnd: true,
      screenshotEachLocale: variable.screenshotEach !== false,
    },
  };
}
