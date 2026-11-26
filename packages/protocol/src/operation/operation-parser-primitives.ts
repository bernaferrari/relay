/** Validation helpers for the iOS lifecycle and mutation record readers. */
import type { OperationRecord } from "./operation-contract.js";

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
