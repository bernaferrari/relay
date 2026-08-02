import type { TestVariable } from "@relay/protocol";
import type { Recipe } from "./recipes.js";

export const PRIVATE_INPUT = "[private]";

function collectStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value as Record<string, unknown>)) collectStrings(child, visit);
}

/** Input placeholders are the execution dependency boundary. Project variables
 * that are not referenced by the frozen recipe graph must never affect a run. */
export function referencedRecipeInputNames(recipes: Record<string, Recipe> | Recipe): string[] {
  const names = new Set<string>();
  collectStrings(recipes, (value) => {
    for (const match of value.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) {
      const name = match[1]?.trim();
      if (name) names.add(name);
    }
  });
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function referencedVariableIds(
  recipes: Record<string, Recipe> | Recipe,
  variables: TestVariable[],
): string[] {
  const names = new Set(referencedRecipeInputNames(recipes));
  return variables
    .filter((variable) => names.has(variable.name) || names.has(variable.id))
    .map((variable) => variable.id);
}

export function referencedRuntimeInputs(
  recipes: Record<string, Recipe> | Recipe,
  variables: TestVariable[],
  runtime: Record<string, string | string[]> | undefined,
): Record<string, string> {
  if (!runtime) return {};
  const definitions = new Map(
    variables.flatMap((variable) => [
      [variable.id, variable] as const,
      [variable.name, variable] as const,
    ]),
  );
  return Object.fromEntries(
    referencedRecipeInputNames(recipes).flatMap((reference) => {
      const definition = definitions.get(reference);
      const value = runtime[reference] ?? (definition ? runtime[definition.id] : undefined);
      return typeof value === "string" && value.trim()
        ? [[definition?.name ?? reference, value] as const]
        : [];
    }),
  );
}

export function sensitiveInputNames(
  variables: TestVariable[],
  values: Record<string, string>,
): string[] {
  return variables
    .filter(
      (variable) =>
        (variable.scope === "private" || variable.sensitive) &&
        (Object.hasOwn(values, variable.name) || Object.hasOwn(values, variable.id)),
    )
    .map((variable) => variable.name)
    .sort((left, right) => left.localeCompare(right));
}

function replaceSecrets(value: string, secrets: string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (!secret) continue;
    if (result === secret) return PRIVATE_INPUT;
    // Replacing tiny substrings would corrupt ordinary words and diagnostics.
    // They remain protected when they are a complete field, while normal
    // credentials and tokens are also removed when embedded in a message.
    if (secret.length >= 4) result = result.replaceAll(secret, PRIVATE_INPUT);
  }
  return result;
}

export function redactPrivateValue<T>(
  value: T,
  inputs: Record<string, string>,
  names: string[],
): T {
  const sensitive = new Set(names);
  const secrets = names.map((name) => inputs[name]).filter((item): item is string => Boolean(item));
  const visit = (current: unknown, key?: string): unknown => {
    if (key && sensitive.has(key)) return PRIVATE_INPUT;
    if (typeof current === "string") return replaceSecrets(current, secrets);
    if (Array.isArray(current)) return current.map((item) => visit(item));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .filter(([childKey]) => childKey !== "toJSON")
        .map(([childKey, child]) => [childKey, visit(child, childKey)]),
    );
  };
  return visit(value) as T;
}

export function redactPrivateInputs(
  inputs: Record<string, string>,
  names: string[],
): Record<string, string> {
  return redactPrivateValue(inputs, inputs, names);
}

/** Recursively sanitizes any live TestJob-like object nested in a transport
 * payload. Kept structural to avoid coupling the HTTP boundary to session
 * internals or requiring callers to remember a special DTO function. */
export function redactPrivateJobs<T>(value: T): T {
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    const record = current as Record<string, unknown>;
    if (
      record.resolvedInputs &&
      typeof record.resolvedInputs === "object" &&
      Array.isArray(record.sensitiveInputNames)
    ) {
      return redactPrivateValue(
        record,
        record.resolvedInputs as Record<string, string>,
        record.sensitiveInputNames.filter((item): item is string => typeof item === "string"),
      );
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value) as T;
}
