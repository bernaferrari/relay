import type {
  FrozenAuthorTestIdentity,
  FrozenRepeatTestIdentity,
  FrozenRunTestIdentity,
  WorkflowRef,
} from "./types.js";
import { repeatPilotSpecSchema, repeatSpecSchema } from "@relay/protocol";

export type RunWorkflowReference = {
  schemaVersion: 1;
  kind: "run-test";
  jobId: string;
  frozen: FrozenRunTestIdentity;
};

export type AuthoringWorkflowReference = {
  schemaVersion: 1;
  kind: "author-test";
  sessionId: string;
  frozen: FrozenAuthorTestIdentity;
};

export type RepeatWorkflowReference = {
  schemaVersion: 1;
  kind: "repeat-test";
  repeatId: string;
  pilotJobId: string;
  selectedCaseIds: string[];
  frozen: FrozenRepeatTestIdentity;
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

export function encodeAuthoringWorkflowRef(reference: AuthoringWorkflowReference): WorkflowRef {
  return `relay-workflow.v1.${encodeBase64Url(JSON.stringify(reference))}` as WorkflowRef;
}

export function encodeRepeatWorkflowRef(reference: RepeatWorkflowReference): WorkflowRef {
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
      !nonEmptyString(frozen.planDigest) ||
      (frozen.targetProfileId !== undefined && !nonEmptyString(frozen.targetProfileId)) ||
      (frozen.workflowRequestId !== undefined && !nonEmptyString(frozen.workflowRequestId))
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

/** Authoring references identify only the canonical session plus the immutable
 * intent facts needed to project it. Take revisions and evidence stay owned by
 * the Authoring Session and are always read afresh. */
export function decodeAuthoringWorkflowRef(
  ref: WorkflowRef,
): AuthoringWorkflowReference | undefined {
  const prefix = "relay-workflow.v1.";
  if (!ref.startsWith(prefix)) return undefined;
  try {
    const raw = JSON.parse(decodeBase64Url(ref.slice(prefix.length))) as unknown;
    if (!raw || typeof raw !== "object") return undefined;
    const record = raw as Record<string, unknown>;
    if (
      record.schemaVersion !== 1 ||
      record.kind !== "author-test" ||
      !nonEmptyString(record.sessionId) ||
      !record.frozen ||
      typeof record.frozen !== "object"
    ) {
      return undefined;
    }
    const frozen = record.frozen as Record<string, unknown>;
    const target = parseTarget(frozen.target);
    if (
      !target ||
      !nonEmptyString(frozen.title) ||
      !nonEmptyString(frozen.actorId) ||
      !nonEmptyString(frozen.appMapId) ||
      !Number.isInteger(frozen.appMapRevision) ||
      (frozen.appMapRevision as number) < 0
    ) {
      return undefined;
    }
    for (const field of ["sourceScreenId", "pendingConnectionId", "group"] as const) {
      if (frozen[field] !== undefined && !nonEmptyString(frozen[field])) return undefined;
    }
    return {
      schemaVersion: 1,
      kind: "author-test",
      sessionId: record.sessionId,
      frozen: { ...(frozen as FrozenAuthorTestIdentity), target },
    };
  } catch {
    return undefined;
  }
}

export function decodeRepeatWorkflowRef(ref: WorkflowRef): RepeatWorkflowReference | undefined {
  const prefix = "relay-workflow.v1.";
  if (!ref.startsWith(prefix)) return undefined;
  try {
    const raw = JSON.parse(decodeBase64Url(ref.slice(prefix.length))) as unknown;
    if (!raw || typeof raw !== "object") return undefined;
    const record = raw as Record<string, unknown>;
    if (
      record.schemaVersion !== 1 ||
      record.kind !== "repeat-test" ||
      !nonEmptyString(record.repeatId) ||
      !nonEmptyString(record.pilotJobId) ||
      !Array.isArray(record.selectedCaseIds) ||
      record.selectedCaseIds.length === 0 ||
      record.selectedCaseIds.some((id) => !nonEmptyString(id)) ||
      new Set(record.selectedCaseIds).size !== record.selectedCaseIds.length ||
      !record.frozen ||
      typeof record.frozen !== "object"
    ) {
      return undefined;
    }
    const frozen = record.frozen as Record<string, unknown>;
    const target = parseTarget(frozen.target);
    const repeat = repeatSpecSchema.safeParse(frozen.repeat);
    const resolved = frozen.resolved as Record<string, unknown> | undefined;
    const resolvedDimensions = resolved?.dimensions;
    const resolvedPilot = repeatPilotSpecSchema.safeParse(resolved?.pilot);
    const specifiedPilot =
      resolvedPilot.success && resolvedPilot.data.mode === "specified"
        ? resolvedPilot.data
        : undefined;
    if (
      !target ||
      !nonEmptyString(frozen.appMapId) ||
      !Number.isInteger(frozen.requestedAppMapRevision) ||
      (frozen.requestedAppMapRevision as number) < 0 ||
      !Number.isInteger(frozen.executionAppMapRevision) ||
      (frozen.executionAppMapRevision as number) < 0 ||
      !nonEmptyString(frozen.testId) ||
      !nonEmptyString(frozen.testPlanDigest) ||
      !nonEmptyString(frozen.rootRecipeId) ||
      !repeat.success ||
      !resolved ||
      !Array.isArray(resolvedDimensions) ||
      resolvedDimensions.length !== repeat.data.dimensions.length ||
      resolvedDimensions.some((raw, index) => {
        if (!raw || typeof raw !== "object") return true;
        const dimension = raw as Record<string, unknown>;
        const requested = repeat.data.dimensions[index];
        return (
          !nonEmptyString(dimension.id) ||
          dimension.id !== requested?.id ||
          !Array.isArray(dimension.valueIds) ||
          dimension.valueIds.length === 0 ||
          dimension.valueIds.some((id) => !nonEmptyString(id)) ||
          new Set(dimension.valueIds).size !== dimension.valueIds.length
        );
      }) ||
      (resolved.strategy !== "cartesian" &&
        resolved.strategy !== "zip" &&
        resolved.strategy !== "pairwise") ||
      (resolved.resume !== "untouched" &&
        resolved.resume !== "failed" &&
        resolved.resume !== "all") ||
      !resolvedPilot.success ||
      (specifiedPilot &&
        (Object.keys(specifiedPilot.case).length !== repeat.data.dimensions.length ||
          repeat.data.dimensions.some(
            (dimension) => !nonEmptyString(specifiedPilot.case[dimension.id]),
          )))
    ) {
      return undefined;
    }
    if (frozen.evidence !== "visual" && frozen.evidence !== "smoke") {
      return undefined;
    }
    const capture = frozen.capture as Record<string, unknown> | undefined;
    if (
      capture &&
      (!Array.isArray(capture.fullSurfaceScreenIds) ||
        capture.fullSurfaceScreenIds.length === 0 ||
        capture.fullSurfaceScreenIds.some((id) => !nonEmptyString(id)) ||
        new Set(capture.fullSurfaceScreenIds).size !== capture.fullSurfaceScreenIds.length)
    ) {
      return undefined;
    }
    return {
      schemaVersion: 1,
      kind: "repeat-test",
      repeatId: record.repeatId,
      pilotJobId: record.pilotJobId,
      selectedCaseIds: [...record.selectedCaseIds],
      frozen: {
        ...(frozen as FrozenRepeatTestIdentity),
        target,
        repeat: repeat.data,
        resolved: {
          dimensions: (resolvedDimensions as Array<{ id: string; valueIds: string[] }>).map(
            (dimension) => ({ id: dimension.id, valueIds: [...dimension.valueIds] }),
          ),
          strategy: resolved.strategy as FrozenRepeatTestIdentity["resolved"]["strategy"],
          pilot: resolvedPilot.data,
          resume: resolved.resume as FrozenRepeatTestIdentity["resolved"]["resume"],
        },
      },
    };
  } catch {
    return undefined;
  }
}
