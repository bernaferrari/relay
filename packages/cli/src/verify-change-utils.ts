import { createHash } from "node:crypto";
import { UsageError } from "./errors.js";

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function boundedText(value: unknown, label: string, max = 4_096): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new UsageError(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

export function boundedInteger(value: unknown, label: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new UsageError(`${label} must be a positive integer no greater than ${max}`);
  }
  return value;
}

export function configError(label: string, error: unknown): UsageError {
  const detail = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
  return new UsageError(`${label} is invalid${detail ? `: ${detail.slice(0, 512)}` : ""}`);
}

/** Stable transport identity for one logical verify-change mutation. A CLI
 * restart therefore adopts the server's existing Proof/job instead of
 * dispatching the same target action again under a fresh random request ID. */
export function verifyChangeRequestIdentity(
  action: string,
  ...parts: readonly (string | number)[]
): { requestId: string; idempotencyKey: string } {
  const digest = createHash("sha256")
    .update([action, ...parts.map(String)].join("\0"))
    .digest("hex");
  const identity = `verify-change-${action}-${digest}`.slice(0, 240);
  return { requestId: identity, idempotencyKey: identity };
}
