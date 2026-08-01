import type { ActorKind } from "./coordination.js";

export const COLLABORATION_TRANSPORT_LIMITS = Object.freeze({
  updateBytes: 4 * 1024 * 1024,
  stateVectorBytes: 256 * 1024,
  clientUpdateIdLength: 128,
  displayNameLength: 80,
  avatarTokenLength: 128,
  entityIdLength: 256,
} as const);

export type CollaborationDocumentStatus = "ready" | "repaired";

export type CollaborationDocumentMetrics = {
  documentBytes: number;
  updateBytes: number;
  pendingUpdates: number;
  repairedTailBytes: number;
};

export type CollaborationDocumentResponse = CollaborationDocumentMetrics & {
  schemaVersion: 1;
  journeyId: string;
  updateBase64: string;
  stateVectorBase64: string;
  status: CollaborationDocumentStatus;
};

export type CollaborationAppendResponse = CollaborationDocumentResponse & {
  clientUpdateId: string;
  applied: boolean;
  duplicate: boolean;
};

export type CollaborationBootstrapInput = { journeyId: string };
export type CollaborationSyncInput = { journeyId: string; stateVectorBase64: string };
export type CollaborationAppendInput = {
  journeyId: string;
  updateBase64: string;
  clientUpdateId: string;
};
export type CollaborationJourneyInput = { journeyId: string };

export type CollaborationActivity = "editing" | "recording" | "running" | "idle";
export type CollaborationCanvasPoint = { x: number; y: number };
export type CollaborationViewport = CollaborationCanvasPoint & {
  zoom: number;
  width: number;
  height: number;
};
export type CollaborationSelection = {
  screenId?: string;
  connectionId?: string;
};

/** Actor identity and timestamps are intentionally absent and server-derived. */
export type CollaborationAwarenessPublishInput = {
  journeyId: string;
  displayName?: string;
  avatarToken?: string;
  cursor?: CollaborationCanvasPoint;
  selection?: CollaborationSelection;
  viewport?: CollaborationViewport;
  activity: CollaborationActivity;
};

export type CollaborationAwareness = Omit<CollaborationAwarenessPublishInput, "journeyId"> & {
  actorId: string;
  actorKind: ActorKind;
  updatedAt: number;
  expiresAt: number;
};

export type CollaborationAwarenessListResponse = {
  journeyId: string;
  awareness: CollaborationAwareness[];
  serverTime: number;
};

export type CollaborationAwarenessResponse = {
  journeyId: string;
  awareness: CollaborationAwareness;
};

export type CollaborationAwarenessRemoveResponse = {
  journeyId: string;
  removed: boolean;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedIdentifier(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new TypeError(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value)) {
    throw new TypeError(`${label} must be a canonical opaque identifier`);
  }
  return value;
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function canonicalBase64(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) {
    throw new TypeError(`${label} must be canonical padded base64`);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError(`${label} must be canonical padded base64`);
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = (value.length / 4) * 3 - padding;
  if (bytes < 1 || bytes > maximumBytes) {
    throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (padding === 2 && (alphabet.indexOf(value.at(-3)!) & 0x0f) !== 0) {
    throw new TypeError(`${label} has non-canonical padding bits`);
  }
  if (padding === 1 && (alphabet.indexOf(value.at(-2)!) & 0x03) !== 0) {
    throw new TypeError(`${label} has non-canonical padding bits`);
  }
  return value;
}

function assertAllowedKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(input).find((key) => !allowedSet.has(key));
  if (unexpected) throw new TypeError(`${label} contains unsupported field ${unexpected}`);
}

export function parseCollaborationJourneyInput(value: unknown): CollaborationJourneyInput {
  const input = object(value, "collaboration Journey input");
  assertAllowedKeys(input, ["journeyId"], "collaboration Journey input");
  return { journeyId: boundedIdentifier(input.journeyId, "journeyId") };
}

export function parseCollaborationSyncInput(value: unknown): CollaborationSyncInput {
  const input = object(value, "collaboration sync input");
  assertAllowedKeys(input, ["journeyId", "stateVectorBase64"], "collaboration sync input");
  return {
    journeyId: boundedIdentifier(input.journeyId, "journeyId"),
    stateVectorBase64: canonicalBase64(
      input.stateVectorBase64,
      "stateVectorBase64",
      COLLABORATION_TRANSPORT_LIMITS.stateVectorBytes,
    ),
  };
}

export function parseCollaborationAppendInput(value: unknown): CollaborationAppendInput {
  const input = object(value, "collaboration append input");
  assertAllowedKeys(
    input,
    ["journeyId", "updateBase64", "clientUpdateId"],
    "collaboration append input",
  );
  return {
    journeyId: boundedIdentifier(input.journeyId, "journeyId"),
    updateBase64: canonicalBase64(
      input.updateBase64,
      "updateBase64",
      COLLABORATION_TRANSPORT_LIMITS.updateBytes,
    ),
    clientUpdateId: boundedIdentifier(
      input.clientUpdateId,
      "clientUpdateId",
      COLLABORATION_TRANSPORT_LIMITS.clientUpdateIdLength,
    ),
  };
}

function point(value: unknown, label: string): CollaborationCanvasPoint {
  const input = object(value, label);
  assertAllowedKeys(input, ["x", "y"], label);
  return {
    x: boundedNumber(input.x, `${label}.x`, -10_000_000, 10_000_000),
    y: boundedNumber(input.y, `${label}.y`, -10_000_000, 10_000_000),
  };
}

function optionalLabel(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError(`${label} must be a privacy-safe label of at most ${maximum} characters`);
  }
  return normalized;
}

