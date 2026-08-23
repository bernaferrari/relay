/**
 * Runtime validation primitives shared by every operation parser.
 *
 * These stay at the bottom of the protocol graph: they know about
 * `OperationRecord` and `RuntimeParser` and nothing else.
 */
import type { OperationRecord, RuntimeParser } from "./operation-contract.js";

export function fail(label: string, message: string): never {
  throw new Error(`${label} ${message}`);
}

export function record(value: unknown, label: string): OperationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(label, "must be an object");
  }
  return value as OperationRecord;
}

export function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) return fail(label, "must be a non-empty string");
  return value;
}

export function number(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fail(label, "must be a number");
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return fail(label, "must be a boolean");
  return value;
}

export const emptyInputParser: RuntimeParser<Record<string, never>> = {
  description: "empty object",
  parse(value) {
    const input = record(value, "operation input");
    if (Object.keys(input).length) fail("operation input", "must be empty");
    return {};
  },
};

export function objectParser<T extends OperationRecord>(
  description: string,
  validate?: (input: OperationRecord) => void,
): RuntimeParser<T> {
  return {
    description,
    parse(value) {
      const input = record(value, description);
      validate?.(input);
      return input as T;
    },
  };
}

export function arrayFieldParser<T extends OperationRecord>(
  description: string,
  field: string,
): RuntimeParser<T> {
  return objectParser<T>(description, (input) => {
    if (!Array.isArray(input[field])) fail(`${description} ${field}`, "must be an array");
  });
}

export function objectFieldParser<T extends OperationRecord>(
  description: string,
  field: string,
): RuntimeParser<T> {
  return objectParser<T>(description, (input) => record(input[field], `${description} ${field}`));
}
