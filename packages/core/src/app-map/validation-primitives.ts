import { appMapFail } from "./errors.js";

export function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    appMapFail("invalid-map", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    appMapFail("invalid-map", `${label} must be a non-empty identifier of at most 128 characters`);
  }
}

export function requiredText(value: unknown, label: string, max = 2_000): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    appMapFail("invalid-map", `${label} must be a non-empty string of at most ${max} characters`);
  }
}

export function optionalText(value: unknown, label: string, max = 2_000): void {
  if (value !== undefined) requiredText(value, label, max);
}

export function finiteTimestamp(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    appMapFail("invalid-map", `${label} must be a non-negative finite number`);
  }
}

export function safeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    appMapFail("invalid-map", `${label} must be a non-negative safe integer`);
  }
}

export function stringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) appMapFail("invalid-map", `${label} must be an array`);
  const seen = new Set<string>();
  value.forEach((item, index) => {
    identifier(item, `${label}[${index}]`);
    if (seen.has(item as string)) appMapFail("duplicate-id", `${label} contains duplicate ${item}`);
    seen.add(item as string);
  });
}