export function parseCollaborationAwarenessPublishInput(
  value: unknown,
): CollaborationAwarenessPublishInput {
  const input = object(value, "collaboration awareness input");
  assertAllowedKeys(
    input,
    ["journeyId", "displayName", "avatarToken", "cursor", "selection", "viewport", "activity"],
    "collaboration awareness input",
  );
  if (!(["editing", "recording", "running", "idle"] as unknown[]).includes(input.activity)) {
    throw new TypeError("activity must be editing, recording, running, or idle");
  }
  const displayName = optionalLabel(
    input.displayName,
    "displayName",
    COLLABORATION_TRANSPORT_LIMITS.displayNameLength,
  );
  const avatarToken =
    input.avatarToken === undefined
      ? undefined
      : boundedIdentifier(
          input.avatarToken,
          "avatarToken",
          COLLABORATION_TRANSPORT_LIMITS.avatarTokenLength,
        );
  const cursor = input.cursor === undefined ? undefined : point(input.cursor, "cursor");
  let selection: CollaborationSelection | undefined;
  if (input.selection !== undefined) {
    const selected = object(input.selection, "selection");
    assertAllowedKeys(selected, ["screenId", "connectionId"], "selection");
    const screenId =
      selected.screenId === undefined
        ? undefined
        : boundedIdentifier(
            selected.screenId,
            "selection.screenId",
            COLLABORATION_TRANSPORT_LIMITS.entityIdLength,
          );
    const connectionId =
      selected.connectionId === undefined
        ? undefined
        : boundedIdentifier(
            selected.connectionId,
            "selection.connectionId",
            COLLABORATION_TRANSPORT_LIMITS.entityIdLength,
          );
    if (!screenId && !connectionId) throw new TypeError("selection must identify an entity");
    selection = { ...(screenId ? { screenId } : {}), ...(connectionId ? { connectionId } : {}) };
  }
  let viewport: CollaborationViewport | undefined;
  if (input.viewport !== undefined) {
    const raw = object(input.viewport, "viewport");
    assertAllowedKeys(raw, ["x", "y", "zoom", "width", "height"], "viewport");
    viewport = {
      ...point({ x: raw.x, y: raw.y }, "viewport"),
      zoom: boundedNumber(raw.zoom, "viewport.zoom", 0.01, 100),
      width: boundedNumber(raw.width, "viewport.width", 0, 1_000_000),
      height: boundedNumber(raw.height, "viewport.height", 0, 1_000_000),
    };
  }
  return {
    journeyId: boundedIdentifier(input.journeyId, "journeyId"),
    activity: input.activity as CollaborationActivity,
    ...(displayName ? { displayName } : {}),
    ...(avatarToken ? { avatarToken } : {}),
    ...(cursor ? { cursor } : {}),
    ...(selection ? { selection } : {}),
    ...(viewport ? { viewport } : {}),
  };
}

