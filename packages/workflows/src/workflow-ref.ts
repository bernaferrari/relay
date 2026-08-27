import type { FrozenRunTestIdentity, WorkflowRef } from "./types.js";

export type RunWorkflowReference = {
  schemaVersion: 1;
  kind: "run-test";
  jobId: string;
  frozen: FrozenRunTestIdentity;
};

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeRunWorkflowRef(reference: RunWorkflowReference): WorkflowRef {
  return `relay-workflow.v1.${encodeBase64Url(JSON.stringify(reference))}` as WorkflowRef;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTarget(value: unknown): FrozenRunTestIdentity["target"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const target = value as Record<string, unknown>;
  if (!nonEmptyString(target.targetId)) return undefined;
  if (target.kind === "browser" && target.platform === "browser") {
    return { kind: "browser", platform: "browser", targetId: target.targetId };
  }
  if (target.kind === "device" && (target.platform === "android" || target.platform === "ios")) {
    return { kind: "device", platform: target.platform, targetId: target.targetId };
  }
  return undefined;
}

/** References are untrusted input even though callers treat them as opaque. */
export function decodeRunWorkflowRef(ref: WorkflowRef): RunWorkflowReference | undefined {
  const prefix = "relay-workflow.v1.";
  if (!ref.startsWith(prefix)) return undefined;
  try {
    const raw = JSON.parse(decodeBase64Url(ref.slice(prefix.length))) as unknown;
    if (!raw || typeof raw !== "object") return undefined;
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== 1 || record.kind !== "run-test" || !nonEmptyString(record.jobId)) {
      return undefined;
    }
    if (!record.frozen || typeof record.frozen !== "object") return undefined;
    const frozen = record.frozen as Record<string, unknown>;
    const target = parseTarget(frozen.target);
    if (
      !target ||
      !nonEmptyString(frozen.appMapId) ||
      !Number.isInteger(frozen.appMapRevision) ||
      (frozen.appMapRevision as number) < 0 ||
      !nonEmptyString(frozen.testId) ||
      !nonEmptyString(frozen.planDigest)
    ) {
      return undefined;
    }
    return {
      schemaVersion: 1,
      kind: "run-test",
      jobId: record.jobId,
      frozen: { ...(frozen as FrozenRunTestIdentity), target },
    };
  } catch {
    return undefined;
  }
}