function parseAwareness(value: unknown): CollaborationAwareness {
  const input = object(value, "collaboration awareness");
  const publish = parseCollaborationAwarenessPublishInput({
    journeyId: "response",
    activity: input.activity,
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.avatarToken !== undefined ? { avatarToken: input.avatarToken } : {}),
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(input.selection !== undefined ? { selection: input.selection } : {}),
    ...(input.viewport !== undefined ? { viewport: input.viewport } : {}),
  });
  return {
    actorId: boundedIdentifier(input.actorId, "actorId", 128),
    actorKind:
      input.actorKind === "human" || input.actorKind === "agent" || input.actorKind === "system"
        ? input.actorKind
        : (() => {
            throw new TypeError("actorKind must be human, agent, or system");
          })(),
    activity: publish.activity,
    ...(publish.displayName ? { displayName: publish.displayName } : {}),
    ...(publish.avatarToken ? { avatarToken: publish.avatarToken } : {}),
    ...(publish.cursor ? { cursor: publish.cursor } : {}),
    ...(publish.selection ? { selection: publish.selection } : {}),
    ...(publish.viewport ? { viewport: publish.viewport } : {}),
    updatedAt: boundedNumber(input.updatedAt, "updatedAt", 0, Number.MAX_SAFE_INTEGER),
    expiresAt: boundedNumber(input.expiresAt, "expiresAt", 0, Number.MAX_SAFE_INTEGER),
  };
}

function documentResponse(value: unknown): CollaborationDocumentResponse {
  const input = object(value, "collaboration document response");
  if (input.schemaVersion !== 1) throw new TypeError("collaboration schemaVersion must be 1");
  if (input.status !== "ready" && input.status !== "repaired") {
    throw new TypeError("collaboration status must be ready or repaired");
  }
  return {
    schemaVersion: 1,
    journeyId: boundedIdentifier(input.journeyId, "journeyId"),
    updateBase64: canonicalBase64(
      input.updateBase64,
      "updateBase64",
      COLLABORATION_TRANSPORT_LIMITS.updateBytes,
    ),
    stateVectorBase64: canonicalBase64(
      input.stateVectorBase64,
      "stateVectorBase64",
      COLLABORATION_TRANSPORT_LIMITS.stateVectorBytes,
    ),
    status: input.status,
    documentBytes: boundedNumber(
      input.documentBytes,
      "documentBytes",
      1,
      COLLABORATION_TRANSPORT_LIMITS.updateBytes,
    ),
    updateBytes: boundedNumber(
      input.updateBytes,
      "updateBytes",
      1,
      COLLABORATION_TRANSPORT_LIMITS.updateBytes,
    ),
    pendingUpdates: boundedNumber(input.pendingUpdates, "pendingUpdates", 0, 1_000_000),
    repairedTailBytes: boundedNumber(
      input.repairedTailBytes,
      "repairedTailBytes",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export const parseCollaborationDocumentResponse = documentResponse;

export function parseCollaborationAppendResponse(value: unknown): CollaborationAppendResponse {
  const input = object(value, "collaboration append response");
  const response = documentResponse(input);
  if (typeof input.applied !== "boolean" || typeof input.duplicate !== "boolean") {
    throw new TypeError("collaboration append flags must be booleans");
  }
  return {
    ...response,
    clientUpdateId: boundedIdentifier(
      input.clientUpdateId,
      "clientUpdateId",
      COLLABORATION_TRANSPORT_LIMITS.clientUpdateIdLength,
    ),
    applied: input.applied,
    duplicate: input.duplicate,
  };
}

export function parseCollaborationAwarenessResponse(
  value: unknown,
): CollaborationAwarenessResponse {
  const input = object(value, "collaboration awareness response");
  return {
    journeyId: boundedIdentifier(input.journeyId, "journeyId"),
    awareness: parseAwareness(input.awareness),
  };
}

export function parseCollaborationAwarenessListResponse(
  value: unknown,
): CollaborationAwarenessListResponse {
  const input = object(value, "collaboration awareness list response");
  if (!Array.isArray(input.awareness)) throw new TypeError("awareness must be an array");
  return {
    journeyId: boundedIdentifier(input.journeyId, "journeyId"),
    awareness: input.awareness.map(parseAwareness),
    serverTime: boundedNumber(input.serverTime, "serverTime", 0, Number.MAX_SAFE_INTEGER),
  };
}

export function parseCollaborationAwarenessRemoveResponse(
  value: unknown,
): CollaborationAwarenessRemoveResponse {
  const input = object(value, "collaboration awareness remove response");
  if (typeof input.removed !== "boolean") throw new TypeError("removed must be a boolean");
  return {
    journeyId: boundedIdentifier(input.journeyId, "journeyId"),
    removed: input.removed,
  };
}
